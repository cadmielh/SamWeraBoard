"""scripts/migrate_billing.py contra emulatorului Firestore."""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import firestore as gcf  # noqa: E402

import billing  # noqa: E402
from scripts import migrate_billing  # noqa: E402

NOW = datetime(2026, 11, 1, tzinfo=timezone.utc)


@pytest.fixture()
def db():
    client = gcf.Client(project="demo-samwera")
    for coll in ("workspaces", "trialClaims"):
        for d in client.collection(coll).stream():
            d.reference.delete()
    for wid, owner in (("wsPilot", "ana"), ("wsTrial", "dan")):
        client.collection("workspaces").document(wid).set({
            "name": wid, "ownerId": owner, "members": {owner: {"role": "admin", "email": f"{owner}@ex.ro"}}})
    client.collection("workspaces").document("wsDone").set(
        {"name": "x", "billing": billing.initial_trial(NOW)})
    return client


def test_dry_run_writes_nothing(db):
    r = migrate_billing.run(db, migrate_billing.DEFAULT_COMP_UNTIL, set(), dry_run=True, now=NOW)
    assert sorted(r["comp"]) == ["wsPilot", "wsTrial"] and r["skipped"] == ["wsDone"]
    assert "billing" not in db.collection("workspaces").document("wsPilot").get().to_dict()


def test_pilot_gets_comp_trial_list_gets_trial_and_owner_claims_trial(db):
    r = migrate_billing.run(db, migrate_billing.DEFAULT_COMP_UNTIL, {"wsTrial"}, now=NOW)
    assert r["comp"] == ["wsPilot"] and r["trial"] == ["wsTrial"] and r["missing_billing_after"] == 0
    pilot = db.collection("workspaces").document("wsPilot").get().to_dict()["billing"]
    assert pilot["status"] == "comp" and pilot["compReason"] == "pilot"
    assert pilot["accessUntil"] == migrate_billing.DEFAULT_COMP_UNTIL
    trial = db.collection("workspaces").document("wsTrial").get().to_dict()["billing"]
    assert trial["accessUntil"] == NOW + timedelta(days=14)
    claim = db.collection("trialClaims").document(billing.claim_id("email", "ana@ex.ro")).get()
    assert claim.exists and claim.to_dict()["workspaceId"] == "wsPilot"


def test_idempotent(db):
    migrate_billing.run(db, migrate_billing.DEFAULT_COMP_UNTIL, set(), now=NOW)
    r = migrate_billing.run(db, migrate_billing.DEFAULT_COMP_UNTIL, {"wsPilot"}, now=NOW + timedelta(days=3))
    assert r["comp"] == [] and r["trial"] == [] and len(r["skipped"]) == 3
    assert db.collection("workspaces").document("wsPilot").get().to_dict()["billing"]["status"] == "comp"
