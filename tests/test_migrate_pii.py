"""Migrarea din text clar în vault (scripts/migrate_pii.py) + măști."""
import base64
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import migrate_pii  # noqa: E402


def test_masks_match_frontend_rules():
    assert migrate_pii.mask_cnp("1800101221144") == "•••••••••1144"
    assert migrate_pii.mask_cnp("") == ""
    assert migrate_pii.mask_serie("MX 123456") == "MX ••••56"
    assert migrate_pii.mask_serie("MX123456") == "MX••••56"
    assert migrate_pii.mask_serie("") == ""


def test_split_client_strips_plaintext_and_is_idempotent():
    data = {
        "titular": {"nume": "A", "cnp": "1800101221144", "serie_numar": "MX 123456"},
        "asociati": [{"nume": "B", "cnp": "2900202334455", "serie_numar": ""}, {"nume": "C", "cnp": "", "serie_numar": ""}],
        "administratori": [],
    }
    patch, vault_persons = migrate_pii.split_client(data)
    assert len(vault_persons) == 3 - 1  # C nu are date sensibile
    t = patch["titular"]
    assert t["cnp"] == "" and t["serie_numar"] == "" and t["cnpMasked"].endswith("1144") and t["pid"] in vault_persons
    assert "1800101221144" not in str(patch) and "123456" not in str(patch).replace("••••56", "")
    assert [p["cnp"] for p in patch["asociati"]] == ["", ""]
    # a doua rulare pe rezultat: nimic de migrat
    again, vp = migrate_pii.split_client({**data, **patch})
    assert vp == {} and again == {}


@pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")
def test_migrate_workspace_end_to_end(monkeypatch):
    from google.cloud import firestore as gcf
    import authz
    import vault

    monkeypatch.setenv("VAULT_LOCAL_KEK", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.delenv("VAULT_KMS_KEY", raising=False)
    vault._cache.clear()
    db = gcf.Client(project="demo-samwera")
    monkeypatch.setattr(authz, "db", lambda: db)
    wid, cid = "workspaceMIGRAT01", "clientMIGRATE0001"
    ref = db.collection("workspaces").document(wid).collection("clienti").document(cid)
    ref.set({"denumire": "X", "titular": {"nume": "A", "cnp": "1800101221144", "serie_numar": "MX 123456"}})

    assert migrate_pii.migrate_workspace(wid, dry_run=True) == (1, 1)
    assert ref.get().to_dict()["titular"]["cnp"] == "1800101221144"  # dry-run nu scrie

    assert migrate_pii.migrate_workspace(wid) == (1, 1)
    t = ref.get().to_dict()["titular"]
    assert t["cnp"] == "" and t["cnpMasked"].endswith("1144")
    stored = ref.collection("pii").document("vault").get().to_dict()["persons"]
    assert vault.decrypt_record(wid, cid, t["pid"], stored[t["pid"]]) == {"cnp": "1800101221144", "serie_numar": "MX 123456"}
    assert migrate_pii.migrate_workspace(wid) == (0, 0)  # idempotent


@pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")
def test_purge_extractions_removes_personal_fields_only(monkeypatch):
    from google.cloud import firestore as gcf
    import authz

    db = gcf.Client(project="demo-samwera")
    monkeypatch.setattr(authz, "db", lambda: db)
    e1 = db.collection("users").document("uPurge").collection("extractions").document("e1")
    e2 = db.collection("users").document("uPurge").collection("extractions").document("e2")
    e1.set({"sourceFile": "ci.jpg", "fields": {"cnp": "1800101221144", "nume": "A"}})
    e2.set({"sourceFile": "ci2.jpg"})

    assert migrate_pii.purge_extractions(dry_run=True) >= 1
    assert "fields" in e1.get().to_dict()          # dry-run nu șterge
    assert migrate_pii.purge_extractions() >= 1
    assert e1.get().to_dict() == {"sourceFile": "ci.jpg"}
    assert e2.get().to_dict() == {"sourceFile": "ci2.jpg"}
    assert migrate_pii.purge_extractions() == 0     # idempotent


def test_split_client_normalizes_ocr_line_breaks_in_vault_and_masks():
    data = {"titular": {"nume": "A", "cnp": "1 800101 221144", "serie_numar": "MX\n123456"}}
    patch, vp = migrate_pii.split_client(data)
    t = patch["titular"]
    assert list(vp.values()) == [{"cnp": "1800101221144", "serie_numar": "MX 123456"}]
    assert t["serieMasked"] == "MX ••••56" and "\n" not in t["serieMasked"]
    assert t["cnpMasked"].endswith("1144")
