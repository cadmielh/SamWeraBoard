"""Teste pentru activity_api.py (statisticile de utilizare din super admin) contra emulatorului Firestore.

Rulare (din rădăcina repo-ului):
    firebase emulators:exec --config firebase.test.json --only firestore --project demo-samwera \
        ".venv/bin/python -m pytest tests/test_activity_api.py -q"
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

import activity_api  # noqa: E402
import authz  # noqa: E402

WID = "wsActivityAAAAAAAA1"


@pytest.fixture()
def env(monkeypatch):
    client = gcf.Client(project="demo-samwera")
    for coll in ("workspaces", "users", "adminCache"):
        for d in client.collection(coll).stream():
            client.recursive_delete(d.reference)
    monkeypatch.setattr(authz, "db", lambda: client)

    def fake_authenticate():
        from flask import request
        raw = request.headers.get("X-Test-User", "")
        if not raw:
            raise authz.AuthError(401)
        return authz.Principal(uid=raw, email=f"{raw}@ex.ro", name=raw, provider="google.com")

    monkeypatch.setattr(authz, "authenticate", fake_authenticate)
    client.collection("users").document("root").set({"isSuperAdmin": True})
    app = Flask(__name__)
    app.register_blueprint(activity_api.bp)
    return app.test_client(), client


def log(db, ts, action, actor):
    db.collection("workspaces").document(WID).collection("auditLog").add({"ts": ts, "action": action, "actorUid": actor})


def test_requires_super_admin(env):
    c, _ = env
    assert c.get("/admin/activity").status_code == 401
    assert c.get("/admin/activity", headers={"X-Test-User": "alice"}).status_code == 403


def test_daily_series_from_audit_log(env):
    c, db = env
    db.collection("workspaces").document(WID).set({"name": "Cabinet", "members": {"alice": {"role": "admin"}}})
    db.collection("workspaces").document(WID).collection("clienti").document("c1").set({"denumire": "X"})
    db.collection("workspaces").document(WID).collection("clienti").document("c2").set({"denumire": "Y"})
    now = datetime.now(timezone.utc)
    log(db, now, "document.generate", "alice")
    log(db, now, "document.generate", "bob")
    log(db, now, "ocr.extract", "alice")
    log(db, now, "billing.payment_failed", "stripe")       # sistem: nu e activitate a cabinetului
    log(db, now - timedelta(days=3), "pii.reveal", "alice")
    log(db, now - timedelta(days=200), "document.generate", "alice")  # în afara ferestrei

    r = c.get("/admin/activity?days=30", headers={"X-Test-User": "root"})
    assert r.status_code == 200
    body = r.get_json()
    ws = body["workspaces"][WID]
    assert body["days"] == 30 and len(ws["series"]) == 30
    today = ws["series"][-1]
    assert today["day"] == body["today"]
    assert (today["documents"], today["scans"], today["activeUsers"]) == (2, 1, 2)
    assert sum(d["documents"] for d in ws["series"]) == 2
    assert sum(1 for d in ws["series"] if d["activeUsers"]) == 2
    assert ws["activeUsers"] == 2 and ws["clients"] == 2 and ws["dosare"] == 0
    assert ws["lastEventAt"] is not None


def test_last_event_outside_window(env):
    c, db = env
    db.collection("workspaces").document(WID).set({"name": "Cabinet", "members": {}})
    old = datetime.now(timezone.utc) - timedelta(days=60)
    log(db, old, "document.generate", "alice")
    log(db, old + timedelta(days=1), "billing.subscription_deleted", "stripe")
    ws = c.get("/admin/activity?days=7", headers={"X-Test-User": "root"}).get_json()["workspaces"][WID]
    assert all(d["activeUsers"] == 0 for d in ws["series"])
    assert ws["lastEventAt"][:10] == old.isoformat()[:10]


def test_computed_once_a_day_then_refresh(env):
    c, db = env
    db.collection("workspaces").document(WID).set({"name": "Cabinet", "members": {}})
    now = datetime.now(timezone.utc)
    log(db, now, "document.generate", "alice")
    h = {"X-Test-User": "root"}
    first = c.get("/admin/activity?days=30", headers=h).get_json()
    assert first["recomputed"] == 1 and first["workspaces"][WID]["series"][-1]["documents"] == 1

    log(db, now, "document.generate", "alice")              # activitate nouă după calculul zilei
    second = c.get("/admin/activity?days=30", headers=h).get_json()
    assert second["recomputed"] == 0 and second["computedAt"] == first["computedAt"]
    assert second["workspaces"][WID]["series"][-1]["documents"] == 1     # rezultatul păstrat, fără citiri noi

    db.collection("workspaces").document("wsNouAAAAAAAAAAAAAA1").set({"name": "Nou", "members": {}})
    third = c.get("/admin/activity?days=30", headers=h).get_json()
    assert third["recomputed"] == 1 and "wsNouAAAAAAAAAAAAAA1" in third["workspaces"]   # doar cabinetul nou

    fresh = c.get("/admin/activity?days=30&refresh=1", headers=h).get_json()
    assert fresh["recomputed"] == 2 and fresh["workspaces"][WID]["series"][-1]["documents"] == 2
