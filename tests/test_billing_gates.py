"""Gardarea rutelor după starea abonamentului, contra emulatorului Firestore.

Fiecare rută a aplicației trebuie clasificată mai jos: o rută nouă face testul să pice până când cineva decide
explicit dacă un cabinet în citire (probă/abonament expirat) o poate folosi.
"""
import base64
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

WID = "wsBillingGate0001"
CID = "clientBilling01"

# Rute care consumă OCR/AI, generează documente sau scriu date: cer probă sau abonament valabil (402).
GATED = {
    ("POST", "/extract"), ("POST", "/fill/docx"), ("POST", "/fill/pdf"),
    ("POST", "/template/placeholders"), ("POST", "/template/blanks"), ("POST", "/template/blanks/apply"),
    ("POST", "/template/blanks/ai-suggest"), ("PUT", "/clients/<cid>/pii"), ("POST", "/templates/<tid>/file"),
    ("POST", "/templates"), ("POST", "/templates/from-builtin"), ("POST", "/billing/credits/consume"),
    # documentele clienților: încărcare, foldere, redenumire, mutare
    ("POST", "/fisiere"), ("PATCH", "/fisiere/<fid>"), ("POST", "/foldere"), ("POST", "/clients/<cid>/documente/init"),
    ("PUT", "/fisiere/setari"),
    ("PATCH", "/foldere/<folder_id>"), ("POST", "/fisiere/<fid>/extract"),
}
# Disponibile și în citire: lectură, export, administrarea oamenilor și a consimțământului, jurnalul,
# ștergerea GDPR a unui client, căutarea ANAF (necesară completării datelor de facturare) și abonarea.
UNGATED = {
    ("GET", "/templates/builtin"), ("GET", "/templates/builtin/<key>"), ("POST", "/audit/document"),
    ("GET", "/anaf/company"), ("GET", "/health"),
    ("GET", "/clients/<cid>/pii"), ("DELETE", "/clients/<cid>"),
    # documentele rămân de descărcat și de șters (GDPR) și după expirarea accesului
    ("GET", "/fisiere/<fid>/continut"), ("DELETE", "/fisiere/<fid>"), ("DELETE", "/foldere/<folder_id>"),
    ("POST", "/workspaces"), ("POST", "/workspaces/<wid>/consent"),
    ("PATCH", "/workspaces/<wid>/members/<uid>"), ("DELETE", "/workspaces/<wid>/members/<uid>"),
    ("POST", "/workspaces/<wid>/invites"), ("GET", "/workspaces/<wid>/invites"),
    ("DELETE", "/workspaces/<wid>/invites/<inv_id>"), ("GET", "/invitations"),
    ("POST", "/invitations/<inv_id>/accept"), ("POST", "/invitations/<inv_id>/decline"),
    ("GET", "/workspaces/<wid>/audit"), ("GET", "/signup/status"), ("POST", "/account/revoke-sessions"), ("POST", "/account/delete"), ("GET", "/account/export"),
    ("GET", "/admin/workspaces/<wid>/deletion-preview"), ("POST", "/admin/workspaces/<wid>/delete"),
    ("POST", "/admin/workspaces/<wid>/restore"), ("GET", "/admin/account-deletions"), ("POST", "/admin/account-deletions/<uid>/restore"), ("GET", "/signup/creators"),
    ("POST", "/signup/creators"), ("DELETE", "/signup/creators/<cid>"),
    # abonarea trebuie să meargă tocmai când accesul a expirat
    ("GET", "/billing"), ("PUT", "/billing/details"), ("POST", "/billing/checkout"), ("POST", "/billing/portal"),
    ("POST", "/billing/sync"), ("POST", "/billing/webhook"),
    ("POST", "/billing/credits/checkout"), ("GET", "/billing/credits"), ("GET", "/billing/credits/quote"),
    ("POST", "/admin/workspaces/<wid>/billing/credits"), ("GET", "/admin/billing/payments"), ("GET", "/admin/billing/stripe-fees"),
    ("POST", "/admin/billing/payments/<wid>/<kind>/<pid>/invoice"),
    ("GET", "/admin/billing/overview"), ("GET", "/admin/activity"), ("POST", "/admin/workspaces/<wid>/billing/extend-trial"),
    ("POST", "/admin/workspaces/<wid>/billing/comp"), ("POST", "/admin/workspaces/<wid>/billing/sync"),
    ("GET", "/admin/workspaces/<wid>/billing/manual"), ("POST", "/admin/workspaces/<wid>/billing/manual"),
    ("POST", "/admin/workspaces/<wid>/billing/manual/<pid>/cancel"),
    # Contextul câmpurilor unui șablon vechi: cache derivat din fișier, necesar și pentru a citi formularul.
    ("POST", "/templates/<tid>/context"),
    # super admin: livrarea cere acces activ la cabinetul ȚINTĂ (billing.has_full_access), nu la cel al apelantului
    ("POST", "/admin/workspaces/<target>/templates"), ("GET", "/admin/workspaces/<wid>/delivered-templates"),
    ("DELETE", "/admin/workspaces/<wid>/templates/<tid>"),
}


@pytest.fixture(scope="module")
def app_mod():
    os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", "/nonexistent/none.json")
    os.environ.setdefault("GCLOUD_PROJECT", "demo-samwera")
    os.environ.setdefault("VAULT_LOCAL_KEK", base64.b64encode(os.urandom(32)).decode())
    import app as flask_app  # noqa: PLC0415  (importat după setarea mediului)
    return flask_app


@pytest.fixture()
def env(app_mod, monkeypatch):
    import authz  # noqa: PLC0415
    from google.cloud import firestore as gcf  # noqa: PLC0415

    db = gcf.Client(project="demo-samwera")
    monkeypatch.setattr(authz, "db", lambda: db)
    monkeypatch.setattr(authz, "authenticate", lambda: authz.Principal(uid="alice", email="alice@ex.ro", name="A"))
    monkeypatch.setattr(app_mod.limiter, "enabled", False)
    db.collection("workspaces").document(WID).set({
        "name": "Cabinet", "ownerId": "alice", "status": "active",
        "members": {"alice": {"role": "admin", "email": "alice@ex.ro"}},
        "consent": {"tos": authz.legal_versions.TOS_VERSION, "dpa": authz.legal_versions.DPA_VERSION},
        "billing": {"status": "expired", "accessUntil": datetime.now(timezone.utc) - timedelta(minutes=1)},
    })
    yield app_mod.app.test_client(), db
    db.collection("workspaces").document(WID).delete()


def _routes(app_mod):
    out = set()
    for rule in app_mod.app.url_map.iter_rules():
        if rule.endpoint == "static":
            continue
        for m in rule.methods - {"HEAD", "OPTIONS"}:
            out.add((m, rule.rule))
    return out


def test_every_route_is_classified(app_mod):
    routes = _routes(app_mod)
    assert not GATED & UNGATED
    unclassified = routes - GATED - UNGATED
    assert not unclassified, f"Rute noi neclasificate pentru abonament: {sorted(unclassified)}"
    assert not (GATED | UNGATED) - routes, "Clasificare pentru rute care nu mai există"


@pytest.mark.parametrize("method,rule", sorted(GATED))
def test_gated_routes_refuse_expired_workspace_with_402(env, method, rule):
    c, _ = env
    url = rule.replace("<cid>", CID)
    r = c.open(url, method=method, headers={"X-Workspace-Id": WID})
    assert r.status_code == 402 and r.get_json() == {"error": "subscription_required"}


def test_gated_route_passes_billing_check_with_valid_access(env):
    c, db = env
    db.collection("workspaces").document(WID).update(
        {"billing.accessUntil": datetime.now(timezone.utc) + timedelta(days=1)})
    r = c.post("/template/placeholders", headers={"X-Workspace-Id": WID})
    assert r.status_code == 400                     # trece de gardă; cade abia la lipsa fișierului


def test_read_and_gdpr_delete_still_work_when_expired(env):
    c, db = env
    db.collection("workspaces").document(WID).collection("clienti").document(CID).set({"denumire": "X"})
    assert c.get(f"/clients/{CID}/pii", headers={"X-Workspace-Id": WID}).status_code == 200
    assert c.delete(f"/clients/{CID}", headers={"X-Workspace-Id": WID}).status_code == 200
    assert c.get("/templates/builtin", headers={"X-Workspace-Id": WID}).status_code == 200


def test_fill_consumes_credit_for_the_firm_after_generation(env, app_mod):
    import json
    import billing  # noqa: PLC0415
    c, db = env
    now = datetime.now(timezone.utc)
    db.collection("workspaces").document(WID).update(
        {"billing": billing.add_credits(billing.no_trial(now), "lotA", 2, now + timedelta(days=365), now)})
    db.collection("workspaces").document(WID).collection("clienti").document(CID).set(
        {"denumire": "Firma X SRL", "codFiscal": "18547290"})
    key = next(iter(app_mod.BUILTIN_TEMPLATES))
    form = lambda cid=None: {"template_builtin_key": key, **({"_client_id": cid} if cid else {})}  # noqa: E731
    try:
        assert c.post("/fill/docx", data=form(), headers={"X-Workspace-Id": WID}).get_json() == {"error": "client_required"}
        r1 = c.post("/fill/docx", data=form(CID), headers={"X-Workspace-Id": WID})
        r2 = c.post("/fill/docx", data=form(CID), headers={"X-Workspace-Id": WID})
        assert r1.status_code == r2.status_code == 200
        assert json.loads(r1.headers["X-Credits"])["consumed"] is True
        assert json.loads(r2.headers["X-Credits"]) | {"coveredUntil": None} == {"consumed": False, "balance": 1, "coveredUntil": None}
        b = db.collection("workspaces").document(WID).get().to_dict()["billing"]
        assert billing.credit_balance(b) == 1
    finally:
        db.recursive_delete(db.collection("billingAccounts").document(WID))
        db.collection("workspaces").document(WID).collection("clienti").document(CID).delete()
