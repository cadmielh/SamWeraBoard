"""Teste pentru workspaces_api.py + authz.py, contra emulatorului Firestore.

Rulare (din rădăcina repo-ului):
    firebase emulators:exec --only firestore --project demo-samwera \
        ".venv/bin/python -m pytest tests/test_workspaces_api.py -q"
Se sar automat dacă emulatorul nu rulează (FIRESTORE_EMULATOR_HOST lipsă).
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore"
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask  # noqa: E402
from google.cloud import firestore as gcf  # noqa: E402

import authz  # noqa: E402
import workspaces_api  # noqa: E402

CONSENT = {"tos": workspaces_api.TOS_VERSION, "dpa": workspaces_api.DPA_VERSION}  # importat din legal_versions


@pytest.fixture()
def env(monkeypatch):
    client = gcf.Client(project="demo-samwera")
    # curăță emulatorul
    for coll in ("workspaces", "invitations", "users", "workspaceCreators"):
        for d in client.collection(coll).stream():
            for sub in d.reference.collections():
                for sd in sub.stream():
                    sd.reference.delete()
            d.reference.delete()

    monkeypatch.setattr(authz, "db", lambda: client)

    def fake_authenticate():
        from flask import request
        raw = request.headers.get("X-Test-User", "")
        if not raw:
            raise authz.AuthError(401)
        uid, email = raw.split(":")
        return authz.Principal(uid=uid, email=email, name=uid)

    monkeypatch.setattr(authz, "authenticate", fake_authenticate)

    app = Flask(__name__)
    app.register_blueprint(workspaces_api.bp)
    return app.test_client(), client


def as_user(c, uid, method, url, **kw):
    hdr = {"X-Test-User": f"{uid}:{uid}@ex.ro"}
    return getattr(c, method)(url, headers=hdr, **kw)


def make_ws(c, uid, name="Cabinet"):
    r = as_user(c, uid, "post", "/workspaces", json={"name": name, "consent": CONSENT})
    assert r.status_code == 201, r.get_json()
    return r.get_json()["id"]


# ── Creare / consimțământ ────────────────────────────────────────────────────
def test_create_requires_auth(env):
    c, _ = env
    assert c.post("/workspaces", json={"name": "x", "consent": CONSENT}).status_code == 401


def test_create_requires_current_consent(env):
    c, _ = env
    r = as_user(c, "alice", "post", "/workspaces", json={"name": "Cabinet"})
    assert r.status_code == 400 and r.get_json()["error"] == "consent_required"
    r = as_user(c, "alice", "post", "/workspaces",
                json={"name": "Cabinet", "consent": {"tos": "veche", "dpa": "veche"}})
    assert r.status_code == 400


def test_create_records_membership_consent_and_audit(env):
    c, db = env
    wid = make_ws(c, "alice")
    ws = db.collection("workspaces").document(wid).get().to_dict()
    assert ws["members"]["alice"]["role"] == "admin"
    assert ws["ownerId"] == "alice" and ws["status"] == "active"
    assert ws["consent"]["tos"] == workspaces_api.TOS_VERSION
    actions = {a.to_dict()["action"] for a in db.collection("workspaces").document(wid).collection("auditLog").stream()}
    assert {"workspace.create", "consent.accept"} <= actions


def test_workspace_creation_is_capped(env):
    c, _ = env
    for i in range(workspaces_api.MAX_OWNED_WORKSPACES):
        make_ws(c, "alice", f"W{i}")
    r = as_user(c, "alice", "post", "/workspaces", json={"name": "extra", "consent": CONSENT})
    assert r.status_code == 429


# ── Înregistrare pe invitație ────────────────────────────────────────────────
def test_invite_only_blocks_new_creators_but_not_existing_owners(env, monkeypatch):
    c, db = env
    monkeypatch.setenv("SIGNUP_MODE", "invite")
    r = as_user(c, "bob", "post", "/workspaces", json={"name": "Cabinet", "consent": CONSENT})
    assert r.status_code == 403 and r.get_json()["error"] == "creation_not_allowed"

    # super adminul aprobă e-mailul; devine creator
    db.collection("users").document("root").set({"isSuperAdmin": True})
    r = as_user(c, "root", "post", "/signup/creators", json={"email": "Bob@ex.ro"})
    assert r.status_code == 201
    assert as_user(c, "bob", "post", "/workspaces", json={"name": "Cabinet", "consent": CONSENT}).status_code == 201

    # cine deține deja un cabinet poate crea altul fără aprobare
    assert as_user(c, "bob", "post", "/workspaces", json={"name": "Al doilea", "consent": CONSENT}).status_code == 201


def test_super_admin_can_create_in_invite_mode_and_others_cannot_manage_creators(env, monkeypatch):
    c, db = env
    monkeypatch.setenv("SIGNUP_MODE", "invite")
    db.collection("users").document("root").set({"isSuperAdmin": True})
    assert as_user(c, "root", "post", "/workspaces", json={"name": "Al meu", "consent": CONSENT}).status_code == 201
    assert as_user(c, "mallory", "get", "/signup/creators").status_code == 403
    assert as_user(c, "mallory", "post", "/signup/creators", json={"email": "m@ex.ro"}).status_code == 403


def test_creators_list_and_remove(env, monkeypatch):
    c, db = env
    monkeypatch.setenv("SIGNUP_MODE", "invite")
    db.collection("users").document("root").set({"isSuperAdmin": True})
    assert as_user(c, "root", "post", "/signup/creators", json={"email": "nu-e-email"}).status_code == 400
    cid = as_user(c, "root", "post", "/signup/creators", json={"email": "a@ex.ro"}).get_json()["id"]
    assert [x["email"] for x in as_user(c, "root", "get", "/signup/creators").get_json()] == ["a@ex.ro"]
    assert as_user(c, "root", "delete", f"/signup/creators/{cid}").status_code == 200
    assert as_user(c, "root", "get", "/signup/creators").get_json() == []
    assert as_user(c, "alice", "post", "/workspaces", json={"name": "Cabinet", "consent": CONSENT}).status_code == 403


def test_signup_status_reflects_invite_mode(env, monkeypatch):
    c, db = env
    monkeypatch.setenv("SIGNUP_MODE", "invite")
    assert as_user(c, "newbie", "get", "/signup/status").get_json() == {"canCreate": False}
    db.collection("users").document("root").set({"isSuperAdmin": True})
    as_user(c, "root", "post", "/signup/creators", json={"email": "newbie@ex.ro"})
    assert as_user(c, "newbie", "get", "/signup/status").get_json() == {"canCreate": True}
    assert c.get("/signup/status").status_code == 401


def test_open_mode_is_default_for_dev(env, monkeypatch):
    c, _ = env
    monkeypatch.delenv("SIGNUP_MODE", raising=False)
    assert as_user(c, "zed", "post", "/workspaces", json={"name": "Cabinet", "consent": CONSENT}).status_code == 201


# ── Invitații ────────────────────────────────────────────────────────────────
def test_only_admin_can_invite(env):
    c, db = env
    wid = make_ws(c, "alice")
    db.collection("workspaces").document(wid).update({"members.bob": {"role": "member", "email": "bob@ex.ro"}})
    r = as_user(c, "bob", "post", f"/workspaces/{wid}/invites", json={"email": "x@ex.ro", "role": "member"})
    assert r.status_code == 403
    r = as_user(c, "mallory", "post", f"/workspaces/{wid}/invites", json={"email": "x@ex.ro", "role": "member"})
    assert r.status_code == 403


def test_invite_does_not_add_member_until_accepted(env):
    c, db = env
    wid = make_ws(c, "alice")
    r = as_user(c, "alice", "post", f"/workspaces/{wid}/invites", json={"email": "victim@ex.ro", "role": "member"})
    assert r.status_code == 201
    ws = db.collection("workspaces").document(wid).get().to_dict()
    assert "victim" not in ws["members"]  # NU se alătură automat

    inv = as_user(c, "victim", "get", "/invitations").get_json()
    assert len(inv) == 1 and inv[0]["workspaceName"] == "Cabinet"

    r = as_user(c, "victim", "post", f"/invitations/{inv[0]['id']}/accept")
    assert r.status_code == 200
    ws = db.collection("workspaces").document(wid).get().to_dict()
    assert ws["members"]["victim"]["role"] == "member"
    # a doua acceptare nu mai merge
    assert as_user(c, "victim", "post", f"/invitations/{inv[0]['id']}/accept").status_code == 404


def test_hostile_admin_cannot_override_another_workspaces_invite(env):
    """Vectorul vechi: un atacator își făcea workspace propriu și rescria invitația victimei."""
    c, _ = env
    good = make_ws(c, "boss", "Cabinet legitim")
    evil = make_ws(c, "mallory", "Workspace atacator")
    as_user(c, "boss", "post", f"/workspaces/{good}/invites", json={"email": "victim@ex.ro", "role": "member"})
    as_user(c, "mallory", "post", f"/workspaces/{evil}/invites", json={"email": "victim@ex.ro", "role": "admin"})

    inv = as_user(c, "victim", "get", "/invitations").get_json()
    names = sorted(i["workspaceName"] for i in inv)
    assert names == ["Cabinet legitim", "Workspace atacator"]  # ambele vizibile, niciuna suprascrisă
    # și victima decide explicit — fără acceptare, nu e membră nicăieri
    for i in inv:
        assert i["invitedByEmail"] in ("boss@ex.ro", "mallory@ex.ro")


def test_cannot_revoke_invite_of_other_workspace(env):
    c, _ = env
    a = make_ws(c, "alice")
    b = make_ws(c, "bob")
    inv_id = as_user(c, "alice", "post", f"/workspaces/{a}/invites",
                     json={"email": "x@ex.ro", "role": "member"}).get_json()["id"]
    assert as_user(c, "bob", "delete", f"/workspaces/{b}/invites/{inv_id}").status_code == 404
    assert as_user(c, "alice", "delete", f"/workspaces/{a}/invites/{inv_id}").status_code == 200


def test_only_invitee_can_accept_or_decline(env):
    c, _ = env
    wid = make_ws(c, "alice")
    inv_id = as_user(c, "alice", "post", f"/workspaces/{wid}/invites",
                     json={"email": "bob@ex.ro", "role": "member"}).get_json()["id"]
    assert as_user(c, "eve", "post", f"/invitations/{inv_id}/accept").status_code == 404
    assert as_user(c, "eve", "post", f"/invitations/{inv_id}/decline").status_code == 404
    assert as_user(c, "bob", "post", f"/invitations/{inv_id}/decline").status_code == 200
    assert as_user(c, "bob", "post", f"/invitations/{inv_id}/accept").status_code == 404


def test_expired_invite_is_rejected_and_hidden(env):
    c, db = env
    wid = make_ws(c, "alice")
    inv_id = as_user(c, "alice", "post", f"/workspaces/{wid}/invites",
                     json={"email": "bob@ex.ro", "role": "member"}).get_json()["id"]
    db.collection("invitations").document(inv_id).update({"expiresAt": datetime.now(timezone.utc) - timedelta(days=1)})
    assert as_user(c, "bob", "get", "/invitations").get_json() == []
    assert as_user(c, "bob", "post", f"/invitations/{inv_id}/accept").status_code == 404


def test_cannot_invite_existing_member_and_validates_input(env):
    c, _ = env
    wid = make_ws(c, "alice")
    r = as_user(c, "alice", "post", f"/workspaces/{wid}/invites", json={"email": "alice@ex.ro", "role": "member"})
    assert r.status_code == 409
    assert as_user(c, "alice", "post", f"/workspaces/{wid}/invites", json={"email": "nu-e-email", "role": "member"}).status_code == 400
    assert as_user(c, "alice", "post", f"/workspaces/{wid}/invites", json={"email": "x@ex.ro", "role": "owner"}).status_code == 400


# ── Roluri / eliminare ───────────────────────────────────────────────────────
def _join(c, db, wid, uid, role):
    db.collection("workspaces").document(wid).update({f"members.{uid}": {"role": role, "email": f"{uid}@ex.ro"}})


def test_last_admin_and_owner_protected(env):
    c, db = env
    wid = make_ws(c, "alice")
    _join(c, db, wid, "bob", "admin")
    # alice e owner: nu poate fi retrogradată/eliminată nici de alt admin
    assert as_user(c, "bob", "patch", f"/workspaces/{wid}/members/alice", json={"role": "viewer"}).status_code == 409
    assert as_user(c, "bob", "delete", f"/workspaces/{wid}/members/alice").status_code == 409
    # bob poate fi retrogradat (mai rămâne alice)
    assert as_user(c, "alice", "patch", f"/workspaces/{wid}/members/bob", json={"role": "viewer"}).status_code == 200
    # acum alice e singurul admin: nu se poate elimina (owner) — protejat
    assert as_user(c, "alice", "delete", f"/workspaces/{wid}/members/alice").status_code == 409


def test_last_admin_cannot_be_demoted_even_if_not_owner(env):
    c, db = env
    wid = make_ws(c, "alice")
    _join(c, db, wid, "bob", "admin")
    db.collection("workspaces").document(wid).update({"ownerId": "carol"})  # nici unul nu mai e owner
    assert as_user(c, "alice", "patch", f"/workspaces/{wid}/members/bob", json={"role": "member"}).status_code == 200
    # alice = singurul admin rămas
    assert as_user(c, "alice", "patch", f"/workspaces/{wid}/members/alice", json={"role": "member"}).status_code == 409
    assert as_user(c, "alice", "delete", f"/workspaces/{wid}/members/alice").status_code == 409


def test_member_can_leave_but_not_remove_others(env):
    c, db = env
    wid = make_ws(c, "alice")
    _join(c, db, wid, "bob", "member")
    _join(c, db, wid, "carol", "member")
    assert as_user(c, "bob", "delete", f"/workspaces/{wid}/members/carol").status_code == 403
    assert as_user(c, "bob", "delete", f"/workspaces/{wid}/members/bob").status_code == 200
    assert "bob" not in db.collection("workspaces").document(wid).get().to_dict()["members"]


def test_role_change_requires_admin_and_valid_role(env):
    c, db = env
    wid = make_ws(c, "alice")
    _join(c, db, wid, "bob", "member")
    assert as_user(c, "bob", "patch", f"/workspaces/{wid}/members/bob", json={"role": "admin"}).status_code == 403
    assert as_user(c, "alice", "patch", f"/workspaces/{wid}/members/bob", json={"role": "god"}).status_code == 400
    assert as_user(c, "alice", "patch", f"/workspaces/{wid}/members/bob", json={"role": "viewer"}).status_code == 200


# ── authz.require_role ───────────────────────────────────────────────────────
def test_require_role_matrix(env):
    c, db = env
    wid = make_ws(c, "alice")
    _join(c, db, wid, "bob", "member")
    _join(c, db, wid, "vera", "viewer")
    p = lambda uid: authz.Principal(uid=uid, email="", name="")
    authz.require_role(p("alice"), wid, "admin")
    authz.require_role(p("bob"), wid, "member")
    authz.require_role(p("vera"), wid, "viewer")
    for uid, role in (("bob", "admin"), ("vera", "member"), ("mallory", "viewer")):
        with pytest.raises(authz.AuthError) as e:
            authz.require_role(p(uid), wid, role)
        assert e.value.status == 403
    for bad in ("", "../x", "a/b", "short", "x" * 100):
        with pytest.raises(authz.AuthError):
            authz.require_role(p("alice"), bad, "viewer")


def test_pending_deletion_workspace_is_inaccessible(env):
    c, db = env
    wid = make_ws(c, "alice")
    db.collection("workspaces").document(wid).update({"status": "pendingDeletion"})
    with pytest.raises(authz.AuthError):
        authz.require_role(authz.Principal("alice", "", ""), wid, "viewer")


# ── Audit ────────────────────────────────────────────────────────────────────
def test_audit_log_readable_by_admin_only_and_records_actions(env):
    c, db = env
    wid = make_ws(c, "alice")
    _join(c, db, wid, "bob", "member")
    as_user(c, "alice", "patch", f"/workspaces/{wid}/members/bob", json={"role": "viewer"})
    assert as_user(c, "bob", "get", f"/workspaces/{wid}/audit").status_code == 403
    log = as_user(c, "alice", "get", f"/workspaces/{wid}/audit").get_json()
    assert "member.role_change" in {e["action"] for e in log}
    assert all("cnp" not in str(e).lower() for e in log)


# ── Paginarea jurnalului ─────────────────────────────────────────────────────
def test_audit_pagination_and_validation(env):
    c, db = env
    wid = make_ws(c, "alice")
    col = db.collection("workspaces").document(wid).collection("auditLog")
    for d in col.stream():
        d.reference.delete()                                       # pornim curat (creare workspace scrie 2 intrări)
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for i in range(5):
        col.document(f"e{i}").set({"ts": base + timedelta(seconds=i), "actorUid": "alice", "action": f"a.{i}", "meta": {"n": i}, "ip": "1.1.1.1"})

    p1 = as_user(c, "alice", "get", f"/workspaces/{wid}/audit?limit=2").get_json()
    assert [e["action"] for e in p1] == ["a.4", "a.3"]                         # cele mai noi întâi
    from urllib.parse import quote
    p2 = as_user(c, "alice", "get", f"/workspaces/{wid}/audit?limit=2&before={quote(p1[-1]['ts'])}").get_json()
    assert [e["action"] for e in p2] == ["a.2", "a.1"]
    p3 = as_user(c, "alice", "get", f"/workspaces/{wid}/audit?limit=2&before={p2[-1]['ts']}").get_json()   # neîncodat: acceptat
    assert [e["action"] for e in p3] == ["a.0"]
    assert set(p1[0]) == {"id", "ts", "actorUid", "action", "target", "meta", "ip"}

    assert as_user(c, "alice", "get", f"/workspaces/{wid}/audit?limit=abc").status_code == 400
    assert as_user(c, "alice", "get", f"/workspaces/{wid}/audit?before=nu-e-data").status_code == 400
    assert len(as_user(c, "alice", "get", f"/workspaces/{wid}/audit?limit=99999").get_json()) == 5      # plafonat, nu eroare
    assert len(as_user(c, "alice", "get", f"/workspaces/{wid}/audit?limit=0").get_json()) == 1          # minim 1
    assert as_user(c, "bob", "get", f"/workspaces/{wid}/audit").status_code == 403
