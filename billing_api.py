"""Abonamente prin Stripe: Checkout găzduit, Customer Portal, sincronizare și webhook.

Principii (vezi billing.py pentru starea propriu-zisă):
  • prețul îl alege serverul (clientul trimite doar intervalul lunar/anual);
  • orice eveniment Stripe declanșează recitirea abonamentului direct din Stripe, deci ordinea în care sosesc
    evenimentele nu contează; fiecare eveniment se procesează o singură dată (`stripeEvents/{id}`);
  • starea afișată în aplicație (`workspaces/{wid}.billing`) și datele interne (`billingAccounts/{wid}`:
    client Stripe, date de facturare, facturi) se scriu doar de aici; regulile Firestore le interzic din browser.

Webhook-ul rulează într-o funcție separată, ușoară (billing_webhook_app.py), dar ruta e înregistrată și în
aplicația principală pentru dezvoltare locală (`stripe listen --forward-to localhost:5001/billing/webhook`).
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

from firebase_admin import firestore
from flask import Blueprint, jsonify, request

import audit
import authz
import billing

bp = Blueprint("billing", __name__)
webhook_bp = Blueprint("billing_webhook", __name__)

# Aceeași versiune trebuie setată pe endpoint-ul de webhook din Stripe Dashboard (forma obiectelor diferă între versiuni).
STRIPE_API_VERSION = "2026-08-26.dahlia"
# Preț afișat (RON, preț final — furnizor neplătitor de TVA). Încasarea folosește prețurile din Stripe (PLANS).
DISPLAY_PRICES_RON = {"month": 200, "year": 2000}
# Statusuri care împiedică un Checkout nou (abonamentul se gestionează din portal).
_BLOCKING_SUB_STATUSES = ("trialing", "active", "past_due", "unpaid", "incomplete", "paused")
_EVENT_STALE = timedelta(minutes=5)
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")


class BillingUnavailable(RuntimeError):
    """Stripe nu e configurat (cheie sau prețuri lipsă) sau nu răspunde."""


def _err(code: str, status: int):
    return jsonify({"error": code}), status


def _body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


@bp.errorhandler(authz.AuthError)
def _handle_auth(e: authz.AuthError):
    return authz.error_response(e)


@bp.errorhandler(BillingUnavailable)
def _handle_unavailable(e: BillingUnavailable):
    print(f"[billing] indisponibil: {e}")
    return _err("billing_unavailable", 503)


# ── Stripe (singurele locuri care vorbesc cu API-ul; înlocuite în teste) ─────

def _stripe():
    import stripe
    key = os.getenv("STRIPE_SECRET_KEY")
    if not key:
        raise BillingUnavailable("STRIPE_SECRET_KEY lipsește")
    stripe.api_key = key
    stripe.api_version = STRIPE_API_VERSION
    return stripe


def _plain(obj) -> dict:
    return obj.to_dict() if hasattr(obj, "to_dict") else dict(obj)


def _call(fn, *args, **kwargs):
    import stripe
    try:
        return fn(*args, **kwargs)
    except stripe.StripeError as e:
        # Mesajul Stripe poate conține date de facturare: logăm doar tipul și codul.
        raise BillingUnavailable(f"{type(e).__name__} {getattr(e, 'code', '')}") from None


def stripe_customer_create(params: dict) -> dict:
    s = _stripe()
    return _plain(_call(s.Customer.create, **params))


def stripe_customer_update(customer_id: str, params: dict) -> None:
    s = _stripe()
    _call(s.Customer.modify, customer_id, **params)


def stripe_subscriptions(customer_id: str) -> list[dict]:
    s = _stripe()
    page = _call(s.Subscription.list, customer=customer_id, status="all", limit=20)
    return [_plain(x) for x in page.data]


def stripe_checkout_create(params: dict) -> dict:
    s = _stripe()
    return _plain(_call(s.checkout.Session.create, **params))


def stripe_checkout_retrieve(session_id: str) -> dict:
    s = _stripe()
    return _plain(_call(s.checkout.Session.retrieve, session_id))


def stripe_checkout_expire(session_id: str) -> None:
    s = _stripe()
    _call(s.checkout.Session.expire, session_id)


def stripe_portal_create(params: dict) -> dict:
    s = _stripe()
    return _plain(_call(s.billing_portal.Session.create, **params))


def stripe_subscription_cancel(sub_id: str) -> None:
    s = _stripe()
    _call(s.Subscription.cancel, sub_id)


def stripe_subscription_update(sub_id: str, params: dict) -> None:
    s = _stripe()
    _call(s.Subscription.modify, sub_id, **params)


def stripe_construct_event(payload: bytes, signature: str) -> dict:
    s = _stripe()
    secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    if not secret:
        raise BillingUnavailable("STRIPE_WEBHOOK_SECRET lipsește")
    return _plain(s.Webhook.construct_event(payload, signature, secret))


# ── Firestore ────────────────────────────────────────────────────────────────

def _ws_ref(wid: str):
    return authz.db().collection("workspaces").document(wid)


def _acct_ref(wid: str):
    return authz.db().collection("billingAccounts").document(wid)


def _account(wid: str) -> dict:
    snap = _acct_ref(wid).get()
    return (snap.to_dict() or {}) if snap.exists else {}


def _wid_for_customer(customer_id: str | None) -> str | None:
    if not customer_id:
        return None
    docs = list(authz.db().collection("billingAccounts")
                .where("stripeCustomerId", "==", customer_id).limit(1).stream())
    return docs[0].id if docs else None


def _iso(v):
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat()
    return v


def serialize_billing(b: dict | None) -> dict:
    return {k: _iso(v) for k, v in (b or {}).items()}


def _app_base_url() -> str:
    base = os.getenv("APP_BASE_URL") or next(
        (o.strip() for o in os.getenv("FRONTEND_ORIGIN", "").split(",") if o.strip()), "")
    if not base:
        raise BillingUnavailable("APP_BASE_URL lipsește")
    return base.rstrip("/")


# ── Sincronizare (comună webhook-ului, /billing/sync și acțiunilor de super admin) ──

def _pick_subscription(subs: list[dict], wid: str) -> tuple[dict | None, list[dict]]:
    """Abonamentul care contează pentru cabinet + duplicatele vii (două ferestre de Checkout plătite)."""
    own = [s for s in subs if (s.get("metadata") or {}).get("workspaceId") in (None, "", wid)]
    live = sorted((s for s in own if s.get("status") in billing.LIVE_SUB_STATUSES), key=lambda s: s.get("created") or 0)
    if live:
        return live[0], live[1:]
    rest = sorted(own, key=lambda s: s.get("created") or 0)
    return (rest[-1] if rest else None), []


def sync_subscription(wid: str, customer_id: str | None = None, actor: str = "stripe") -> dict:
    """Recitește abonamentele clientului Stripe și rescrie `workspaces/{wid}.billing`. Idempotent."""
    acct = _account(wid)
    customer_id = customer_id or acct.get("stripeCustomerId")
    sub, duplicates = (None, [])
    if customer_id:
        sub, duplicates = _pick_subscription(stripe_subscriptions(customer_id), wid)
    for dup in duplicates:
        # Plată dublă (ex. Checkout deschis în două ferestre): păstrăm cel mai vechi abonament. Rambursarea
        # primei plăți a duplicatului se face manual din Stripe Dashboard (alertă în jurnal).
        try:
            stripe_subscription_cancel(dup["id"])
        except BillingUnavailable:
            continue                                   # deja anulat de o sincronizare concurentă
        audit.log(wid, actor, "billing.duplicate_canceled", dup["id"])
        print(f"[billing] ALERTĂ: abonament duplicat anulat pentru {wid}; verificați rambursarea în Stripe")

    db = authz.db()
    ws_ref, acct_ref = _ws_ref(wid), _acct_ref(wid)

    @firestore.transactional
    def run(txn):
        snap = ws_ref.get(transaction=txn)
        if not snap.exists:
            return None
        new = billing.with_subscription((snap.to_dict() or {}).get("billing"), sub)
        txn.update(ws_ref, {"billing": new})
        acct_update = {"stripeSubscriptionId": sub.get("id") if sub else None,
                       "stripePriceId": billing.subscription_price(sub) if sub else None,
                       "syncedAt": firestore.SERVER_TIMESTAMP}
        if customer_id:
            acct_update["stripeCustomerId"] = customer_id
        txn.set(acct_ref, acct_update, merge=True)
        return new

    new = run(db.transaction())
    if sub and billing.plan_for_price(billing.subscription_price(sub)) is None:
        print(f"[billing] ALERTĂ: abonament {sub.get('id')} cu preț necunoscut pentru {wid} — fără acces")
    return new or {}


# ── Date de facturare ───────────────────────────────────────────────────────

_DETAIL_FIELDS = {"denumire": 200, "regCom": 40, "adresa": 300, "localitate": 100, "judet": 100, "email": 254}


def _clean_details(raw: dict) -> tuple[dict | None, str | None]:
    tip = raw.get("tip")
    if tip not in ("PJ", "PF"):
        return None, "invalid_tip"
    out = {"tip": tip, "tara": "RO"}
    for k, maxlen in _DETAIL_FIELDS.items():
        v = str(raw.get(k) or "").strip()
        if len(v) > maxlen:
            return None, f"invalid_{k}"
        out[k] = v
    for k in ("denumire", "adresa", "localitate", "judet", "email"):
        if not out[k]:
            return None, f"missing_{k}"
    if not _EMAIL_RE.match(out["email"]):
        return None, "invalid_email"
    cui = billing.normalize_cui(raw.get("cui") or "")
    if tip == "PJ" and not billing.valid_cui(cui):
        return None, "invalid_cui"
    out["cui"] = cui if tip == "PJ" else ""
    return out, None


def details_complete(details: dict | None) -> bool:
    return bool(details) and _clean_details(details)[1] is None


def _customer_params(details: dict) -> dict:
    return {
        "name": details["denumire"], "email": details["email"],
        "address": {"line1": details["adresa"][:200], "city": details["localitate"],
                    "state": details["judet"], "country": "RO"},
        "preferred_locales": ["ro"],
    }


@bp.get("/billing")
def get_billing():
    _principal, wid, ws = authz.require_from_header("admin")
    acct = _account(wid)
    return jsonify({
        "billing": serialize_billing(ws.get("billing")),
        "details": acct.get("details"),
        "hasCustomer": bool(acct.get("stripeCustomerId")),
        "prices": DISPLAY_PRICES_RON,
    })


@bp.put("/billing/details")
def put_details():
    principal, wid, _ws = authz.require_from_header("admin")
    details, error = _clean_details(_body())
    if error:
        return _err(error, 400)
    acct_ref = _acct_ref(wid)
    acct = _account(wid)
    update = {"details": details, "detailsUpdatedAt": firestore.SERVER_TIMESTAMP, "detailsUpdatedBy": principal.uid}
    if details["cui"]:
        # Semnal pentru super admin (nu blochează): același CUI a mai avut o perioadă de probă în alt cabinet.
        claim_ref = authz.db().collection("trialClaims").document(billing.claim_id("cui", details["cui"]))
        claim = claim_ref.get()
        if not claim.exists:
            claim_ref.set({"kind": "cui", "workspaceId": wid, "claimedAt": firestore.SERVER_TIMESTAMP})
        elif (claim.to_dict() or {}).get("workspaceId") != wid:
            update["cuiSeenInWorkspace"] = (claim.to_dict() or {}).get("workspaceId")
    acct_ref.set(update, merge=True)
    if acct.get("stripeCustomerId"):
        stripe_customer_update(acct["stripeCustomerId"], _customer_params(details))
    audit.log(wid, principal.uid, "billing.details_update", wid, {"tip": details["tip"]})
    return jsonify({"details": details})


# ── Checkout / Portal / Sync ────────────────────────────────────────────────

@bp.post("/billing/checkout")
def create_checkout():
    principal, wid, ws = authz.require_from_header("admin")
    interval = _body().get("interval")
    if interval not in billing.INTERVALS:
        return _err("invalid_interval", 400)
    plan = (ws.get("billing") or {}).get("plan") or "standard"
    price = billing.price_id(plan, interval)
    if not price:
        raise BillingUnavailable(f"prețul {plan}/{interval} lipsește din env")
    acct = _account(wid)
    if not details_complete(acct.get("details")):
        return _err("billing_details_required", 400)
    base = _app_base_url()

    customer_id = acct.get("stripeCustomerId")
    if not customer_id:
        customer = stripe_customer_create({**_customer_params(acct["details"]), "metadata": {"workspaceId": wid}})
        customer_id = customer["id"]
        _acct_ref(wid).set({"stripeCustomerId": customer_id}, merge=True)
    elif any(s.get("status") in _BLOCKING_SUB_STATUSES for s in stripe_subscriptions(customer_id)):
        return _err("subscription_exists", 409)

    pending = acct.get("pendingCheckout") or {}
    if pending.get("sessionId") and billing.to_utc(pending.get("expiresAt")) and \
            billing.to_utc(pending["expiresAt"]) > datetime.now(timezone.utc):
        try:
            stripe_checkout_expire(pending["sessionId"])          # o singură sesiune deschisă per cabinet
        except BillingUnavailable:
            pass                                                   # deja finalizată sau expirată

    sub_data: dict = {"metadata": {"workspaceId": wid}}
    trial_end = billing.trial_end_for_checkout(ws)
    if trial_end:
        sub_data["trial_end"] = trial_end
    session = stripe_checkout_create({
        "mode": "subscription",
        "customer": customer_id,
        "client_reference_id": wid,
        "line_items": [{"price": price, "quantity": 1}],
        "subscription_data": sub_data,
        "metadata": {"workspaceId": wid},
        "allow_promotion_codes": True,
        "locale": "ro",
        "success_url": f"{base}/abonament?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/abonament?checkout=cancel",
    })
    _acct_ref(wid).set({"pendingCheckout": {
        "sessionId": session["id"], "expiresAt": billing.to_utc(session.get("expires_at")),
    }}, merge=True)
    audit.log(wid, principal.uid, "billing.checkout_start", wid,
              {"interval": interval, "trialCarry": bool(trial_end)})
    return jsonify({"url": session["url"]})


@bp.post("/billing/portal")
def create_portal():
    principal, wid, _ws = authz.require_from_header("admin")
    customer_id = _account(wid).get("stripeCustomerId")
    if not customer_id:
        return _err("no_customer", 409)
    session = stripe_portal_create({"customer": customer_id, "return_url": f"{_app_base_url()}/abonament",
                                    "locale": "ro"})
    audit.log(wid, principal.uid, "billing.portal_open", wid)
    return jsonify({"url": session["url"]})


@bp.post("/billing/sync")
def sync():
    """Recitește starea din Stripe (după întoarcerea din Checkout sau dacă un webhook s-a pierdut)."""
    principal, wid, _ws = authz.require_from_header("viewer", limit="billing_sync")
    customer_id = None
    session_id = _body().get("sessionId")
    if session_id:
        if not isinstance(session_id, str) or not re.fullmatch(r"cs_[A-Za-z0-9_]{1,250}", session_id):
            return _err("invalid_session", 400)
        session = stripe_checkout_retrieve(session_id)
        if session.get("client_reference_id") != wid:       # sesiunea altui cabinet: nu o atingem
            return _err("invalid_session", 400)
        customer_id = session.get("customer")
        _acct_ref(wid).set({"pendingCheckout": None}, merge=True)
    new = sync_subscription(wid, customer_id, actor=principal.uid)
    return jsonify({"billing": serialize_billing(new)})


# ── Webhook ──────────────────────────────────────────────────────────────────

def _event_wid(obj: dict, kind: str) -> tuple[str | None, str | None]:
    """(workspaceId, customerId) pentru obiectul evenimentului."""
    customer = obj.get("customer")
    if isinstance(customer, dict):
        customer = customer.get("id")
    wid = (obj.get("metadata") or {}).get("workspaceId")
    if kind == "checkout":
        wid = obj.get("client_reference_id") or wid
    if kind == "invoice" and not wid:
        details = ((obj.get("parent") or {}).get("subscription_details") or {})
        wid = (details.get("metadata") or {}).get("workspaceId")
    if wid and not authz.valid_wid(wid):
        wid = None
    return wid or _wid_for_customer(customer), customer


def _record_invoice(wid: str, inv: dict) -> None:
    """Factură plătită: o păstrăm pentru emiterea facturii fiscale (SmartBill). Statusul SmartBill nu se
    rescrie niciodată de aici, ca o retrimitere a evenimentului să nu provoace o a doua emitere."""
    ref = _acct_ref(wid).collection("invoices").document(inv["id"])
    lines = ((inv.get("lines") or {}).get("data") or [])
    period = (lines[0].get("period") or {}) if lines else {}
    paid_at = (inv.get("status_transitions") or {}).get("paid_at")
    data = {
        "amount": inv.get("amount_paid", 0), "currency": inv.get("currency"),
        "periodStart": billing.to_utc(period.get("start") or inv.get("period_start")),
        "periodEnd": billing.to_utc(period.get("end") or inv.get("period_end")),
        "paidAt": billing.to_utc(paid_at), "stripeNumber": inv.get("number"),
    }

    @firestore.transactional
    def run(txn):
        snap = ref.get(transaction=txn)
        if snap.exists:
            txn.update(ref, data)
        else:
            txn.set(ref, {**data, "smartbill": {"status": "pending" if data["amount"] > 0 else "skipped",
                                                "attempts": 0}})

    run(authz.db().transaction())


def process_event(event: dict) -> str | None:
    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    if etype == "checkout.session.completed":
        wid, customer = _event_wid(obj, "checkout")
        if wid:
            _acct_ref(wid).set({"pendingCheckout": None}, merge=True)
            sync_subscription(wid, customer)
        return wid
    if etype.startswith("customer.subscription."):
        wid, customer = _event_wid(obj, "subscription")
        if wid:
            sync_subscription(wid, customer)
        return wid
    if etype in ("invoice.paid", "invoice.payment_failed"):
        wid, customer = _event_wid(obj, "invoice")
        if wid:
            if etype == "invoice.paid":
                _record_invoice(wid, obj)
            else:
                audit.log(wid, "stripe", "billing.payment_failed", obj.get("id"))
            sync_subscription(wid, customer)
        return wid
    if etype in ("charge.refunded", "charge.dispute.created"):
        wid, _customer = _event_wid(obj, "charge")
        print(f"[billing] ALERTĂ: {etype} pentru {wid or 'cabinet necunoscut'} — storno/verificare manuală")
        if wid:
            audit.log(wid, "stripe", f"billing.{etype.split('.', 1)[1].replace('.', '_')}", obj.get("id"))
        return wid
    return None


@webhook_bp.post("/billing/webhook")
def webhook():
    payload = request.get_data()                      # corpul brut, înainte de orice parsare (semnătura)
    try:
        event = stripe_construct_event(payload, request.headers.get("Stripe-Signature", ""))
    except BillingUnavailable as e:
        print(f"[billing] webhook indisponibil: {e}")
        return _err("billing_unavailable", 503)
    except Exception as e:  # noqa: BLE001 — semnătură invalidă sau corp corupt
        print(f"[billing] webhook respins ({type(e).__name__})")
        return _err("invalid_signature", 400)

    db = authz.db()
    ref = db.collection("stripeEvents").document(str(event.get("id", "")))
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def claim(txn):
        snap = ref.get(transaction=txn)
        if snap.exists:
            prev = snap.to_dict() or {}
            if prev.get("status") == "done":
                return "done"
            started = billing.to_utc(prev.get("startedAt"))
            if prev.get("status") == "processing" and started and now - started < _EVENT_STALE:
                return "busy"
        txn.set(ref, {"type": event.get("type"), "status": "processing", "startedAt": now,
                      "expireAt": now + timedelta(days=60)}, merge=True)
        return "claimed"

    state = claim(db.transaction())
    if state == "done":
        return jsonify({"ok": True, "duplicate": True})
    if state == "busy":
        return _err("in_progress", 409)               # Stripe reîncearcă mai târziu
    try:
        wid = process_event(event)
    except Exception as e:  # noqa: BLE001 — Stripe reîncearcă; eroarea rămâne vizibilă în log
        print(f"[billing] eveniment {event.get('type')} eșuat ({type(e).__name__})")
        ref.set({"status": "failed", "error": type(e).__name__}, merge=True)
        return _err("processing_failed", 500)
    ref.set({"status": "done", "workspaceId": wid, "doneAt": firestore.SERVER_TIMESTAMP}, merge=True)
    return jsonify({"ok": True})


# ── Super admin ──────────────────────────────────────────────────────────────

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _end_of_day_ro(day: str) -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.fromisoformat(day).replace(hour=23, minute=59, second=59, tzinfo=ZoneInfo("Europe/Bucharest"))


def _update_billing(wid: str, change) -> dict | None:
    """Aplică `change(prev_billing) -> billing nou` în tranzacție. None dacă cabinetul nu există."""
    ref = _ws_ref(wid)

    @firestore.transactional
    def run(txn):
        snap = ref.get(transaction=txn)
        if not snap.exists:
            return None
        new = change((snap.to_dict() or {}).get("billing"))
        txn.update(ref, {"billing": new})
        return new

    return run(authz.db().transaction())


@bp.get("/admin/billing/overview")
def admin_overview():
    """Starea abonamentelor tuturor cabinetelor + semnale (CUI refolosit, facturi SmartBill cu eroare)."""
    authz.require_super_admin()
    db = authz.db()
    accounts = {d.id: (d.to_dict() or {}) for d in db.collection("billingAccounts").limit(1000).stream()}
    out = []
    for d in db.collection("workspaces").limit(1000).stream():
        ws = d.to_dict() or {}
        acct = accounts.get(d.id, {})
        out.append({
            "id": d.id, "name": ws.get("name", ""),
            "billing": serialize_billing(ws.get("billing")),
            "hasCustomer": bool(acct.get("stripeCustomerId")),
            "cuiSeenInWorkspace": acct.get("cuiSeenInWorkspace"),
        })
    return jsonify(out)


@bp.post("/admin/workspaces/<wid>/billing/extend-trial")
def admin_extend_trial(wid: str):
    principal = authz.require_super_admin()
    days = _body().get("days")
    if not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= 365:
        return _err("invalid_days", 400)
    if not authz.valid_wid(wid):
        return _err("not_found", 404)
    new = _update_billing(wid, lambda prev: billing.extend_trial(prev, days))
    if new is None:
        return _err("not_found", 404)
    sub_id = _account(wid).get("stripeSubscriptionId")
    if sub_id and new.get("subscriptionStatus") == "trialing":
        # Abonat deja în perioada de probă: mutăm și prima plată, altfel Stripe încasează la vechea dată.
        # Nu aducem plata înaintea sfârșitului unei gratuități care a amânat-o deja.
        target = max(d for d in (new["trialEndsAt"], billing.to_utc(new.get("compUntil"))) if d)
        stripe_subscription_update(sub_id, {"trial_end": int(target.timestamp()), "proration_behavior": "none"})
    audit.log(wid, principal.uid, "billing.trial_extend", wid, {"days": days})
    return jsonify({"billing": serialize_billing(new)})


@bp.post("/admin/workspaces/<wid>/billing/comp")
def admin_comp(wid: str):
    """Acces gratuit până la o dată (sfârșitul zilei, ora României); `until: null` îl retrage."""
    principal = authz.require_super_admin()
    body = _body()
    until_raw, reason = body.get("until"), str(body.get("reason") or "").strip()[:120]
    if until_raw is not None and (not isinstance(until_raw, str) or not _DATE_RE.match(until_raw)):
        return _err("invalid_until", 400)
    if not authz.valid_wid(wid):
        return _err("not_found", 404)
    try:
        until = _end_of_day_ro(until_raw) if until_raw else None
    except ValueError:                                      # ex. 2026-02-31
        return _err("invalid_until", 400)
    ws = authz.load_workspace(wid)
    if ws is None:
        return _err("not_found", 404)
    b = ws.get("billing") or {}
    acct = _account(wid)
    sub_id = acct.get("stripeSubscriptionId")
    period_end = billing.to_utc(b.get("currentPeriodEnd"))
    deferred = False
    if (until and sub_id and b.get("subscriptionStatus") in ("active", "trialing") and not b.get("cancelAtPeriodEnd")
            and period_end and until > period_end):
        # Abonat care s-ar reînnoi în timpul gratuității: mutăm următoarea plată la sfârșitul ei (trial Stripe, fără
        # proration). Nu folosim pause_collection: perioadele ar avansa cu facturi anulate, iar accesul calculat din
        # perioadă ar depăși gratuitatea (la anual, cu până la un an). Dacă perioada plătită acoperă deja gratuitatea,
        # nu atingem Stripe. Întâi Stripe, apoi Firestore.
        stripe_subscription_update(sub_id, {"trial_end": int(until.timestamp()), "proration_behavior": "none"})
        deferred = True
    elif not until and acct.get("compDeferredBilling") and sub_id and b.get("subscriptionStatus") == "trialing":
        # Gratuitate retrasă: plata amânată revine la sfârșitul probei inițiale, sau acum dacă proba a trecut.
        trial_end = billing.to_utc(b.get("trialEndsAt"))
        resume = int(trial_end.timestamp()) if trial_end and trial_end > datetime.now(timezone.utc) + timedelta(hours=1) else "now"
        stripe_subscription_update(sub_id, {"trial_end": resume, "proration_behavior": "none"})
    if deferred or not until:
        _acct_ref(wid).set({"compDeferredBilling": deferred}, merge=True)
    new = _update_billing(wid, lambda prev: billing.set_comp(prev, until, reason or "manual"))
    audit.log(wid, principal.uid, "billing.comp_set" if until else "billing.comp_revoke", wid,
              {"until": until_raw, "billingDeferred": deferred} if until else {})
    return jsonify({"billing": serialize_billing(new)})


@bp.post("/admin/workspaces/<wid>/billing/sync")
def admin_sync(wid: str):
    principal = authz.require_super_admin()
    if authz.load_workspace(wid) is None:
        return _err("not_found", 404)
    new = sync_subscription(wid, actor=principal.uid)
    audit.log(wid, principal.uid, "billing.admin_sync", wid)
    return jsonify({"billing": serialize_billing(new)})
