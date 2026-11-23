"""API pentru documentele clienților: încărcare, descărcare, redenumire, mutare, ștergere, foldere.

Metadatele stau în `workspaces/{wid}/fisiere` și `workspaces/{wid}/foldere` (citire directă din browser pentru membri,
scriere DOAR de aici), conținutul criptat în stocare (fisiere.py). Spațiul ocupat se ține în
`workspaces/{wid}/contoare/fisiere`. Jurnalul de acces nu primește niciodată numele fișierelor (pot conține nume de
persoane), doar id-uri, mărimi și tipuri.

Fișierele unui client șters se șterg sau trec în Arhivă (`arhivat: true`, `clientId: null`), la alegerea
utilizatorului — vezi `la_stergere_client`, apelat din pii_api.delete_client.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from urllib.parse import quote

from firebase_admin import firestore
from flask import Blueprint, Response, jsonify, request
from google.api_core import exceptions as gexc
from google.cloud.firestore_v1.base_query import FieldFilter
from werkzeug.exceptions import RequestEntityTooLarge

import audit
import authz
import fisiere
import vault

bp = Blueprint("fisiere", __name__)

_ID_RE = re.compile(r"^[A-Za-z0-9]{10,40}$")
_SCOPURI = {"descarcare", "previzualizare"}
_BATCH = 400


class _FunctieInactiva(Exception):
    pass


def _err(code: str, status: int, **extra):
    return jsonify({"error": code, **extra}), status


@bp.errorhandler(authz.AuthError)
def _handle_auth(e: authz.AuthError):
    return authz.error_response(e)


@bp.errorhandler(_FunctieInactiva)
def _handle_inactiv(_e):
    return _err("feature_disabled", 403)


@bp.errorhandler(fisiere.FisierRefuzat)
def _handle_refuzat(e: fisiere.FisierRefuzat):
    return _err(e.code, 400)


@bp.errorhandler(fisiere.StocareIndisponibila)
def _handle_stocare(e):
    print(f"[fisiere] stocare indisponibilă ({e})")
    return _err("storage_unavailable", 503)


@bp.errorhandler(vault.VaultError)
def _handle_vault(e: vault.VaultError):
    print(f"[fisiere] vault: {e}")
    return _err("vault_unavailable", 503)


@bp.errorhandler(RequestEntityTooLarge)
def _handle_mare(_e):
    return _err("fisier_prea_mare", 413)


def _require(min_role: str, billing: bool = False, limit: str | None = None):
    principal, wid, ws = authz.require_from_header(min_role, consent=True, limit=limit, billing=billing)
    if not (ws.get("features") or {}).get("documente"):
        raise _FunctieInactiva()
    if not fisiere.configurata():
        raise fisiere.StocareIndisponibila("neconfigurată")
    return principal, wid, ws


def _ws(wid: str):
    return authz.db().collection("workspaces").document(wid)


def _col_fisiere(wid: str):
    return _ws(wid).collection("fisiere")


def _col_foldere(wid: str):
    return _ws(wid).collection("foldere")


def _contor(wid: str):
    return _ws(wid).collection("contoare").document("fisiere")


def _schimba_contor(wid: str, octeti: int, numar: int) -> None:
    _contor(wid).set({"octeti": firestore.Increment(octeti), "numar": firestore.Increment(numar)}, merge=True)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(v) -> str | None:
    return v.isoformat() if isinstance(v, datetime) else None


def _out_fisier(fid: str, d: dict) -> dict:
    return {
        "id": fid, "clientId": d.get("clientId"), "folderId": d.get("folderId"), "nume": d.get("nume"),
        "mime": d.get("mime"), "marime": d.get("marime"), "sursa": d.get("sursa"), "stare": d.get("stare"),
        "arhivat": bool(d.get("arhivat")), "createdAt": _iso(d.get("createdAt")), "createdBy": d.get("createdBy"),
    }


def _out_folder(fid: str, d: dict) -> dict:
    return {"id": fid, "clientId": d.get("clientId"), "parentId": d.get("parentId"), "nume": d.get("nume")}


def _body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _client_exista(wid: str, cid: str) -> bool:
    return bool(_ID_RE.match(cid or "")) and _ws(wid).collection("clienti").document(cid).get().exists


def _foldere_client(wid: str, cid: str) -> dict[str, dict]:
    q = _col_foldere(wid).where(filter=FieldFilter("clientId", "==", cid))
    return {s.id: s.to_dict() or {} for s in q.stream()}


def _fisiere_client(wid: str, cid: str) -> list:
    return list(_col_fisiere(wid).where(filter=FieldFilter("clientId", "==", cid)).stream())


def _folder_valid(wid: str, cid: str, folder_id) -> dict | None:
    """Folderul țintă (None = rădăcina clientului). Ridică 400 dacă nu e un folder al aceluiași client."""
    if folder_id is None:
        return None
    if not isinstance(folder_id, str) or not _ID_RE.match(folder_id):
        raise fisiere.FisierRefuzat("folder_invalid")
    snap = _col_foldere(wid).document(folder_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("clientId") != cid:
        raise fisiere.FisierRefuzat("folder_invalid")
    return d


def _nume_ocupate(wid: str, cid: str, folder_id, exclude: str | None = None) -> set[str]:
    q = (_col_fisiere(wid).where(filter=FieldFilter("clientId", "==", cid))
         .where(filter=FieldFilter("folderId", "==", folder_id)))
    return {fisiere.cheie_nume((s.to_dict() or {}).get("nume", "")) for s in q.stream() if s.id != exclude}


def _nume_liber(nume: str, ocupate: set[str]) -> str:
    """„act.pdf”, apoi „act (2).pdf”, „act (3).pdf”… — ca exploratorul de fișiere."""
    if fisiere.cheie_nume(nume) not in ocupate:
        return nume
    ext = fisiere.extensie(nume)
    baza = nume[: -(len(ext) + 1)] if ext else nume
    for i in range(2, 1000):
        cand = f"{baza} ({i}).{ext}" if ext else f"{baza} ({i})"
        if fisiere.cheie_nume(cand) not in ocupate:
            return cand
    raise fisiere.FisierRefuzat("nume_invalid")


# ── Fișiere ───────────────────────────────────────────────────────────────────

@bp.post("/fisiere")
def incarca():
    principal, wid, _ = _require("member", billing=True, limit="fisiere_scriere")
    request.max_content_length = fisiere.MAX_BYTES + 256 * 1024      # restul aplicației rămâne la plafonul global
    upload = request.files.get("fisier")
    cid = request.form.get("clientId", "")
    folder_id = request.form.get("folderId") or None
    if upload is None:
        return _err("fisier_lipsa", 400)
    if not _client_exista(wid, cid):
        return _err("not_found", 404)
    _folder_valid(wid, cid, folder_id)
    data = upload.read(fisiere.MAX_BYTES + 1)
    if len(data) > fisiere.MAX_BYTES:
        return _err("fisier_prea_mare", 413)
    tip = fisiere.detecteaza_tip(data, upload.filename or "")

    contor = _contor(wid).get().to_dict() or {}
    if int(contor.get("octeti") or 0) + len(data) > fisiere.LIMITA_CABINET:
        return _err("spatiu_depasit", 409)

    sha = hashlib.sha256(data).hexdigest()
    if request.form.get("duplicat") != "permite":
        q = (_col_fisiere(wid).where(filter=FieldFilter("clientId", "==", cid))
             .where(filter=FieldFilter("sha256", "==", sha)).limit(1))
        for s in q.stream():
            d = s.to_dict() or {}
            return _err("duplicat", 409, existent={"id": s.id, "nume": d.get("nume"), "folderId": d.get("folderId")})

    nume = _nume_liber(fisiere.nume_fisier(upload.filename or "", tip), _nume_ocupate(wid, cid, folder_id))
    ref = _col_fisiere(wid).document()
    fisiere.salveaza(wid, ref.id, data)
    client_ref = _ws(wid).collection("clienti").document(cid)
    meta = {
        "clientId": cid, "folderId": folder_id, "nume": nume, "mime": tip.mime, "marime": len(data), "sha256": sha,
        "sursa": "incarcat", "stare": "acceptat", "arhivat": False,
        "createdAt": _now(), "createdBy": principal.uid, "updatedAt": _now(),
    }
    # Metadatele se scriu într-o tranzacție care citește și fișa clientului: dacă între timp clientul a fost șters, fișierul
    # nu se înregistrează (altfel ar rămâne orfan: nici la client, nici în Arhivă, dar numărat în spațiul cabinetului).
    @firestore.transactional
    def inregistreaza(txn) -> bool:
        if not client_ref.get(transaction=txn).exists:
            return False
        txn.create(ref, meta)
        return True

    try:
        creat = inregistreaza(authz.db().transaction())
    except Exception:
        fisiere.sterge(wid, ref.id)          # fără metadate, obiectul ar rămâne orfan
        raise
    if not creat:
        fisiere.sterge(wid, ref.id)
        return _err("not_found", 404)
    _schimba_contor(wid, len(data), 1)
    audit.log(wid, principal.uid, "fisier.upload", ref.id, {"client": cid, "marime": len(data), "tip": tip.ext})
    return jsonify({"fisier": _out_fisier(ref.id, meta)}), 201


@bp.get("/fisiere/<fid>/continut")
def descarca(fid: str):
    principal, wid, _ = _require("viewer", limit="fisiere_citire")
    scop = request.args.get("scop", "descarcare")
    if not _ID_RE.match(fid) or scop not in _SCOPURI:
        return _err("not_found", 404)
    snap = _col_fisiere(wid).document(fid).get()
    if not snap.exists:
        return _err("not_found", 404)
    d = snap.to_dict() or {}
    data = fisiere.citeste(wid, fid)
    if data is None:
        return _err("fisier_indisponibil", 404)
    audit.log(wid, principal.uid, "fisier.download", fid, {"scop": scop})

    nume = d.get("nume") or "document"
    ascii_nume = nume.encode("ascii", "ignore").decode().replace('"', "") or "document"
    resp = Response(data, mimetype=fisiere.mime_sigur(d.get("mime")))
    resp.headers["Content-Disposition"] = f"attachment; filename=\"{ascii_nume}\"; filename*=UTF-8''{quote(nume)}"
    resp.headers["Cache-Control"] = "private, no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return resp


@bp.patch("/fisiere/<fid>")
def modifica(fid: str):
    """Redenumire și/sau mutare în alt folder al aceluiași client (`folderId: null` = rădăcina)."""
    principal, wid, _ = _require("member", billing=True, limit="fisiere_scriere")
    if not _ID_RE.match(fid):
        return _err("not_found", 404)
    body = _body()
    ref = _col_fisiere(wid).document(fid)
    snap = ref.get()
    if not snap.exists:
        return _err("not_found", 404)
    d = snap.to_dict() or {}
    patch: dict = {}
    nume = d.get("nume") or ""
    folder_id = d.get("folderId")
    if "nume" in body:
        nume = fisiere.redenumeste(str(body.get("nume") or ""), nume)
        patch["nume"] = nume
    if "folderId" in body:
        if d.get("arhivat"):
            return _err("arhivat", 409)
        folder_id = body.get("folderId")
        _folder_valid(wid, d.get("clientId"), folder_id)
        patch["folderId"] = folder_id
    if not patch:
        return _err("invalid_body", 400)
    if not d.get("arhivat") and fisiere.cheie_nume(nume) in _nume_ocupate(wid, d.get("clientId"), folder_id, exclude=fid):
        return _err("nume_existent", 409)
    patch["updatedAt"] = _now()
    ref.update(patch)
    audit.log(wid, principal.uid, "fisier.update", fid, {"redenumit": "nume" in patch, "mutat": "folderId" in patch})
    return jsonify({"fisier": _out_fisier(fid, {**d, **patch})})


def _sterge_fisiere(wid: str, snaps: list) -> int:
    """Metadatele întâi (utilizatorul nu mai vede fișierul), apoi obiectele. Un obiect rămas din cauza unei erori e
    oricum ilizibil fără metadate și dispare la ștergerea cabinetului."""
    octeti = 0
    for i in range(0, len(snaps), _BATCH):
        batch = authz.db().batch()
        for s in snaps[i:i + _BATCH]:
            batch.delete(s.reference)
            octeti += int((s.to_dict() or {}).get("marime") or 0)
        batch.commit()
    if snaps:
        _schimba_contor(wid, -octeti, -len(snaps))
    for s in snaps:
        try:
            fisiere.sterge(wid, s.id)
        except Exception as e:  # noqa: BLE001
            print(f"[fisiere] obiect neșters ({type(e).__name__})")
    return octeti


@bp.delete("/fisiere/<fid>")
def sterge(fid: str):
    # Fără `billing`: ștergerea datelor rămâne posibilă și după expirarea abonamentului.
    principal, wid, _ = _require("member", limit="fisiere_scriere")
    if not _ID_RE.match(fid):
        return _err("not_found", 404)
    snap = _col_fisiere(wid).document(fid).get()
    if not snap.exists:
        return _err("not_found", 404)
    _sterge_fisiere(wid, [snap])
    audit.log(wid, principal.uid, "fisier.delete", fid)
    return jsonify({"ok": True})


# ── Foldere ───────────────────────────────────────────────────────────────────

def _adancime(foldere: dict[str, dict], folder_id) -> int:
    """Nivelul folderului (1 = în rădăcină). Ciclurile (date corupte) se opresc la MAX_ADANCIME + 1."""
    n = 0
    while folder_id and n <= fisiere.MAX_ADANCIME:
        n += 1
        folder_id = (foldere.get(folder_id) or {}).get("parentId")
    return n


def _descendenti(foldere: dict[str, dict], root: str) -> set[str]:
    out, stiva = {root}, [root]
    while stiva:
        cur = stiva.pop()
        for fid, d in foldere.items():
            if d.get("parentId") == cur and fid not in out:
                out.add(fid)
                stiva.append(fid)
    return out


def _inaltime(foldere: dict[str, dict], root: str) -> int:
    """Câte niveluri are subarborele (1 = folder fără subfoldere)."""
    copii = [fid for fid, d in foldere.items() if d.get("parentId") == root]
    return 1 + max((_inaltime(foldere, c) for c in copii), default=0)


def _nume_folder_ocupat(foldere: dict[str, dict], parent_id, nume: str, exclude: str | None = None) -> bool:
    k = fisiere.cheie_nume(nume)
    return any(fid != exclude and d.get("parentId") == parent_id and fisiere.cheie_nume(d.get("nume", "")) == k
               for fid, d in foldere.items())


@bp.post("/foldere")
def creeaza_folder():
    principal, wid, _ = _require("member", billing=True, limit="fisiere_scriere")
    body = _body()
    cid = body.get("clientId") if isinstance(body.get("clientId"), str) else ""
    parent_id = body.get("parentId")
    if not _client_exista(wid, cid):
        return _err("not_found", 404)
    nume = fisiere.nume_folder(body.get("nume"))
    foldere = _foldere_client(wid, cid)
    if parent_id is not None and (not isinstance(parent_id, str) or parent_id not in foldere):
        return _err("folder_invalid", 400)
    if len(foldere) >= fisiere.MAX_FOLDERE_CLIENT:
        return _err("prea_multe_foldere", 409)
    if _adancime(foldere, parent_id) + 1 > fisiere.MAX_ADANCIME:
        return _err("folder_prea_adanc", 409)
    if _nume_folder_ocupat(foldere, parent_id, nume):
        return _err("nume_existent", 409)
    ref = _col_foldere(wid).document()
    meta = {"clientId": cid, "parentId": parent_id, "nume": nume, "createdAt": _now(), "createdBy": principal.uid}
    ref.create(meta)
    audit.log(wid, principal.uid, "folder.create", ref.id, {"client": cid})
    return jsonify({"folder": _out_folder(ref.id, meta)}), 201


# ── Folderele implicite ───────────────────────────────────────────────────────

def _setari(wid: str):
    return _ws(wid).collection("setari").document("documente")


def _marcaj_client(wid: str, cid: str):
    """Existența lui = documentele clientului au fost pregătite (folderele implicite create o dată). Folderele șterse
    apoi de utilizator nu mai reapar, iar o listă nouă a cabinetului nu schimbă clienții deja pregătiți."""
    return _ws(wid).collection("documenteClienti").document(cid)


def foldere_implicite(wid: str) -> list[str]:
    snap = _setari(wid).get()
    lista = (snap.to_dict() or {}).get("foldereImplicite") if snap.exists else None
    return [n for n in lista if isinstance(n, str)] if isinstance(lista, list) else list(fisiere.FOLDERE_IMPLICITE)


@bp.put("/fisiere/setari")
def seteaza_foldere_implicite():
    principal, wid, _ = _require("admin", billing=True, limit="fisiere_scriere")
    lista = _body().get("foldereImplicite")
    if not isinstance(lista, list) or len(lista) > fisiere.MAX_FOLDERE_IMPLICITE:
        return _err("invalid_body", 400)
    curate: list[str] = []
    for raw in lista:
        nume = fisiere.nume_folder(raw)
        if any(fisiere.cheie_nume(n) == fisiere.cheie_nume(nume) for n in curate):
            return _err("nume_existent", 409)
        curate.append(nume)
    _setari(wid).set({"foldereImplicite": curate, "updatedAt": _now(), "updatedBy": principal.uid}, merge=True)
    audit.log(wid, principal.uid, "fisiere.setari", None, {"foldere": len(curate)})
    return jsonify({"foldereImplicite": curate})


@bp.post("/clients/<cid>/documente/init")
def initializeaza_client(cid: str):
    """Pregătește documentele clientului: creează folderele implicite ale cabinetului, o singură dată (idempotent, sigur
    și la două ferestre deschise simultan — marcajul se creează înaintea folderelor)."""
    principal, wid, _ = _require("member", billing=True)
    if not _client_exista(wid, cid):
        return _err("not_found", 404)
    try:
        _marcaj_client(wid, cid).create({"initLa": _now(), "initDe": principal.uid})
    except gexc.AlreadyExists:
        return jsonify({"foldere": [], "init": False})
    foldere = _foldere_client(wid, cid)
    create = []
    for nume in foldere_implicite(wid):
        if _nume_folder_ocupat(foldere, None, nume):
            continue
        ref = _col_foldere(wid).document()
        meta = {"clientId": cid, "parentId": None, "nume": nume, "createdAt": _now(), "createdBy": principal.uid}
        ref.create(meta)
        foldere[ref.id] = meta
        create.append(_out_folder(ref.id, meta))
    return jsonify({"foldere": create, "init": True})


@bp.patch("/foldere/<folder_id>")
def modifica_folder(folder_id: str):
    principal, wid, _ = _require("member", billing=True, limit="fisiere_scriere")
    if not _ID_RE.match(folder_id):
        return _err("not_found", 404)
    snap = _col_foldere(wid).document(folder_id).get()
    if not snap.exists:
        return _err("not_found", 404)
    d = snap.to_dict() or {}
    body = _body()
    foldere = _foldere_client(wid, d.get("clientId"))
    patch: dict = {}
    nume, parent_id = d.get("nume") or "", d.get("parentId")
    if "nume" in body:
        nume = fisiere.nume_folder(body.get("nume"))
        patch["nume"] = nume
    if "parentId" in body:
        parent_id = body.get("parentId")
        if parent_id is not None:
            if not isinstance(parent_id, str) or parent_id not in foldere:
                return _err("folder_invalid", 400)
            if parent_id in _descendenti(foldere, folder_id):
                return _err("folder_ciclu", 409)
        if _adancime(foldere, parent_id) + _inaltime(foldere, folder_id) > fisiere.MAX_ADANCIME:
            return _err("folder_prea_adanc", 409)
        patch["parentId"] = parent_id
    if not patch:
        return _err("invalid_body", 400)
    if _nume_folder_ocupat(foldere, parent_id, nume, exclude=folder_id):
        return _err("nume_existent", 409)
    _col_foldere(wid).document(folder_id).update(patch)
    audit.log(wid, principal.uid, "folder.update", folder_id)
    return jsonify({"folder": _out_folder(folder_id, {**d, **patch})})


@bp.delete("/foldere/<folder_id>")
def sterge_folder(folder_id: str):
    """Un folder cu conținut se șterge doar cu `?recursiv=1` (după confirmarea utilizatorului), împreună cu tot ce
    conține; altfel 409 cu numărul de fișiere și subfoldere, pentru mesajul de confirmare."""
    principal, wid, _ = _require("member", limit="fisiere_scriere")
    if not _ID_RE.match(folder_id):
        return _err("not_found", 404)
    snap = _col_foldere(wid).document(folder_id).get()
    if not snap.exists:
        return _err("not_found", 404)
    cid = (snap.to_dict() or {}).get("clientId")
    foldere = _foldere_client(wid, cid)
    tinta = _descendenti(foldere, folder_id)
    continut = [s for s in _fisiere_client(wid, cid) if (s.to_dict() or {}).get("folderId") in tinta]
    if (continut or len(tinta) > 1) and request.args.get("recursiv") != "1":
        return _err("folder_negol", 409, fisiere=len(continut), foldere=len(tinta) - 1)
    _sterge_fisiere(wid, continut)
    batch = authz.db().batch()
    for fid in tinta:
        batch.delete(_col_foldere(wid).document(fid))
    batch.commit()
    audit.log(wid, principal.uid, "folder.delete", folder_id, {"fisiere": len(continut), "foldere": len(tinta)})
    return jsonify({"ok": True, "fisiere": len(continut)})


# ── Ștergerea clientului ──────────────────────────────────────────────────────

MODURI_STERGERE = ("arhiveaza", "sterge")


def numar_fisiere_client(wid: str, cid: str) -> int:
    return len(_fisiere_client(wid, cid))


def la_stergere_client(wid: str, cid: str, mod: str, actor: str, client_nume: str = "") -> dict:
    """Înainte de ștergerea fișei: fișierele clientului se șterg sau trec în Arhivă, cu numele clientului și calea
    folderului păstrate pe ele (folderele dispar). Implicit (`mod` necunoscut) se arhivează: nimic nu se pierde fără
    o alegere explicită."""
    snaps = _fisiere_client(wid, cid)
    foldere = _foldere_client(wid, cid)
    if mod == "sterge":
        _sterge_fisiere(wid, snaps)
    else:
        def cale_folder(fid) -> str:
            parti, n = [], 0
            while fid and n <= fisiere.MAX_ADANCIME:
                d = foldere.get(fid) or {}
                parti.append(d.get("nume") or "")
                fid, n = d.get("parentId"), n + 1
            return " / ".join(reversed([p for p in parti if p]))

        acum = _now()
        for i in range(0, len(snaps), _BATCH):
            batch = authz.db().batch()
            for s in snaps[i:i + _BATCH]:
                d = s.to_dict() or {}
                batch.update(s.reference, {
                    "arhivat": True, "clientId": None, "folderId": None, "clientIdInitial": cid,
                    "clientNume": client_nume[:200], "cale": cale_folder(d.get("folderId")),
                    "arhivatLa": acum, "arhivatDe": actor, "updatedAt": acum,
                })
            batch.commit()
    _marcaj_client(wid, cid).delete()
    ids = list(foldere)
    for i in range(0, len(ids), _BATCH):
        batch = authz.db().batch()
        for fid in ids[i:i + _BATCH]:
            batch.delete(_col_foldere(wid).document(fid))
        batch.commit()
    return {"fisiere": len(snaps), "mod": "sterge" if mod == "sterge" else "arhiveaza"}
