"""Migrarea completă între proiecte (scripts/migrate_project.py), cu două „proiecte” pe același emulator Firestore.

Rulare: firebase emulators:exec --only firestore --project demo-samwera ".venv/bin/python -m pytest tests/test_migrate_project.py -q"
"""
import base64
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

import authz  # noqa: E402
import vault  # noqa: E402
import migrate_project as mp  # noqa: E402

WID = "wsLegacyAAAAAAAA01"
WID2 = "wsLegacyBBBBBBBB02"
CNP1, CNP2, CNP3 = "1800101221144", "2900202334455", "1750303445566"
T0 = datetime(2026, 1, 5, 10, 30, tzinfo=timezone.utc)


def wipe(client):
    for c in ("workspaces", "users", "invitations", "superAdminGrants", "workspaceKeys"):
        for d in client.collection(c).stream():
            client.recursive_delete(d.reference)


@pytest.fixture()
def dbs(monkeypatch):
    monkeypatch.setenv("VAULT_LOCAL_KEK", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.delenv("VAULT_KMS_KEY", raising=False)
    vault._cache.clear()
    src = gcf.Client(project="demo-legacy-src")
    dst = gcf.Client(project="demo-legacy-dst")
    wipe(src)
    wipe(dst)
    monkeypatch.setattr(authz, "db", lambda: dst)   # vault-ul își ține cheile în baza țintă
    yield src, dst
    authz._db = None
    vault._cache.clear()


def seed_source(src):
    w = src.collection("workspaces").document(WID)
    w.set({
        "name": "Cabinet Vechi", "ownerId": "uOwner", "createdAt": T0,
        "members": {"uOwner": {"role": "admin", "email": "owner@ex.ro"}, "uMember": {"role": "member", "email": "m@ex.ro"}},
        "facturareConfig": {"caaMin": 100}, "features": {"facturareSamiAdi": True},
    })
    c1 = w.collection("clienti").document("cliPF00000000000001")
    c1.set({
        "denumire": "Popescu Ion", "denumireLower": "popescu ion", "tipClient": "PF", "createdAt": T0, "createdBy": "uOwner",
        "titular": {"nume": "Popescu", "prenume": "Ion", "cnp": CNP1, "serie_numar": "MX 123456", "adresa": "Str. X"},
        "asociati": [], "administratori": [],
    })
    c1.collection("docGenerations").document("g1").set({"templateName": "Act", "generatedAt": "2026-01-06"})
    c2 = w.collection("clienti").document("cliPJ00000000000002")
    c2.set({
        "denumire": "SC Test SRL", "tipClient": "PJ", "createdAt": T0, "createdBy": "uOwner",
        "asociati": [{"nume": "A", "cnp": CNP2, "serie_numar": ""}, {"nume": "B", "cnp": CNP3, "serie_numar": "AB 99"}, {"nume": "C", "cnp": "", "serie_numar": ""}],
        "administratori": [{"nume": "A", "cnp": CNP2, "serie_numar": ""}],
    })
    w.collection("clienti").document("cliPJ00000000000003").set({"denumire": "Fără persoane", "tipClient": "PJ", "asociati": [], "administratori": []})
    w.collection("dosare").document("dos1").set({"titlu": "Dosar 1", "createdAt": T0, "createdBy": "uOwner"})
    w.collection("dosare").document("dos2").set({"titlu": "Dosar 2"})
    w.collection("sarcini").document("sar1").set({"titlu": "Sarcină", "createdBy": "uMember"})
    w.collection("docTemplates").document("tpl1").set({"name": "Șablon", "fileBase64": "QUJD"})
    src.collection("workspaces").document(WID2).set({"name": "Al doilea", "ownerId": "uOwner", "members": {"uOwner": {"role": "admin", "email": "owner@ex.ro"}}})

    src.collection("users").document("uOwner").set({"activeWorkspaceId": WID, "isSuperAdmin": True})
    src.collection("users").document("uMember").set({"activeWorkspaceId": WID})
    ex = src.collection("users").document("uOwner").collection("extractions")
    ex.document("e1").set({"createdAt": T0, "sourceFile": "ci.jpg", "fields": {"cnp": CNP1, "nume": "Popescu"}})
    ex.document("e2").set({"createdAt": T0, "sourceFile": "manual"})

    src.collection("invitations").document("x_AT_y_DOT_ro").set({
        "email": "Nou@Ex.ro", "workspaceId": WID, "workspaceName": "Cabinet Vechi", "role": "member",
        "invitedBy": "uOwner", "invitedAt": T0, "used": False})
    src.collection("invitations").document("used_one").set({"email": "a@ex.ro", "workspaceId": WID, "role": "member", "used": True})
    src.collection("superAdminGrants").document("g_AT_ex_DOT_ro").set({"email": "g@ex.ro", "used": False})


def vault_of(dst, wid, cid):
    snap = dst.collection("workspaces").document(wid).collection("clienti").document(cid).collection("pii").document("vault").get()
    return (snap.to_dict() or {}).get("persons", {}) if snap.exists else {}


def test_full_migration_keeps_everything_and_encrypts_pii(dbs):
    src, dst = dbs
    seed_source(src)
    report = mp.run(src, dst)

    # workspace: totul păstrat + status; fără consimțământ (se acceptă la primul login)
    w = dst.collection("workspaces").document(WID).get().to_dict()
    assert w["name"] == "Cabinet Vechi" and w["ownerId"] == "uOwner" and w["createdAt"] == T0
    assert w["members"]["uMember"]["role"] == "member" and w["facturareConfig"] == {"caaMin": 100}
    assert w["features"] == {"facturareSamiAdi": True} and w["status"] == "active" and "consent" not in w

    # colecții copiate cu aceleași id-uri și valori
    d = dst.collection("workspaces").document(WID)
    assert d.collection("dosare").document("dos1").get().to_dict() == {"titlu": "Dosar 1", "createdAt": T0, "createdBy": "uOwner"}
    assert d.collection("sarcini").document("sar1").get().to_dict()["createdBy"] == "uMember"
    assert d.collection("docTemplates").document("tpl1").get().to_dict()["fileBase64"] == "QUJD"
    assert d.collection("clienti").document("cliPF00000000000001").collection("docGenerations").document("g1").get().exists
    assert dst.collection("workspaces").document(WID2).get().exists

    # CNP/serie: în vault, criptate; în document doar mască + pid
    c1 = d.collection("clienti").document("cliPF00000000000001").get().to_dict()
    t = c1["titular"]
    assert t["cnp"] == "" and t["serie_numar"] == "" and t["cnpMasked"].endswith("1144") and t["adresa"] == "Str. X"
    assert c1["createdBy"] == "uOwner" and c1["createdAt"] == T0
    stored = vault_of(dst, WID, "cliPF00000000000001")
    assert CNP1 not in str(stored) and "MX" not in str(stored)
    assert vault.decrypt_record(WID, "cliPF00000000000001", t["pid"], stored[t["pid"]]) == {"cnp": CNP1, "serie_numar": "MX 123456"}

    c2 = d.collection("clienti").document("cliPJ00000000000002").get().to_dict()
    got = {p["nume"]: vault.decrypt_record(WID, "cliPJ00000000000002", p["pid"], vault_of(dst, WID, "cliPJ00000000000002")[p["pid"]])
           for p in c2["asociati"] + c2["administratori"] if p.get("pid")}
    assert got["B"] == {"cnp": CNP3, "serie_numar": "AB 99"} and got["A"]["cnp"] == CNP2
    assert "pid" not in c2["asociati"][2]                       # persoana fără date sensibile nu are intrare în vault
    assert not d.collection("clienti").document("cliPJ00000000000003").collection("pii").document("vault").get().exists

    assert report["clienti"] == 3 and report["persoane_în_vault"] == 4 and report["workspaces"] == 2
    assert mp.verify(src, dst) == []


def test_users_keep_super_admin_and_extractions_lose_personal_data(dbs):
    src, dst = dbs
    seed_source(src)
    mp.run(src, dst)
    assert dst.collection("users").document("uOwner").get().to_dict() == {"activeWorkspaceId": WID, "isSuperAdmin": True}
    ex = {e.id: e.to_dict() for e in dst.collection("users").document("uOwner").collection("extractions").stream()}
    assert set(ex) == {"e1", "e2"}
    assert all(set(v) == {"createdAt", "sourceFile", "expireAt"} for v in ex.values())      # fără `fields`
    assert CNP1 not in str(ex) and ex["e1"]["sourceFile"] == "ci.jpg"
    assert ex["e1"]["expireAt"] == T0 + mp.EXTRACTION_TTL


def test_pending_invitations_are_converted_and_used_ones_skipped(dbs):
    src, dst = dbs
    seed_source(src)
    mp.run(src, dst)
    invs = [i.to_dict() for i in dst.collection("invitations").stream()]
    assert len(invs) == 1
    i = invs[0]
    assert i["email"] == "nou@ex.ro" and i["status"] == "pending" and i["workspaceId"] == WID
    assert i["invitedByEmail"] == "owner@ex.ro" and i["expiresAt"] > datetime.now(timezone.utc)
    assert dst.collection("superAdminGrants").document("g_AT_ex_DOT_ro").get().exists


def test_migration_is_idempotent_and_vault_ids_are_stable(dbs):
    src, dst = dbs
    seed_source(src)
    mp.run(src, dst)
    first = {c.id: c.to_dict() for c in dst.collection("workspaces").document(WID).collection("clienti").stream()}
    pids1 = sorted(vault_of(dst, WID, "cliPJ00000000000002"))
    mp.run(src, dst)
    second = {c.id: c.to_dict() for c in dst.collection("workspaces").document(WID).collection("clienti").stream()}
    assert first == second                                               # documente identice
    assert sorted(vault_of(dst, WID, "cliPJ00000000000002")) == pids1      # aceleași pid-uri, fără duplicate
    assert len(list(dst.collection("invitations").stream())) == 1
    assert mp.verify(src, dst) == []


def test_dry_run_writes_nothing_and_reports_counts(dbs):
    src, dst = dbs
    seed_source(src)
    report = mp.run(src, dst, dry_run=True)
    assert report["clienti"] == 3 and report["persoane_în_vault"] == 4
    assert list(dst.collection("workspaces").stream()) == []
    assert list(dst.collection("users").stream()) == [] and list(dst.collection("workspaceKeys").stream()) == []


def test_workspace_filter(dbs):
    src, dst = dbs
    seed_source(src)
    mp.run(src, dst, only_workspaces=[WID2])
    assert dst.collection("workspaces").document(WID2).get().exists
    assert not dst.collection("workspaces").document(WID).get().exists


def test_verify_detects_missing_documents_and_plaintext(dbs):
    src, dst = dbs
    seed_source(src)
    mp.run(src, dst)
    d = dst.collection("workspaces").document(WID)
    d.collection("dosare").document("dos2").delete()
    d.collection("clienti").document("cliPF00000000000001").update({"titular.cnp": CNP1})
    problems = mp.verify(src, dst)
    assert any("dosare" in p for p in problems) and any("în clar" in p for p in problems)


def test_report_never_contains_document_content(dbs):
    src, dst = dbs
    seed_source(src)
    report = mp.run(src, dst)
    blob = str(dict(report))
    assert all(isinstance(v, int) for v in report.values())
    assert CNP1 not in blob and "Popescu" not in blob


def test_audit_entry_is_written_per_workspace(dbs):
    src, dst = dbs
    seed_source(src)
    mp.run(src, dst)
    log = [e.to_dict() for e in dst.collection("workspaces").document(WID).collection("auditLog").stream()]
    assert any(e["action"] == "migration.import" and e["actorUid"] == "system" for e in log)


def test_rerun_preserves_consent_already_accepted_in_the_target(dbs):
    src, dst = dbs
    seed_source(src)
    mp.run(src, dst)
    assert "consent" not in dst.collection("workspaces").document(WID).get().to_dict()       # prima migrare: fără consimțământ
    accepted = {"tos": "2026-09-18", "dpa": "2026-09-18", "acceptedBy": "uOwner"}
    dst.collection("workspaces").document(WID).update({"consent": accepted})
    mp.run(src, dst)                                                                          # rerulare (cutover final)
    w = dst.collection("workspaces").document(WID).get().to_dict()
    assert w["consent"] == accepted                                                           # nu se pierde acceptarea
    assert w["name"] == "Cabinet Vechi" and w["status"] == "active"                           # restul vine din sursă
    assert "consent" not in dst.collection("workspaces").document(WID2).get().to_dict()       # alt workspace: încă neacceptat
