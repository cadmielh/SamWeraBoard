"""Cererile de documente (faza 4 din docs/plan-documente-client.md): cabinetul cere actele, clientul le încarcă prin
link, cabinetul le verifică.

Date:
- `workspaces/{wid}/cereriDocumente/{rid}`: clientul, actele cerute (fiecare cu stare: de_trimis → primit → acceptat
  sau respins, cu motiv), mesajul, expirarea, `deVerificat` (câte acte așteaptă verificarea). Citire pentru membri,
  scriere DOAR de aici. Nu conține tokenul, doar hash-ul lui.
- `portalTokens/{sha256(token)}`: {wid, rid} — legătura de la link la cerere (doar server). Tokenul în clar există
  doar în link și, criptat cu cheia cabinetului, în `portalTokens` (`tokenCriptat`), ca linkul să poată fi copiat
  din nou din aplicație.

Fișierele primite sunt documente obișnuite ale clientului (`fisiere`), cu `sursa: portal`, `stare: de_verificat`,
`cerereId`, `actId`, în folderul „Primite de la client”. La acceptare primesc numele actului și trec în folderul
potrivit; la respingere se șterg, iar actul se redeschide pe același link, cu motivul.

Rutele publice (`/portal/<token>`) nu cer cont: linkul e singura cheie. Răspund la fel („link_inactiv”) pentru un
token greșit, expirat, anulat sau al unui cabinet în mod citire, ca să nu dezvăluie nimic. Clientul vede doar
numele cabinetului, mesajul și actele; din fișierele trimise, doar numele și mărimea (fără conținut).
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from firebase_admin import firestore
from flask import Blueprint, jsonify, request
from google.cloud.firestore_v1.base_query import FieldFilter
from werkzeug.exceptions import RequestEntityTooLarge

import audit
import authz
import billing as _billing
import fisiere
import fisiere_api
import ratelimit
import vault

bp = Blueprint("cereri", __name__)

COLECTIE = "cereriDocumente"
TOKENURI = "portalTokens"
ZILE_IMPLICIT = 14
ZILE_MAX = 60
MAX_ACTE = 20
MAX_FISIERE_CERERE = 30
MAX_ETICHETA = 120
MAX_MESAJ = 1000
MAX_MOTIV = 300
TIPURI_ACT = ("ci", "dovada_sediu", "altul")
STARI_ACT = ("de_trimis", "primit", "acceptat", "respins")
FOLDER_PRIMITE = "Primite de la client"
FOLDER_ACTE_IDENTITATE = "Acte identitate"
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{30,64}$")
_ACT_RE = re.compile(r"^a\d{1,2}$")
_PORTAL_UID = "portal"          # „autorul” în jurnalul de acces pentru acțiunile clientului final


class _LinkInactiv(Exception):
    pass


def _err(code: str, status: int, **extra):
    return jsonify({"error": code, **extra}), status


@bp.errorhandler(authz.AuthError)
def _handle_auth(e: authz.AuthError):
    return authz.error_response(e)


@bp.errorhandler(fisiere.FisierRefuzat)
def _handle_refuzat(e: fisiere.FisierRefuzat):
    return _err(e.code, 400)


@bp.errorhandler(fisiere.StocareIndisponibila)
def _handle_stocare(_e):
    return _err("storage_unavailable", 503)


@bp.errorhandler(vault.VaultError)
def _handle_vault(_e):
    return _err("vault_unavailable", 503)


@bp.errorhandler(RequestEntityTooLarge)
def _handle_mare(_e):
    return _err("fisier_prea_mare", 413)


@bp.errorhandler(_LinkInactiv)
def _handle_inactiv(_e):
    return _err("link_inactiv", 404)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(v) -> str | None:
    return v.isoformat() if isinstance(v, datetime) else None


def _ws(wid: str):
    return authz.db().collection("workspaces").document(wid)


def _col(wid: str):
    return _ws(wid).collection(COLECTIE)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _link(token: str) -> str:
    baza = (os.getenv("FRONTEND_ORIGIN") or "").split(",")[0].strip().rstrip("/")
    return f"{baza}/p/{token}"


def _curat(raw, maxim: int) -> str:
    return re.sub(r"\s+", " ", str(raw or "")).strip()[:maxim]


def _body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _zile(raw, implicit: int = ZILE_IMPLICIT) -> int:
    try:
        z = int(raw if raw is not None else implicit)
    except (TypeError, ValueError):
        raise fisiere.FisierRefuzat("zile_invalide")
    if not 1 <= z <= ZILE_MAX:
        raise fisiere.FisierRefuzat("zile_invalide")
    return z


def de_verificat(acte: list[dict]) -> int:
    return sum(1 for a in acte if a.get("stare") == "primit")


def _expirata(d: dict, acum: datetime | None = None) -> bool:
    exp = d.get("expiraLa")
    return isinstance(exp, datetime) and exp <= (acum or _now())


def _out_cerere(rid: str, d: dict) -> dict:
    return {
        "id": rid, "clientId": d.get("clientId"), "clientNume": d.get("clientNume"), "mesaj": d.get("mesaj") or "",
        "acte": d.get("acte") or [], "stare": d.get("stare"), "deVerificat": d.get("deVerificat", 0),
        "expiraLa": _iso(d.get("expiraLa")), "deschisaLa": _iso(d.get("deschisaLa")),
        "creataLa": _iso(d.get("creataLa")), "creataDe": d.get("creataDe"),
    }


# ── Cabinetul ─────────────────────────────────────────────────────────────────

def _acte_din(raw) -> list[dict]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_ACTE:
        raise fisiere.FisierRefuzat("acte_invalide")
    acte = []
    for i, a in enumerate(raw):
        if not isinstance(a, dict):
            raise fisiere.FisierRefuzat("acte_invalide")
        eticheta = _curat(a.get("eticheta"), MAX_ETICHETA)
        tip = a.get("tip") if a.get("tip") in TIPURI_ACT else "altul"
        if not eticheta:
            raise fisiere.FisierRefuzat("acte_invalide")
        act = {"id": f"a{i + 1}", "eticheta": eticheta, "tip": tip, "stare": "de_trimis", "fisiere": []}
        pid = a.get("persoanaPid")
        if isinstance(pid, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", pid):
            act["persoanaPid"] = pid
        acte.append(act)
    return acte


@bp.post("/cereri")
def creeaza():
    principal, wid, ws = fisiere_api._require("member", billing=True, limit="fisiere_scriere")
    body = _body()
    cid = str(body.get("clientId") or "")
    if not fisiere_api._client_exista(wid, cid):
        return _err("not_found", 404)
    acte = _acte_din(body.get("acte"))
    zile = _zile(body.get("zile"))
    client = _ws(wid).collection("clienti").document(cid).get().to_dict() or {}

    token = secrets.token_urlsafe(24)               # 192 de biți
    ref = _col(wid).document()
    acum = _now()
    d = {
        "clientId": cid, "clientNume": _curat(client.get("denumire"), 200), "mesaj": _curat(body.get("mesaj"), MAX_MESAJ),
        "acte": acte, "stare": "deschisa", "deVerificat": 0, "expiraLa": acum + timedelta(days=zile),
        "tokenHash": _hash(token), "creataLa": acum, "creataDe": principal.uid, "actualizataLa": acum,
        # Numele afișat clientului pe link („cerere de la …”); adresa de e-mail a contului nu se arată.
        "cerutDe": "" if "@" in (principal.name or "") else _curat(principal.name, 120),
    }
    batch = authz.db().batch()
    batch.create(ref, d)
    batch.create(authz.db().collection(TOKENURI).document(d["tokenHash"]), {
        "wid": wid, "rid": ref.id, "creatLa": acum,
        "tokenCriptat": vault.encrypt_record(wid, "cerere", ref.id, {"token": token}),
    })
    batch.commit()
    audit.log(wid, principal.uid, "cerere.creare", ref.id, {"client": cid, "acte": len(acte), "zile": zile})
    return jsonify({"cerere": _out_cerere(ref.id, d), "link": _link(token)}), 201


def _cerere(wid: str, rid: str):
    if not fisiere_api._ID_RE.match(rid or ""):
        return None, None
    ref = _col(wid).document(rid)
    snap = ref.get()
    return (ref, snap.to_dict() or {}) if snap.exists else (None, None)


@bp.get("/cereri/<rid>/link")
def link(rid: str):
    principal, wid, _ = fisiere_api._require("member", limit="fisiere_citire")
    ref, d = _cerere(wid, rid)
    if not ref:
        return _err("not_found", 404)
    tok = authz.db().collection(TOKENURI).document(d.get("tokenHash") or "-").get()
    if not tok.exists or d.get("stare") == "anulata":
        return _err("link_inactiv", 404)
    token = vault.decrypt_record(wid, "cerere", rid, (tok.to_dict() or {}).get("tokenCriptat") or "")["token"]
    audit.log(wid, principal.uid, "cerere.link", rid)
    return jsonify({"link": _link(token)})


@bp.post("/cereri/<rid>/prelungeste")
def prelungeste(rid: str):
    principal, wid, _ = fisiere_api._require("member", billing=True, limit="fisiere_scriere")
    ref, d = _cerere(wid, rid)
    if not ref:
        return _err("not_found", 404)
    if d.get("stare") != "deschisa":
        return _err("cerere_inchisa", 409)
    zile = _zile(_body().get("zile"))
    patch = {"expiraLa": _now() + timedelta(days=zile), "actualizataLa": _now()}
    ref.update(patch)
    audit.log(wid, principal.uid, "cerere.prelungire", rid, {"zile": zile})
    return jsonify({"cerere": _out_cerere(rid, {**d, **patch})})


@bp.post("/cereri/<rid>/anuleaza")
def anuleaza(rid: str):
    """Linkul nu mai merge. Ce a trimis deja clientul rămâne și se poate verifica în continuare."""
    principal, wid, _ = fisiere_api._require("member", limit="fisiere_scriere")
    ref, d = _cerere(wid, rid)
    if not ref:
        return _err("not_found", 404)
    if d.get("stare") == "anulata":
        return jsonify({"cerere": _out_cerere(rid, d)})
    batch = authz.db().batch()
    patch = {"stare": "anulata", "actualizataLa": _now()}
    batch.update(ref, patch)
    if d.get("tokenHash"):
        batch.delete(authz.db().collection(TOKENURI).document(d["tokenHash"]))
    batch.commit()
    audit.log(wid, principal.uid, "cerere.anulare", rid)
    return jsonify({"cerere": _out_cerere(rid, {**d, **patch})})


def _folder_dupa_nume(wid: str, cid: str, nume: str, uid: str, creeaza: bool) -> str | None:
    """Folderul din rădăcina clientului cu numele dat (fără diferențe de litere mari/mici); creat dacă lipsește."""
    cheie = fisiere.cheie_nume(nume)
    for fid, f in fisiere_api._foldere_client(wid, cid).items():
        if f.get("parentId") is None and fisiere.cheie_nume(f.get("nume") or "") == cheie:
            return fid
    if not creeaza:
        return None
    ref = fisiere_api._col_foldere(wid).document()
    ref.set({"clientId": cid, "parentId": None, "nume": nume, "createdAt": _now(), "createdBy": uid})
    return ref.id


def _act(d: dict, aid: str) -> tuple[int, dict] | tuple[None, None]:
    for i, a in enumerate(d.get("acte") or []):
        if a.get("id") == aid:
            return i, a
    return None, None


class _ActModificat(Exception):
    """Între citire și scriere, clientul a mai trimis sau a retras un fișier la același act."""


@bp.errorhandler(_ActModificat)
def _handle_modificat(_e):
    return _err("act_modificat", 409)


def _schimba_act(ref, aid: str, fisiere_vazute: list[str] | None, schimbare) -> dict:
    """Aplică `schimbare(act) -> act nou` într-o tranzacție. Cu `fisiere_vazute`, doar dacă actul are exact acele
    fișiere (altfel _ActModificat: utilizatorul reîncarcă și vede noua stare). Cererea devine „completă” când toate
    actele sunt acceptate; `deVerificat` se recalculează."""
    @firestore.transactional
    def run(txn) -> dict:
        snap = ref.get(transaction=txn)
        d = snap.to_dict() if snap.exists else None
        if d is None:
            raise _ActModificat()
        acte = list(d.get("acte") or [])
        k, a = _act(d, aid)
        if a is None or (fisiere_vazute is not None and list(a.get("fisiere") or []) != fisiere_vazute):
            raise _ActModificat()
        acte[k] = schimbare(a)
        patch = {"acte": acte, "deVerificat": de_verificat(acte), "actualizataLa": _now()}
        if d.get("stare") == "deschisa" and all(x.get("stare") == "acceptat" for x in acte):
            patch["stare"] = "completa"
        txn.update(ref, patch)
        return {**d, **patch}

    return run(authz.db().transaction())


@bp.post("/cereri/<rid>/acte/<aid>/accepta")
def accepta(rid: str, aid: str):
    """Fișierele actului devin documente obișnuite ale clientului: numele actului („CI – Popescu Ion.jpg”), iar
    buletinele trec în „Acte identitate” dacă folderul există."""
    principal, wid, _ = fisiere_api._require("member", billing=True, limit="fisiere_scriere")
    ref, d = _cerere(wid, rid)
    if not ref:
        return _err("not_found", 404)
    _, act = _act(d, aid)
    if act is None:
        return _err("not_found", 404)
    if act.get("stare") != "primit":
        return _err("act_neprimit", 409)
    cid = d.get("clientId")
    tinta = _folder_dupa_nume(wid, cid, FOLDER_ACTE_IDENTITATE, principal.uid, creeaza=False) \
        if act.get("tip") == "ci" else None
    col = fisiere_api._col_fisiere(wid)
    for fid in act.get("fisiere") or []:
        snap = col.document(fid).get()
        f = snap.to_dict() if snap.exists else None
        if not f or f.get("cerereId") != rid or f.get("clientId") != cid:
            continue
        folder = tinta if tinta is not None else f.get("folderId")
        tip = fisiere.PDF if f.get("mime") == fisiere.PDF.mime else fisiere.JPEG
        dorit = fisiere.nume_fisier(f"{act.get('eticheta')}.{tip.ext}", tip)
        nume = fisiere_api._nume_liber(dorit, fisiere_api._nume_ocupate(wid, cid, folder, exclude=fid))
        col.document(fid).update({"stare": "acceptat", "folderId": folder, "nume": nume, "updatedAt": _now()})

    def schimbare(a: dict) -> dict:
        nou_act = {**a, "stare": "acceptat", "verificatLa": _now(), "verificatDe": principal.uid}
        nou_act.pop("motiv", None)
        return nou_act

    # Fișierele întâi (idempotent: un act acceptat de două ori își păstrează numele), apoi actul.
    nou = _schimba_act(ref, aid, list(act.get("fisiere") or []), schimbare)
    audit.log(wid, principal.uid, "cerere.accepta", rid, {"act": aid, "fisiere": len(act.get("fisiere") or [])})
    return jsonify({"cerere": _out_cerere(rid, nou)})


@bp.post("/cereri/<rid>/acte/<aid>/respinge")
def respinge(rid: str, aid: str):
    """Fișierele se șterg, iar actul se redeschide pe același link, cu motivul văzut de client."""
    principal, wid, _ = fisiere_api._require("member", billing=True, limit="fisiere_scriere")
    ref, d = _cerere(wid, rid)
    if not ref:
        return _err("not_found", 404)
    _, act = _act(d, aid)
    if act is None:
        return _err("not_found", 404)
    if act.get("stare") != "primit":
        return _err("act_neprimit", 409)
    motiv = _curat(_body().get("motiv"), MAX_MOTIV)
    if not motiv:
        return _err("motiv_lipsa", 400)
    # Actul întâi (dacă între timp a mai venit un fișier, utilizatorul îl vede înainte să respingă), apoi fișierele.
    vazute = list(act.get("fisiere") or [])
    nou = _schimba_act(ref, aid, vazute, lambda a: {**a, "stare": "respins", "motiv": motiv, "fisiere": [],
                                                     "verificatLa": _now(), "verificatDe": principal.uid})
    col = fisiere_api._col_fisiere(wid)
    snaps = [s for s in (col.document(fid).get() for fid in vazute)
             if s.exists and (s.to_dict() or {}).get("cerereId") == rid
             and (s.to_dict() or {}).get("stare") == "de_verificat"]
    fisiere_api._sterge_fisiere(wid, snaps)
    audit.log(wid, principal.uid, "cerere.respinge", rid, {"act": aid, "fisiere": len(snaps)})
    return jsonify({"cerere": _out_cerere(rid, nou)})


def la_stergere_client(wid: str, cid: str) -> int:
    """Cererile clientului dispar odată cu el (linkurile nu mai merg). Fișierele urmează alegerea pentru documente."""
    db = authz.db()
    snaps = list(_col(wid).where(filter=FieldFilter("clientId", "==", cid)).stream())
    for k in range(0, len(snaps), 200):
        batch = db.batch()
        for s in snaps[k:k + 200]:
            batch.delete(s.reference)
            h = (s.to_dict() or {}).get("tokenHash")
            if h:
                batch.delete(db.collection(TOKENURI).document(h))
        batch.commit()
    return len(snaps)


def la_stergere_cabinet(wid: str) -> int:
    """Legăturile linkurilor stau în afara cabinetului (`portalTokens`): se șterg explicit la purjare."""
    db = authz.db()
    snaps = list(db.collection(TOKENURI).where(filter=FieldFilter("wid", "==", wid)).stream())
    for k in range(0, len(snaps), 400):
        batch = db.batch()
        for s in snaps[k:k + 400]:
            batch.delete(s.reference)
        batch.commit()
    return len(snaps)


# ── Portalul (fără cont) ──────────────────────────────────────────────────────

def _portal(token: str, limita: str):
    """(wid, ref cerere, cerere, cabinet) pentru un link activ; altfel _LinkInactiv. Numără cererea pe link și pe IP."""
    if not _TOKEN_RE.match(token or ""):
        raise _LinkInactiv()
    h = _hash(token)
    ip = hashlib.sha256(authz.client_ip().encode()).hexdigest()[:24]
    ratelimit.check(f"ip:{ip}", "-", "portal_ip")
    snap = authz.db().collection(TOKENURI).document(h).get()
    if not snap.exists:
        raise _LinkInactiv()
    t = snap.to_dict() or {}
    wid, rid = t.get("wid") or "", t.get("rid") or ""
    ws = authz.load_workspace(wid)
    if not ws or ws.get("status") == "pendingDeletion" or not _billing.has_full_access(ws):
        raise _LinkInactiv()
    ratelimit.check(f"link:{h[:24]}", wid, limita)
    ref, d = _cerere(wid, rid)
    if not ref or d.get("tokenHash") != h or d.get("stare") == "anulata" or _expirata(d):
        raise _LinkInactiv()
    return wid, ref, d, ws


def _nume_original(raw: str, tip: fisiere.Tip) -> str:
    """Numele trimis de client, cu extensia formatului păstrat: „IMG_1.png” re-salvat ca JPEG devine „IMG_1.jpg”."""
    ext = fisiere.extensie(raw)
    baza = raw[: -(len(ext) + 1)] if ext else raw
    return fisiere.nume_fisier(f"{baza or 'document'}.{tip.ext}", tip)


def _out_portal(d: dict, ws: dict) -> dict:
    acte = []
    for a in d.get("acte") or []:
        acte.append({"id": a.get("id"), "eticheta": a.get("eticheta"), "tip": a.get("tip"), "stare": a.get("stare"),
                     **({"motiv": a["motiv"]} if a.get("stare") == "respins" and a.get("motiv") else {})})
    return {"cabinet": ws.get("name") or "", "cerutDe": d.get("cerutDe") or "", "mesaj": d.get("mesaj") or "",
            "expiraLa": _iso(d.get("expiraLa")), "stare": d.get("stare"), "acte": acte}


def _fisiere_trimise(wid: str, rid: str, d: dict) -> dict[str, list[dict]]:
    """Fișierele trimise și încă neverificate, pe act: doar nume și mărime (conținutul nu se arată pe link)."""
    out: dict[str, list[dict]] = {}
    col = fisiere_api._col_fisiere(wid)
    for a in d.get("acte") or []:
        if a.get("stare") != "primit":
            continue
        lista = []
        for fid in a.get("fisiere") or []:
            s = col.document(fid).get()
            f = s.to_dict() if s.exists else None
            if f and f.get("cerereId") == rid and f.get("stare") == "de_verificat":
                lista.append({"id": fid, "nume": f.get("numeOriginal") or f.get("nume"), "marime": f.get("marime")})
        out[a["id"]] = lista
    return out


@bp.get("/portal/<token>")
def portal_vezi(token: str):
    wid, ref, d, ws = _portal(token, "portal_citire")
    if not d.get("deschisaLa"):
        ref.update({"deschisaLa": _now()})          # „deschisă de client”, vizibil în aplicație
    out = _out_portal(d, ws)
    trimise = _fisiere_trimise(wid, ref.id, d)
    for a in out["acte"]:
        a["fisiere"] = trimise.get(a["id"], [])
    return jsonify(out)


@bp.post("/portal/<token>/acte/<aid>")
def portal_incarca(token: str, aid: str):
    wid, ref, d, ws = _portal(token, "portal_scriere")
    request.max_content_length = fisiere.MAX_BYTES + 256 * 1024
    if d.get("stare") != "deschisa":
        return _err("cerere_completa", 409)
    if not _ACT_RE.match(aid or ""):
        return _err("not_found", 404)
    _, act = _act(d, aid)
    if act is None:
        return _err("not_found", 404)
    if act.get("stare") == "acceptat":
        return _err("act_acceptat", 409)
    if sum(len(a.get("fisiere") or []) for a in d.get("acte") or []) >= MAX_FISIERE_CERERE:
        return _err("prea_multe_fisiere", 409)
    upload = request.files.get("fisier")
    if upload is None:
        return _err("fisier_lipsa", 400)
    data = upload.read(fisiere.MAX_BYTES + 1)
    if len(data) > fisiere.MAX_BYTES:
        return _err("fisier_prea_mare", 413)
    data, tip = fisiere.pregateste_portal(data, upload.filename or "")
    contor = fisiere_api._contor(wid).get().to_dict() or {}
    if int(contor.get("octeti") or 0) + len(data) > fisiere.LIMITA_CABINET:
        return _err("spatiu_depasit", 409)

    cid = d.get("clientId")
    sha = hashlib.sha256(data).hexdigest()
    col = fisiere_api._col_fisiere(wid)
    q = col.where(filter=FieldFilter("cerereId", "==", ref.id)).where(filter=FieldFilter("sha256", "==", sha)).limit(1)
    if any(True for _ in q.stream()):
        return _err("duplicat", 409)

    fisiere_api.pregateste_client(wid, cid, _PORTAL_UID)     # folderele implicite, dacă e primul document
    folder = _folder_dupa_nume(wid, cid, FOLDER_PRIMITE, _PORTAL_UID, creeaza=True)
    nume = fisiere_api._nume_liber(fisiere.nume_fisier(f"{act.get('eticheta')}.{tip.ext}", tip),
                                   fisiere_api._nume_ocupate(wid, cid, folder))
    fref = col.document()
    fisiere.salveaza(wid, fref.id, data)
    acum = _now()
    meta = {
        "clientId": cid, "folderId": folder, "nume": nume, "mime": tip.mime, "marime": len(data), "sha256": sha,
        "sursa": "portal", "stare": "de_verificat", "arhivat": False, "cerereId": ref.id, "actId": aid,
        "numeOriginal": _nume_original(upload.filename or "", tip),
        "createdAt": acum, "createdBy": _PORTAL_UID, "updatedAt": acum,
    }
    client_ref = _ws(wid).collection("clienti").document(cid)

    # Fișierul și actul se scriu împreună, după ce se confirmă că cererea e tot deschisă și clientul există.
    @firestore.transactional
    def inregistreaza(txn) -> dict | None:
        c = ref.get(transaction=txn)
        cd = c.to_dict() if c.exists else None
        if not cd or cd.get("stare") != "deschisa" or not client_ref.get(transaction=txn).exists:
            return None
        acte = list(cd.get("acte") or [])
        k, a = _act(cd, aid)
        if a is None or a.get("stare") == "acceptat":
            return None
        acte[k] = {**a, "stare": "primit", "fisiere": [*(a.get("fisiere") or []), fref.id], "primitLa": acum}
        acte[k].pop("motiv", None)
        txn.create(fref, meta)
        txn.update(ref, {"acte": acte, "deVerificat": de_verificat(acte), "ultimaPrimireLa": acum,
                         "actualizataLa": acum, **({} if cd.get("deschisaLa") else {"deschisaLa": acum})})
        return {**cd, "acte": acte}

    try:
        nou = inregistreaza(authz.db().transaction())
    except Exception:
        fisiere.sterge(wid, fref.id)
        raise
    if nou is None:
        fisiere.sterge(wid, fref.id)
        raise _LinkInactiv()
    fisiere_api._schimba_contor(wid, len(data), 1)
    audit.log(wid, _PORTAL_UID, "portal.incarcare", ref.id, {"act": aid, "marime": len(data), "tip": tip.ext})
    return jsonify({"fisier": {"id": fref.id, "nume": meta["numeOriginal"], "marime": len(data)}}), 201


@bp.delete("/portal/<token>/fisiere/<fid>")
def portal_sterge(token: str, fid: str):
    """Clientul își retrage o încărcare greșită, cât timp cabinetul nu a verificat-o."""
    wid, ref, d, _ = _portal(token, "portal_scriere")
    if not fisiere_api._ID_RE.match(fid or ""):
        return _err("not_found", 404)
    snap = fisiere_api._col_fisiere(wid).document(fid).get()
    f = snap.to_dict() if snap.exists else None
    if not f or f.get("cerereId") != ref.id or f.get("stare") != "de_verificat":
        return _err("not_found", 404)
    def schimbare(a: dict) -> dict:
        rest = [x for x in a.get("fisiere") or [] if x != fid]
        return {**a, "fisiere": rest, "stare": a.get("stare") if rest else "de_trimis"}

    _schimba_act(ref, f.get("actId") or "", None, schimbare)
    fisiere_api._sterge_fisiere(wid, [snap])
    audit.log(wid, _PORTAL_UID, "portal.stergere", ref.id, {"act": f.get("actId")})
    return jsonify({"ok": True})
