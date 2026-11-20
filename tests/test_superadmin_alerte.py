"""Teste pentru superadmin_alerte.py (notificările de aplicație pentru super admini) contra emulatorului Firestore.

Rulare (din rădăcina repo-ului):
    firebase emulators:exec --config firebase.test.json --only firestore --project demo-samwera \
        ".venv/bin/python -m pytest tests/test_superadmin_alerte.py -q"
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

from google.cloud import firestore as gcf  # noqa: E402

import authz  # noqa: E402
import superadmin_alerte as sa  # noqa: E402

NOW = datetime.now(timezone.utc)
DAY = timedelta(days=1)


@pytest.fixture()
def db(monkeypatch):
    client = gcf.Client(project="demo-samwera")
    for coll in ("workspaces", "superAdminNotificari", "billingAccounts"):
        for d in client.collection(coll).stream():
            client.recursive_delete(d.reference)
    monkeypatch.setattr(authz, "db", lambda: client)
    return client


def notificari(db):
    return {d.id: d.to_dict() for d in db.collection(sa.COLECTIE).stream()}


def ws(db, wid, billing, name="Cabinet", owner="u1", email="ana@ex.ro"):
    db.collection("workspaces").document(wid).set({"name": name, "ownerId": owner,
                                                   "members": {owner: {"role": "admin", "email": email}}, "billing": billing})


def test_ron():
    assert sa.ron(125000) == "1.250 RON"
    assert sa.ron(1250) == "12,50 RON"


def test_stripe_events_idempotent(db):
    ws(db, "w1AAAAAAAAAAAAAAAAAA", {}, name="Cabinet Pop")
    ev = {"id": "evt_1", "type": "checkout.session.completed",
          "data": {"object": {"mode": "payment", "amount_total": 75000, "metadata": {"pack": "30"}}}}
    sa.din_stripe(ev, "w1AAAAAAAAAAAAAAAAAA")
    sa.din_stripe(ev, "w1AAAAAAAAAAAAAAAAAA")                      # reluarea webhook-ului nu dublează
    n = notificari(db)
    assert len(n) == 1
    x = next(iter(n.values()))
    assert x["categorie"] == "bani" and "750 RON" in x["titlu"] and "Cabinet Pop" in x["text"]
    assert x["link"] == "/super-admin?cabinet=w1AAAAAAAAAAAAAAAAAA"


def test_cancel_reactivate_dispute(db):
    ws(db, "w1AAAAAAAAAAAAAAAAAA", {})
    sa.din_stripe({"id": "e1", "type": "customer.subscription.updated",
                   "data": {"object": {"cancel_at_period_end": True, "current_period_end": int((NOW + 10 * DAY).timestamp())},
                            "previous_attributes": {"cancel_at_period_end": False}}}, "w1AAAAAAAAAAAAAAAAAA")
    sa.din_stripe({"id": "e2", "type": "customer.subscription.updated",
                   "data": {"object": {"status": "active"}, "previous_attributes": {"items": {}}}}, "w1AAAAAAAAAAAAAAAAAA")  # alt câmp: nimic
    sa.din_stripe({"id": "e3", "type": "charge.dispute.created", "data": {"object": {"amount": 20000, "reason": "fraudulent"}}}, "w1AAAAAAAAAAAAAAAAAA")
    titluri = sorted(x["titlu"] for x in notificari(db).values())
    assert titluri == ["Abonament anulat: Cabinet", "Dispută (chargeback): 200 RON"]
    assert next(x for x in notificari(db).values() if x["titlu"].startswith("Dispută"))["severitate"] == "urgent"


def test_daily_trial_ending_and_expired(db):
    ws(db, "wEndAAAAAAAAAAAAAAAA", {"trialEndsAt": NOW + 2 * DAY, "accessUntil": NOW + 2 * DAY, "hasSubscription": False}, name="Ionescu")
    ws(db, "wExpAAAAAAAAAAAAAAAA", {"trialEndsAt": NOW - timedelta(hours=3), "accessUntil": NOW - timedelta(hours=3), "hasSubscription": False}, name="Marin")
    ws(db, "wPaidAAAAAAAAAAAAAAA", {"trialEndsAt": NOW + 2 * DAY, "accessUntil": NOW + 40 * DAY, "hasSubscription": True,
                     "subscriptionStatus": "trialing"}, name="Abonat")   # abonat în probă: nu e risc
    r = sa.zilnic(db, NOW)
    assert (r["proba"], r["expirate"]) == (1, 1)
    titluri = {x["titlu"] for x in notificari(db).values()}
    assert "Proba se încheie în 2 zile: Ionescu" in titluri and "A trecut în modul citire: Marin" in titluri
    assert sa.zilnic(db, NOW)["proba"] == 0      # a doua rulare în aceeași zi nu repetă


def test_daily_inactive_payer(db):
    ws(db, "wSubAAAAAAAAAAAAAAAA", {"accessUntil": NOW + 20 * DAY, "hasSubscription": True, "subscriptionStatus": "active"}, name="Plătitor")
    db.collection("workspaces").document("wSubAAAAAAAAAAAAAAAA").collection("auditLog").add({"ts": NOW - 20 * DAY, "action": "document.generate", "actorUid": "u1"})
    db.collection("workspaces").document("wSubAAAAAAAAAAAAAAAA").collection("auditLog").add({"ts": NOW - DAY, "action": "billing.invoice_paid", "actorUid": "stripe"})
    assert sa.zilnic(db, NOW)["inactivi"] == 1
    x = next(iter(notificari(db).values()))
    assert x["titlu"] == "Client plătitor inactiv: Plătitor" and "20 zile" in x["text"]


def test_daily_uninvoiced_summary(db):
    acct = db.collection("billingAccounts").document("w1AAAAAAAAAAAAAAAAAA")
    acct.set({"x": 1})
    acct.collection("invoices").document("in_old").set({"amount": 20000, "paidAt": NOW - 8 * DAY, "smartbill": {"status": "pending"}})
    acct.collection("invoices").document("in_done").set({"amount": 20000, "paidAt": NOW - 8 * DAY, "smartbill": {"status": "manual"}})
    acct.collection("invoices").document("in_new").set({"amount": 20000, "paidAt": NOW - DAY, "smartbill": {"status": "pending"}})
    acct.collection("creditLots").document("cs_1").set({"source": "purchase", "amountPaid": 75000, "createdAt": NOW - 6 * DAY})
    acct.collection("creditLots").document("grant_1").set({"source": "grant", "amountPaid": 0, "createdAt": NOW - 30 * DAY})
    assert sa.zilnic(db, NOW)["nefacturate"] == 2
    x = next(iter(notificari(db).values()))
    assert x["titlu"] == "2 încasări nefacturate de peste 5 zile" and "950 RON" in x["text"]
