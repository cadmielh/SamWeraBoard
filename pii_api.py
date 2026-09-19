"""API pentru datele personale sensibile (CNP, serie/număr CI) ale persoanelor din
fișele de client. Valorile se păstrează criptate (vault.py) în
`workspaces/{wid}/clienti/{cid}/pii/vault`, document la care clienții NU au acces
(regulile Firestore nu-l expun), deci orice citire în clar trece pe aici și e auditată.
"""
from __future__ import annotations

import re

from firebase_admin import firestore
from flask import Blueprint, jsonify, request

import audit
import authz
import vault

bp = Blueprint("pii", __name__)

_ID_RE = re.compile(r"^[A-Za-z0-9]{10,40}$")
_PID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_CNP_RE = re.compile(r"^\d{13}$")
_SERIE_RE = re.compile(r"^[A-Za-z0-9 .\-/]{0,30}$")
_PURPOSES = {"view", "edit", "generate"}
MAX_PERSONS = 200


def normalize_cnp(v) -> str:
    """CNP: fără spații sau alte caractere albe (ex. „1 800101 221144”)."""
    return re.sub(r"\s+", "", str(v or ""))


def normalize_serie(v) -> str:
    """Seria/numărul actului: orice succesiune de spații, taburi sau linii noi devine un singur spațiu.
    Scanarea produce adesea „MX⏎123456” (serie și număr pe linii diferite); fără normalizare, acele persoane nu s-ar mai putea salva."""
    return " ".join(str(v or "").split())


def _err(code: str, status: int):
    return jsonify({"error": code}), status


@bp.errorhandler(authz.AuthError)
def _handle_auth(e: authz.AuthError):
    return authz.error_response(e)


@bp.errorhandler(vault.VaultError)
def _handle_vault(e: vault.VaultError):
    print(f"[vault] {e}")
    return _err("vault_unavailable", 503)


def _client_ref(wid: str, cid: str):
    return authz.db().collection("workspaces").document(wid).collection("clienti").document(cid)


def _vault_ref(wid: str, cid: str):
    return _client_ref(wid, cid).collection("pii").document("vault")


@bp.get("/clients/<cid>/pii")
def reveal(cid: str):
    principal, wid, _ = authz.require_from_header("viewer", consent=True, limit="pii")
    if not _ID_RE.match(cid):
        return _err("not_found", 404)
    purpose = request.args.get("purpose", "view")
    if purpose not in _PURPOSES:
        return _err("invalid_purpose", 400)

    snap = _vault_ref(wid, cid).get()
    stored = (snap.to_dict() or {}).get("persons", {}) if snap.exists else {}
    out, failed = {}, 0
    for pid, token in stored.items():
        try:
            out[pid] = vault.decrypt_record(wid, cid, pid, token)
        except vault.VaultError:
            failed += 1
    # Se loghează cine/când/de ce/câte persoane — niciodată valorile.
    audit.log(wid, principal.uid, "pii.reveal", cid, {"purpose": purpose, "persons": len(out)})
    return jsonify({"persons": out, "failed": failed})


@bp.put("/clients/<cid>/pii")
def write(cid: str):
    principal, wid, _ = authz.require_from_header("member", consent=True, limit="pii")
    if not _ID_RE.match(cid):
        return _err("not_found", 404)
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _err("invalid_body", 400)
    persons = body.get("persons") or {}
    keep = body.get("keep")
    if not isinstance(persons, dict) or len(persons) > MAX_PERSONS:
        return _err("invalid_body", 400)
    if keep is not None and (not isinstance(keep, list) or len(keep) > MAX_PERSONS):
        return _err("invalid_body", 400)

    clean: dict[str, dict] = {}
    for pid, v in persons.items():
        if not _PID_RE.match(pid) or not isinstance(v, dict):
            return _err("invalid_person", 400)
        cnp = normalize_cnp(v.get("cnp"))
        serie = normalize_serie(v.get("serie_numar"))
        if (cnp and not _CNP_RE.match(cnp)) or not _SERIE_RE.match(serie):
            return _err("invalid_person", 400)
        clean[pid] = {"cnp": cnp, "serie_numar": serie}

    ref = _vault_ref(wid, cid)
    db = authz.db()

    @firestore.transactional
    def run(txn):
        snap = ref.get(transaction=txn)
        stored = dict((snap.to_dict() or {}).get("persons", {})) if snap.exists else {}
        written = removed = 0
        for pid, v in clean.items():
            if not v["cnp"] and not v["serie_numar"]:
                if stored.pop(pid, None) is not None:
                    removed += 1
            else:
                stored[pid] = vault.encrypt_record(wid, cid, pid, v)
                written += 1
        if keep is not None:
            keep_set = {k for k in keep if isinstance(k, str)}
            for pid in [p for p in stored if p not in keep_set]:
                del stored[pid]
                removed += 1
        txn.set(ref, {"persons": stored, "updatedAt": firestore.SERVER_TIMESTAMP})
        return written, removed

    written, removed = run(db.transaction())
    audit.log(wid, principal.uid, "pii.write", cid, {"written": written, "removed": removed})
    return jsonify({"ok": True})


@bp.delete("/clients/<cid>")
def delete_client(cid: str):
    """Șterge fișa clientului împreună cu tot ce ține de ea (vault, istoric generări)."""
    principal, wid, _ = authz.require_from_header("admin")
    if not _ID_RE.match(cid):
        return _err("not_found", 404)
    ref = _client_ref(wid, cid)
    if not ref.get().exists:
        return _err("not_found", 404)
    authz.db().recursive_delete(ref)
    audit.log(wid, principal.uid, "client.delete", cid)
    return jsonify({"ok": True})
