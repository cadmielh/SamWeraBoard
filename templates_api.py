"""Șabloanele proprii ale cabinetelor: crearea și înlocuirea fișierului, livrarea unui șablon pregătit de furnizor.

Regulile Firestore permit browserului doar să creeze un șablon Google Docs (fără fișier) și să schimbe numele,
descrierea, tipul și numele fișierului generat. Șabloanele .docx (`fileBase64`), etichetele detectate, `revision`,
`updatedAt/By` și `delivery` se scriu DOAR de aici (Admin SDK), după `template_safety.validate_docx` și cu
etichetele recalculate pe server, deci niciodată din ce trimite clientul.

Livrarea (super admin): copiază un șablon din cabinetul super adminului într-un cabinet client cu abonament.
Nu întoarce niciodată conținut din cabinetul țintă și nu poate suprascrie un șablon existent.
"""
from __future__ import annotations

import base64
import binascii
import re
import unicodedata

from firebase_admin import firestore
from flask import Blueprint, jsonify, request
from google.api_core import exceptions as gexc
from werkzeug.utils import secure_filename

import audit
import authz
import billing
import ratelimit
import template_safety
from doc_filler import (list_clauses_in_docx, list_placeholders_in_docx, list_repeat_group_fields_in_docx,
                        list_repeat_groups_in_docx)

bp = Blueprint("templates", __name__)

_TID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_TIP_TEMPLATE = ("PF", "PJ", "universal")
# Șabloanele de bază cu formular dedicat (vezi isAnexa1Template & co. din frontend): formularul cere doar
# etichetele șablonului de bază, deci o etichetă în plus într-o copie nu e cerută nicăieri.
DEDICATED_FORM_KEYS = frozenset({"anexa1_inregistrare_fiscala", "declaratie_beneficiari_reali", "declaratie_activitate"})

# Setat de app.py după încărcarea fisiere_template/ (cheie -> intrarea din registry, cu `placeholders`).
_builtins: dict[str, dict] = {}


def set_builtins(templates: dict[str, dict]) -> None:
    global _builtins
    _builtins = templates


@bp.errorhandler(authz.AuthError)
def _handle_auth(e: authz.AuthError):
    return authz.error_response(e)


def _err(code: str, status: int, **extra):
    return jsonify({"error": code, **extra}), status


def _body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _templates(wid: str):
    return authz.db().collection("workspaces").document(wid).collection("docTemplates")


def _meta(data: bytes) -> dict:
    """Etichetele, clauzele și blocurile repetitive, recalculate pe server."""
    try:
        return {"placeholders": list_placeholders_in_docx(data), "clauses": list_clauses_in_docx(data),
                "repeatGroups": list_repeat_groups_in_docx(data), "repeatGroupFields": list_repeat_group_fields_in_docx(data)}
    except Exception as e:  # noqa: BLE001 — document pe care python-docx nu-l poate citi
        print(f"[templates] citire eșuată ({type(e).__name__})")
        raise template_safety.TemplateRejected("invalid_template")


def _file_name(raw: str | None) -> str:
    name = secure_filename(unicodedata.normalize("NFKD", raw or ""))[:120]
    if not name.lower().endswith(".docx"):
        name = (name or "sablon") + ".docx"
    return name


def _encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


# ── Crearea unui șablon .docx ────────────────────────────────────────────────

def _create(principal: authz.Principal, wid: str, data: bytes, file_name: str | None, fields: dict, meta: dict,
            **extra) -> str:
    name = str(fields.get("name") or "").strip()[:200]
    tip = fields.get("tipTemplate") if fields.get("tipTemplate") in _TIP_TEMPLATE else "universal"
    ref = _templates(wid).document()
    ref.create({
        "name": name, "description": str(fields.get("description") or "").strip()[:1000],
        "type": "docx", "fileBase64": _encode(data), "fileName": _file_name(file_name), **meta,
        "outputNameTemplate": str(fields.get("outputNameTemplate") or "").strip()[:300] or f"{name}_completat.docx",
        "tipTemplate": tip, "createdAt": firestore.SERVER_TIMESTAMP, "createdBy": principal.uid, "revision": 0, **extra,
    })
    audit.log(wid, principal.uid, "template.create", ref.id, {"placeholders": len(meta["placeholders"]), **extra})
    return ref.id


@bp.post("/templates")
def create_template():
    """Șablon nou din fișierul încărcat. Fișierul trece prin `template_safety` și etichetele se calculează aici:
    regulile Firestore nu mai primesc fișiere direct din browser."""
    principal, wid, _ws = authz.require_from_header("member", limit="fill", billing=True)
    if not str(request.form.get("name") or "").strip():
        return _err("name_required", 400)
    upload = request.files.get("template")
    if upload is None or not (upload.filename or "").lower().endswith(".docx"):
        return _err("invalid_template", 400)
    data = upload.read(template_safety.MAX_STORED_BYTES + 1)
    try:
        template_safety.validate_docx(data)
        meta = _meta(data)
    except template_safety.TemplateRejected as e:
        return _err(e.code, 400)
    tid = _create(principal, wid, data, upload.filename, request.form, meta)
    return jsonify({"id": tid, **meta}), 201


@bp.post("/templates/from-builtin")
def duplicate_builtin():
    """Copie a unui șablon de bază („Duplică”). Fișierul se ia de pe server, nu din browser."""
    principal, wid, _ws = authz.require_from_header("member", limit="fill", billing=True)
    key = _body().get("key")
    base = _builtins.get(key) if isinstance(key, str) else None
    if not base or base.get("type", "docx") != "docx" or not isinstance(base.get("bytes"), bytes):
        return _err("invalid_source_key", 400)
    if len(base["bytes"]) > template_safety.MAX_STORED_BYTES:
        return _err("template_too_large", 400)
    meta = {k: base.get(k) or [] for k in ("placeholders", "clauses", "repeatGroups")}
    meta["repeatGroupFields"] = base.get("repeatGroupFields") or {}
    tid = _create(principal, wid, base["bytes"], base.get("filename"), base, meta,
                  sourceKey=key, sourceVersion=int(base.get("version") or 0))
    return jsonify({"id": tid}), 201


# ── Înlocuirea fișierului ────────────────────────────────────────────────────

@bp.post("/templates/<tid>/file")
def replace_template_file(tid: str):
    """Înlocuiește fișierul unui șablon .docx, păstrându-i identitatea (id, `sourceKey`, livrarea, numele).

    `baseRevision` = revizia pe care a văzut-o utilizatorul: dacă între timp un coleg a înlocuit fișierul,
    cererea e refuzată (409 revision_conflict), ca nimeni să nu suprascrie fără să știe."""
    principal, wid, _ws = authz.require_from_header("member", limit="fill", billing=True)
    if not _TID_RE.match(tid):
        return _err("not_found", 404)
    try:
        base_revision = int(request.form.get("baseRevision", ""))
    except ValueError:
        return _err("invalid_revision", 400)
    upload = request.files.get("template")
    if upload is None or not (upload.filename or "").lower().endswith(".docx"):
        return _err("invalid_template", 400)
    data = upload.read(template_safety.MAX_STORED_BYTES + 1)
    try:
        template_safety.validate_docx(data)
        meta = _meta(data)
    except template_safety.TemplateRejected as e:
        return _err(e.code, 400)

    ref = _templates(wid).document(tid)

    @firestore.transactional
    def run(txn):
        snap = ref.get(transaction=txn)
        if not snap.exists:
            return "not_found", None
        cur = snap.to_dict() or {}
        if cur.get("type") != "docx" or not isinstance(cur.get("fileBase64"), str):
            return "not_replaceable", None
        revision = int(cur.get("revision") or 0)
        if revision != base_revision:
            return "revision_conflict", revision
        txn.update(ref, {
            "fileBase64": _encode(data), "fileName": _file_name(upload.filename), **meta,
            "revision": revision + 1, "updatedAt": firestore.SERVER_TIMESTAMP, "updatedBy": principal.uid,
        })
        return None, revision + 1

    error, revision = run(authz.db().transaction())
    if error == "not_found":
        return _err("not_found", 404)
    if error:
        return _err(error, 409, **({"revision": revision} if revision is not None else {}))
    audit.log(wid, principal.uid, "template.replace", tid,
              {"revision": revision, "placeholders": len(meta["placeholders"]), "clauses": len(meta["clauses"])})
    return jsonify({"revision": revision, **meta})


# ── Livrarea către un cabinet (super admin) ──────────────────────────────────

def _target_workspace(wid: str) -> dict | None:
    ws = authz.load_workspace(wid)
    return None if ws is None or ws.get("status") == "pendingDeletion" else ws


def _same_name(typed: object, actual: object) -> bool:
    norm = lambda v: unicodedata.normalize("NFC", str(v or "")).strip()  # noqa: E731
    return isinstance(typed, str) and bool(norm(actual)) and norm(typed) == norm(actual)


def _warnings(meta: dict, source_key: str | None) -> dict:
    out: dict = {}
    if not meta["placeholders"]:
        out["noPlaceholders"] = True
    base = _builtins.get(source_key or "")
    if source_key in DEDICATED_FORM_KEYS and base:
        unasked = sorted(set(meta["placeholders"]) - set(base.get("placeholders") or []))
        if unasked:
            out["dedicatedFormUnasked"] = unasked[:50]
    return out


@bp.post("/admin/workspaces/<target>/templates")
def deliver_template(target: str):
    """Copiază șablonul `sourceTemplateId` din cabinetul activ (`X-Workspace-Id`) în cabinetul `target`.

    `dryRun: true` face toate verificările fără să scrie nimic. Livrarea e refuzată dacă documentul conține
    un CNP valid, comentarii, modificări urmărite sau proprietăți personalizate (422 template_blocked)."""
    principal = authz.require_super_admin()
    source = request.headers.get("X-Workspace-Id", "")
    # Doar dintr-un cabinet al super adminului: rolul de aplicație nu mută șabloane între cabinete străine.
    authz.require_role(principal, source, "member")
    ratelimit.check(principal.uid, source, "template_delivery")

    body = _body()
    source_tid, source_key = body.get("sourceTemplateId"), body.get("sourceKey")
    dry_run, as_new_copy = body.get("dryRun") is True, body.get("asNewCopy") is True
    if not isinstance(source_tid, str) or not _TID_RE.match(source_tid):
        return _err("not_found", 404)
    if source_key is not None and (not isinstance(source_key, str) or source_key not in _builtins):
        return _err("invalid_source_key", 400)

    ws = _target_workspace(target) if authz.valid_wid(target) and target != source else None
    if ws is None:
        return _err("not_found", 404)
    if not _same_name(body.get("confirmName"), ws.get("name")):
        return _err("confirm_mismatch", 400)
    if not authz.consent_ok(ws):
        return _err("target_consent_required", 409)
    if not billing.has_paid_access(ws):
        return _err("target_subscription_required", 409)

    snap = _templates(source).document(source_tid).get()
    if not snap.exists:
        return _err("not_found", 404)
    src = snap.to_dict() or {}
    if src.get("type") != "docx" or not isinstance(src.get("fileBase64"), str):
        return _err("not_deliverable", 409)
    try:
        original = base64.b64decode(src["fileBase64"], validate=True)
        template_safety.validate_docx(original)
        blocking = template_safety.inspect_content(original)
        cleaned = template_safety.strip_metadata(original)
        template_safety.validate_docx(cleaned)
        meta = _meta(cleaned)
    except binascii.Error:
        return _err("invalid_template", 400)
    except template_safety.TemplateRejected as e:
        return _err(e.code, 400)

    warnings = _warnings(meta, source_key)
    if blocking:
        return _err("template_blocked", 422, blocking=blocking, warnings=warnings)
    if dry_run:
        return jsonify({"ok": True, "warnings": warnings, "placeholders": len(meta["placeholders"])})

    tip = src.get("tipTemplate") if src.get("tipTemplate") in _TIP_TEMPLATE else "universal"
    doc = {
        "name": str(src.get("name") or "Șablon")[:200], "description": str(src.get("description") or "")[:1000],
        "type": "docx", "fileBase64": _encode(cleaned), "fileName": _file_name(src.get("fileName")), **meta,
        "outputNameTemplate": str(src.get("outputNameTemplate") or "")[:300], "tipTemplate": tip,
        # `createdAt` e obligatoriu: lista din aplicație e ordonată după el (un document fără el nu apare).
        "createdAt": firestore.SERVER_TIMESTAMP, "createdBy": principal.uid, "revision": 0,
        "delivery": {"at": firestore.SERVER_TIMESTAMP, "by": principal.uid, "sourceTemplateId": source_tid},
    }
    if source_key:
        doc["sourceKey"] = source_key          # fără `sourceVersion`: nu e o copie care trebuie ținută la zi
    col = _templates(target)
    # Id determinist: un dublu-click sau o relivrare nu dublează și nu suprascrie modificările clientului.
    ref = col.document() if as_new_copy else col.document(f"dlv_{source_tid}")
    try:
        ref.create(doc)
    except (gexc.Conflict, gexc.AlreadyExists):
        return _err("already_delivered", 409)
    audit.log(target, principal.uid, "template.deliver", ref.id,
              {"byProvider": True, "placeholders": len(meta["placeholders"]), "sourceKey": source_key})
    return jsonify({"id": ref.id, "warnings": warnings}), 201


@bp.get("/admin/workspaces/<wid>/delivered-templates")
def list_delivered_templates(wid: str):
    """Șabloanele livrate de furnizor într-un cabinet (fără fișier), pentru retragerea unei livrări greșite."""
    authz.require_super_admin()
    if not authz.valid_wid(wid) or _target_workspace(wid) is None:
        return _err("not_found", 404)
    out = []
    for d in _templates(wid).select(["name", "delivery", "revision"]).stream():
        v = d.to_dict() or {}
        delivery = v.get("delivery")
        if not isinstance(delivery, dict):
            continue
        at = delivery.get("at")
        out.append({"id": d.id, "name": v.get("name", ""), "revision": int(v.get("revision") or 0),
                    "deliveredAt": at.isoformat() if hasattr(at, "isoformat") else None})
    return jsonify(sorted(out, key=lambda x: x["deliveredAt"] or "", reverse=True))


@bp.delete("/admin/workspaces/<wid>/templates/<tid>")
def revoke_delivered_template(wid: str, tid: str):
    """Retrage un șablon livrat. Un șablon creat de cabinet (fără `delivery`) nu poate fi atins de aici."""
    principal = authz.require_super_admin()
    if not authz.valid_wid(wid) or not _TID_RE.match(tid) or _target_workspace(wid) is None:
        return _err("not_found", 404)
    ref = _templates(wid).document(tid)
    snap = ref.get()
    data = (snap.to_dict() or {}) if snap.exists else {}
    if not isinstance(data.get("delivery"), dict):
        return _err("not_found", 404)
    ref.delete()
    audit.log(wid, principal.uid, "template.delivery_revoke", tid,
              {"byProvider": True, "revision": int(data.get("revision") or 0)})
    return jsonify({"ok": True})
