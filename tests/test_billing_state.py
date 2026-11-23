"""Teste pentru billing.py — logica de acces (trial, abonament Stripe, acces gratuit). Fără emulator."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import billing  # noqa: E402

NOW = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
DAY = timedelta(days=1)


@pytest.fixture(autouse=True)
def prices(monkeypatch):
    monkeypatch.setenv("STRIPE_PRICE_STANDARD_MONTH", "price_m")
    monkeypatch.setenv("STRIPE_PRICE_STANDARD_YEAR", "price_y")


def ws(b):
    return {"billing": b}


def sub(status, *, price="price_m", start=None, end=None, trial_end=None, ended_at=None, cancel=False):
    item = {"price": {"id": price}}
    if start:
        item["current_period_start"] = int(start.timestamp())
    if end:
        item["current_period_end"] = int(end.timestamp())
    return {"status": status, "items": {"data": [item]}, "cancel_at_period_end": cancel,
            "trial_end": int(trial_end.timestamp()) if trial_end else None,
            "ended_at": int(ended_at.timestamp()) if ended_at else None}


# ── Acces de bază ────────────────────────────────────────────────────────────
def test_missing_billing_fails_closed():
    assert not billing.has_full_access({}, NOW)
    assert not billing.has_full_access({"billing": {}}, NOW)
    assert not billing.has_full_access(None, NOW)


def test_initial_trial_is_14_days_and_ends_exactly_at_boundary():
    b = billing.initial_trial(NOW)
    assert b["status"] == "trialing" and b["accessUntil"] == NOW + 14 * DAY
    assert billing.has_full_access(ws(b), NOW + 14 * DAY - timedelta(seconds=1))
    assert not billing.has_full_access(ws(b), NOW + 14 * DAY)
    assert billing.quota_tier(ws(b), NOW) == "trial"


def test_no_trial_means_no_access_and_status_none():
    b = billing.no_trial(NOW)
    assert b["status"] == "none" and not billing.has_full_access(ws(b), NOW)
    assert b["accessUntil"] == billing.EPOCH


def test_expired_trial_status_after_recompute():
    b = billing.initial_trial(NOW)
    later = billing.finalize(b, NOW + 20 * DAY)
    assert later["status"] == "expired" and later["accessUntil"] == b["accessUntil"]


# ── Stripe ───────────────────────────────────────────────────────────────────
def test_active_subscription_covers_period_plus_buffer():
    b = billing.with_subscription(billing.no_trial(NOW), sub("active", start=NOW, end=NOW + 30 * DAY), NOW)
    assert b["status"] == "active" and b["hasSubscription"] and b["interval"] == "month"
    assert b["accessUntil"] == NOW + 30 * DAY + billing.ACTIVE_BUFFER
    assert billing.quota_tier(ws(b), NOW) == "standard"


def test_past_due_grace_counts_from_failed_renewal_not_period_end():
    s = sub("past_due", start=NOW, end=NOW + 30 * DAY)
    b = billing.with_subscription(billing.no_trial(NOW), s, NOW)
    assert b["status"] == "past_due"
    assert b["accessUntil"] == NOW + billing.GRACE_DAYS * DAY      # nu NOW + 30 zile
    assert b["graceUntil"] == b["accessUntil"]


def test_canceled_keeps_access_until_ended_at():
    b = billing.with_subscription(billing.no_trial(NOW), sub("canceled", ended_at=NOW + 3 * DAY), NOW)
    assert b["status"] == "canceled" and not b["hasSubscription"]
    assert b["accessUntil"] == NOW + 3 * DAY


def test_portal_cancel_via_cancel_at_counts_as_scheduled_cancel():
    s = sub("active", start=NOW, end=NOW + 30 * DAY)
    assert not billing.with_subscription(billing.no_trial(NOW), s, NOW)["cancelAtPeriodEnd"]
    s["cancel_at"] = int((NOW + 30 * DAY).timestamp())   # așa anulează portalul, cu cancel_at_period_end=False
    b = billing.with_subscription(billing.no_trial(NOW), s, NOW)
    assert b["cancelAtPeriodEnd"] and b["hasSubscription"]
    assert b["currentPeriodEnd"] == NOW + 30 * DAY
    assert b["accessUntil"] == NOW + 30 * DAY    # anulat: fără marja de reînnoire
    s["cancel_at"] = int((NOW + 10 * DAY).timestamp())   # anulare programată înainte de sfârșitul perioadei
    assert billing.with_subscription(billing.no_trial(NOW), s, NOW)["currentPeriodEnd"] == NOW + 10 * DAY


@pytest.mark.parametrize("status", ["unpaid", "incomplete", "incomplete_expired", "paused"])
def test_non_paying_statuses_give_nothing(status):
    b = billing.with_subscription(billing.no_trial(NOW), sub(status, start=NOW, end=NOW + 30 * DAY), NOW)
    assert not billing.has_full_access(ws(b), NOW)


def test_unknown_price_gives_no_access():
    b = billing.with_subscription(billing.no_trial(NOW),
                                  sub("active", price="price_alien", start=NOW, end=NOW + 30 * DAY), NOW)
    assert not billing.has_full_access(ws(b), NOW)


def test_subscribing_during_trial_keeps_remaining_trial():
    trial = billing.initial_trial(NOW)
    b = billing.with_subscription(trial, sub("trialing", trial_end=NOW + 14 * DAY), NOW + DAY)
    assert b["status"] == "trialing" and b["hasSubscription"]
    assert b["accessUntil"] == NOW + 14 * DAY
    assert billing.quota_tier(ws(b), NOW + DAY) == "standard"      # a pus cardul: cote pline


def test_yearly_price_maps_interval():
    b = billing.with_subscription(None, sub("active", price="price_y", start=NOW, end=NOW + 365 * DAY), NOW)
    assert b["interval"] == "year"


def test_legacy_period_fields_at_root_are_supported():
    s = {"status": "active", "items": {"data": [{"price": {"id": "price_m"}}]},
         "current_period_end": int((NOW + 30 * DAY).timestamp())}
    b = billing.with_subscription(None, s, NOW)
    assert b["accessUntil"] == NOW + 30 * DAY + billing.ACTIVE_BUFFER


def test_removing_subscription_falls_back_to_trial_or_comp():
    trial = billing.initial_trial(NOW)
    active = billing.with_subscription(trial, sub("active", start=NOW, end=NOW + 30 * DAY), NOW)
    gone = billing.with_subscription(active, None, NOW)
    assert gone["accessUntil"] == NOW + 14 * DAY and not gone["hasSubscription"]


# ── Super admin ──────────────────────────────────────────────────────────────
def test_extend_trial_from_current_end_or_now():
    b = billing.initial_trial(NOW)
    assert billing.extend_trial(b, 10, NOW)["accessUntil"] == NOW + 24 * DAY
    expired = billing.no_trial(NOW)
    assert billing.extend_trial(expired, 5, NOW)["accessUntil"] == NOW + 5 * DAY


def test_comp_wins_by_max_and_can_be_revoked():
    b = billing.set_comp(billing.no_trial(NOW), NOW + 60 * DAY, "pilot", NOW)
    assert b["status"] == "comp" and b["accessUntil"] == NOW + 60 * DAY
    assert billing.quota_tier(ws(b), NOW) == "standard"
    revoked = billing.set_comp(b, None, None, NOW)
    assert not billing.has_full_access(ws(revoked), NOW) and revoked["compReason"] is None


# ── Checkout ─────────────────────────────────────────────────────────────────
def test_trial_carry_only_with_at_least_48h_left():
    b = billing.initial_trial(NOW)
    assert billing.trial_end_for_checkout(ws(b), NOW) == int((NOW + 14 * DAY).timestamp())
    assert billing.trial_end_for_checkout(ws(b), NOW + 12 * DAY + timedelta(hours=1)) is None
    assert billing.trial_end_for_checkout(ws(billing.no_trial(NOW)), NOW) is None


def test_checkout_keeps_comp_days_too():
    comp = billing.set_comp(billing.no_trial(NOW), NOW + 40 * DAY, "pilot", NOW)
    assert billing.trial_end_for_checkout(ws(comp), NOW) == int((NOW + 40 * DAY).timestamp())
    # Proba și gratuitatea: contează cea care ține mai mult.
    both = billing.set_comp(billing.initial_trial(NOW), NOW + 5 * DAY, "x", NOW)
    assert billing.trial_end_for_checkout(ws(both), NOW) == int((NOW + 14 * DAY).timestamp())
    far = billing.set_comp(billing.no_trial(NOW), NOW + 1000 * DAY, "x", NOW)
    assert billing.trial_end_for_checkout(ws(far), NOW) == int((NOW + billing.MAX_TRIAL_CARRY).timestamp())


def test_price_is_chosen_server_side():
    assert billing.price_id("standard", "month") == "price_m"
    assert billing.price_id("standard", "week") is None
    assert billing.plan_for_price("price_y") == ("standard", "year")
    assert billing.plan_for_price(None) is None


# ── Anti-abuz / date facturare ───────────────────────────────────────────────
def test_email_normalization():
    assert billing.normalize_email(" Ana.Pop+test@GMAIL.com ") == "anapop@gmail.com"
    assert billing.normalize_email("ana.pop@googlemail.com") == "anapop@gmail.com"
    assert billing.normalize_email("ana.pop+x@cabinet.ro") == "ana.pop@cabinet.ro"
    assert billing.claim_id("email", "a@b.ro") == billing.claim_id("email", "a@b.ro")
    assert "a@b.ro" not in billing.claim_id("email", "a@b.ro")


@pytest.mark.parametrize("cui,ok", [
    ("RO18547290", True), ("18547290", True), ("ro 18547290", True),
    ("18547291", False), ("abc", False), ("1", False),
])
def test_cui_check_digit(cui, ok):
    assert billing.valid_cui(cui) is ok


# ── Generații de preț ────────────────────────────────────────────────────────
def test_new_subscriptions_get_2027_prices_but_old_prices_stay_known(monkeypatch):
    monkeypatch.setenv("STRIPE_PRICE_STANDARD_MONTH_2027", "price_m27")
    monkeypatch.setenv("STRIPE_PRICE_STANDARD_YEAR_2027", "price_y27")
    before = billing.PRICE_V2_FROM - timedelta(seconds=1)
    assert billing.price_id("standard", "month", before) == "price_m"
    assert billing.price_id("standard", "month", billing.PRICE_V2_FROM) == "price_m27"
    assert billing.display_prices(now=before) == {"month": 200, "year": 2000}
    assert billing.display_prices(now=billing.PRICE_V2_FROM) == {"month": 250, "year": 2500}
    # Cine s-a abonat la 200 RON își păstrează prețul: abonamentul lui rămâne recunoscut și după schimbare.
    assert billing.plan_for_price("price_m") == ("standard", "month")
    assert billing.plan_for_price("price_y27") == ("standard", "year")


def test_missing_2027_price_stops_new_subscriptions_after_switch(monkeypatch):
    monkeypatch.delenv("STRIPE_PRICE_STANDARD_MONTH_2027", raising=False)
    assert billing.price_id("standard", "month", billing.PRICE_V2_FROM + DAY) is None


# ── Credite ──────────────────────────────────────────────────────────────────
def with_credits(*lots, prev=None):
    b = prev if prev is not None else billing.no_trial(NOW - 30 * DAY)
    for i, (amount, expires) in enumerate(lots):
        b = billing.add_credits(b, f"lot{i}", amount, expires, NOW)
    return b


def test_credits_give_access_until_last_lot_with_balance_expires():
    b = with_credits((10, NOW + 100 * DAY), (5, NOW + 300 * DAY))
    assert billing.credit_balance(b, NOW) == 15
    assert b["accessUntil"] == NOW + 300 * DAY and b["status"] == "credits"
    assert billing.credit_mode(b, NOW) == "credits"
    # Primul pachet a expirat: soldul scade fără nicio scriere, accesul ține până la al doilea.
    assert billing.credit_balance(b, NOW + 150 * DAY) == 5
    assert billing.has_full_access(ws(b), NOW + 299 * DAY)


def test_consume_takes_from_lot_expiring_first_and_opens_window():
    b = with_credits((5, NOW + 300 * DAY), (2, NOW + 100 * DAY))
    new, lot = billing.consume_credit(b, NOW + 30 * DAY, NOW)
    assert lot == "lot1" and billing.credit_balance(new, NOW) == 6
    assert billing.covered_until(new) == NOW + 30 * DAY


def test_last_credit_keeps_access_until_window_ends():
    b = with_credits((1, NOW + 10 * DAY))
    new, lot = billing.consume_credit(b, NOW + 30 * DAY, NOW)
    assert lot and billing.credit_balance(new, NOW) == 0
    assert new["accessUntil"] == NOW + 30 * DAY               # fereastra firmei, nu expirarea pachetului
    assert billing.credit_mode(new, NOW + 29 * DAY) == "credits"
    assert billing.credit_mode(new, NOW + 31 * DAY) == "none"
    assert not new["credits"]["lots"]                          # pachetul epuizat iese din rezumat


def test_no_credits_left_means_no_consumption():
    b = with_credits((1, NOW - DAY))
    same, lot = billing.consume_credit(b, NOW + 30 * DAY, NOW)
    assert lot is None and same == b


def test_unlimited_access_wins_over_credits():
    trial = with_credits((10, NOW + 300 * DAY), prev=billing.initial_trial(NOW))
    assert billing.credit_mode(trial, NOW) == "unlimited"
    assert billing.credit_mode(trial, NOW + 15 * DAY) == "credits"   # după probă se trece pe credite
    assert trial["accessUntil"] == NOW + 300 * DAY


def test_add_credits_is_idempotent_and_remove_takes_latest_first():
    b = with_credits((10, NOW + 100 * DAY), (5, NOW + 300 * DAY))
    assert billing.credit_balance(billing.add_credits(b, "lot0", 10, NOW + 100 * DAY, NOW), NOW) == 15
    removed = billing.remove_credits(b, 7, NOW)
    lots = {lot["id"]: lot["remaining"] for lot in removed["credits"]["lots"]}
    assert lots == {"lot0": 8}
    assert billing.remove_credits(b, 16, NOW) is None


def test_firm_key_follows_cui_or_client_and_name():
    pj = billing.firm_key("c1", {"codFiscal": "RO 18547290", "denumire": "X SRL"})
    assert pj == billing.firm_key("c2", {"codFiscal": "18547290", "denumire": "Alt nume"})   # aceeași firmă
    new_firm = billing.firm_key("c1", {"codFiscal": "", "denumire": "Firma  Nouă SRL"})
    assert new_firm == billing.firm_key("c1", {"codFiscal": "", "denumire": "firma nouă srl"})
    assert new_firm != billing.firm_key("c1", {"codFiscal": "", "denumire": "Altă firmă SRL"})
    assert new_firm != billing.firm_key("c3", {"codFiscal": "", "denumire": "Firma Nouă SRL"})


def test_credit_packs_have_launch_prices_until_2027(monkeypatch):
    monkeypatch.setenv("STRIPE_PRICE_CREDITS_10", "price_c10")
    monkeypatch.setenv("STRIPE_PRICE_CREDITS_10_2027", "price_c10_27")
    before = billing.PRICE_V2_FROM - timedelta(seconds=1)
    assert billing.pack_price_id("10", before) == "price_c10"
    assert billing.pack_price_id("10", billing.PRICE_V2_FROM) == "price_c10_27"
    assert billing.pack_price_id("7", before) is None
    assert billing.display_packs(before) == {"10": {"credits": 10, "ron": 300}, "30": {"credits": 30, "ron": 750},
                                             "50": {"credits": 50, "ron": 1000}}
    assert billing.display_packs(billing.PRICE_V2_FROM)["30"] == {"credits": 30, "ron": 900}


def test_credit_cabinets_get_trial_quotas():
    b = with_credits((10, NOW + 300 * DAY))
    assert billing.quota_tier(ws(b), NOW) == "trial"
    subscribed = {**b, "hasSubscription": True}
    assert billing.quota_tier(ws(subscribed), NOW) == "standard"
    assert billing.quota_tier(ws(billing.no_trial(NOW)), NOW) == "standard"   # fără acces: cotele nu mai contează


def test_manual_subscription_gives_full_access_without_credits_and_carries_to_checkout():
    until = NOW + 40 * DAY
    b = billing.set_manual(billing.no_trial(NOW), until, NOW)
    assert b["status"] == "manual" and billing.access_until(ws(b)) == until
    assert billing.credit_mode(b, NOW) == "unlimited" and billing.quota_tier(ws(b), NOW) == "standard"
    # Abonare prin Stripe în timpul perioadei plătite manual: prima plată vine la sfârșitul ei.
    assert billing.trial_end_for_checkout(ws(b), NOW) == int(until.timestamp())
    assert billing.finalize(b, until + DAY)["status"] == "expired"
    assert billing.set_manual(b, None, NOW)["status"] == "none"


def test_live_stripe_subscription_status_wins_over_manual():
    b = billing.set_manual(billing.no_trial(NOW), NOW + 10 * DAY, NOW)
    b = billing.with_subscription(b, sub("active", start=NOW, end=NOW + 30 * DAY), NOW)
    assert b["status"] == "active" and b["manualUntil"] == NOW + 10 * DAY


def test_remove_lot_takes_only_that_lot():
    b = billing.add_credits(billing.no_trial(NOW), "a", 5, NOW + 100 * DAY, NOW)
    b = billing.add_credits(b, "b", 3, NOW + 200 * DAY, NOW)
    b, removed = billing.remove_lot(b, "b", NOW)
    assert removed == 3 and billing.credit_balance(b, NOW) == 5
    assert billing.remove_lot(b, "missing", NOW)[1] == 0
