"""Starea abonamentului unui cabinet (trial, abonament Stripe, abonament plătit manual, acces gratuit acordat de
super admin).

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
MAX_TRIAL_CARRY = timedelta(days=720)

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# Planuri: azi unul singur; grila după volum (2027) se adaugă aici. Id-urile de preț vin din env
# (diferă între modul test și live), prețul îl alege mereu serverul — clientul trimite doar intervalul.
# Generații de preț, cea mai nouă prima: un abonament nou primește generația în vigoare la checkout, iar cine
# s-a abonat la un preț îl păstrează (Stripe nu schimbă prețul abonamentelor existente) — deci toate
# generațiile rămân recunoscute. 1 ianuarie 2027, 00:00 ora României = 31 decembrie 2026, 22:00 UTC.
PRICE_V2_FROM = datetime(2026, 12, 31, 22, 0, tzinfo=timezone.utc)
PLAN_PRICES: dict[str, list[dict]] = {
    "standard": [
        {"from": PRICE_V2_FROM, "ron": {"month": 250, "year": 2500},
         "env": {"month": "STRIPE_PRICE_STANDARD_MONTH_2027", "year": "STRIPE_PRICE_STANDARD_YEAR_2027"}},
        {"from": EPOCH, "ron": {"month": 200, "year": 2000},
         "env": {"month": "STRIPE_PRICE_STANDARD_MONTH", "year": "STRIPE_PRICE_STANDARD_YEAR"}},
    ],
}
INTERVALS = ("month", "year")
LIVE_SUB_STATUSES = ("trialing", "active", "past_due")

# Pachete de credite (plată unică). Un credit = o firmă (client) timp de CREDIT_WINDOW_DAYS: prima generare
# pentru firmă consumă creditul, restul documentelor și regenerările pentru ea în fereastră sunt incluse.
CREDIT_PACKS: dict[str, dict] = {"10": {"credits": 10}, "30": {"credits": 30}, "50": {"credits": 50}}
# Prețurile pachetelor, pe generații ca la abonament: preț de lansare până la 31.12.2026, apoi grila din 2027.
# Un pachet cumpărat la prețul de lansare rămâne valabil 12 luni de la cumpărare.
PACK_PRICES: list[dict] = [
    {"from": PRICE_V2_FROM, "ron": {"10": 350, "30": 900, "50": 1250},
     "env": {"10": "STRIPE_PRICE_CREDITS_10_2027", "30": "STRIPE_PRICE_CREDITS_30_2027", "50": "STRIPE_PRICE_CREDITS_50_2027"}},
    {"from": EPOCH, "ron": {"10": 300, "30": 750, "50": 1000},
     "env": {"10": "STRIPE_PRICE_CREDITS_10", "30": "STRIPE_PRICE_CREDITS_30", "50": "STRIPE_PRICE_CREDITS_50"}},
]
CREDIT_VALID_DAYS = 365
CREDIT_WINDOW_DAYS = 30


def _generation(plan: str, now: datetime | None = None) -> dict | None:
    now = _now(now)
    return next((g for g in PLAN_PRICES.get(plan, []) if g["from"] <= now), None)


def price_id(plan: str, interval: str, now: datetime | None = None) -> str | None:
    """Prețul Stripe pentru un abonament nou, din generația în vigoare. None = plățile sunt oprite (env lipsă)."""
    gen = _generation(plan, now)
    env = gen["env"].get(interval) if gen else None
    return (os.getenv(env) or None) if env else None


def display_prices(plan: str = "standard", now: datetime | None = None) -> dict[str, int]:
    gen = _generation(plan, now)
    return dict(gen["ron"]) if gen else {}


def plan_for_price(pid: str | None) -> tuple[str, str] | None:
    """(plan, interval) pentru un id de preț cunoscut, din orice generație; None pentru orice alt preț."""
    if not pid:
        return None
    for plan, gens in PLAN_PRICES.items():
        for gen in gens:
            for interval, env in gen["env"].items():
                if os.getenv(env) and os.getenv(env) == pid:
                    return plan, interval
    return None


def _pack_generation(now: datetime | None = None) -> dict:
    now = _now(now)
    return next(g for g in PACK_PRICES if g["from"] <= now)


def pack_price_id(pack: str, now: datetime | None = None) -> str | None:
    """Prețul Stripe al pachetului, din generația în vigoare. None = plățile sunt oprite (env lipsă)."""
    env = _pack_generation(now)["env"].get(pack)
    return (os.getenv(env) or None) if env else None


def display_packs(now: datetime | None = None) -> dict[str, dict[str, int]]:
    ron = _pack_generation(now)["ron"]
    return {k: {"credits": v["credits"], "ron": ron[k]} for k, v in CREDIT_PACKS.items()}


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
    """'trial' (cote OCR/AI mai mici) cât timp cabinetul e în perioada de probă fără abonament, sau pe credite: un
    credit nefolosit ține accesul deschis până la un an, deci scanarea nu poate avea plafonul unui abonament.
    Altfel 'standard'."""
    b = (ws or {}).get("billing") or {}
    trial_end = to_utc(b.get("trialEndsAt"))
    if (b.get("hasSubscription") or (to_utc(b.get("compUntil")) or EPOCH) > _now(now)
            or (to_utc(b.get("manualUntil")) or EPOCH) > _now(now)):
        return "standard"
    if trial_end and trial_end > _now(now):
        return "trial"
    return "trial" if credit_mode(b, now) == "credits" else "standard"


def unlimited_until(b: dict | None) -> datetime | None:
    """Până când are cabinetul acces nelimitat (probă, acces gratuit sau abonament) — fără consum de credite."""
    b = b or {}
    dates = [t for t in (to_utc(b.get("trialEndsAt")), to_utc(b.get("compUntil")),
                         to_utc(b.get("subscriptionAccessUntil")), to_utc(b.get("manualUntil"))) if t]
    return max(dates) if dates else None


def finalize(b: dict, now: datetime | None = None) -> dict:
    """Recalculează `accessUntil` și statusul afișat din componente. Singurul loc care scrie `accessUntil`."""
    now = _now(now)
    trial_end = to_utc(b.get("trialEndsAt"))
    comp_until = to_utc(b.get("compUntil"))
    manual_until = to_utc(b.get("manualUntil"))
    credits_until = credits_access_until(b)
    candidates = [t for t in (unlimited_until(b), credits_until) if t]
    out = dict(b)
    out["schema"] = SCHEMA
    out["accessUntil"] = max(candidates) if candidates else EPOCH
    sub_status = b.get("subscriptionStatus")
    if sub_status in LIVE_SUB_STATUSES:
        status = "trialing" if sub_status == "trialing" else sub_status
    elif manual_until and manual_until > now:
        status = "manual"
    elif comp_until and comp_until > now:
        status = "comp"
    elif trial_end and trial_end > now:
        status = "trialing"
    elif credits_until and credits_until > now:
        status = "credits"
    elif sub_status == "canceled":
        status = "canceled"
    elif trial_end or comp_until or manual_until or sub_status or b.get("credits"):
        status = "expired"
    else:
        status = "none"
    out["status"] = status
    out["syncedAt"] = now
    return out


def _empty() -> dict:
    return {
        "plan": "standard", "interval": None,
        "trialEndsAt": None, "compUntil": None, "compReason": None, "manualUntil": None,
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


def set_manual(prev: dict | None, until: datetime | None, now: datetime | None = None) -> dict:
    """Abonament plătit manual (transfer, numerar), înregistrat de super admin: acces până la `until`, calculat din
    încasările manuale neanulate (vezi billing_manual.py). None = fără abonament manual."""
    b = {**_empty(), **(prev or {})}
    b["manualUntil"] = to_utc(until)
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
    """Zilele gratuite rămase (probă, acces gratuit dat de super-admin sau abonament plătit manual) se păstrează la
    abonare: prima
    plată vine la sfârșitul lor, doar dacă mai sunt cel puțin 48h; altfel plata se încasează imediat.
    Plafonat la limita Stripe pentru `trial_end` (730 de zile). Secunde Unix, cum le cere Stripe."""
    b = (ws or {}).get("billing") or {}
    now = _now(now)
    free_until = max((d for d in (to_utc(b.get("trialEndsAt")), to_utc(b.get("compUntil")),
                                  to_utc(b.get("manualUntil"))) if d), default=None)
    if free_until and free_until - now >= MIN_TRIAL_CARRY:
        return int(min(free_until, now + MAX_TRIAL_CARRY).timestamp())
    return None


# ── Credite ──────────────────────────────────────────────────────────────────
# Rezumatul din `billing.credits` (scris doar de server): `lots` = pachetele cu sold, `coveredUntil` = sfârșitul
# celei mai târzii ferestre de firmă deschise. Accesul pe credite ține până la expirarea ultimului pachet cu sold
# sau până la sfârșitul ultimei ferestre: expirarea unui pachet mai vechi nu schimbă maximul, deci trecerea
# timpului nu cere nicio scriere. Soldul se calculează mereu doar din pachetele încă valabile.

def _lots(b: dict | None) -> list[dict]:
    return list(((b or {}).get("credits") or {}).get("lots") or [])


def live_lots(b: dict | None, now: datetime | None = None) -> list[dict]:
    """Pachetele cu sold, încă valabile, în ordinea consumului (cel care expiră primul, primul)."""
    now = _now(now)
    lots = [lot for lot in _lots(b) if lot.get("remaining", 0) > 0 and (to_utc(lot.get("expiresAt")) or EPOCH) > now]
    return sorted(lots, key=lambda lot: to_utc(lot["expiresAt"]))


def credit_balance(b: dict | None, now: datetime | None = None) -> int:
    return sum(int(lot["remaining"]) for lot in live_lots(b, now))


def covered_until(b: dict | None) -> datetime | None:
    return to_utc(((b or {}).get("credits") or {}).get("coveredUntil"))


def credits_access_until(b: dict | None) -> datetime | None:
    dates = [to_utc(lot.get("expiresAt")) for lot in _lots(b) if lot.get("remaining", 0) > 0]
    dates.append(covered_until(b))
    dates = [d for d in dates if d]
    return max(dates) if dates else None


def credit_mode(b: dict | None, now: datetime | None = None) -> str:
    """'unlimited' (probă / gratuit / abonament: nu se consumă credite), 'credits' sau 'none'."""
    now = _now(now)
    if (unlimited_until(b) or EPOCH) > now:
        return "unlimited"
    if credit_balance(b, now) > 0 or (covered_until(b) or EPOCH) > now:
        return "credits"
    return "none"


def _with_lots(prev: dict | None, lots: list[dict], now: datetime, covered: datetime | None = None) -> dict:
    b = {**_empty(), **(prev or {})}
    keep = [lot for lot in lots if lot.get("remaining", 0) > 0 and (to_utc(lot.get("expiresAt")) or EPOCH) > now]
    cov = max((d for d in (covered_until(prev), to_utc(covered)) if d), default=None)
    b["credits"] = {"lots": sorted(keep, key=lambda lot: to_utc(lot["expiresAt"])), "coveredUntil": cov}
    return finalize(b, now)


def add_credits(prev: dict | None, lot_id: str, amount: int, expires_at: datetime,
                now: datetime | None = None) -> dict:
    """Pachet nou (cumpărat sau acordat de super admin). Idempotent după `lot_id`."""
    now = _now(now)
    lots = live_lots(prev, now)
    if not any(lot["id"] == lot_id for lot in _lots(prev)):
        lots.append({"id": lot_id, "remaining": int(amount), "expiresAt": to_utc(expires_at)})
    return _with_lots(prev, lots, now)


def consume_credit(prev: dict | None, covered: datetime, now: datetime | None = None) -> tuple[dict, str | None]:
    """Ia un credit din pachetul care expiră primul și deschide fereastra firmei până la `covered`.
    (billing neschimbat, None) dacă nu mai există credite valabile."""
    now = _now(now)
    lots = [dict(lot) for lot in live_lots(prev, now)]
    if not lots:
        return prev or {}, None
    lots[0]["remaining"] = int(lots[0]["remaining"]) - 1
    return _with_lots(prev, lots, now, covered), lots[0]["id"]


def remove_credits(prev: dict | None, amount: int, now: datetime | None = None) -> dict | None:
    """Ajustare negativă (ex. după o rambursare): scade din pachetele care expiră ultimele (cel mai probabil
    cel rambursat). None dacă soldul nu ajunge."""
    now = _now(now)
    if credit_balance(prev, now) < amount:
        return None
    lots = [dict(lot) for lot in live_lots(prev, now)]
    left = amount
    for lot in reversed(lots):
        take = min(left, int(lot["remaining"]))
        lot["remaining"] = int(lot["remaining"]) - take
        left -= take
        if not left:
            break
    return _with_lots(prev, lots, now)


def remove_lot(prev: dict | None, lot_id: str, now: datetime | None = None) -> tuple[dict, int]:
    """Scoate creditele rămase dintr-un pachet anume (ex. o vânzare manuală anulată). Întoarce (billing, câte s-au
    scos); creditele deja consumate din el rămân consumate."""
    now = _now(now)
    lots = [dict(lot) for lot in live_lots(prev, now)]
    removed = 0
    for lot in lots:
        if lot["id"] == lot_id:
            removed, lot["remaining"] = int(lot["remaining"]), 0
    return _with_lots(prev, lots, now), removed


def firm_key(cid: str, client: dict) -> str:
    """Identitatea firmei pentru fereastra de credit, calculată pe server din fișa clientului: CUI-ul, iar fără
    CUI (firmă în înființare, persoană fizică) clientul + denumirea. Schimbarea lor înseamnă altă firmă."""
    cui = normalize_cui(client.get("codFiscal") or "")
    if cui.isdigit():
        raw = f"cui|{cui}"
    else:
        name = re.sub(r"\s+", " ", str(client.get("denumire") or "")).strip().lower()
        raw = f"den|{cid}|{name}"
    return hashlib.sha256(raw.encode()).hexdigest()[:40]


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
