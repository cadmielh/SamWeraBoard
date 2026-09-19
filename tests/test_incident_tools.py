"""Uneltele de incident (scripts/incident_tools.py), pe emulatorul Firestore."""
import csv
import io
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from google.cloud import firestore as gcf  # noqa: E402

import incident_tools as it  # noqa: E402


@pytest.fixture()
def db():
    c = gcf.Client(project="demo-incident")
    for d in c.collection("workspaces").stream():
        c.recursive_delete(d.reference)
    return c


def test_contacts_lists_only_admins(db):
    db.collection("workspaces").document("wsA").set({"name": "Cabinet A", "members": {
        "u1": {"role": "admin", "email": "a1@ex.ro", "displayName": "Ana"},
        "u2": {"role": "member", "email": "m@ex.ro"}, "u3": {"role": "admin", "email": "a3@ex.ro"}}})
    db.collection("workspaces").document("wsB").set({"name": "Cabinet B", "members": {"u9": {"role": "admin", "email": "b@ex.ro"}}})
    rows = it.contacts(db)
    assert sorted(r["email"] for r in rows) == ["a1@ex.ro", "a3@ex.ro", "b@ex.ro"]
    assert [r["email"] for r in it.contacts(db, "wsB")] == ["b@ex.ro"]
    assert it.contacts(db, "nu-exista") == []


def test_export_audit_is_chronological_filters_by_date_and_is_safe_for_excel(db):
    col = db.collection("workspaces").document("wsA").collection("auditLog")
    base = datetime(2026, 9, 1, tzinfo=timezone.utc)
    col.document("e0").set({"ts": base, "actorUid": "u1", "action": "pii.reveal", "target": "cli1", "meta": {"purpose": "view"}, "ip": "1.1.1.1"})
    col.document("e1").set({"ts": base + timedelta(days=5), "actorUid": "=cmd()", "action": "ocr.extract", "target": None, "meta": {"cnp": True}, "ip": "2.2.2.2"})
    rows = list(csv.reader(io.StringIO(it.export_audit(db, "wsA"))))
    assert rows[0] == ["ts", "actorUid", "action", "target", "meta", "ip"]
    assert [r[2] for r in rows[1:]] == ["pii.reveal", "ocr.extract"]                     # cronologic
    assert rows[2][1] == "'=cmd()"                                                        # formulă neutralizată
    recent = list(csv.reader(io.StringIO(it.export_audit(db, "wsA", since=base + timedelta(days=2)))))
    assert [r[2] for r in recent[1:]] == ["ocr.extract"]
