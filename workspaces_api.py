"""API pentru operațiunile privilegiate pe workspace.

Tot ce ține de membri, roluri, invitații și consimțământ se scrie DOAR de aici
(Admin SDK); regulile Firestore interzic aceste scrieri din browser. Asta
închide vectorul în care un utilizator își crea propriul workspace și scria
invitații pentru e-mailurile altora, care erau apoi acceptate automat.
"""
from __future__ import annotations

import hashlib
import os
import re
import time
from datetime import datetime, timedelta, timezone

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from flask import Blueprint, jsonify, request

import audit
import authz
import billing
import workspace_deletion

bp = Blueprint("workspaces", __name__)

from legal_versions import DPA_VERSION, TOS_VERSION  # noqa: E402  (versiunile curente ale documentelor legale)

MAX_OWNED_WORKSPACES = 5
MAX_PENDING_INVITES = 50
INVITE_TTL = timedelta(days=14)
ROLES = ("admin", "member", "viewer")
RECENT_LOGIN_SECONDS = 600   # ștergerile definitive cer o autentificare din ultimele 10 minute
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")


def _err(code: str, status: int):
    return jsonify({"error": code}), status


def _body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _auth(wid: str | None = None, min_role: str = "member"):
    """Întoarce (principal, workspace|None). Ridică AuthError."""
    principal = authz.authenticate()
    ws = authz.require_role(principal, wid, min_role) if wid is not None else None
    return principal, ws


@bp.errorhandler(authz.AuthError)
def _handle_auth(e: authz.AuthError):
    return authz.error_response(e)


def _creator_id(email: str) -> str:
    return hashlib.sha256(email.encode()).hexdigest()[:20]


def _may_create_workspace(principal: authz.Principal, owned: int) -> bool:
    """Creare cabinet nou: liberă (dev/teste) sau doar pe invitație (SIGNUP_MODE=invite).

    În modul „invite” pot crea: super adminul, e-mailurile aprobate de el (workspaceCreators)
    și cine deține deja un cabinet (ex. adminii existenți care cer un spațiu suplimentar).
    Membrii invitați într-un cabinet existent nu creează nimic, deci nu sunt afectați.
    """
    if os.getenv("SIGNUP_MODE", "open") != "invite":
        return True
    if owned > 0 or authz.is_super_admin(principal):
        return True
    return authz.db().collection("workspaceCreators").document(_creator_id(principal.email)).get().exists


def _invite_id(wid: str, email: str) -> str:
    # Determinist per (workspace, e-mail): re-invitarea actualizează invitația
    # aceluiași workspace și nu poate atinge invitațiile altor workspace-uri.
    return f"{wid}_{hashlib.sha256(email.encode()).hexdigest()[:20]}"


# ── Workspace ────────────────────────────────────────────────────────────────

@bp.post("/workspaces")
def create_workspace():
    principal, _ = _auth()
    body = _body()
    name = str(body.get("name", "")).strip()
    if not 2 <= len(name) <= 120:
        return _err("invalid_name", 400)
    consent = body.get("consent") if isinstance(body.get("consent"), dict) else {}
    if consent.get("tos") != TOS_VERSION or consent.get("dpa") != DPA_VERSION:
        return _err("consent_required", 400)

    db = authz.db()
    owned = list(db.collection("workspaces").where("ownerId", "==", principal.uid)
                 .limit(MAX_OWNED_WORKSPACES).stream())
    if len(owned) >= MAX_OWNED_WORKSPACES:
        return _err("workspace_limit", 429)
    if not _may_create_workspace(principal, len(owned)):
        return _err("creation_not_allowed", 403)

    # O singură perioadă de probă per e-mail (normalizat): al doilea cabinet al aceluiași om pornește direct
    # cu abonare. Revendicarea și cabinetul se scriu în aceeași tranzacție.
    now = datetime.now(timezone.utc)
    claim_ref = db.collection("trialClaims").document(
        billing.claim_id("email", billing.normalize_email(principal.email)))
    ref = db.collection("workspaces").document()

    @firestore.transactional
    def run(txn):
        trial = not claim_ref.get(transaction=txn).exists
        if trial:
            txn.create(claim_ref, {"kind": "email", "workspaceId": ref.id, "claimedAt": firestore.SERVER_TIMESTAMP})
        txn.set(ref, _new_workspace(name, principal, billing.initial_trial(now) if trial else billing.no_trial(now)))
        return trial

    trial = run(db.transaction())
    db.collection("users").document(principal.uid).set({"activeWorkspaceId": ref.id}, merge=True)
    audit.log(ref.id, principal.uid, "workspace.create", ref.id)
    audit.log(ref.id, principal.uid, "consent.accept", ref.id,
              {"tos": TOS_VERSION, "dpa": DPA_VERSION})
    audit.log(ref.id, principal.uid, "billing.trial_start" if trial else "billing.no_trial", ref.id)
    return jsonify({"id": ref.id, "trial": trial}), 201


def _new_workspace(name: str, principal: authz.Principal, billing_state: dict) -> dict:
    return {
        "name": name,
        "ownerId": principal.uid,
        "members": {principal.uid: {
            "role": "admin",
            "email": principal.email,
            "displayName": principal.name,
            "addedAt": firestore.SERVER_TIMESTAMP,
        }},
        "consent": {
            "tos": TOS_VERSION,
            "dpa": DPA_VERSION,
            "acceptedBy": principal.uid,
            "acceptedAt": firestore.SERVER_TIMESTAMP,
            "ip": authz.client_ip(),
        },
        "status": "active",
        "createdAt": firestore.SERVER_TIMESTAMP,
        "billing": billing_state,
    }


@bp.post("/workspaces/<wid>/consent")
def accept_consent(wid: str):
    """Adminul unui workspace (creat înainte de existența acceptării, sau după o revizuire a textelor)
    acceptă versiunea curentă a termenilor și a DPA."""
    principal, _ = _auth(wid, "admin")
    body = _body()
    if body.get("tos") != TOS_VERSION or body.get("dpa") != DPA_VERSION:
        return _err("invalid_consent", 400)
    authz.db().collection("workspaces").document(wid).update({"consent": {
        "tos": TOS_VERSION, "dpa": DPA_VERSION, "acceptedBy": principal.uid,
        "acceptedAt": firestore.SERVER_TIMESTAMP, "ip": authz.client_ip(),
    }})
    audit.log(wid, principal.uid, "consent.accept", wid, {"tos": TOS_VERSION, "dpa": DPA_VERSION})
    return jsonify({"ok": True})


# ── Membri ───────────────────────────────────────────────────────────────────

def _admin_count(members: dict) -> int:
    return sum(1 for m in members.values() if m.get("role") == "admin")


@bp.patch("/workspaces/<wid>/members/<uid>")
def change_role(wid: str, uid: str):
    principal, _ = _auth(wid, "admin")
    role = _body().get("role")
    if role not in ROLES:
        return _err("invalid_role", 400)

    db = authz.db()
    ref = db.collection("workspaces").document(wid)

    @firestore.transactional
    def run(txn):
        data = ref.get(transaction=txn).to_dict() or {}
        members = data.get("members") or {}
        if uid not in members:
            return "not_found"
        if uid == data.get("ownerId"):
            return "owner_locked"
        if members[uid].get("role") == "admin" and role != "admin" and _admin_count(members) <= 1:
            return "last_admin"
        txn.update(ref, {f"members.{uid}.role": role})
        return "ok"

    result = run(db.transaction())
    if result != "ok":
        return _err(result, 404 if result == "not_found" else 409)
    audit.log(wid, principal.uid, "member.role_change", uid, {"role": role})
    return jsonify({"ok": True})


@bp.delete("/workspaces/<wid>/members/<uid>")
def remove_member(wid: str, uid: str):
    # Adminul îi elimină pe alții; orice membru se poate retrage singur.
    principal = authz.authenticate()
    authz.require_role(principal, wid, "admin" if uid != principal.uid else "viewer")

    db = authz.db()
    ref = db.collection("workspaces").document(wid)

    @firestore.transactional
    def run(txn):
        data = ref.get(transaction=txn).to_dict() or {}
        members = data.get("members") or {}
        if uid not in members:
            return "not_found"
        if uid == data.get("ownerId"):
            return "owner_locked"
        if members[uid].get("role") == "admin" and _admin_count(members) <= 1:
            return "last_admin"
        txn.update(ref, {f"members.{uid}": firestore.DELETE_FIELD})
        return "ok"

    result = run(db.transaction())
    if result != "ok":
        return _err(result, 404 if result == "not_found" else 409)
    audit.log(wid, principal.uid, "member.remove", uid)
    return jsonify({"ok": True})


# ── Invitații ────────────────────────────────────────────────────────────────

@bp.post("/workspaces/<wid>/invites")
def create_invite(wid: str):
    principal, ws = _auth(wid, "admin")
    body = _body()
    email = str(body.get("email", "")).strip().lower()
    role = body.get("role", "member")
    if not _EMAIL_RE.match(email):
        return _err("invalid_email", 400)
    if role not in ROLES:
        return _err("invalid_role", 400)
    if any((m.get("email") or "").lower() == email for m in (ws.get("members") or {}).values()):
        return _err("already_member", 409)

    db = authz.db()
    pending = list(db.collection("invitations").where("workspaceId", "==", wid)
                   .where("status", "==", "pending").limit(MAX_PENDING_INVITES + 1).stream())
    inv_id = _invite_id(wid, email)
    if len(pending) >= MAX_PENDING_INVITES and not any(p.id == inv_id for p in pending):
        return _err("invite_limit", 429)

    db.collection("invitations").document(inv_id).set({
        "workspaceId": wid,
        "workspaceName": ws.get("name", ""),
        "email": email,
        "role": role,
        "invitedBy": principal.uid,
        "invitedByEmail": principal.email,
        "invitedAt": firestore.SERVER_TIMESTAMP,
        "expiresAt": datetime.now(timezone.utc) + INVITE_TTL,
        "status": "pending",
    })
    audit.log(wid, principal.uid, "invite.create", inv_id, {"role": role})
    return jsonify({"id": inv_id}), 201


@bp.get("/workspaces/<wid>/invites")
def list_workspace_invites(wid: str):
    _auth(wid, "admin")
    docs = (authz.db().collection("invitations").where("workspaceId", "==", wid)
            .where("status", "==", "pending").stream())
    now = datetime.now(timezone.utc)
    out = []
    for d in docs:
        v = d.to_dict()
        exp = v.get("expiresAt")
        if exp and exp < now:
            continue
        out.append({"id": d.id, "email": v.get("email"), "role": v.get("role")})
    return jsonify(out)


@bp.delete("/workspaces/<wid>/invites/<inv_id>")
def revoke_invite(wid: str, inv_id: str):
    principal, _ = _auth(wid, "admin")
    ref = authz.db().collection("invitations").document(inv_id)
    snap = ref.get()
    if not snap.exists or snap.to_dict().get("workspaceId") != wid:
        return _err("not_found", 404)
    ref.update({"status": "revoked"})
    audit.log(wid, principal.uid, "invite.revoke", inv_id)
    return jsonify({"ok": True})


@bp.get("/invitations")
def my_invitations():
    principal = authz.authenticate()
    docs = (authz.db().collection("invitations").where("email", "==", principal.email)
            .where("status", "==", "pending").stream())
    now = datetime.now(timezone.utc)
    out = []
    for d in docs:
        v = d.to_dict()
        exp = v.get("expiresAt")
        if exp and exp < now:
            continue
        out.append({
            "id": d.id,
            "workspaceName": v.get("workspaceName", ""),
            "role": v.get("role"),
            "invitedByEmail": v.get("invitedByEmail", ""),
        })
    return jsonify(out)


def _load_own_invite(inv_id: str, principal: authz.Principal):
    ref = authz.db().collection("invitations").document(inv_id)
    snap = ref.get()
    if not snap.exists:
        return ref, None
    v = snap.to_dict()
    if (v.get("email") or "") != principal.email or v.get("status") != "pending":
        return ref, None
    exp = v.get("expiresAt")
    if exp and exp < datetime.now(timezone.utc):
        return ref, None
    return ref, v


@bp.post("/invitations/<inv_id>/accept")
def accept_invite(inv_id: str):
    principal = authz.authenticate()
    db = authz.db()
    inv_ref, inv = _load_own_invite(inv_id, principal)
    if inv is None:
        return _err("not_found", 404)
    ws_ref = db.collection("workspaces").document(inv["workspaceId"])

    @firestore.transactional
    def run(txn):
        ws = ws_ref.get(transaction=txn).to_dict()
        if not ws or ws.get("status") == "pendingDeletion":
            return "not_found"
        if principal.uid not in (ws.get("members") or {}):
            txn.update(ws_ref, {f"members.{principal.uid}": {
                "role": inv["role"],
                "email": principal.email,
                "displayName": principal.name,
                "addedAt": firestore.SERVER_TIMESTAMP,
            }})
        txn.update(inv_ref, {
            "status": "accepted",
            "acceptedBy": principal.uid,
            "acceptedAt": firestore.SERVER_TIMESTAMP,
        })
        return "ok"

    result = run(db.transaction())
    if result != "ok":
        return _err(result, 404)
    audit.log(inv["workspaceId"], principal.uid, "invite.accept", inv_id, {"role": inv["role"]})
    return jsonify({"workspaceId": inv["workspaceId"]})


@bp.post("/invitations/<inv_id>/decline")
def decline_invite(inv_id: str):
    principal = authz.authenticate()
    inv_ref, inv = _load_own_invite(inv_id, principal)
    if inv is None:
        return _err("not_found", 404)
    inv_ref.update({"status": "declined"})
    audit.log(inv["workspaceId"], principal.uid, "invite.decline", inv_id)
    return jsonify({"ok": True})


# ── Audit ────────────────────────────────────────────────────────────────────

@bp.get("/workspaces/<wid>/audit")
def list_audit(wid: str):
    """Jurnalul de activitate al workspace-ului (doar admin). Cele mai recente întâi.
    `limit` (1–500, implicit 100) și `before` (ISO 8601, momentul ultimei intrări primite) pentru paginare."""
    _auth(wid, "admin")
    try:
        limit = min(max(int(request.args.get("limit", 100)), 1), 500)
    except ValueError:
        return _err("invalid_limit", 400)
    q = authz.db().collection("workspaces").document(wid).collection("auditLog")
    before = request.args.get("before")
    if before:
        try:
            # Într-un URL neîncodat, „+” din „+00:00” ajunge ca spațiu: îl acceptăm.
            dt = datetime.fromisoformat(before.strip().replace(" ", "+").replace("Z", "+00:00"))
        except ValueError:
            return _err("invalid_before", 400)
        q = q.where(filter=FieldFilter("ts", "<", dt))
    docs = q.order_by("ts", direction=firestore.Query.DESCENDING).limit(limit).stream()
    out = []
    for d in docs:
        v = d.to_dict()
        ts = v.get("ts")
        out.append({
            "id": d.id,
            "ts": ts.isoformat() if ts else None,
            "actorUid": v.get("actorUid"),
            "action": v.get("action"),
            "target": v.get("target"),
            "meta": v.get("meta") or {},
            "ip": v.get("ip"),
        })
    return jsonify(out)


# ── Cine poate crea cabinete (înregistrare pe invitație) ────────────────────

def _require_super_admin() -> authz.Principal:
    return authz.require_super_admin()


@bp.post("/account/revoke-sessions")
def revoke_sessions():
    principal = authz.authenticate()
    try:
        authz.revoke_sessions(principal.uid)
    except Exception as e:
        print(f"[auth] revoke failed: {type(e).__name__}")
        return _err("unavailable", 503)
    return jsonify({"ok": True})


def _recent_login(principal: authz.Principal) -> bool:
    return time.time() - principal.auth_time <= RECENT_LOGIN_SECONDS


@bp.post("/account/delete")
def delete_account():
    """Programează ștergerea contului: îl dezactivează acum, iar datele se șterg după perioada de grație.

    Refuză dacă e proprietarul sau ultimul administrator al unui cabinet cu alți membri: cabinetul ar rămâne fără administrator.
    """
    principal = authz.authenticate()
    if not _recent_login(principal):
        return _err("recent_login_required", 403)
    if str(_body().get("confirm", "")).strip().lower() != principal.email:
        return _err("confirm_mismatch", 400)

    db = authz.db()
    uid = principal.uid
    own, blocked = [], []
    q = db.collection("workspaces").where(filter=FieldFilter(f"members.{uid}.role", "in", list(ROLES)))
    for snap in q.stream():
        ws = snap.to_dict() or {}
        members = ws.get("members") or {}
        if len(members) == 1:
            own.append(snap.id)
        elif uid == ws.get("ownerId") or (members[uid].get("role") == "admin" and _admin_count(members) <= 1):
            blocked.append(ws.get("name") or snap.id)
    if blocked:
        return jsonify({"error": "workspace_blockers", "workspaces": sorted(blocked)}), 409

    # Întâi dezactivarea: dacă eșuează, nu s-a programat nimic. Dacă programarea eșuează, contul se reactivează.
    try:
        authz.set_user_disabled(uid, True)
    except Exception as e:
        print(f"[account] disable failed: {type(e).__name__}")
        return _err("unavailable", 503)
    try:
        delete_after = workspace_deletion.schedule_account(db, uid, principal.email, own)
    except Exception as e:                       # ex. Stripe indisponibil
        print(f"[account] schedule failed: {type(e).__name__}")
        authz.set_user_disabled(uid, False)
        return _err("unavailable", 503)
    for wid in own:
        audit.log(wid, uid, "workspace.deletion_scheduled", wid, {"reason": "account"})
    return jsonify({"ok": True, "deleteAfter": delete_after.isoformat(), "workspaces": len(own)})


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


@bp.get("/account/export")
def export_account():
    """Copia datelor contului (GDPR art. 15 și 20), unde Furnizorul e operator. Datele clienților țin de cabinet (DPA)."""
    principal = authz.authenticate()
    db = authz.db()
    uid = principal.uid
    memberships = []
    q = db.collection("workspaces").where(filter=FieldFilter(f"members.{uid}.role", "in", list(ROLES)))
    for snap in q.stream():
        ws = snap.to_dict() or {}
        m = (ws.get("members") or {}).get(uid) or {}
        memberships.append({"cabinet": ws.get("name"), "rol": m.get("role"), "proprietar": ws.get("ownerId") == uid})
    profile = db.collection("users").document(uid).get().to_dict() or {}
    extractions = [{"moment": _iso(v.get("createdAt")), "fisier": v.get("sourceFile")}
                   for v in (d.to_dict() or {} for d in db.collection("users").document(uid).collection("extractions").stream())]
    invitations = [{"cabinet": v.get("workspaceName"), "rol": v.get("role"), "stare": v.get("status")}
                   for v in (d.to_dict() or {} for d in db.collection("invitations").where(filter=FieldFilter("email", "==", principal.email)).stream())]
    return jsonify({
        "exportatLa": datetime.now(timezone.utc).isoformat(),
        "cont": {"id": uid, "email": principal.email, "nume": principal.name, "metodaAutentificare": principal.provider},
        "profil": {k: _iso(v) for k, v in profile.items()},
        "cabinete": sorted(memberships, key=lambda m: m["cabinet"] or ""),
        "invitatii": invitations,
        "istoricExtrageri": extractions,
    })


@bp.get("/admin/workspaces/<wid>/deletion-preview")
def workspace_deletion_preview(wid: str):
    _require_super_admin()
    if not authz.valid_wid(wid):
        return _err("not_found", 404)
    try:
        r = workspace_deletion.run(authz.db(), wid, dry_run=True)
    except SystemExit:
        return _err("not_found", 404)
    return jsonify({"counts": r["counts"], "subscription": bool(r["stripeSubscription"]), "graceDays": workspace_deletion.GRACE_DAYS})


@bp.post("/admin/workspaces/<wid>/delete")
def delete_workspace(wid: str):
    """Super admin: programează ștergerea (implicit) sau, cu `immediate`, o face definitiv acum.

    Cere numele exact al cabinetului și o autentificare recentă."""
    principal = _require_super_admin()
    if not _recent_login(principal):
        return _err("recent_login_required", 403)
    ws = authz.load_workspace(wid)
    if ws is None:
        return _err("not_found", 404)
    body = _body()
    if str(body.get("confirm", "")).strip() != (ws.get("name") or "").strip():
        return _err("confirm_mismatch", 400)
    db = authz.db()
    try:
        if body.get("immediate") is True:
            workspace_deletion.run(db, wid, actor=principal.uid)
            return jsonify({"ok": True, "deleted": True})
        delete_after = workspace_deletion.schedule(db, wid, actor=principal.uid, reason="admin")
    except Exception as e:
        print(f"[admin] workspace delete failed: {type(e).__name__}")
        return _err("unavailable", 503)
    audit.log(wid, principal.uid, "workspace.deletion_scheduled", wid, {"reason": "admin"})
    return jsonify({"ok": True, "deleted": False, "deleteAfter": delete_after.isoformat()})


@bp.post("/admin/workspaces/<wid>/restore")
def restore_workspace(wid: str):
    principal = _require_super_admin()
    if not authz.valid_wid(wid) or not workspace_deletion.restore(authz.db(), wid):
        return _err("not_found", 404)
    audit.log(wid, principal.uid, "workspace.deletion_canceled", wid)
    return jsonify({"ok": True})


@bp.get("/admin/account-deletions")
def list_account_deletions():
    _require_super_admin()
    out = []
    for d in authz.db().collection(workspace_deletion.ACCOUNTS).limit(200).stream():
        v = d.to_dict() or {}
        out.append({"uid": d.id, "email": v.get("email"), "deleteAfter": v["deleteAfter"].isoformat() if v.get("deleteAfter") else None,
                    "workspaces": len(v.get("workspaces") or [])})
    return jsonify(sorted(out, key=lambda x: x["deleteAfter"] or ""))


@bp.post("/admin/account-deletions/<uid>/restore")
def restore_account(uid: str):
    _require_super_admin()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", uid):
        return _err("not_found", 404)
    db = authz.db()
    if not db.collection(workspace_deletion.ACCOUNTS).document(uid).get().exists:
        return _err("not_found", 404)
    try:
        authz.set_user_disabled(uid, False)
    except Exception as e:
        print(f"[admin] account enable failed: {type(e).__name__}")
        return _err("unavailable", 503)
    workspace_deletion.restore_account(db, uid)
    return jsonify({"ok": True})


@bp.get("/signup/status")
def signup_status():
    """Poate utilizatorul curent crea un cabinet nou? (folosit de ecranul „Creați un spațiu de lucru”)"""
    principal = authz.authenticate()
    owned = list(authz.db().collection("workspaces").where("ownerId", "==", principal.uid).limit(1).stream())
    return jsonify({"canCreate": _may_create_workspace(principal, len(owned)),
                    "mode": os.getenv("SIGNUP_MODE", "open")})


@bp.get("/signup/creators")
def list_creators():
    _require_super_admin()
    docs = authz.db().collection("workspaceCreators").limit(200).stream()
    out = [{"id": d.id, "email": (d.to_dict() or {}).get("email", "")} for d in docs]
    return jsonify(sorted(out, key=lambda x: x["email"]))


@bp.post("/signup/creators")
def add_creator():
    principal = _require_super_admin()
    email = str(_body().get("email", "")).strip().lower()
    if not _EMAIL_RE.match(email):
        return _err("invalid_email", 400)
    ref = authz.db().collection("workspaceCreators").document(_creator_id(email))
    ref.set({"email": email, "addedBy": principal.uid, "addedAt": firestore.SERVER_TIMESTAMP})
    return jsonify({"id": ref.id, "email": email}), 201


@bp.delete("/signup/creators/<cid>")
def remove_creator(cid: str):
    _require_super_admin()
    if not re.fullmatch(r"[0-9a-f]{20}", cid):
        return _err("not_found", 404)
    authz.db().collection("workspaceCreators").document(cid).delete()
    return jsonify({"ok": True})
