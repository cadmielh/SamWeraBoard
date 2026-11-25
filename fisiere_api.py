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
import json
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
import tipar
import vault

bp = Blueprint("fisiere", __name__)

_ID_RE = re.compile(r"^[A-Za-z0-9]{10,40}$")
_SCOPURI = {"descarcare", "previzualizare"}
_BATCH = 400


def _err(code: str, status: int, **extra):
    return jsonify({"error": code, **extra}), status


@bp.errorhandler(authz.AuthError)
def _handle_auth(e: authz.AuthError):
    return authz.error_response(e)


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
        "editat": bool(d.get("original")),
    }


def obiect(fid: str, d: dict) -> str:
    """Obiectul din stocare cu conținutul curent: după o editare, altul decât id-ul fișierului (vezi `inlocuieste`)."""
    o = d.get("obiect")
    return o if isinstance(o, str) and _ID_RE.match(o) else fid


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
    # Copia unui document generat (faza 2): folderul îl alege cabinetul, iar fișierul e marcat ca generat.
    generat = request.form.get("destinatie") == "generate"
    if upload is None:
        return _err("fisier_lipsa", 400)
    if not _client_exista(wid, cid):
        return _err("not_found", 404)
    if generat:
        # Prima operație pe documentele clientului poate fi o copie generată: întâi folderele implicite (altfel, la
        # deschiderea fișei, clientul n-ar mai fi gol și n-ar mai primi folderele), apoi folderul copiilor.
        pregateste_client(wid, cid, principal.uid)
        folder_id = _folder_generate(wid, cid, principal.uid)
    _folder_valid(wid, cid, folder_id)
    data = upload.read(fisiere.MAX_BYTES + 1)
    if len(data) > fisiere.MAX_BYTES:
        return _err("fisier_prea_mare", 413)
    tip = fisiere.detecteaza_tip(data, upload.filename or "")

    contor = _contor(wid).get().to_dict() or {}
    if int(contor.get("octeti") or 0) + len(data) > fisiere.LIMITA_CABINET:
        return _err("spatiu_depasit", 409)

    sha = hashlib.sha256(data).hexdigest()
    if not generat and request.form.get("duplicat") != "permite":
        q = (_col_fisiere(wid).where(filter=FieldFilter("clientId", "==", cid))
             .where(filter=FieldFilter("sha256", "==", sha)).limit(1))
        for s in q.stream():
            d = s.to_dict() or {}
            return _err("duplicat", 409, existent={"id": s.id, "nume": d.get("nume"), "folderId": d.get("folderId")})

    nume = _nume_liber(fisiere.nume_fisier(upload.filename or "", tip), _nume_ocupate(wid, cid, folder_id))
    rezultat = _inregistreaza(wid, cid, folder_id, data, nume, tip, principal.uid, "generat" if generat else "incarcat", sha)
    if rezultat is None:
        return _err("not_found", 404)
    fid, meta = rezultat
    audit.log(wid, principal.uid, "fisier.upload", fid,
              {"client": cid, "marime": len(data), "tip": tip.ext, **({"sursa": "generat"} if generat else {})})
    return jsonify({"fisier": _out_fisier(fid, meta)}), 201


def _inregistreaza(wid: str, cid: str, folder_id, data: bytes, nume: str, tip: fisiere.Tip, uid: str, sursa: str,
                   sha: str | None = None) -> tuple[str, dict] | None:
    """Conținutul criptat în stocare și metadatele în Firestore; None dacă între timp clientul a fost șters."""
    ref = _col_fisiere(wid).document()
    fisiere.salveaza(wid, ref.id, data)
    client_ref = _ws(wid).collection("clienti").document(cid)
    meta = {
        "clientId": cid, "folderId": folder_id, "nume": nume, "mime": tip.mime, "marime": len(data),
        "sha256": sha or hashlib.sha256(data).hexdigest(),
        "sursa": sursa, "stare": "acceptat", "arhivat": False,
        "createdAt": _now(), "createdBy": uid, "updatedAt": _now(),
    }
    # Metadatele se scriu într-o tranzacție care citește și fișa clientului: dacă între timp clientul a fost șters, fișierul
    # nu se înregistrează (altfel ar rămâne orfan: nici la client, nici în Arhivă, dar numărat în spațiul cabinetului).
    @firestore.transactional
    def scrie(txn) -> bool:
        if not client_ref.get(transaction=txn).exists:
            return False
        txn.create(ref, meta)
        return True

    try:
        creat = scrie(authz.db().transaction())
    except Exception:
        fisiere.sterge(wid, ref.id)          # fără metadate, obiectul ar rămâne orfan
        raise
    if not creat:
        fisiere.sterge(wid, ref.id)
        return None
    _schimba_contor(wid, len(data), 1)
    return ref.id, meta


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
    # `?versiune=original`: conținutul dinaintea editării, cât timp e păstrat.
    orig = d.get("original") if request.args.get("versiune") == "original" else None
    if request.args.get("versiune") == "original" and not isinstance(orig, dict):
        return _err("not_found", 404)
    data = fisiere.citeste(wid, orig["obiect"] if orig else obiect(fid, d))
    if data is None:
        return _err("fisier_indisponibil", 404)
    audit.log(wid, principal.uid, "fisier.download", fid, {"scop": scop, **({"versiune": "original"} if orig else {})})

    nume = d.get("nume") or "document"
    ascii_nume = nume.encode("ascii", "ignore").decode().replace('"', "") or "document"
    resp = Response(data, mimetype=fisiere.mime_sigur((orig or d).get("mime")))
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
            d = s.to_dict() or {}
            octeti += int(d.get("marime") or 0) + int((d.get("original") or {}).get("marime") or 0)
        batch.commit()
    if snaps:
        _schimba_contor(wid, -octeti, -len(snaps))
    for s in snaps:
        d = s.to_dict() or {}
        for o in {obiect(s.id, d), *([d["original"]["obiect"]] if isinstance(d.get("original"), dict) else [])}:
            try:
                fisiere.sterge(wid, o)
            except Exception as e:  # noqa: BLE001
                print(f"[fisiere] obiect neșters ({type(e).__name__})")
    return octeti


def _cu_extensia(nume: str, tip: fisiere.Tip) -> str:
    """Același nume, cu extensia noului format („act.png” salvat ca JPEG devine „act.jpg”)."""
    ext = fisiere.extensie(nume)
    baza = nume[: -(len(ext) + 1)] if ext else nume
    return fisiere.nume_fisier(f"{baza or 'document'}.{tip.ext}", tip)


POZE = {fisiere.JPEG.mime, fisiere.PNG.mime, fisiere.WEBP.mime}
EDITABILE = POZE | {fisiere.PDF.mime}
# Tot ce intră în PDF-urile pregătite pentru tipar (sursele se țin în memorie, deci plafonul contează).
MAX_SURSE_TIPAR = 60 * 1024 * 1024


class _SpatiuDepasit(Exception):
    pass


@bp.errorhandler(_SpatiuDepasit)
def _handle_spatiu(_e):
    return _err("spatiu_depasit", 409)


class _Modificat(Exception):
    """Fișierul s-a schimbat între citire și scriere (altă editare sau ștergere în paralel)."""


@bp.errorhandler(_Modificat)
def _handle_modificat(_e):
    return _err("fisier_modificat", 409)


def _inlocuieste(wid: str, fid: str, d: dict, data: bytes, tip: fisiere.Tip, uid: str) -> dict:
    """Conținutul nou devine versiunea curentă; prima versiune rămâne în `original` (vezi `inlocuieste`)."""
    ref = _col_fisiere(wid).document(fid)
    vechi = int(d.get("marime") or 0) if d.get("original") else 0     # versiunea editată anterior, care dispare
    contor = _contor(wid).get().to_dict() or {}
    if int(contor.get("octeti") or 0) + len(data) - vechi > fisiere.LIMITA_CABINET:
        raise _SpatiuDepasit()

    nou = _col_fisiere(wid).document().id
    fisiere.salveaza(wid, nou, data)
    cid, folder = d.get("clientId"), d.get("folderId")
    nume = _nume_liber(_cu_extensia(d.get("nume") or "", tip), _nume_ocupate(wid, cid, folder, exclude=fid))
    acum = _now()

    @firestore.transactional
    def scrie(txn) -> dict:
        cur = ref.get(transaction=txn)
        c = cur.to_dict() if cur.exists else None
        if not c or obiect(fid, c) != obiect(fid, d) or c.get("arhivat"):
            raise _Modificat()
        patch = {
            "obiect": nou, "mime": tip.mime, "marime": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "nume": nume, "editatLa": acum, "editatDe": uid, "updatedAt": acum,
        }
        if not c.get("original"):
            patch["original"] = {"obiect": obiect(fid, c), "marime": c.get("marime"), "mime": c.get("mime"),
                                 "sha256": c.get("sha256"), "nume": c.get("nume")}
        txn.update(ref, patch)
        return {**c, **patch}

    try:
        rezultat = scrie(authz.db().transaction())
    except Exception:
        fisiere.sterge(wid, nou)
        raise
    if d.get("original"):
        fisiere.sterge(wid, obiect(fid, d))           # editarea precedentă; originalul rămâne
    _schimba_contor(wid, len(data) - vechi, 0)
    return rezultat


@bp.put("/fisiere/<fid>/continut")
def inlocuieste(fid: str):
    """Conținutul editat în aplicație (decupat, îndreptat, „scanat”) înlocuiește fișierul. Prima versiune rămâne păstrată
    (`original`) până la „Revino la original” sau ștergerea fișierului; editările următoare o înlocuiesc doar pe cea editată."""
    principal, wid, _ = _require("member", billing=True, limit="fisiere_scriere")
    request.max_content_length = fisiere.MAX_BYTES + 256 * 1024
    if not _ID_RE.match(fid):
        return _err("not_found", 404)
    ref = _col_fisiere(wid).document(fid)
    snap = ref.get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("arhivat"):
        return _err("not_found", 404)
    if d.get("mime") not in POZE:                     # PDF-urile se modifică prin /pagini
        return _err("tip_nepermis", 400)
    upload = request.files.get("fisier")
    if upload is None:
        return _err("fisier_lipsa", 400)
    data = upload.read(fisiere.MAX_BYTES + 1)
    if len(data) > fisiere.MAX_BYTES:
        return _err("fisier_prea_mare", 413)
    tip = fisiere.detecteaza_tip(data, upload.filename or "")
    if tip.mime not in POZE:
        return _err("tip_nepermis", 400)
    rezultat = _inlocuieste(wid, fid, d, data, tip, principal.uid)
    audit.log(wid, principal.uid, "fisier.edit", fid, {"marime": len(data), "tip": tip.ext})
    return jsonify({"fisier": _out_fisier(fid, rezultat)})


@bp.post("/fisiere/<fid>/pagini")
def pagini_pdf(fid: str):
    """Paginile unui PDF: ordine, ștergere, rotire. `copie: true` salvează rezultatul ca fișier nou lângă original;
    altfel îl înlocuiește, cu originalul păstrat (ca la editarea pozelor)."""
    principal, wid, _ = _require("member", billing=True, limit="fisiere_scriere")
    if not _ID_RE.match(fid):
        return _err("not_found", 404)
    snap = _col_fisiere(wid).document(fid).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("arhivat") or not d.get("clientId"):
        return _err("not_found", 404)
    if d.get("mime") != fisiere.PDF.mime:
        return _err("tip_nepermis", 400)
    # JSON simplu sau, cu pagini editate ca poză, multipart: `date` (JSON-ul) și fișierele `pagina_<index>`.
    request.max_content_length = fisiere.MAX_BYTES + 256 * 1024
    inlocuiri: dict[int, bytes] = {}
    if request.files:
        try:
            body = json.loads(request.form.get("date") or "{}")
        except ValueError:
            return _err("pagini_invalide", 400)
        for cheie, f in request.files.items():
            m = re.fullmatch(r"pagina_(\d{1,3})", cheie)
            if not m:
                return _err("pagini_invalide", 400)
            img = f.read(fisiere.MAX_BYTES + 1)
            if len(img) > fisiere.MAX_BYTES or fisiere.detecteaza_tip(img, f.filename or "").mime not in POZE:
                return _err("tip_nepermis", 400)
            inlocuiri[int(m.group(1))] = img
    else:
        body = _body()
    if not isinstance(body, dict):
        return _err("pagini_invalide", 400)
    raw = body.get("pagini")
    if not isinstance(raw, list) or not 1 <= len(raw) <= 500:
        return _err("pagini_invalide", 400)
    try:
        pagini = [(int(p["p"]), int(p.get("r") or 0)) for p in raw]
    except (TypeError, ValueError, KeyError):
        return _err("pagini_invalide", 400)
    data = fisiere.citeste(wid, obiect(fid, d))
    if data is None:
        return _err("fisier_indisponibil", 404)
    pdf = tipar.rearanjeaza(data, pagini, inlocuiri)
    if len(pdf) > fisiere.MAX_BYTES:
        return _err("fisier_prea_mare", 413)
    meta_audit = {"pagini": len(pagini), "copie": bool(body.get("copie")), **({"editate": len(inlocuiri)} if inlocuiri else {})}
    if body.get("copie") is True:
        contor = _contor(wid).get().to_dict() or {}
        if int(contor.get("octeti") or 0) + len(pdf) > fisiere.LIMITA_CABINET:
            return _err("spatiu_depasit", 409)
        cid, folder = d["clientId"], d.get("folderId")
        baza = (d.get("nume") or "document").rsplit(".", 1)[0]
        nume = _nume_liber(fisiere.nume_fisier(f"{baza} (editat).pdf", fisiere.PDF), _nume_ocupate(wid, cid, folder))
        rezultat = _inregistreaza(wid, cid, folder, pdf, nume, fisiere.PDF, principal.uid, "incarcat")
        if rezultat is None:
            return _err("not_found", 404)
        nid, meta = rezultat
        audit.log(wid, principal.uid, "fisier.pagini", fid, {**meta_audit, "nou": nid})
        return jsonify({"fisier": _out_fisier(nid, meta)}), 201
    rezultat = _inlocuieste(wid, fid, d, pdf, fisiere.PDF, principal.uid)
    audit.log(wid, principal.uid, "fisier.pagini", fid, meta_audit)
    return jsonify({"fisier": _out_fisier(fid, rezultat)})


@bp.post("/fisiere/<fid>/original")
def revino_la_original(fid: str):
    """Renunță la editare: conținutul, numele și tipul de dinainte revin, iar versiunea editată se șterge."""
    principal, wid, _ = _require("member", limit="fisiere_scriere")
    if not _ID_RE.match(fid):
        return _err("not_found", 404)
    ref = _col_fisiere(wid).document(fid)
    snap = ref.get()
    d = snap.to_dict() if snap.exists else None
    if not d or not isinstance(d.get("original"), dict):
        return _err("not_found", 404)
    o = d["original"]
    cid, folder = d.get("clientId"), d.get("folderId")
    nume = d.get("nume") or ""
    if o.get("mime") and o.get("mime") != d.get("mime"):
        tip = next((t for t in (fisiere.JPEG, fisiere.PNG, fisiere.WEBP, fisiere.PDF) if t.mime == o["mime"]), None)
        if tip:
            nume = _nume_liber(_cu_extensia(nume, tip), _nume_ocupate(wid, cid, folder, exclude=fid))

    @firestore.transactional
    def scrie(txn) -> dict:
        cur = ref.get(transaction=txn)
        c = cur.to_dict() if cur.exists else None
        if not c or obiect(fid, c) != obiect(fid, d):
            raise _Modificat()
        patch = {"obiect": o.get("obiect") or fid, "mime": o.get("mime"), "marime": o.get("marime"),
                 "sha256": o.get("sha256"), "nume": nume, "original": firestore.DELETE_FIELD,
                 "editatLa": firestore.DELETE_FIELD, "editatDe": firestore.DELETE_FIELD, "updatedAt": _now()}
        txn.update(ref, patch)
        rest = {k: v for k, v in patch.items() if v is not firestore.DELETE_FIELD}
        return {**{k: v for k, v in c.items() if k not in ("original", "editatLa", "editatDe")}, **rest}

    rezultat = scrie(authz.db().transaction())
    fisiere.sterge(wid, obiect(fid, d))
    _schimba_contor(wid, -int(d.get("marime") or 0), 0)
    audit.log(wid, principal.uid, "fisier.original", fid)
    return jsonify({"fisier": _out_fisier(fid, rezultat)})


@bp.errorhandler(tipar.TiparRefuzat)
def _handle_tipar(e: tipar.TiparRefuzat):
    return _err(e.code, 400)


@bp.post("/fisiere/tipar")
def pregateste_tipar():
    """Pozele (și PDF-urile) alese, în ordinea dată, într-un PDF A4 nou, salvat lângă primul document."""
    principal, wid, _ = _require("member", billing=True, limit="fisiere_scriere")
    body = _body()
    ids = body.get("fisiere")
    aspect = body.get("aspect")
    if (not isinstance(ids, list) or not 1 <= len(ids) <= 20 or len(set(map(str, ids))) != len(ids)
            or any(not isinstance(i, str) or not _ID_RE.match(i) for i in ids) or aspect not in tipar.ASPECTE):
        return _err("tipar_invalid", 400)
    metas = []
    for i in ids:
        snap = _col_fisiere(wid).document(i).get()
        d = snap.to_dict() if snap.exists else None
        if not d or d.get("arhivat") or not d.get("clientId"):
            return _err("not_found", 404)
        metas.append((i, d))
    cid = metas[0][1]["clientId"]
    if any(d.get("clientId") != cid for _, d in metas):
        return _err("tipar_invalid", 400)
    permise = {fisiere.JPEG.mime, fisiere.PNG.mime, fisiere.WEBP.mime} | ({fisiere.PDF.mime} if aspect != "ci" else set())
    if any(d.get("mime") not in permise for _, d in metas):
        return _err("tip_nepermis", 400)
    if sum(int(d.get("marime") or 0) for _, d in metas) > MAX_SURSE_TIPAR:
        return _err("tipar_prea_mare", 413)
    continut = []
    for i, d in metas:
        data = fisiere.citeste(wid, obiect(i, d))
        if data is None:
            return _err("fisier_indisponibil", 404)
        continut.append((data, d.get("mime")))

    pdf = tipar.pdf_tipar(continut, aspect)
    if len(pdf) > fisiere.MAX_BYTES:
        return _err("tipar_prea_mare", 413)
    contor = _contor(wid).get().to_dict() or {}
    if int(contor.get("octeti") or 0) + len(pdf) > fisiere.LIMITA_CABINET:
        return _err("spatiu_depasit", 409)
    folder = metas[0][1].get("folderId")
    try:
        _folder_valid(wid, cid, folder)
    except fisiere.FisierRefuzat:
        folder = None
    nume = _nume_liber(fisiere.nume_fisier(tipar.nume_tipar(metas[0][1].get("nume") or "", aspect, len(ids)), fisiere.PDF),
                       _nume_ocupate(wid, cid, folder))
    rezultat = _inregistreaza(wid, cid, folder, pdf, nume, fisiere.PDF, principal.uid, "generat")
    if rezultat is None:
        return _err("not_found", 404)
    fid, meta = rezultat
    audit.log(wid, principal.uid, "fisier.tipar", fid, {"client": cid, "aspect": aspect, "surse": len(ids), "marime": len(pdf)})
    return jsonify({"fisier": _out_fisier(fid, meta)}), 201


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


def folder_generate_nume(wid: str) -> str:
    snap = _setari(wid).get()
    nume = (snap.to_dict() or {}).get("folderGenerate") if snap.exists else None
    return nume if isinstance(nume, str) and nume.strip() else fisiere.FOLDER_GENERATE


def _folder_generate(wid: str, cid: str, uid: str) -> str:
    """Folderul copiilor documentelor generate, în rădăcina clientului; dacă lipsește (nu s-a creat sau a fost șters),
    se creează acum: utilizatorul a cerut explicit păstrarea copiei."""
    nume = folder_generate_nume(wid)
    foldere = _foldere_client(wid, cid)
    for fid, d in foldere.items():
        if d.get("parentId") is None and fisiere.cheie_nume(d.get("nume", "")) == fisiere.cheie_nume(nume):
            return fid
    if len(foldere) >= fisiere.MAX_FOLDERE_CLIENT:
        raise fisiere.FisierRefuzat("prea_multe_foldere")
    ref = _col_foldere(wid).document()
    ref.create({"clientId": cid, "parentId": None, "nume": nume, "createdAt": _now(), "createdBy": uid})
    return ref.id


@bp.put("/fisiere/setari")
def seteaza_foldere_implicite():
    """Setările cabinetului: lista folderelor implicite și/sau folderul copiilor documentelor generate."""
    principal, wid, _ = _require("admin", billing=True, limit="fisiere_scriere")
    body = _body()
    patch: dict = {}
    if "foldereImplicite" in body:
        lista = body.get("foldereImplicite")
        if not isinstance(lista, list) or len(lista) > fisiere.MAX_FOLDERE_IMPLICITE:
            return _err("invalid_body", 400)
        curate: list[str] = []
        for raw in lista:
            nume = fisiere.nume_folder(raw)
            if any(fisiere.cheie_nume(n) == fisiere.cheie_nume(nume) for n in curate):
                return _err("nume_existent", 409)
            curate.append(nume)
        patch["foldereImplicite"] = curate
    if "folderGenerate" in body:
        patch["folderGenerate"] = fisiere.nume_folder(body.get("folderGenerate"))
    if not patch:
        return _err("invalid_body", 400)
    _setari(wid).set({**patch, "updatedAt": _now(), "updatedBy": principal.uid}, merge=True)
    meta = {}
    if "foldereImplicite" in patch:
        meta["foldere"] = len(patch["foldereImplicite"])
    if "folderGenerate" in patch:
        meta["folderGenerate"] = True        # doar faptul că s-a schimbat, fără nume
    audit.log(wid, principal.uid, "fisiere.setari", None, meta)
    return jsonify(patch)


@bp.get("/admin/fisiere/spatiu")
def admin_spatiu():
    """Spațiul ocupat de documente în fiecare cabinet (super admin): cine se apropie de limită, din date reale."""
    authz.require_super_admin()
    db = authz.db()
    ids = [d.id for d in db.collection("workspaces").select([]).limit(1000).stream()]
    cabinete = {}
    for snap in db.get_all([_contor(wid) for wid in ids]):
        d = snap.to_dict() or {}
        cabinete[snap.reference.parent.parent.id] = {
            "octeti": max(0, int(d.get("octeti") or 0)), "numar": max(0, int(d.get("numar") or 0)),
        }
    return jsonify({"limita": fisiere.LIMITA_CABINET, "cabinete": cabinete})


@bp.post("/clients/<cid>/documente/init")
def initializeaza_client(cid: str):
    """Pregătește documentele clientului: creează folderele implicite ale cabinetului, o singură dată (idempotent, sigur
    și la două ferestre deschise simultan — marcajul se creează înaintea folderelor)."""
    principal, wid, _ = _require("member", billing=True)
    if not _client_exista(wid, cid):
        return _err("not_found", 404)
    create = pregateste_client(wid, cid, principal.uid)
    return jsonify({"foldere": create or [], "init": create is not None})


def pregateste_client(wid: str, cid: str, uid: str) -> list[dict] | None:
    """Folderele implicite, o singură dată per client. None = clientul fusese deja pregătit (nimic de făcut)."""
    try:
        _marcaj_client(wid, cid).create({"initLa": _now(), "initDe": uid})
    except gexc.AlreadyExists:
        return None
    foldere = _foldere_client(wid, cid)
    create = []
    for nume in foldere_implicite(wid):
        if _nume_folder_ocupat(foldere, None, nume):
            continue
        ref = _col_foldere(wid).document()
        meta = {"clientId": cid, "parentId": None, "nume": nume, "createdAt": _now(), "createdBy": uid}
        ref.create(meta)
        foldere[ref.id] = meta
        create.append(_out_folder(ref.id, meta))
    return create


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
