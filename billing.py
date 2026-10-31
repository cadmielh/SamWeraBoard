"""Starea abonamentului unui cabinet (trial, abonament Stripe, acces gratuit acordat de super admin).

Sursa unică de adevăr pentru acces e `workspaces/{wid}.billing.accessUntil` (moment UTC): cât timp
`acum < accessUntil`, cabinetul are acces complet; după, trece în citire + export. Regulile Firestore
(`billingOk`), API-ul (`authz.require_role(..., billing=True)`) și interfața compară toate doar acest câmp,
deci nu există logică de trial duplicată. Câmpul se recalculează DOAR aici, la schimbări din Stripe sau
la acțiuni de super admin — trecerea timpului nu cere nicio scriere.

Modul fără Firestore și fără Stripe: primește și întoarce dicționare simple (testabil izolat).
"""
from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timedelta, timezone

SCHEMA = 1
TRIAL_DAYS = 14
# Plată eșuată la reînnoire: acces complet încă N zile cât timp Stripe reîncearcă (Smart Retries pe 1 săptămână,
# apoi Stripe anulează abonamentul).
GRACE_DAYS = int(os.getenv("BILLING_GRACE_DAYS", "7"))
# La reînnoire, webhook-ul poate întârzia: abonamentul activ mai acoperă o marjă după sfârșitul perioadei.
ACTIVE_BUFFER = timedelta(days=2)
# Stripe cere ca `trial_end` din Checkout să fie la cel puțin 48h în viitor.
MIN_TRIAL_CARRY = timedelta(hours=48)

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# Planuri: azi unul singur; grila după volum (2027) se adaugă aici. Id-urile de preț vin din env
# (diferă între modul test și live), prețul îl alege mereu serverul — clientul trimite doar intervalul.
PLANS: dict[str, dict[str, str]] = {
    "standard": {"month": "STRIPE_PRICE_STANDARD_MONTH", "year": "STRIPE_PRICE_STANDARD_YEAR"},
}
INTERVALS = ("month", "year")
LIVE_SUB_STATUSES = ("trialing", "active", "past_due")


def price_id(plan: str, interval: str) -> str | None:
    env = PLANS.get(plan, {}).get(interval)
    return (os.getenv(env) or None) if env else None


def plan_for_price(pid: str | None) -> tuple[str, str] | None:
    """(plan, interval) pentru un id de preț cunoscut; None pentru orice alt preț (inclusiv lipsă din env)."""
    if not pid:
        return None
    for plan, intervals in PLANS.items():
        for interval, env in intervals.items():
            if os.getenv(env) and os.getenv(env) == pid:
                return plan, interval
    return None


# ── Timp ─────────────────────────────────────────────────────────────────────

def to_utc(v) -> datetime | None:
    """Timestamp Firestore (datetime), datetime naiv/aware sau secunde Unix (Stripe) -> datetime UTC."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, timezone.utc)
    return None


def _now(now: datetime | None) -> datetime:
    return to_utc(now) or datetime.now(timezone.utc)


# ── Acces ────────────────────────────────────────────────────────────────────

def access_until(ws: dict | None) -> datetime | None:
    return to_utc(((ws or {}).get("billing") or {}).get("accessUntil"))


def has_full_access(ws: dict | None, now: datetime | None = None) -> bool:
    """Acces complet (creare/modificare, OCR, AI, generare). Fără câmpul `billing` -> fără acces (fail closed)."""
    until = access_until(ws)
    return until is not None and _now(now) < until


def quota_tier(ws: dict | None, now: datetime | None = None) -> str:
    """'trial' cât timp cabinetul e în perioada de probă fără abonament (cote OCR/AI mai mici), altfel 'standard'."""
    b = (ws or {}).get("billing") or {}
    trial_end = to_utc(b.get("trialEndsAt"))
    if b.get("hasSubscription") or (to_utc(b.get("compUntil")) or EPOCH) > _now(now):
        return "standard"
    return "trial" if trial_end and trial_end > _now(now) else "standard"


def finalize(b: dict, now: datetime | None = None) -> dict:
    """Recalculează `accessUntil` și statusul afișat din componente. Singurul loc care scrie `accessUntil`."""
    now = _now(now)
    trial_end = to_utc(b.get("trialEndsAt"))
    comp_until = to_utc(b.get("compUntil"))
    sub_until = to_utc(b.get("subscriptionAccessUntil"))
    candidates = [t for t in (trial_end, comp_until, sub_until) if t]
    out = dict(b)
    out["schema"] = SCHEMA
    out["accessUntil"] = max(candidates) if candidates else EPOCH
    sub_status = b.get("subscriptionStatus")
    if sub_status in LIVE_SUB_STATUSES:
        status = "trialing" if sub_status == "trialing" else sub_status
    elif comp_until and comp_until > now:
        status = "comp"
    elif trial_end and trial_end > now:
        status = "trialing"
    elif sub_status == "canceled":
        status = "canceled"
    elif trial_end or comp_until or sub_status:
        status = "expired"
    else:
        status = "none"
    out["status"] = status
    out["syncedAt"] = now
    return out


def _empty() -> dict:
    return {
        "plan": "standard", "interval": None,
        "trialEndsAt": None, "compUntil": None, "compReason": None,
        "subscriptionStatus": None, "subscriptionAccessUntil": None,
        "currentPeriodEnd": None, "graceUntil": None,
        "cancelAtPeriodEnd": False, "hasSubscription": False,
    }


def initial_trial(now: datetime | None = None) -> dict:
    now = _now(now)
    return finalize({**_empty(), "trialEndsAt": now + timedelta(days=TRIAL_DAYS)}, now)


def no_trial(now: datetime | None = None) -> dict:
    """Cabinet creat de cineva care și-a folosit deja perioada de probă: direct abonare."""
    return finalize(_empty(), now)


def extend_trial(prev: dict | None, days: int, now: datetime | None = None) -> dict:
    """Super admin: prelungește proba cu `days` zile de la max(acum, sfârșitul curent al probei)."""
    now = _now(now)
    b = {**_empty(), **(prev or {})}
    start = max(now, to_utc(b.get("trialEndsAt")) or now)
    b["trialEndsAt"] = start + timedelta(days=days)
    return finalize(b, now)


def set_comp(prev: dict | None, until: datetime | None, reason: str | None, now: datetime | None = None) -> dict:
    """Super admin: acces gratuit până la `until` (None = retrage accesul gratuit)."""
    b = {**_empty(), **(prev or {})}
    b["compUntil"] = to_utc(until)
    b["compReason"] = (reason or None) if until else None
    return finalize(b, now)


# ── Stripe ───────────────────────────────────────────────────────────────────

def _period(sub: dict, key: str) -> datetime | None:
    # Din API-ul Stripe 2025-03-31 (basil), perioada e pe elementele abonamentului; înainte era la rădăcină.
    items = ((sub.get("items") or {}).get("data") or [])
    if items and items[0].get(key):
        return to_utc(items[0][key])
    return to_utc(sub.get(key))


def subscription_price(sub: dict) -> str | None:
    items = ((sub.get("items") or {}).get("data") or [])
    return ((items[0].get("price") or {}).get("id")) if items else None


def subscription_access(sub: dict) -> datetime | None:
    """Până când acoperă abonamentul accesul, după statusul lui real în Stripe."""
    status = sub.get("status")
    if status == "trialing":
        return to_utc(sub.get("trial_end"))
    if status == "active":
        end = _period(sub, "current_period_end")
        cancel_at = to_utc(sub.get("cancel_at"))
        if cancel_at or sub.get("cancel_at_period_end"):
            # Anulat: nu mai urmează nicio reînnoire de așteptat, deci fără marjă — se încheie exact la anulare.
            return min(d for d in (end, cancel_at) if d) if (end or cancel_at) else None
        return end + ACTIVE_BUFFER if end else None
    if status == "past_due":
        # Perioada s-a mutat deja înainte la reînnoirea eșuată: grația se numără de la începutul ei
        # (momentul plății eșuate), nu de la sfârșit — altfel un neplătitor ar primi o lună gratuită.
        start = _period(sub, "current_period_start")
        return start + timedelta(days=GRACE_DAYS) if start else None
    if status == "canceled":
        return to_utc(sub.get("ended_at"))
    return None  # unpaid, incomplete, incomplete_expired, paused


def with_subscription(prev: dict | None, sub: dict | None, now: datetime | None = None) -> dict:
    """Aplică starea unui abonament Stripe (citit proaspăt din API) peste billing-ul existent.
    `sub=None`: cabinetul nu (mai) are abonament în Stripe."""
    b = {**_empty(), **(prev or {})}
    if sub is None:
        b.update(subscriptionStatus=None, subscriptionAccessUntil=None, currentPeriodEnd=None,
                 graceUntil=None, cancelAtPeriodEnd=False, hasSubscription=False, interval=None)
        return finalize(b, now)
    status = sub.get("status")
    mapped = plan_for_price(subscription_price(sub))
    if mapped:
        b["plan"], b["interval"] = mapped
    b["subscriptionStatus"] = status
    b["subscriptionAccessUntil"] = subscription_access(sub) if mapped else None
    b["currentPeriodEnd"] = _period(sub, "current_period_end")
    b["graceUntil"] = b["subscriptionAccessUntil"] if status == "past_due" else None
    # Portalul Stripe (API ≥ basil) anulează prin `cancel_at` = sfârșitul perioadei, cu `cancel_at_period_end`
    # rămas false; acceptăm ambele forme. O anulare programată mai devreme mută data afișată de încheiere.
    cancel_at = to_utc(sub.get("cancel_at"))
    b["cancelAtPeriodEnd"] = bool(sub.get("cancel_at_period_end")) or (cancel_at is not None and status in LIVE_SUB_STATUSES)
    if cancel_at and b["currentPeriodEnd"] and cancel_at < b["currentPeriodEnd"]:
        b["currentPeriodEnd"] = cancel_at
    b["hasSubscription"] = status in LIVE_SUB_STATUSES
    return finalize(b, now)


def trial_end_for_checkout(ws: dict | None, now: datetime | None = None) -> int | None:
    """Zilele de probă rămase se păstrează la abonare (prima plată la sfârșitul probei), doar dacă mai sunt
    cel puțin 48h; altfel plata se încasează imediat. Secunde Unix, cum le cere Stripe."""
    trial_end = to_utc(((ws or {}).get("billing") or {}).get("trialEndsAt"))
    if trial_end and trial_end - _now(now) >= MIN_TRIAL_CARRY:
        return int(trial_end.timestamp())
    return None


# ── Anti-abuz perioadă de probă ─────────────────────────────────────────────

def normalize_email(email: str) -> str:
    """O singură probă per cutie poștală: litere mici, fără sufix `+etichetă`; la Gmail și fără puncte."""
    local, _, domain = (email or "").strip().lower().partition("@")
    local = local.split("+", 1)[0]
    if domain in ("gmail.com", "googlemail.com"):
        local, domain = local.replace(".", ""), "gmail.com"
    return f"{local}@{domain}"


def claim_id(kind: str, value: str) -> str:
    """Id de document pentru `trialClaims`: hash, ca să nu păstrăm e-mailul în clar."""
    return hashlib.sha256(f"{kind}|{value}".encode()).hexdigest()[:40]


# ── Date de facturare ───────────────────────────────────────────────────────

_CUI_KEY = "753217532"


def normalize_cui(cui: str) -> str:
    return re.sub(r"\s+", "", str(cui or "")).upper().removeprefix("RO")


def valid_cui(cui: str) -> bool:
    """Cifra de control a codului de identificare fiscală (CIF/CUI) românesc."""
    digits = normalize_cui(cui)
    if not digits.isdigit() or not 2 <= len(digits) <= 10:
        return False
    body, control = digits[:-1].rjust(9, "0"), int(digits[-1])
    check = sum(int(d) * int(k) for d, k in zip(body, _CUI_KEY)) * 10 % 11
    return (0 if check == 10 else check) == control
