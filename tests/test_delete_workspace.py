"""Ștergerea definitivă a unui workspace (scripts/delete_workspace.py), pe emulatorul Firestore."""
import base64
import os
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from google.cloud import firestore as gcf  # noqa: E402

import authz  # noqa: E402
import delete_workspace as dw  # noqa: E402
import vault  # noqa: E402

W, OTHER = "wsDeleteAAAAAAAA01", "wsKeepBBBBBBBBBB02"


@pytest.fixture()
def db(monkeypatch):
    monkeypatch.setenv("VAULT_LOCAL_KEK", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.delenv("VAULT_KMS_KEY", raising=False)
    vault._cache.clear()
    c = gcf.Client(project="demo-delete")
    for coll in ("workspaces", "users", "invitations", "workspaceKeys", "deletionLog"):
        for d in c.collection(coll).stream():
            c.recursive_delete(d.reference)
    monkeypatch.setattr(authz, "db", lambda: c)
    yield c
    authz._db = None
    vault._cache.clear()


def seed(c):
    for wid, uid in ((W, "uA"), (OTHER, "uB")):
        ws = c.collection("workspaces").document(wid)
        ws.set({"name": wid, "ownerId": uid, "members": {uid: {"role": "admin", "email": f"{uid}@ex.ro"}}, "status": "active"})
        cl = ws.collection("clienti").document(f"cli{wid[:6]}00000000")
        cl.set({"denumire": "X"})
        cl.collection("docGenerations").document("g1").set({"t": 1})
        pid = "person-aaaa-0001"
        cl.collection("pii").document("vault").set({"persons": {pid: vault.encrypt_record(wid, cl.id, pid, {"cnp": "1800101221144", "serie_numar": ""})}})
        ws.collection("dosare").document("d1").set({"t": 1})
        ws.collection("sarcini").document("s1").set({"t": 1})
        ws.collection("docTemplates").document("t1").set({"t": 1})
        ws.collection("auditLog").document("a1").set({"action": "x"})
        c.collection("users").document(uid).set({"activeWorkspaceId": wid})
    c.collection("invitations").document("inv1").set({"workspaceId": W, "email": "x@ex.ro", "status": "pending"})
    c.collection("invitations").document("inv2").set({"workspaceId": OTHER, "email": "y@ex.ro", "status": "pending"})


def test_dry_run_reports_counts_and_deletes_nothing(db):
    seed(db)
    r = dw.run(db, W, dry_run=True)
    assert r["counts"] == {"clienti": 1, "dosare": 1, "sarcini": 1, "docTemplates": 1, "auditLog": 1, "membri": 1, "invitații": 1}
    assert db.collection("workspaces").document(W).get().to_dict()["status"] == "active"
    assert db.collection("workspaceKeys").document(W).get().exists


def test_delete_removes_everything_of_the_workspace_and_nothing_else(db):
    seed(db)
    cid = f"cli{W[:6]}00000000"
    dw.run(db, W, actor="test")
    ws = db.collection("workspaces").document(W)
    assert not ws.get().exists
    assert list(ws.collection("clienti").stream()) == [] and list(ws.collection("auditLog").stream()) == []
    assert not ws.collection("clienti").document(cid).collection("pii").document("vault").get().exists    # vault-ul a dispărut
    assert not db.collection("workspaceKeys").document(W).get().exists                                    # cheia de date distrusă
    assert not db.collection("invitations").document("inv1").get().exists
    assert db.collection("users").document("uA").get().to_dict()["activeWorkspaceId"] is None
    log = db.collection("deletionLog").document(W).get().to_dict()
    assert log["workspaceId"] == W and log["deletedBy"] == "test" and log["counts"]["clienti"] == 1
    assert "1800101221144" not in str(log) and "uA" not in str(log)                                       # fără date personale

    # celălalt workspace rămâne intact, inclusiv vault-ul și cheia lui
    other = db.collection("workspaces").document(OTHER)
    assert other.get().to_dict()["status"] == "active"
    ocid = f"cli{OTHER[:6]}00000000"
    token = other.collection("clienti").document(ocid).collection("pii").document("vault").get().to_dict()["persons"]["person-aaaa-0001"]
    assert vault.decrypt_record(OTHER, ocid, "person-aaaa-0001", token)["cnp"] == "1800101221144"
    assert db.collection("invitations").document("inv2").get().exists
    assert db.collection("users").document("uB").get().to_dict()["activeWorkspaceId"] == OTHER


def test_missing_workspace_stops_with_a_clear_message(db):
    with pytest.raises(SystemExit, match="nu există"):
        dw.run(db, "nu-exista-aaaaaaaaaa")
