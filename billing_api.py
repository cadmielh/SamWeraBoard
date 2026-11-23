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
import superadmin_alerte
import billing
import billing_credits
import billing_manual

bp = Blueprint("billing", __name__)
webhook_bp = Blueprint("billing_webhook", __name__)

# Aceeași versiune trebuie setată pe endpoint-ul de webhook din Stripe Dashboard (forma obiectelor diferă între versiuni).
STRIPE_API_VERSION = "2026-08-26.dahlia"
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


@bp.errorhandler(billing_credits.ClientNotFound)
def _handle_no_client(_e):
    return _err("client_required", 400)


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


def stripe_payment_fee(payment_intent_id: str) -> dict | None:
    """Brut, comision și net din tranzacția de sold a plății. Cere cheii drept de citire pe PaymentIntents, Charges și
    Balance (balance transactions); fără el, Stripe răspunde cu eroare de permisiune (BillingUnavailable)."""
    s = _stripe()
    pi = _plain(_call(s.PaymentIntent.retrieve, payment_intent_id, expand=["latest_charge.balance_transaction"]))
    bt = ((pi.get("latest_charge") or {}) if isinstance(pi.get("latest_charge"), dict) else {}).get("balance_transaction")
    if not isinstance(bt, dict):
        return None
    details = [{"type": f.get("type"), "amount": f.get("amount", 0), "description": f.get("description")}
               for f in (bt.get("fee_details") or [])]
    return {"amount": bt.get("amount", 0), "fee": bt.get("fee", 0), "net": bt.get("net", 0), "currency": bt.get("currency"),
            "details": details}


def stripe_invoice_payment_intent(invoice_id: str) -> str | None:
    """PaymentIntent-ul care a plătit o factură de abonament (din API basil, prin InvoicePayment). Cere drept de citire pe Invoices."""
    s = _stripe()
    page = _call(s.InvoicePayment.list, invoice=invoice_id, limit=5)
    for p in page.data:
        p = _plain(p)
        pi = (p.get("payment") or {}).get("payment_intent")
        if p.get("status") == "paid" and pi:
            return pi if isinstance(pi, str) else pi.get("id")
    return None


def stripe_account_fees(since: datetime | None, until: datetime | None) -> list[dict]:
    """Comisioanele Stripe care nu țin de o plată anume: Stripe Billing (reținut periodic din sold) și taxele pentru
    dispute. Din tranzacțiile de sold; cere drept de citire pe Balance."""
    s = _stripe()
    created = {k: int(v.timestamp()) for k, v in (("gte", since), ("lt", until)) if v}
    out = []
    for kind in ("stripe_fee", "adjustment"):
        params = {"type": kind, "limit": 100, **({"created": created} if created else {})}
        page = _call(s.BalanceTransaction.list, **params)
        for bt in _call(lambda: list(page.auto_paging_iter())[:2000]):
            bt = _plain(bt)
            if kind == "stripe_fee":
                cost, category = -bt.get("amount", 0), "billing" if "billing" in (bt.get("description") or "").lower() else "stripe"
            elif bt.get("reporting_category") == "dispute" and bt.get("fee"):
                cost, category = bt["fee"], "dispute"
            else:
                continue
            out.append({"id": bt.get("id"), "at": bt.get("created"), "category": category, "amount": cost,
                        "currency": bt.get("currency"), "description": bt.get("description")})
    return out


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
    if isinstance(v, dict):
        return {k: _iso(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_iso(x) for x in v]
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
    """Vânzare exclusiv către profesioniști (PJ, PFA, II, IF): CUI valid și confirmarea expresă că achiziția se face
    în scopul activității profesionale. Fără ele nu se poate plăti (regulile pentru consumatori nu se aplică)."""
    tip = raw.get("tip", "PJ")
    if tip == "PF":
        return None, "business_only"
    if tip != "PJ":
        return None, "invalid_tip"
    if raw.get("professional") is not True:
        return None, "professional_required"
    out = {"tip": "PJ", "tara": "RO", "professional": True}
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
    if not billing.valid_cui(cui):
        return None, "invalid_cui"
    out["cui"] = cui
    return out, None


def details_complete(details: dict | None) -> bool:
    return bool(details) and _clean_details(details)[1] is None


def _customer_params(details: dict) -> dict:
    # Tipul, CUI-ul și Nr. Reg. Com. ajung în metadate ca facturile manuale din SmartBill să se poată
    # emite doar din Stripe Dashboard. Un "" șterge cheia la update (o persoană fizică n-are CUI).
    return {
        "name": details["denumire"], "email": details["email"],
        "address": {"line1": details["adresa"][:200], "city": details["localitate"],
                    "state": details["judet"], "country": "RO"},
        "preferred_locales": ["ro"],
        "metadata": {"tip": details.get("tip") or "", "cui": details.get("cui") or "",
                     "regCom": details.get("regCom") or ""},
    }


@bp.get("/billing")
def get_billing():
    _principal, wid, ws = authz.require_from_header("admin")
    acct = _account(wid)
    return jsonify({
        "billing": serialize_billing(ws.get("billing")),
        "details": acct.get("details"),
        "hasCustomer": bool(acct.get("stripeCustomerId")),
        **_price_info(),
    })


def _price_info() -> dict:
    """Prețurile afișate (RON, preț final — furnizor neplătitor de TVA); încasarea folosește prețurile din Stripe.
    `nextPrices`: generația care urmează, cât timp prețul curent e garantat celor care se abonează acum."""
    now = datetime.now(timezone.utc)
    upcoming = now < billing.PRICE_V2_FROM
    return {
        "prices": billing.display_prices(now=now),
        "nextPrices": billing.display_prices(now=billing.PRICE_V2_FROM) if upcoming else None,
        "nextPricesFrom": _iso(billing.PRICE_V2_FROM) if upcoming else None,
        "packs": billing.display_packs(now),
        "nextPacks": billing.display_packs(billing.PRICE_V2_FROM) if upcoming else None,
    }


@bp.put("/billing/details")
def put_details():
    principal, wid, _ws = authz.require_from_header("admin")
    details, error = _clean_details(_body())
    if error:
        return _err(error, 400)
    acct_ref = _acct_ref(wid)
    acct = _account(wid)
    # Confirmarea de profesionist se salvează la fiecare salvare a datelor, ca dovadă (cine și când).
    update = {"details": details, "detailsUpdatedAt": firestore.SERVER_TIMESTAMP, "detailsUpdatedBy": principal.uid,
              "professionalConfirmedAt": firestore.SERVER_TIMESTAMP, "professionalConfirmedBy": principal.uid}
    if details["cui"]:
        # Semnal pentru super admin (nu blochează): același CUI a mai avut o perioadă de probă în alt cabinet.
        claim_ref = authz.db().collection("trialClaims").document(billing.claim_id("cui", details["cui"]))
        claim = claim_ref.get()
        if not claim.exists:
            claim_ref.set({"kind": "cui", "workspaceId": wid, "claimedAt": firestore.SERVER_TIMESTAMP})
        elif (claim.to_dict() or {}).get("workspaceId") != wid:
            update["cuiSeenInWorkspace"] = (claim.to_dict() or {}).get("workspaceId")
            if acct.get("cuiSeenInWorkspace") != update["cuiSeenInWorkspace"]:
                superadmin_alerte.cui_refolosit(wid, update["cuiSeenInWorkspace"])
    acct_ref.set(update, merge=True)
    if acct.get("stripeCustomerId"):
        stripe_customer_update(acct["stripeCustomerId"], _customer_params(details))
    audit.log(wid, principal.uid, "billing.details_update", wid, {"tip": details["tip"]})
    return jsonify({"details": details})


# ── Checkout / Portal / Sync ────────────────────────────────────────────────

def _create_customer(wid: str, details: dict) -> str:
    params = _customer_params(details)
    meta = {k: v for k, v in params["metadata"].items() if v}
    customer = stripe_customer_create({**params, "metadata": {**meta, "workspaceId": wid}})
    _acct_ref(wid).set({"stripeCustomerId": customer["id"]}, merge=True)
    return customer["id"]


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
        customer_id = _create_customer(wid, acct["details"])
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
        # Bifa de acceptare a Termenilor; Stripe refuză sesiunea dacă URL-ul lor lipsește din Dashboard (Settings → Public details).
        "consent_collection": {"terms_of_service": "required"},
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
        if session.get("mode") == "payment":
            billing_credits.fulfill_purchase(session)
        else:
            _acct_ref(wid).set({"pendingCheckout": None}, merge=True)
    new = sync_subscription(wid, customer_id, actor=principal.uid)
    return jsonify({"billing": serialize_billing(new)})


# ── Credite ──────────────────────────────────────────────────────────────────

@bp.post("/billing/credits/checkout")
def credits_checkout():
    """Pachet de credite: Checkout cu plată unică. Pachetul îl alege clientul, prețul îl ia serverul din env."""
    principal, wid, ws = authz.require_from_header("admin")
    pack = _body().get("pack")
    if pack not in billing.CREDIT_PACKS:
        return _err("invalid_pack", 400)
    price = billing.pack_price_id(pack)
    if not price:
        raise BillingUnavailable(f"prețul pachetului {pack} lipsește din env")
    b = ws.get("billing") or {}
    if b.get("hasSubscription") and not b.get("cancelAtPeriodEnd"):
        # Abonament care se reînnoiește: e nelimitat, creditele n-ar avea rost. Unul anulat se încheie sigur, deci
        # creditele se pot lua dinainte (se consumă abia după încheierea lui; valabilitatea curge de la cumpărare).
        return _err("subscription_active", 409)
    acct = _account(wid)
    if not details_complete(acct.get("details")):
        return _err("billing_details_required", 400)
    base = _app_base_url()
    customer_id = acct.get("stripeCustomerId") or _create_customer(wid, acct["details"])
    meta = {"workspaceId": wid, "pack": pack}
    session = stripe_checkout_create({
        "mode": "payment",
        "customer": customer_id,
        "client_reference_id": wid,
        "line_items": [{"price": price, "quantity": 1}],
        "metadata": meta,
        # Pe plată (și pe charge) ca o rambursare sau o dispută să ajungă la cabinetul potrivit.
        "payment_intent_data": {"metadata": meta},
        "allow_promotion_codes": True,
        "consent_collection": {"terms_of_service": "required"},
        "locale": "ro",
        "success_url": f"{base}/abonament?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/abonament?checkout=cancel",
    })
    audit.log(wid, principal.uid, "billing.credits_checkout_start", wid, {"pack": pack})
    return jsonify({"url": session["url"]})


@bp.get("/billing/credits")
def get_credits():
    """Soldul, pachetele și istoricul (ultimele 100 de mișcări) — pentru admin."""
    _principal, wid, ws = authz.require_from_header("admin")
    b = ws.get("billing") or {}
    now = datetime.now(timezone.utc)
    return jsonify({
        "balance": billing.credit_balance(b, now),
        "lots": _iso(billing.live_lots(b, now)),
        "coveredUntil": _iso(billing.covered_until(b)),
        "mode": billing.credit_mode(b, now),
        "ledger": [_iso(e) for e in billing_credits.ledger(wid)],
    })


@bp.get("/billing/credits/quote")
def credits_quote():
    """Ce face generarea pentru un client: inclus în nelimitat, inclus în fereastra firmei, consumă 1 credit, sau nimic."""
    _principal, wid, ws = authz.require_from_header("member")
    cid = request.args.get("clientId") or None
    return jsonify(_iso(billing_credits.quote(wid, ws, cid)))


@bp.post("/billing/credits/consume")
def credits_consume():
    """Pentru documentele completate în browser (șabloane Google Docs): consumul se cere ÎNAINTE de copie."""
    principal, wid, _ws = authz.require_from_header("member", billing=True)
    body = _body()
    result = billing_credits.consume(wid, body.get("clientId"), principal.uid, str(body.get("template") or "gdoc"))
    return jsonify(_iso(result))


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
    line = lines[0] if lines else {}
    # Prețul liniei: din API basil e sub `pricing.price_details`, înainte direct sub `price`.
    price = (((line.get("pricing") or {}).get("price_details") or {}).get("price")) or ((line.get("price") or {}).get("id"))
    mapped = billing.plan_for_price(price if isinstance(price, str) else None)
    data = {
        "amount": inv.get("amount_paid", 0), "currency": inv.get("currency"),
        "interval": mapped[1] if mapped else None,
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


def _record_money_event(wid: str, etype: str, obj: dict) -> None:
    """Rambursări și dispute, pentru tabloul de încasări din super admin. Suma rambursată e cumulată pe charge
    (Stripe trimite totalul), deci documentul se suprascrie la fiecare rambursare parțială."""
    if etype == "charge.refunded":
        _acct_ref(wid).collection("refunds").document(obj["id"]).set({
            "amount": obj.get("amount", 0), "amountRefunded": obj.get("amount_refunded", 0),
            "currency": obj.get("currency"), "at": datetime.now(timezone.utc),
        }, merge=True)
    else:
        _acct_ref(wid).collection("disputes").document(obj["id"]).set({
            "amount": obj.get("amount", 0), "currency": obj.get("currency"), "reason": obj.get("reason"),
            "status": obj.get("status"), "charge": obj.get("charge"), "at": datetime.now(timezone.utc),
        }, merge=True)


def process_event(event: dict) -> str | None:
    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    if etype == "checkout.session.completed":
        wid, customer = _event_wid(obj, "checkout")
        if wid and obj.get("mode") == "payment":
            # Pachet de credite: recitim sesiunea din Stripe (plata confirmată), nu ne bazăm pe corpul evenimentului.
            billing_credits.fulfill_purchase(stripe_checkout_retrieve(obj["id"]))
            return wid
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
            _record_money_event(wid, etype, obj)
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
    # După procesare: notificarea pentru super admini (cheia = id-ul evenimentului, deci o reluare nu o dublează).
    superadmin_alerte.din_stripe(event, wid)
    return jsonify({"ok": True})


# ── Super admin ──────────────────────────────────────────────────────────────

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _start_of_day_ro(day: str) -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.fromisoformat(day).replace(tzinfo=ZoneInfo("Europe/Bucharest"))


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


_PAYMENT_KINDS = {"subscription": "invoices", "credits": "creditLots", "manual": "manualPayments"}
# Comisioanele se citesc din Stripe o singură dată pe plată și se păstrează în documentul ei; la o încărcare a tabloului
# se fac cel mult atâtea citiri noi (restul la următoarea), ca pagina să rămână rapidă.
_FEE_LOOKUPS_PER_LOAD = 25


def _fee_fields(doc, d: dict, amount: int, state: dict) -> dict:
    """Brut / comision / net pentru o încasare, din cache sau citite acum din Stripe. Plățile de 0 RON n-au comision."""
    if d.get("stripeFee"):
        f = d["stripeFee"]
        return {"gross": f.get("amount"), "fee": f.get("fee"), "net": f.get("net"), "feeCurrency": f.get("currency"),
                "feeDetails": f.get("details") or []}
    if not amount or state["unavailable"] or state["left"] <= 0:
        return {}
    state["left"] -= 1
    try:
        pi = d.get("paymentIntent")
        if not pi and doc.reference.parent.id == "invoices":
            pi = stripe_invoice_payment_intent(doc.id)
        elif not pi and doc.id.startswith("cs_"):
            # Pachet cumpărat înainte să păstrăm plata: id-ul pachetului e sesiunea Checkout, care o are.
            pi = stripe_checkout_retrieve(doc.id).get("payment_intent")
            pi = pi if isinstance(pi, str) else (pi or {}).get("id")
        fee = stripe_payment_fee(pi) if pi else None
    except BillingUnavailable as e:
        print(f"[billing] comisioanele Stripe nu se pot citi ({e}) — verificați permisiunile cheii")
        state["unavailable"] = True
        return {}
    if not fee:
        return {}
    doc.reference.set({"stripeFee": {**fee, "at": datetime.now(timezone.utc)}, "paymentIntent": pi}, merge=True)
    return {"gross": fee["amount"], "fee": fee["fee"], "net": fee["net"], "feeCurrency": fee["currency"],
            "feeDetails": fee.get("details") or []}


@bp.get("/admin/billing/payments")
def admin_payments():
    """Toate încasările (abonamente, pachete de credite), rambursările și disputele, cu datele de facturare și starea
    facturii emise manual. Filtrarea se face în pagină (volumul e mic); sursa e ce a primit webhook-ul de la Stripe."""
    authz.require_super_admin()
    db = authz.db()
    fee_lookups = {"left": _FEE_LOOKUPS_PER_LOAD, "unavailable": False}
    names = {d.id: (d.to_dict() or {}).get("name", "") for d in db.collection("workspaces").limit(2000).stream()}
    accounts = {d.id: (d.to_dict() or {}) for d in db.collection("billingAccounts").limit(2000).stream()}

    def base(doc, kind: str) -> dict:
        wid = doc.reference.parent.parent.id
        details = accounts.get(wid, {}).get("details") or {}
        return {"id": doc.id, "kind": kind, "workspaceId": wid, "workspaceName": names.get(wid, ""),
                "billingName": details.get("denumire", ""), "cui": details.get("cui", ""),
                "stripeCustomerId": accounts.get(wid, {}).get("stripeCustomerId")}

    rows = []
    for doc in db.collection_group("invoices").stream():
        d = doc.to_dict() or {}
        sb = d.get("smartbill") or {}
        rows.append({**base(doc, "subscription"), **_fee_fields(doc, d, d.get("amount", 0), fee_lookups), "at": _iso(d.get("paidAt")), "amount": d.get("amount", 0),
                     "currency": d.get("currency"), "interval": d.get("interval"),
                     "periodStart": _iso(d.get("periodStart")), "periodEnd": _iso(d.get("periodEnd")),
                     "stripeNumber": d.get("stripeNumber"),
                     "invoice": {"status": sb.get("status"), "number": sb.get("number"), "at": _iso(sb.get("issuedAt"))}})
    for doc in db.collection_group("creditLots").stream():
        d = doc.to_dict() or {}
        if d.get("source") != "purchase":
            continue                                        # creditele gratuite nu sunt încasări
        amount = d.get("amountPaid") or 0
        inv = d.get("invoice") or {}
        rows.append({**base(doc, "credits"), **_fee_fields(doc, d, d.get("amountPaid") or 0, fee_lookups), "at": _iso(d.get("createdAt")), "amount": amount, "currency": "ron",
                     "pack": d.get("pack"), "credits": d.get("amount"),
                     "invoice": {"status": inv.get("status") or ("pending" if amount > 0 else "skipped"),
                                 "number": inv.get("number"), "at": _iso(inv.get("issuedAt"))}})
    for doc in db.collection_group("manualPayments").stream():
        d = doc.to_dict() or {}
        if d.get("canceledAt"):
            continue
        inv, amount = d.get("invoice") or {}, d.get("amount") or 0
        # Fără Stripe, fără comision: brut = net.
        rows.append({**base(doc, d.get("kind") or "subscription"), "source": "manual", "method": d.get("method"),
                     "note": d.get("note"), "at": _iso(d.get("paidAt")), "amount": amount, "currency": "ron",
                     "gross": amount, "fee": 0, "net": amount, "interval": d.get("interval"),
                     "periodStart": _iso(d.get("periodStart")), "periodEnd": _iso(d.get("periodEnd")),
                     "credits": d.get("credits"),
                     "invoice": {"status": inv.get("status"), "number": inv.get("number"), "at": _iso(inv.get("issuedAt"))}})
    for doc in db.collection_group("refunds").stream():
        d = doc.to_dict() or {}
        rows.append({**base(doc, "refund"), "at": _iso(d.get("at")), "amount": -(d.get("amountRefunded") or 0),
                     "currency": d.get("currency")})
    for doc in db.collection_group("disputes").stream():
        d = doc.to_dict() or {}
        rows.append({**base(doc, "dispute"), "at": _iso(d.get("at")), "amount": d.get("amount", 0),
                     "currency": d.get("currency"), "status": d.get("status"), "reason": d.get("reason")})
    rows.sort(key=lambda r: r.get("at") or "", reverse=True)
    return jsonify({"rows": rows, "feesUnavailable": fee_lookups["unavailable"]})


@bp.get("/admin/billing/stripe-fees")
def admin_stripe_fees():
    """Comisioanele Stripe din afara plăților (Billing, dispute) pentru intervalul [from, to), date AAAA-LL-ZZ, ora
    României. Fără drept de citire pe Balance: `unavailable`, fără eroare (tabloul rămâne utilizabil)."""
    authz.require_super_admin()
    bounds = []
    for key in ("from", "to"):
        raw = request.args.get(key)
        if raw and not _DATE_RE.match(raw):
            return _err(f"invalid_{key}", 400)
        try:
            bounds.append(_start_of_day_ro(raw) if raw else None)
        except ValueError:
            return _err(f"invalid_{key}", 400)
    try:
        items = stripe_account_fees(*bounds)
    except BillingUnavailable as e:
        print(f"[billing] comisioanele contului Stripe nu se pot citi ({e}) — verificați permisiunile cheii")
        return jsonify({"items": [], "unavailable": True})
    items.sort(key=lambda x: x.get("at") or 0, reverse=True)
    return jsonify({"items": [{**x, "at": _iso(billing.to_utc(x.get("at")))} for x in items], "unavailable": False})


@bp.post("/admin/billing/payments/<wid>/<kind>/<pid>/invoice")
def admin_mark_invoiced(wid: str, kind: str, pid: str):
    """Factura emisă manual în SmartBill pentru o încasare: `number` (seria și numărul) o marchează, `null` o demarchează."""
    principal = authz.require_super_admin()
    coll = _PAYMENT_KINDS.get(kind)
    if not coll or not authz.valid_wid(wid) or not re.fullmatch(r"[A-Za-z0-9_]{1,255}", pid):
        return _err("not_found", 404)
    number = _body().get("number")
    if number is not None and (not isinstance(number, str) or not 1 <= len(number.strip()) <= 60):
        return _err("invalid_number", 400)
    ref = _acct_ref(wid).collection(coll).document(pid)
    if not ref.get().exists:
        return _err("not_found", 404)
    field = "smartbill" if kind == "subscription" else "invoice"
    value = ({"status": "manual", "number": number.strip(), "issuedAt": datetime.now(timezone.utc), "by": principal.uid}
             if number else {"status": "pending", "number": None, "issuedAt": None, "by": principal.uid})
    ref.set({field: value}, merge=True)
    audit.log(wid, principal.uid, "billing.invoice_marked" if number else "billing.invoice_unmarked", pid, {"kind": kind})
    return jsonify({"ok": True, "invoice": {"status": value["status"], "number": value["number"], "at": _iso(value["issuedAt"])}})


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


@bp.post("/admin/workspaces/<wid>/billing/credits")
def admin_credits(wid: str):
    """Credite gratuite (`amount` > 0, valabile 12 luni) sau ajustare negativă (`amount` < 0, ex. după o rambursare)."""
    principal = authz.require_super_admin()
    body = _body()
    amount, reason = body.get("amount"), str(body.get("reason") or "").strip()[:120]
    if not isinstance(amount, int) or isinstance(amount, bool) or amount == 0 or not -1000 <= amount <= 1000:
        return _err("invalid_amount", 400)
    reason = reason or ("acordate de super admin" if isinstance(amount, int) and amount > 0 else "ajustare")
    if not authz.valid_wid(wid) or authz.load_workspace(wid) is None:
        return _err("not_found", 404)
    if amount > 0:
        billing_credits.grant(wid, amount, reason, principal.uid)
    elif billing_credits.remove(wid, -amount, reason, principal.uid) is None:
        return _err("insufficient_credits", 409)
    return jsonify({"billing": serialize_billing((authz.load_workspace(wid) or {}).get("billing"))})


_MAX_MANUAL_RON = 1_000_000
_MAX_MANUAL_PERIOD = timedelta(days=3 * 366)


def _manual_payment_input(body: dict, b: dict) -> tuple[dict | None, str | None]:
    """Validează o încasare manuală. (date, None) sau (None, cod de eroare)."""
    kind, method = body.get("kind"), body.get("method")
    if kind not in billing_manual.KINDS:
        return None, "invalid_kind"
    if method not in billing_manual.METHODS:
        return None, "invalid_method"
    amount = body.get("amount")
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not 0 <= amount <= _MAX_MANUAL_RON:
        return None, "invalid_amount"
    paid_raw = body.get("paidAt")
    try:
        paid_at = _start_of_day_ro(paid_raw) if isinstance(paid_raw, str) and _DATE_RE.match(paid_raw) else None
    except ValueError:
        paid_at = None
    if not paid_at or paid_at > datetime.now(timezone.utc) + timedelta(days=1):
        return None, "invalid_paid_at"
    number = body.get("invoiceNumber")
    if number is not None and (not isinstance(number, str) or len(number.strip()) > 60):
        return None, "invalid_number"
    out = {"kind": kind, "method": method, "amount": round(amount * 100), "paidAt": paid_at,
           "note": str(body.get("note") or "").strip()[:200], "invoiceNumber": (number or "").strip() or None}
    if kind == "credits":
        credits = body.get("credits")
        if isinstance(credits, bool) or not isinstance(credits, int) or not 1 <= credits <= 1000:
            return None, "invalid_credits"
        return {**out, "credits": credits}, None
    start_raw, end_raw, interval = body.get("periodStart"), body.get("periodEnd"), body.get("interval")
    if interval not in (None, *billing.INTERVALS):
        return None, "invalid_interval"
    try:
        if not all(isinstance(v, str) and _DATE_RE.match(v) for v in (start_raw, end_raw)):
            raise ValueError
        start, end = _start_of_day_ro(start_raw), _end_of_day_ro(end_raw)
    except ValueError:
        return None, "invalid_period"
    if end <= start or end - start > _MAX_MANUAL_PERIOD:
        return None, "invalid_period"
    # Abonament Stripe care s-ar reînnoi în perioada plătită manual: clientul ar plăti de două ori.
    period_end = billing.to_utc(b.get("currentPeriodEnd"))
    if b.get("hasSubscription") and not b.get("cancelAtPeriodEnd") and (not period_end or period_end < end):
        return None, "stripe_subscription_active"
    return {**out, "periodStart": start, "periodEnd": end, "interval": interval}, None


def _serialize_manual(p: dict) -> dict:
    inv = p.get("invoice") or {}
    return {
        "id": p["id"], "kind": p.get("kind"), "amount": p.get("amount", 0), "method": p.get("method"),
        "note": p.get("note"), "paidAt": _iso(p.get("paidAt")), "periodStart": _iso(p.get("periodStart")),
        "periodEnd": _iso(p.get("periodEnd")), "interval": p.get("interval"), "credits": p.get("credits"),
        "createdAt": _iso(p.get("createdAt")), "canceledAt": _iso(p.get("canceledAt")),
        "cancelReason": p.get("cancelReason"),
        "invoice": {"status": inv.get("status"), "number": inv.get("number"), "at": _iso(inv.get("issuedAt"))},
    }


@bp.get("/admin/workspaces/<wid>/billing/manual")
def admin_manual_list(wid: str):
    authz.require_super_admin()
    if not authz.valid_wid(wid):
        return _err("not_found", 404)
    return jsonify({"payments": [_serialize_manual(p) for p in billing_manual.list_payments(wid)]})


@bp.post("/admin/workspaces/<wid>/billing/manual")
def admin_manual_record(wid: str):
    """Încasare manuală: abonament pe o perioadă sau pachet de credite, cu suma încasată (RON)."""
    principal = authz.require_super_admin()
    ws = authz.load_workspace(wid) if authz.valid_wid(wid) else None
    if ws is None:
        return _err("not_found", 404)
    data, error = _manual_payment_input(_body(), ws.get("billing") or {})
    if error:
        return _err(error, 409 if error == "stripe_subscription_active" else 400)
    payment = billing_manual.record(wid, data, principal.uid)
    if payment is None:
        return _err("not_found", 404)
    return jsonify({"payment": _serialize_manual(payment),
                    "billing": serialize_billing((authz.load_workspace(wid) or {}).get("billing"))})


@bp.post("/admin/workspaces/<wid>/billing/manual/<pid>/cancel")
def admin_manual_cancel(wid: str, pid: str):
    principal = authz.require_super_admin()
    if not authz.valid_wid(wid) or not re.fullmatch(r"man_[a-f0-9]{20}", pid):
        return _err("not_found", 404)
    payment = billing_manual.cancel(wid, pid, str(_body().get("reason") or "").strip()[:120], principal.uid)
    if payment is None:
        return _err("not_found", 404)
    return jsonify({"payment": _serialize_manual(payment),
                    "billing": serialize_billing((authz.load_workspace(wid) or {}).get("billing"))})


@bp.post("/admin/workspaces/<wid>/billing/sync")
def admin_sync(wid: str):
    principal = authz.require_super_admin()
    if authz.load_workspace(wid) is None:
        return _err("not_found", 404)
    new = sync_subscription(wid, actor=principal.uid)
    audit.log(wid, principal.uid, "billing.admin_sync", wid)
    return jsonify({"billing": serialize_billing(new)})
