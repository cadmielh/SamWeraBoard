"""scripts/backfill_stadiu_din.py contra emulatorului Firestore."""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import firestore as gcf  # noqa: E402

from scripts import backfill_stadiu_din  # noqa: E402

NOW = datetime(2026, 11, 14, 9, tzinfo=timezone.utc)
VECHI = NOW - timedelta(days=40)


@pytest.fixture()
def db():
    client = gcf.Client(project="demo-samwera")
    for ws in client.collection("workspaces").stream():
        client.recursive_delete(ws.reference)
    for wid in ("wsA", "wsB"):
        client.collection("workspaces").document(wid).set({"name": wid})
    dosare = client.collection("workspaces").document("wsA").collection("dosare")
    dosare.document("vechi").set({"stadiu": "in_lucru", "createdAt": VECHI})
    dosare.document("nou").set({"stadiu": "in_lucru", "createdAt": NOW, "stadiuDin": VECHI})
    client.collection("workspaces").document("wsB").collection("dosare").document("altul").set({"stadiu": "dosar_amanat"})
    return client


def _stadiu_din(db, wid, did):
    return (db.collection("workspaces").document(wid).collection("dosare").document(did).get().to_dict() or {}).get("stadiuDin")


def test_dry_run_nu_scrie(db):
    r = backfill_stadiu_din.run(db, dry_run=True, now=NOW)
    assert (r["cabinete"], r["completate"], r["sarite"]) == (2, 2, 1)
    assert _stadiu_din(db, "wsA", "vechi") is None


def test_completeaza_doar_ce_lipseste_si_e_idempotent(db):
    r = backfill_stadiu_din.run(db, now=NOW)
    assert (r["completate"], r["sarite"]) == (2, 1)
    assert _stadiu_din(db, "wsA", "vechi") == NOW and _stadiu_din(db, "wsB", "altul") == NOW
    assert _stadiu_din(db, "wsA", "nou") == VECHI                     # avea deja: neatins
    assert backfill_stadiu_din.run(db, now=NOW + timedelta(days=1))["completate"] == 0


def test_un_singur_cabinet(db):
    r = backfill_stadiu_din.run(db, workspace="wsB", now=NOW)
    assert (r["cabinete"], r["completate"]) == (1, 1)
    assert _stadiu_din(db, "wsA", "vechi") is None
