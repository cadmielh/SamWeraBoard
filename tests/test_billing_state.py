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
