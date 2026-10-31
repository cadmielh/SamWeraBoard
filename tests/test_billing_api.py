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
           "adresa": "Str. Exemplu 1", "localitate": "Cluj-Napoca", "judet": "Cluj", "email": "facturi@ex.ro"}
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

    def customer_create(self, params):
        cid = self._id("cus")
        self.customers[cid] = params
        return {"id": cid}

    def checkout_create(self, params):
        sid = "cs_test_" + self._id("s")
        self.sessions[sid] = {"id": sid, "url": f"https://checkout/{sid}", "customer": params["customer"],
                              "client_reference_id": params["client_reference_id"],
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
        return authz.Principal(uid=uid, email=email, name=uid)

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
    r = call(c, wid, "alice", "put", "/billing/details", json={**DETAILS, "tip": "PF", "cui": "orice"})
    assert r.status_code == 200 and r.get_json()["details"]["cui"] == ""
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
    assert stripe.customers[cust]["metadata"] == {"workspaceId": wid}


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
                f"/admin/workspaces/{wid}/billing/sync"):
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
