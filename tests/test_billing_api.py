"""billing_api.py (Checkout, Portal, Sync, webhook) contra emulatorului Firestore, cu un Stripe simulat în memorie."""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask  # noqa: E402
from google.cloud import firestore as gcf  # noqa: E402

import authz  # noqa: E402
import billing  # noqa: E402
import billing_api  # noqa: E402
import workspaces_api  # noqa: E402

CONSENT = {"tos": workspaces_api.TOS_VERSION, "dpa": workspaces_api.DPA_VERSION}
DETAILS = {"tip": "PJ", "denumire": "Cabinet Avocat Pop", "cui": "RO18547290", "regCom": "",
           "adresa": "Str. Exemplu 1", "localitate": "Cluj-Napoca", "judet": "Cluj", "email": "facturi@ex.ro",
           "professional": True}
DAY = 86400


class FakeStripe:
    def __init__(self):
        self.customers, self.subs, self.sessions = {}, {}, {}
        self.calls = []
        self.n = 0

    def _id(self, prefix):
        self.n += 1
        return f"{prefix}_{self.n:04d}"

    def add_sub(self, customer, status, wid, price="price_m", created=None, **kw):
        now = int(datetime.now(timezone.utc).timestamp())
        sid = self._id("sub")
        self.subs[sid] = {"id": sid, "customer": customer, "status": status, "created": created or now,
                          "metadata": {"workspaceId": wid},
                          "items": {"data": [{"price": {"id": price}, "current_period_start": now,
                                              "current_period_end": now + 30 * DAY}]}, **kw}
        return sid

    def install(self, monkeypatch):
        m = billing_api
        monkeypatch.setattr(m, "stripe_customer_create", self.customer_create)
        monkeypatch.setattr(m, "stripe_customer_update", lambda cid, p: self.calls.append(("customer_update", cid)))
        monkeypatch.setattr(m, "stripe_subscriptions",
                            lambda cid: [dict(s) for s in self.subs.values() if s["customer"] == cid])
        monkeypatch.setattr(m, "stripe_checkout_create", self.checkout_create)
        monkeypatch.setattr(m, "stripe_checkout_retrieve", lambda sid: self.sessions[sid])
        monkeypatch.setattr(m, "stripe_checkout_expire", lambda sid: self.calls.append(("expire", sid)))
        monkeypatch.setattr(m, "stripe_portal_create", lambda p: {"url": f"https://portal/{p['customer']}"})
        monkeypatch.setattr(m, "stripe_subscription_cancel", self.cancel)
        monkeypatch.setattr(m, "stripe_construct_event", self.construct_event)
        monkeypatch.setattr(m, "stripe_payment_fee", self.payment_fee)
        monkeypatch.setattr(m, "stripe_invoice_payment_intent", lambda inv_id: f"pi_{inv_id}")

    def payment_fee(self, pi):
        self.calls.append(("fee", pi))
        if getattr(self, "fees_forbidden", False):
            raise billing_api.BillingUnavailable("PermissionError")
        return {"amount": 20000, "fee": 425, "net": 19575, "currency": "ron",
                "details": [{"type": "stripe_fee", "amount": 425, "description": "Stripe processing fees"}]}

    def customer_create(self, params):
        cid = self._id("cus")
        self.customers[cid] = params
        return {"id": cid}

    def checkout_create(self, params):
        sid = "cs_test_" + self._id("s")
        self.sessions[sid] = {"id": sid, "url": f"https://checkout/{sid}", "customer": params["customer"],
                              "client_reference_id": params["client_reference_id"], "mode": params["mode"],
                              "metadata": params.get("metadata") or {}, "payment_status": "unpaid",
                              "expires_at": int(datetime.now(timezone.utc).timestamp()) + DAY, "params": params}
        return self.sessions[sid]

    def cancel(self, sid):
        self.subs[sid]["status"] = "canceled"
        self.subs[sid]["ended_at"] = int(datetime.now(timezone.utc).timestamp())
        self.calls.append(("cancel", sid))

    def construct_event(self, payload, sig):
        import json
        if sig != "valid":
            raise ValueError("bad signature")
        return json.loads(payload)


@pytest.fixture()
def env(monkeypatch):
    client = gcf.Client(project="demo-samwera")
    for coll in ("workspaces", "users", "trialClaims", "billingAccounts", "stripeEvents", "rateLimits"):
        for d in client.collection(coll).stream():
            client.recursive_delete(d.reference)
    monkeypatch.setattr(authz, "db", lambda: client)

    def fake_authenticate():
        from flask import request
        raw = request.headers.get("X-Test-User", "")
        if not raw:
            raise authz.AuthError(401)
        uid, email = raw.split(":")
        return authz.Principal(uid=uid, email=email, name=uid, provider="google.com")

    monkeypatch.setattr(authz, "authenticate", fake_authenticate)
    monkeypatch.setenv("STRIPE_PRICE_STANDARD_MONTH", "price_m")
    monkeypatch.setenv("STRIPE_PRICE_STANDARD_YEAR", "price_y")
    monkeypatch.setenv("APP_BASE_URL", "https://cabinio.test")
    stripe = FakeStripe()
    stripe.install(monkeypatch)

    app = Flask(__name__)
    app.register_blueprint(workspaces_api.bp)
    app.register_blueprint(billing_api.bp)
    app.register_blueprint(billing_api.webhook_bp)
    c = app.test_client()
    r = c.post("/workspaces", headers={"X-Test-User": "alice:alice@ex.ro"}, json={"name": "Cabinet", "consent": CONSENT})
    wid = r.get_json()["id"]
    client.collection("workspaces").document(wid).update({"members.bob": {"role": "member", "email": "bob@ex.ro"}})
    return c, client, stripe, wid


def call(c, wid, uid, method, url, **kw):
    return getattr(c, method)(url, headers={"X-Test-User": f"{uid}:{uid}@ex.ro", "X-Workspace-Id": wid}, **kw)


def billing_of(db, wid):
    return db.collection("workspaces").document(wid).get().to_dict()["billing"]


def event(evt_id, etype, obj):
    import json
    return json.dumps({"id": evt_id, "type": etype, "data": {"object": obj}})


def post_event(c, payload, sig="valid"):
    return c.post("/billing/webhook", data=payload, headers={"Stripe-Signature": sig},
                  content_type="application/json")


def with_details(c, wid):
    assert call(c, wid, "alice", "put", "/billing/details", json=DETAILS).status_code == 200


# ── Date de facturare ───────────────────────────────────────────────────────
def test_details_validation_and_admin_only(env):
    c, db, _, wid = env
    assert call(c, wid, "bob", "put", "/billing/details", json=DETAILS).status_code == 403
    assert call(c, wid, "alice", "put", "/billing/details", json={**DETAILS, "cui": "123"}).get_json()["error"] == "invalid_cui"
    assert call(c, wid, "alice", "put", "/billing/details", json={**DETAILS, "email": "x"}).get_json()["error"] == "invalid_email"
    assert call(c, wid, "alice", "put", "/billing/details", json={**DETAILS, "adresa": ""}).get_json()["error"] == "missing_adresa"
    # Doar profesioniști: persoană fizică refuzată, confirmarea de profesionist obligatorie, CUI valid obligatoriu.
    assert call(c, wid, "alice", "put", "/billing/details", json={**DETAILS, "tip": "PF"}).get_json()["error"] == "business_only"
    no_flag = {k: v for k, v in DETAILS.items() if k != "professional"}
    assert call(c, wid, "alice", "put", "/billing/details", json=no_flag).get_json()["error"] == "professional_required"
    assert call(c, wid, "alice", "put", "/billing/details", json={**DETAILS, "cui": ""}).get_json()["error"] == "invalid_cui"
    r = call(c, wid, "alice", "put", "/billing/details", json=DETAILS)
    assert r.status_code == 200 and r.get_json()["details"]["professional"] is True
    acct = db.collection("billingAccounts").document(wid).get().to_dict()
    assert acct["professionalConfirmedBy"] == "alice" and acct["professionalConfirmedAt"]


def test_old_details_without_professional_confirmation_block_checkout(env):
    c, db, _, wid = env
    old = {k: v for k, v in DETAILS.items() if k != "professional"}
    db.collection("billingAccounts").document(wid).set({"details": {**old, "cui": "18547290", "tara": "RO"}})
    assert call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"}).get_json()["error"] \
        == "billing_details_required"
    with_details(c, wid)
    assert db.collection("billingAccounts").document(wid).get().to_dict()["details"]["cui"] == "18547290"
    got = call(c, wid, "alice", "get", "/billing").get_json()
    assert got["billing"]["status"] == "trialing" and got["prices"] == {"month": 200, "year": 2000}


# ── Checkout ─────────────────────────────────────────────────────────────────
def test_checkout_requires_admin_valid_interval_and_details(env):
    c, _, _, wid = env
    assert call(c, wid, "bob", "post", "/billing/checkout", json={"interval": "month"}).status_code == 403
    assert call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "week"}).status_code == 400
    r = call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    assert r.status_code == 400 and r.get_json()["error"] == "billing_details_required"


def test_checkout_server_picks_price_and_carries_trial(env):
    c, db, stripe, wid = env
    with_details(c, wid)
    r = call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "year", "priceId": "price_ieftin"})
    assert r.status_code == 200 and r.get_json()["url"].startswith("https://checkout/")
    params = next(iter(stripe.sessions.values()))["params"]
    assert params["line_items"] == [{"price": "price_y", "quantity": 1}]          # priceId-ul clientului ignorat
    assert params["client_reference_id"] == wid and params["allow_promotion_codes"] and params["locale"] == "ro"
    assert params["consent_collection"] == {"terms_of_service": "required"}
    trial_end = billing.to_utc(billing_of(db, wid)["trialEndsAt"])
    assert params["subscription_data"]["trial_end"] == int(trial_end.timestamp())
    assert params["success_url"].startswith("https://cabinio.test/abonament?checkout=success")
    cust = db.collection("billingAccounts").document(wid).get().to_dict()["stripeCustomerId"]
    cui = billing.normalize_cui(DETAILS["cui"])
    # regCom gol nu ajunge în metadate; CUI-ul și tipul sunt acolo pentru facturarea manuală.
    assert stripe.customers[cust]["metadata"] == {"workspaceId": wid, "tip": "PJ", "cui": cui}


def test_checkout_charges_now_when_trial_has_under_48h(env):
    c, db, stripe, wid = env
    with_details(c, wid)
    soon = datetime.now(timezone.utc) + timedelta(hours=20)
    db.collection("workspaces").document(wid).update({"billing.trialEndsAt": soon, "billing.accessUntil": soon})
    call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    assert "trial_end" not in next(iter(stripe.sessions.values()))["params"]["subscription_data"]


def test_checkout_refused_when_subscription_exists_and_expires_previous_session(env):
    c, db, stripe, wid = env
    with_details(c, wid)
    call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    first = next(iter(stripe.sessions))
    call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    assert ("expire", first) in stripe.calls                               # o singură sesiune deschisă
    cust = db.collection("billingAccounts").document(wid).get().to_dict()["stripeCustomerId"]
    stripe.add_sub(cust, "active", wid)
    r = call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    assert r.status_code == 409 and r.get_json()["error"] == "subscription_exists"


def test_checkout_unavailable_without_price_config(env, monkeypatch):
    c, _, _, wid = env
    with_details(c, wid)
    monkeypatch.delenv("STRIPE_PRICE_STANDARD_MONTH")
    r = call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    assert r.status_code == 503 and r.get_json()["error"] == "billing_unavailable"


# ── Portal / Sync ────────────────────────────────────────────────────────────
def test_portal_needs_customer(env):
    c, _, _, wid = env
    assert call(c, wid, "alice", "post", "/billing/portal").get_json()["error"] == "no_customer"
    with_details(c, wid)
    call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    r = call(c, wid, "alice", "post", "/billing/portal")
    assert r.status_code == 200 and r.get_json()["url"].startswith("https://portal/cus_")
    assert call(c, wid, "bob", "post", "/billing/portal").status_code == 403


def test_sync_after_checkout_success_activates_immediately(env):
    c, db, stripe, wid = env
    with_details(c, wid)
    call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    sid, sess = next(iter(stripe.sessions.items()))
    stripe.add_sub(sess["customer"], "active", wid)
    r = call(c, wid, "bob", "post", "/billing/sync", json={"sessionId": sid})       # orice membru
    assert r.status_code == 200 and r.get_json()["billing"]["status"] == "active"
    assert billing_of(db, wid)["hasSubscription"] is True


def test_sync_rejects_session_of_another_workspace(env):
    c, _, stripe, wid = env
    stripe.sessions["cs_test_alt"] = {"id": "cs_test_alt", "client_reference_id": "altCabinet0001", "customer": "cus_x"}
    r = call(c, wid, "alice", "post", "/billing/sync", json={"sessionId": "cs_test_alt"})
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_session"


def test_sync_cancels_duplicate_live_subscriptions_keeping_oldest(env):
    c, db, stripe, wid = env
    with_details(c, wid)
    call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    cust = db.collection("billingAccounts").document(wid).get().to_dict()["stripeCustomerId"]
    old = stripe.add_sub(cust, "active", wid, created=1000)
    dup = stripe.add_sub(cust, "active", wid, created=2000)
    call(c, wid, "alice", "post", "/billing/sync", json={})
    assert ("cancel", dup) in stripe.calls and ("cancel", old) not in stripe.calls
    assert db.collection("billingAccounts").document(wid).get().to_dict()["stripeSubscriptionId"] == old


# ── Webhook ──────────────────────────────────────────────────────────────────
def _customer(c, db, stripe, wid):
    with_details(c, wid)
    call(c, wid, "alice", "post", "/billing/checkout", json={"interval": "month"})
    return db.collection("billingAccounts").document(wid).get().to_dict()["stripeCustomerId"]


def test_webhook_rejects_bad_signature(env):
    c, *_ = env
    assert post_event(c, event("evt_1", "customer.subscription.updated", {}), sig="fake").status_code == 400


def test_webhook_subscription_event_is_processed_once(env, monkeypatch):
    c, db, stripe, wid = env
    cust = _customer(c, db, stripe, wid)
    sub = stripe.add_sub(cust, "active", wid)
    syncs = []
    real = billing_api.sync_subscription
    monkeypatch.setattr(billing_api, "sync_subscription", lambda *a, **k: syncs.append(a) or real(*a, **k))
    payload = event("evt_sub1", "customer.subscription.created", stripe.subs[sub])
    assert post_event(c, payload).status_code == 200
    assert post_event(c, payload).get_json()["duplicate"] is True
    assert len(syncs) == 1 and billing_of(db, wid)["status"] == "active"
    assert db.collection("stripeEvents").document("evt_sub1").get().to_dict()["status"] == "done"


def test_webhook_order_does_not_matter_state_comes_from_stripe(env):
    c, db, stripe, wid = env
    cust = _customer(c, db, stripe, wid)
    sub = stripe.add_sub(cust, "active", wid)
    stale = dict(stripe.subs[sub])                       # instantaneu vechi, „activ”
    stripe.cancel(sub)                                   # între timp, anulat în Stripe
    db.collection("workspaces").document(wid).update({"billing.trialEndsAt": None})
    post_event(c, event("evt_del", "customer.subscription.deleted", stripe.subs[sub]))
    post_event(c, event("evt_old", "customer.subscription.updated", stale))   # sosește târziu
    b = billing_of(db, wid)
    assert b["status"] == "canceled" and not b["hasSubscription"]          # nu „reînvie”


def test_webhook_invoice_paid_recorded_once_and_zero_amount_skipped(env):
    c, db, stripe, wid = env
    cust = _customer(c, db, stripe, wid)
    stripe.add_sub(cust, "active", wid)
    inv = {"id": "in_1", "customer": cust, "amount_paid": 20000, "currency": "ron",
           "parent": {"subscription_details": {"metadata": {"workspaceId": wid}}},
           "lines": {"data": [{"period": {"start": 1_800_000_000, "end": 1_802_592_000}}]},
           "status_transitions": {"paid_at": 1_800_000_100}}
    post_event(c, event("evt_inv1", "invoice.paid", inv))
    ref = db.collection("billingAccounts").document(wid).collection("invoices").document("in_1")
    ref.update({"smartbill.status": "issued"})                              # emisă între timp
    post_event(c, event("evt_inv1_bis", "invoice.paid", inv))              # eveniment retrimis cu alt id
    assert ref.get().to_dict()["smartbill"]["status"] == "issued"           # nu se re-emite
    post_event(c, event("evt_inv0", "invoice.paid", {**inv, "id": "in_0", "amount_paid": 0}))
    zero = db.collection("billingAccounts").document(wid).collection("invoices").document("in_0").get().to_dict()
    assert zero["smartbill"]["status"] == "skipped"


def test_webhook_resolves_workspace_by_customer_when_metadata_missing(env):
    c, db, stripe, wid = env
    cust = _customer(c, db, stripe, wid)
    sub = stripe.add_sub(cust, "past_due", wid)
    post_event(c, event("evt_pd", "customer.subscription.updated", {**stripe.subs[sub], "metadata": {}}))
    assert billing_of(db, wid)["status"] == "past_due"


def test_webhook_failure_returns_500_and_retry_reprocesses(env, monkeypatch):
    c, db, stripe, wid = env
    cust = _customer(c, db, stripe, wid)
    sub = stripe.add_sub(cust, "active", wid)
    payload = event("evt_fail", "customer.subscription.updated", stripe.subs[sub])

    def boom(*_a, **_k):
        raise RuntimeError("x")

    real = billing_api.sync_subscription
    monkeypatch.setattr(billing_api, "sync_subscription", boom)
    assert post_event(c, payload).status_code == 500
    assert db.collection("stripeEvents").document("evt_fail").get().to_dict()["status"] == "failed"
    monkeypatch.setattr(billing_api, "sync_subscription", real)
    assert post_event(c, payload).status_code == 200
    assert billing_of(db, wid)["status"] == "active"


def test_unknown_price_subscription_gives_no_access(env):
    c, db, stripe, wid = env
    cust = _customer(c, db, stripe, wid)
    db.collection("workspaces").document(wid).update({"billing.trialEndsAt": None})
    sub = stripe.add_sub(cust, "active", wid, price="price_alien")
    post_event(c, event("evt_alien", "customer.subscription.created", stripe.subs[sub]))
    assert not billing.has_full_access({"billing": billing_of(db, wid)})


# ── Super admin ──────────────────────────────────────────────────────────────
def as_root(c, method, url, **kw):
    return getattr(c, method)(url, headers={"X-Test-User": "root:root@ex.ro"}, **kw)


def test_admin_actions_require_super_admin(env):
    c, db, _, wid = env
    for url in (f"/admin/workspaces/{wid}/billing/extend-trial", f"/admin/workspaces/{wid}/billing/comp",
                f"/admin/workspaces/{wid}/billing/sync", f"/admin/workspaces/{wid}/billing/manual",
                f"/admin/workspaces/{wid}/billing/manual/man_{'0' * 20}/cancel"):
        assert as_root(c, "post", url, json={"days": 5}).status_code == 403
    assert as_root(c, "get", "/admin/billing/overview").status_code == 403
    assert call(c, wid, "alice", "post", f"/admin/workspaces/{wid}/billing/extend-trial", json={"days": 5}).status_code == 403


def test_admin_extend_trial_and_validation(env):
    c, db, stripe, wid = env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    before = billing.to_utc(billing_of(db, wid)["trialEndsAt"])
    for bad in (0, 366, "5", True, None):
        assert as_root(c, "post", f"/admin/workspaces/{wid}/billing/extend-trial", json={"days": bad}).status_code == 400
    r = as_root(c, "post", f"/admin/workspaces/{wid}/billing/extend-trial", json={"days": 10})
    assert r.status_code == 200
    b = billing_of(db, wid)
    assert billing.to_utc(b["trialEndsAt"]) == before + timedelta(days=10) and b["accessUntil"] == b["trialEndsAt"]
    actions = [a.to_dict()["action"] for a in db.collection("workspaces").document(wid).collection("auditLog").stream()]
    assert "billing.trial_extend" in actions
    assert as_root(c, "post", "/admin/workspaces/inexistent0001/billing/extend-trial", json={"days": 3}).status_code == 404


def test_admin_extend_trial_moves_stripe_trial_end_when_subscribed_in_trial(env, monkeypatch):
    c, db, stripe, wid = env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    cust = _customer(c, db, stripe, wid)
    trial_end = billing.to_utc(billing_of(db, wid)["trialEndsAt"])
    stripe.add_sub(cust, "trialing", wid, trial_end=int(trial_end.timestamp()))
    call(c, wid, "alice", "post", "/billing/sync", json={})
    updates = []
    monkeypatch.setattr(billing_api, "stripe_subscription_update", lambda sid, p: updates.append((sid, p)))
    as_root(c, "post", f"/admin/workspaces/{wid}/billing/extend-trial", json={"days": 7})
    assert len(updates) == 1 and updates[0][1]["proration_behavior"] == "none"
    assert updates[0][1]["trial_end"] == int((trial_end + timedelta(days=7)).timestamp())


def test_admin_comp_until_date_and_revoke(env):
    c, db, _, wid = env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    db.collection("workspaces").document(wid).update({"billing.trialEndsAt": None})
    assert as_root(c, "post", f"/admin/workspaces/{wid}/billing/comp", json={"until": "31.12.2026"}).status_code == 400
    r = as_root(c, "post", f"/admin/workspaces/{wid}/billing/comp", json={"until": "2030-12-31", "reason": "pilot"})
    assert r.status_code == 200 and r.get_json()["billing"]["status"] == "comp"
    b = billing_of(db, wid)
    assert b["compReason"] == "pilot" and billing.to_utc(b["accessUntil"]).year == 2030
    as_root(c, "post", f"/admin/workspaces/{wid}/billing/comp", json={"until": None})
    assert not billing.has_full_access({"billing": billing_of(db, wid)})


def test_admin_comp_while_paying_defers_next_payment_to_comp_end(env, monkeypatch):
    c, db, stripe, wid = env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    db.collection("workspaces").document(wid).update({"billing.trialEndsAt": None})
    cust = _customer(c, db, stripe, wid)
    sid = stripe.add_sub(cust, "active", wid)
    call(c, wid, "alice", "post", "/billing/sync", json={})
    updates = []
    monkeypatch.setattr(billing_api, "stripe_subscription_update", lambda s, p: updates.append((s, p)))
    assert as_root(c, "post", f"/admin/workspaces/{wid}/billing/comp", json={"until": "2026-13-01"}).status_code == 400
    r = as_root(c, "post", f"/admin/workspaces/{wid}/billing/comp", json={"until": "2030-01-01"})
    assert r.status_code == 200
    comp_end = billing.to_utc(billing_of(db, wid)["compUntil"])
    assert updates == [(sid, {"trial_end": int(comp_end.timestamp()), "proration_behavior": "none"})]
    assert db.collection("billingAccounts").document(wid).get().to_dict()["compDeferredBilling"] is True
    # Stripe trece abonamentul în trialing până la sfârșitul gratuității; retragerea readuce plata acum.
    stripe.subs[sid].update(status="trialing", trial_end=int(comp_end.timestamp()))
    call(c, wid, "alice", "post", "/billing/sync", json={})
    as_root(c, "post", f"/admin/workspaces/{wid}/billing/comp", json={"until": None})
    assert updates[-1] == (sid, {"trial_end": "now", "proration_behavior": "none"})
    assert db.collection("billingAccounts").document(wid).get().to_dict()["compDeferredBilling"] is False


def test_admin_comp_within_paid_period_leaves_stripe_alone(env, monkeypatch):
    c, db, stripe, wid = env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    cust = _customer(c, db, stripe, wid)
    stripe.add_sub(cust, "active", wid)                     # plătit încă 30 de zile
    call(c, wid, "alice", "post", "/billing/sync", json={})
    updates = []
    monkeypatch.setattr(billing_api, "stripe_subscription_update", lambda s, p: updates.append((s, p)))
    soon = (datetime.now(timezone.utc) + timedelta(days=5)).date().isoformat()
    assert as_root(c, "post", f"/admin/workspaces/{wid}/billing/comp", json={"until": soon}).status_code == 200
    assert updates == []


def test_admin_comp_for_canceling_subscription_leaves_stripe_alone(env, monkeypatch):
    c, db, stripe, wid = env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    cust = _customer(c, db, stripe, wid)
    stripe.add_sub(cust, "active", wid)
    call(c, wid, "alice", "post", "/billing/sync", json={})
    db.collection("workspaces").document(wid).update({"billing.cancelAtPeriodEnd": True})
    updates = []
    monkeypatch.setattr(billing_api, "stripe_subscription_update", lambda sid, p: updates.append((sid, p)))
    assert as_root(c, "post", f"/admin/workspaces/{wid}/billing/comp", json={"until": "2030-01-01"}).status_code == 200
    assert updates == []


def test_admin_overview_lists_workspaces(env):
    c, db, _, wid = env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    rows = as_root(c, "get", "/admin/billing/overview").get_json()
    row = next(r for r in rows if r["id"] == wid)
    assert row["billing"]["status"] == "trialing" and row["hasCustomer"] is False


# ── Credite ──────────────────────────────────────────────────────────────────
import billing_credits  # noqa: E402


@pytest.fixture()
def credits_env(env, monkeypatch):
    c, db, stripe, wid = env
    for pack in ("10", "30", "50"):
        monkeypatch.setenv(f"STRIPE_PRICE_CREDITS_{pack}", f"price_c{pack}")
    # Cabinet după probă, fără abonament: trece pe credite.
    db.collection("workspaces").document(wid).update({"billing": billing.no_trial(datetime.now(timezone.utc))})
    db.collection("workspaces").document(wid).collection("clienti").document("clientFirmaX01").set(
        {"denumire": "Firma X SRL", "codFiscal": "RO18547290"})
    db.collection("workspaces").document(wid).collection("clienti").document("clientFirmaY01").set(
        {"denumire": "Firma Y SRL", "codFiscal": ""})
    return c, db, stripe, wid


def buy(c, stripe, wid, pack="10", via="webhook"):
    r = call(c, wid, "alice", "post", "/billing/credits/checkout", json={"pack": pack})
    assert r.status_code == 200, r.get_json()
    sid = r.get_json()["url"].rsplit("/", 1)[1]
    stripe.sessions[sid].update(payment_status="paid", amount_total=35000, payment_intent=f"pi_{sid}")
    if via == "webhook":
        assert post_event(c, event(f"evt_{sid}", "checkout.session.completed", stripe.sessions[sid])).status_code == 200
    else:
        assert call(c, wid, "bob", "post", "/billing/sync", json={"sessionId": sid}).status_code == 200
    return sid


def test_credit_checkout_is_one_time_payment_with_server_price(credits_env):
    c, db, stripe, wid = credits_env
    assert call(c, wid, "alice", "post", "/billing/credits/checkout", json={"pack": "10"}).get_json()["error"] \
        == "billing_details_required"
    with_details(c, wid)
    assert call(c, wid, "bob", "post", "/billing/credits/checkout", json={"pack": "10"}).status_code == 403
    assert call(c, wid, "alice", "post", "/billing/credits/checkout", json={"pack": "7"}).get_json()["error"] == "invalid_pack"
    r = call(c, wid, "alice", "post", "/billing/credits/checkout", json={"pack": "30", "priceId": "price_ieftin"})
    params = next(iter(stripe.sessions.values()))["params"]
    assert r.status_code == 200 and params["mode"] == "payment"
    assert params["line_items"] == [{"price": "price_c30", "quantity": 1}]
    assert params["metadata"] == {"workspaceId": wid, "pack": "30"}
    assert params["payment_intent_data"]["metadata"]["workspaceId"] == wid


def test_credit_checkout_refused_while_subscribed(credits_env):
    c, db, stripe, wid = credits_env
    with_details(c, wid)
    db.collection("workspaces").document(wid).update({"billing.hasSubscription": True})
    assert call(c, wid, "alice", "post", "/billing/credits/checkout", json={"pack": "10"}).status_code == 409
    # Abonament anulat, încă activ: creditele se pot cumpăra dinainte.
    db.collection("workspaces").document(wid).update({"billing.cancelAtPeriodEnd": True})
    assert call(c, wid, "alice", "post", "/billing/credits/checkout", json={"pack": "10"}).status_code == 200


def test_credit_checkout_unavailable_without_price(credits_env, monkeypatch):
    c, db, stripe, wid = credits_env
    with_details(c, wid)
    monkeypatch.delenv("STRIPE_PRICE_CREDITS_10")
    assert call(c, wid, "alice", "post", "/billing/credits/checkout", json={"pack": "10"}).status_code == 503


@pytest.mark.parametrize("via", ["webhook", "sync"])
def test_purchase_adds_credits_once(credits_env, via):
    c, db, stripe, wid = credits_env
    with_details(c, wid)
    sid = buy(c, stripe, wid, "10", via)
    # A doua livrare (webhook după sync sau eveniment retrimis) nu dublează pachetul.
    assert post_event(c, event("evt_again", "checkout.session.completed", stripe.sessions[sid])).status_code == 200
    call(c, wid, "bob", "post", "/billing/sync", json={"sessionId": sid})
    b = billing_of(db, wid)
    assert billing.credit_balance(b) == 10 and b["status"] == "credits"
    assert billing.has_full_access({"billing": b})
    data = call(c, wid, "alice", "get", "/billing/credits").get_json()
    assert data["balance"] == 10 and [e["kind"] for e in data["ledger"]] == ["purchase"]


def test_full_discount_promo_still_delivers_the_pack(credits_env):
    c, db, stripe, wid = credits_env
    with_details(c, wid)
    r = call(c, wid, "alice", "post", "/billing/credits/checkout", json={"pack": "30"})
    sid = r.get_json()["url"].rsplit("/", 1)[1]
    stripe.sessions[sid].update(payment_status="no_payment_required", amount_total=0)
    post_event(c, event("evt_free", "checkout.session.completed", stripe.sessions[sid]))
    assert billing.credit_balance(billing_of(db, wid)) == 30


def test_unpaid_session_adds_nothing(credits_env):
    c, db, stripe, wid = credits_env
    with_details(c, wid)
    r = call(c, wid, "alice", "post", "/billing/credits/checkout", json={"pack": "10"})
    sid = r.get_json()["url"].rsplit("/", 1)[1]
    post_event(c, event("evt_unpaid", "checkout.session.completed", stripe.sessions[sid]))
    assert billing.credit_balance(billing_of(db, wid)) == 0


def test_consume_once_per_firm_within_window(credits_env):
    c, db, stripe, wid = credits_env
    with_details(c, wid)
    buy(c, stripe, wid, "10")
    assert call(c, wid, "bob", "get", "/billing/credits/quote?clientId=clientFirmaX01").get_json()["mode"] == "consume"
    first = billing_credits.consume(wid, "clientFirmaX01", "bob", "Act constitutiv.docx")
    again = billing_credits.consume(wid, "clientFirmaX01", "bob", "Anexa 1.docx")
    other = billing_credits.consume(wid, "clientFirmaY01", "bob", "Anexa 1.docx")
    assert (first["mode"], again["mode"], other["mode"]) == ("consumed", "included", "consumed")
    assert other["balance"] == 8
    q = call(c, wid, "bob", "get", "/billing/credits/quote?clientId=clientFirmaX01").get_json()
    assert q["mode"] == "included" and q["coveredUntil"]
    # Același CUI pe alt client = aceeași firmă; schimbarea CUI-ului = firmă nouă.
    clients = db.collection("workspaces").document(wid).collection("clienti")
    clients.document("clientFirmaX02").set({"denumire": "X", "codFiscal": "18547290"})
    assert billing_credits.consume(wid, "clientFirmaX02", "bob", "d")["mode"] == "included"
    clients.document("clientFirmaX01").update({"codFiscal": "RO14399840"})
    assert billing_credits.consume(wid, "clientFirmaX01", "bob", "d")["mode"] == "consumed"
    ledger = call(c, wid, "alice", "get", "/billing/credits").get_json()["ledger"]
    assert [e["kind"] for e in ledger].count("consume") == 3
    assert all("denumire" not in e for e in ledger)           # jurnalul nu păstrează nume
    consumed_for = {e["clientName"] for e in ledger if e["kind"] == "consume"}
    assert consumed_for == {"Firma X SRL", "Firma Y SRL"}     # citite acum din fișa clientului


def test_demo_client_never_consumes(credits_env):
    c, db, stripe, wid = credits_env
    clients = db.collection("workspaces").document(wid).collection("clienti")
    clients.document("clientDemo0001").set(
        {"denumire": "DEMO EXEMPLU SRL", "codFiscal": "99999999", "nrRegistrul": "J40/9999/2020"})
    # Fără niciun credit: clientul demo tot se poate genera, fără consum.
    assert billing_credits.consume(wid, "clientDemo0001", "bob", "d") == {"mode": "unlimited"}
    assert call(c, wid, "bob", "get", "/billing/credits/quote?clientId=clientDemo0001").get_json()["mode"] == "unlimited"
    assert not list(db.collection("billingAccounts").document(wid).collection("creditLedger").stream())
    # Trecut pe date reale (alt CUI), nu mai e demo.
    clients.document("clientDemo0001").update({"codFiscal": "RO18547290"})
    with pytest.raises(authz.CreditsRequired):
        billing_credits.consume(wid, "clientDemo0001", "bob", "d")


def test_window_expiry_consumes_again(credits_env):
    c, db, stripe, wid = credits_env
    with_details(c, wid)
    buy(c, stripe, wid, "10")
    billing_credits.consume(wid, "clientFirmaX01", "bob", "d")
    firm_docs = list(db.collection("billingAccounts").document(wid).collection("creditFirms").stream())
    firm_docs[0].reference.update({"coveredUntil": datetime.now(timezone.utc) - timedelta(seconds=1)})
    assert billing_credits.consume(wid, "clientFirmaX01", "bob", "d")["mode"] == "consumed"


def test_no_credits_left_refuses_new_firm_but_keeps_open_window(credits_env):
    c, db, stripe, wid = credits_env
    billing_credits.grant(wid, 1, "test", "admin")
    assert billing_credits.consume(wid, "clientFirmaX01", "bob", "d")["mode"] == "consumed"
    with pytest.raises(authz.CreditsRequired):
        billing_credits.consume(wid, "clientFirmaY01", "bob", "d")
    assert billing_credits.consume(wid, "clientFirmaX01", "bob", "d")["mode"] == "included"
    assert call(c, wid, "bob", "get", "/billing/credits/quote?clientId=clientFirmaY01").get_json()["mode"] == "none"
    with pytest.raises(billing_credits.ClientNotFound):
        billing_credits.consume(wid, None, "bob", "d")
    assert call(c, wid, "bob", "get", "/billing/credits/quote?clientId=lipsaClient001").status_code == 400


def test_unlimited_access_does_not_consume(credits_env):
    c, db, stripe, wid = credits_env
    billing_credits.grant(wid, 5, "test", "admin")
    db.collection("workspaces").document(wid).update(
        {"billing.compUntil": datetime.now(timezone.utc) + timedelta(days=10)})
    assert billing_credits.consume(wid, None, "bob", "d") == {"mode": "unlimited"}
    assert billing.credit_balance(billing_of(db, wid)) == 5


def test_concurrent_generations_for_same_firm_consume_once(credits_env):
    from concurrent.futures import ThreadPoolExecutor
    c, db, stripe, wid = credits_env
    billing_credits.grant(wid, 5, "test", "admin")
    with ThreadPoolExecutor(3) as pool:
        modes = list(pool.map(lambda _: billing_credits.consume(wid, "clientFirmaX01", "bob", "d")["mode"], range(3)))
    assert modes.count("consumed") == 1
    assert billing.credit_balance(billing_of(db, wid)) == 4


def test_gdoc_consume_endpoint(credits_env):
    c, db, stripe, wid = credits_env
    r = call(c, wid, "bob", "post", "/billing/credits/consume", json={"clientId": "clientFirmaX01"})
    assert r.status_code == 402 and r.get_json()["error"] == "subscription_required"   # fără credite: citire
    billing_credits.grant(wid, 2, "test", "admin")
    r = call(c, wid, "bob", "post", "/billing/credits/consume", json={"clientId": "clientFirmaX01", "template": "Doc"})
    assert r.status_code == 200 and r.get_json()["mode"] == "consumed"
    assert call(c, wid, "bob", "post", "/billing/credits/consume", json={}).get_json()["error"] == "client_required"


def test_super_admin_grants_and_removes_credits(credits_env):
    c, db, stripe, wid = credits_env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    admin = lambda body: call(c, wid, "root", "post", f"/admin/workspaces/{wid}/billing/credits", json=body)  # noqa: E731
    assert call(c, wid, "alice", "post", f"/admin/workspaces/{wid}/billing/credits",
                json={"amount": 3, "reason": "x"}).status_code == 403
    assert admin({"amount": 0, "reason": "x"}).get_json()["error"] == "invalid_amount"
    assert admin({"amount": 3, "reason": "bonus"}).status_code == 200
    assert admin({"amount": -5, "reason": "rambursare"}).status_code == 409
    assert admin({"amount": -2, "reason": "rambursare"}).status_code == 200
    assert billing.credit_balance(billing_of(db, wid)) == 1
    kinds = [e["kind"] for e in call(c, wid, "alice", "get", "/billing/credits").get_json()["ledger"]]
    assert sorted(kinds) == ["adjust", "grant"]


def test_billing_overview_shows_packs_and_upcoming_prices(credits_env):
    c, db, stripe, wid = credits_env
    data = call(c, wid, "alice", "get", "/billing").get_json()
    if datetime.now(timezone.utc) < billing.PRICE_V2_FROM:
        assert data["prices"] == {"month": 200, "year": 2000} and data["nextPrices"] == {"month": 250, "year": 2500}
        assert data["packs"]["50"] == {"credits": 50, "ron": 1000} and data["nextPacks"]["50"]["ron"] == 1250


# ── Tabloul de încasări (super admin) ────────────────────────────────────────
def test_admin_payments_lists_subscriptions_credits_refunds_and_tracks_invoices(credits_env):
    c, db, stripe, wid = credits_env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    with_details(c, wid)
    buy(c, stripe, wid, "10")                                         # 350 RON (amount_total simulat)
    billing_credits.grant(wid, 5, "bonus", "root")                    # gratuit: nu e încasare
    cust = db.collection("billingAccounts").document(wid).get().to_dict()["stripeCustomerId"]
    now = int(datetime.now(timezone.utc).timestamp())
    inv = {"id": "in_123", "customer": cust, "amount_paid": 20000, "currency": "ron", "number": "ABC-1",
           "status_transitions": {"paid_at": now}, "metadata": {"workspaceId": wid},
           "lines": {"data": [{"period": {"start": now, "end": now + 30 * DAY}, "price": {"id": "price_m"}}]}}
    post_event(c, event("evt_inv", "invoice.paid", inv))
    post_event(c, event("evt_ref", "charge.refunded", {"id": "ch_1", "customer": cust, "amount": 20000,
                                                        "amount_refunded": 5000, "currency": "ron", "metadata": {}}))
    assert call(c, wid, "alice", "get", "/admin/billing/payments").status_code == 403
    data = call(c, wid, "root", "get", "/admin/billing/payments").get_json()
    assert data["feesUnavailable"] is False
    by_kind = {r["kind"]: r for r in data["rows"]}
    # Brut / comision / net din Stripe, citite o singură dată și păstrate pe plată.
    assert (by_kind["subscription"]["gross"], by_kind["subscription"]["fee"], by_kind["subscription"]["net"]) == (20000, 425, 19575)
    assert ("fee", "pi_in_123") in stripe.calls and by_kind["credits"]["fee"] == 425
    assert by_kind["subscription"]["feeDetails"] == [{"type": "stripe_fee", "amount": 425, "description": "Stripe processing fees"}]
    calls = len([x for x in stripe.calls if x[0] == "fee"])
    call(c, wid, "root", "get", "/admin/billing/payments")
    assert len([x for x in stripe.calls if x[0] == "fee"]) == calls
    assert set(by_kind) == {"subscription", "credits", "refund"}
    assert by_kind["subscription"]["amount"] == 20000 and by_kind["subscription"]["interval"] == "month"
    assert by_kind["subscription"]["cui"] == billing.normalize_cui(DETAILS["cui"])
    assert by_kind["credits"]["amount"] == 35000 and by_kind["credits"]["credits"] == 10
    assert by_kind["credits"]["invoice"]["status"] == "pending"
    assert by_kind["refund"]["amount"] == -5000

    lot = by_kind["credits"]["id"]
    url = f"/admin/billing/payments/{wid}/credits/{lot}/invoice"
    assert call(c, wid, "root", "post", url, json={"number": "  CAB 12 "}).get_json()["invoice"]["number"] == "CAB 12"
    assert call(c, wid, "root", "post", f"/admin/billing/payments/{wid}/subscription/in_123/invoice",
                json={"number": "CAB 13"}).status_code == 200
    assert call(c, wid, "root", "post", f"/admin/billing/payments/{wid}/refund/x/invoice", json={"number": "1"}).status_code == 404
    assert call(c, wid, "root", "post", url, json={"number": ""}).status_code == 400
    rows = {r["kind"]: r for r in call(c, wid, "root", "get", "/admin/billing/payments").get_json()["rows"]}
    assert rows["credits"]["invoice"]["status"] == "manual" and rows["subscription"]["invoice"]["number"] == "CAB 13"
    assert call(c, wid, "root", "post", url, json={"number": None}).get_json()["invoice"]["status"] == "pending"


def test_fee_for_older_credit_pack_is_found_through_its_checkout_session(credits_env):
    c, db, stripe, wid = credits_env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    with_details(c, wid)
    sid = buy(c, stripe, wid, "10")
    lot = db.collection("billingAccounts").document(wid).collection("creditLots").document(sid)
    lot.update({"paymentIntent": None})                       # ca un pachet cumpărat înainte de această versiune
    row = call(c, wid, "root", "get", "/admin/billing/payments").get_json()["rows"][0]
    assert row["fee"] == 425 and ("fee", f"pi_{sid}") in stripe.calls


def test_admin_payments_without_fee_permission_still_lists_payments(credits_env):
    c, db, stripe, wid = credits_env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    with_details(c, wid)
    buy(c, stripe, wid, "10")
    stripe.fees_forbidden = True
    data = call(c, wid, "root", "get", "/admin/billing/payments").get_json()
    assert data["feesUnavailable"] is True
    assert data["rows"][0]["amount"] == 35000 and "fee" not in data["rows"][0]


def test_admin_stripe_fees_lists_billing_and_dispute_fees(credits_env, monkeypatch):
    c, db, stripe, wid = credits_env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    seen = {}

    def fees(since, until):
        seen["range"] = (since, until)
        return [{"id": "txn_1", "at": 1795000000, "category": "billing", "amount": 140, "currency": "ron",
                 "description": "Billing (2026-11)"}]
    monkeypatch.setattr(billing_api, "stripe_account_fees", fees)
    assert call(c, wid, "alice", "get", "/admin/billing/stripe-fees").status_code == 403
    data = call(c, wid, "root", "get", "/admin/billing/stripe-fees?from=2026-11-01&to=2026-12-01").get_json()
    assert data["unavailable"] is False and data["items"][0]["amount"] == 140 and data["items"][0]["at"].startswith("2026")
    assert seen["range"][0].isoformat().startswith("2026-11-01T00:00:00+02:00")
    assert call(c, wid, "root", "get", "/admin/billing/stripe-fees?from=azi").status_code == 400

    def forbidden(since, until):
        raise billing_api.BillingUnavailable("PermissionError")
    monkeypatch.setattr(billing_api, "stripe_account_fees", forbidden)
    assert call(c, wid, "root", "get", "/admin/billing/stripe-fees").get_json() == {"items": [], "unavailable": True}


# ── Încasări manuale ─────────────────────────────────────────────────────────

def _day(offset: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=offset)).date().isoformat()


def manual(c, wid, **body):
    base = {"kind": "subscription", "amount": 200, "method": "transfer", "paidAt": _day(0),
            "periodStart": _day(0), "periodEnd": _day(30), "interval": "month"}
    return as_root(c, "post", f"/admin/workspaces/{wid}/billing/manual", json={**base, **body})


def test_manual_subscription_records_payment_grants_access_and_cancels(credits_env):
    c, db, _, wid = credits_env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    assert call(c, wid, "alice", "post", f"/admin/workspaces/{wid}/billing/manual", json={}).status_code == 403
    for bad in ({"amount": -1}, {"amount": True}, {"method": "crypto"}, {"kind": "x"}, {"paidAt": _day(5)},
                {"periodEnd": _day(-1)}, {"periodStart": "2026-02-31"}, {"interval": "week"}, {"invoiceNumber": "x" * 61}):
        assert manual(c, wid, **bad).status_code == 400, bad
    r = manual(c, wid, amount=199.99, invoiceNumber=" CAB 12 ", note="ordin de plată 77")
    assert r.status_code == 200, r.get_json()
    p, b = r.get_json()["payment"], r.get_json()["billing"]
    assert p["amount"] == 19999 and p["invoice"]["status"] == "manual" and p["invoice"]["number"] == "CAB 12"
    assert b["status"] == "manual" and b["manualUntil"][:10] >= _day(29)
    assert billing.has_full_access({"billing": billing_of(db, wid)})
    # A doua perioadă, mai lungă: accesul se întinde; anularea ei îl readuce la prima.
    second = manual(c, wid, periodStart=_day(31), periodEnd=_day(395), interval="year", amount=2000).get_json()["payment"]
    assert billing.to_utc(billing_of(db, wid)["manualUntil"]).date().isoformat() == _day(395)
    assert len(as_root(c, "get", f"/admin/workspaces/{wid}/billing/manual").get_json()["payments"]) == 2
    r = as_root(c, "post", f"/admin/workspaces/{wid}/billing/manual/{second['id']}/cancel", json={"reason": "greșeală"})
    assert r.status_code == 200 and r.get_json()["payment"]["canceledAt"]
    assert billing.to_utc(billing_of(db, wid)["manualUntil"]).date().isoformat() == _day(30)
    # Plățile anulate nu apar în Încasări; cea valabilă apare fără comision.
    rows = [r for r in as_root(c, "get", "/admin/billing/payments").get_json()["rows"] if r.get("source") == "manual" and r["workspaceId"] == wid]
    assert [(r["kind"], r["amount"], r["fee"], r["net"]) for r in rows] == [("subscription", 19999, 0, 19999)]
    assert as_root(c, "post", f"/admin/workspaces/{wid}/billing/manual/man_{'0' * 20}/cancel", json={}).status_code == 404


def test_manual_credit_sale_adds_lot_and_cancel_removes_remaining(credits_env):
    c, db, _, wid = credits_env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    assert manual(c, wid, kind="credits", credits=0).status_code == 400
    r = manual(c, wid, kind="credits", credits=30, amount=750, method="numerar")
    assert r.status_code == 200
    pid = r.get_json()["payment"]["id"]
    assert billing.credit_balance(billing_of(db, wid)) == 30
    row = next(x for x in as_root(c, "get", "/admin/billing/payments").get_json()["rows"] if x.get("source") == "manual" and x["workspaceId"] == wid)
    assert row["kind"] == "credits" and row["credits"] == 30 and row["invoice"]["status"] == "pending"
    # Factura se marchează la fel ca la Stripe, pe tipul „manual”.
    r = as_root(c, "post", f"/admin/billing/payments/{wid}/manual/{pid}/invoice", json={"number": "CAB 13"})
    assert r.status_code == 200
    billing_credits.consume(wid, "clientFirmaX01", "alice", "doc")
    as_root(c, "post", f"/admin/workspaces/{wid}/billing/manual/{pid}/cancel", json={})
    assert billing.credit_balance(billing_of(db, wid)) == 0
    ledger = [d.to_dict() for d in db.collection("billingAccounts").document(wid).collection("creditLedger").stream()]
    assert any(e["kind"] == "adjust" and e["amount"] == -29 for e in ledger)
    assert not any(x.get("source") == "manual" and x["workspaceId"] == wid for x in as_root(c, "get", "/admin/billing/payments").get_json()["rows"])


def test_manual_subscription_refused_while_stripe_would_renew(env):
    c, db, stripe, wid = env
    db.collection("users").document("root").set({"isSuperAdmin": True})
    cust = _customer(c, db, stripe, wid)
    stripe.add_sub(cust, "active", wid)                     # plătit 30 de zile, se reînnoiește
    call(c, wid, "alice", "post", "/billing/sync", json={})
    assert manual(c, wid, periodEnd=_day(90)).get_json()["error"] == "stripe_subscription_active"
    assert manual(c, wid, periodEnd=_day(10)).status_code == 200   # acoperit de perioada Stripe: nu se dublează
