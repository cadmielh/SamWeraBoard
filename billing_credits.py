"""Credite preplătite: cumpărare (Stripe, plată unică), consum la generare, acordare/ajustare de super admin.

Un credit = o firmă (client) timp de `billing.CREDIT_WINDOW_DAYS`: prima generare pentru firmă consumă creditul,
restul documentelor și regenerările pentru ea în fereastră sunt incluse. Cât timp cabinetul are acces nelimitat
(probă, acces gratuit, abonament) nu se consumă nimic.

Soldul afișat stă în `workspaces/{wid}.billing.credits` (rezumat, vezi billing.py); detaliile doar pe server,
sub `billingAccounts/{wid}/`: `creditLots` (pachetele, imuabile), `creditFirms` (ferestrele deschise, după
`billing.firm_key`) și `creditLedger` (jurnalul de mișcări; fără nume de persoane — doar id-ul clientului).
"""
from __future__ import annotations

import random
import time
import uuid
from datetime import datetime, timedelta, timezone

from firebase_admin import firestore

import audit
import authz
import billing


class ClientNotFound(LookupError):
    """Clientul nu există în cabinet (sau id invalid)."""


def _acct_ref(wid: str):
    return authz.db().collection("billingAccounts").document(wid)


def _client_ref(wid: str, cid: str):
    if not isinstance(cid, str) or not authz.valid_wid(cid):
        raise ClientNotFound()
    return authz.db().collection("workspaces").document(wid).collection("clienti").document(cid)


def _ledger(txn, wid: str, entry: dict) -> None:
    txn.set(_acct_ref(wid).collection("creditLedger").document(), {**entry, "at": firestore.SERVER_TIMESTAMP})


def _summary(b: dict, now: datetime) -> dict:
    return {"balance": billing.credit_balance(b, now), "coveredUntil": billing.covered_until(b)}


def quote(wid: str, ws: dict, cid: str | None) -> dict:
    """Ce s-ar întâmpla la generarea pentru `cid`, pentru textul butonului (fără nicio scriere)."""
    now = datetime.now(timezone.utc)
    b = ws.get("billing") or {}
    mode = billing.credit_mode(b, now)
    out = {"mode": mode, "balance": billing.credit_balance(b, now)}
    if mode == "unlimited":
        return {"mode": "unlimited"}
    if cid:
        snap = _client_ref(wid, cid).get()
        if not snap.exists:
            raise ClientNotFound()
        firm = _acct_ref(wid).collection("creditFirms").document(billing.firm_key(cid, snap.to_dict() or {})).get()
        until = billing.to_utc((firm.to_dict() or {}).get("coveredUntil")) if firm.exists else None
        if until and until > now:
            return {**out, "mode": "included", "coveredUntil": until}
    return {**out, "mode": "consume" if out["balance"] > 0 else "none"}


def consume(wid: str, cid: str | None, uid: str, document: str) -> dict:
    """Consumă un credit pentru firma clientului `cid`, dacă e cazul. Apelat DUPĂ o generare reușită.
    Întoarce {mode: unlimited|included|consumed, balance?, coveredUntil?}; ridică authz.CreditsRequired fără
    credite și ClientNotFound fără client. Tranzacția serializează generările simultane pentru aceeași firmă."""
    db = authz.db()
    ws_ref = db.collection("workspaces").document(wid)
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def run(txn):
        ws = (ws_ref.get(transaction=txn).to_dict() or {})
        b = ws.get("billing") or {}
        if billing.credit_mode(b, now) == "unlimited":
            return {"mode": "unlimited"}
        if not cid:
            raise ClientNotFound()
        client_snap = _client_ref(wid, cid).get(transaction=txn)
        if not client_snap.exists:
            raise ClientNotFound()
        firm_ref = _acct_ref(wid).collection("creditFirms").document(billing.firm_key(cid, client_snap.to_dict() or {}))
        firm = firm_ref.get(transaction=txn)
        until = billing.to_utc((firm.to_dict() or {}).get("coveredUntil")) if firm.exists else None
        if until and until > now:
            return {"mode": "included", **_summary(b, now), "coveredUntil": until}
        until = now + timedelta(days=billing.CREDIT_WINDOW_DAYS)
        new, lot_id = billing.consume_credit(b, until, now)
        if lot_id is None:
            raise authz.CreditsRequired()
        txn.update(ws_ref, {"billing": new})
        txn.set(firm_ref, {"clientId": cid, "coveredUntil": until, "consumedAt": now, "lotId": lot_id, "by": uid})
        _ledger(txn, wid, {"kind": "consume", "amount": -1, "uid": uid, "clientId": cid,
                           "document": (document or "")[:200], "lotId": lot_id, "coveredUntil": until})
        return {"mode": "consumed", **_summary(new, now), "coveredUntil": until}

    # Generările simultane din același cabinet concurează pe documentul lui: tranzacția reîncearcă de mai multe ori,
    # iar dacă tot renunță (ValueError din SDK), reluăm cu o pauză aleatoare, ca încercările să nu se mai ciocnească.
    for attempt in range(4):
        try:
            return run(db.transaction(max_attempts=10))
        except ValueError:
            if attempt == 3:
                raise
            time.sleep(random.uniform(0.05, 0.3) * (attempt + 1))


def add_lot(wid: str, lot_id: str, amount: int, source: str, actor: str, meta: dict | None = None) -> bool:
    """Adaugă un pachet valabil `CREDIT_VALID_DAYS`. Idempotent după `lot_id` (id-ul sesiunii Checkout la
    cumpărare): False dacă pachetul exista deja sau cabinetul nu există."""
    db = authz.db()
    ws_ref = db.collection("workspaces").document(wid)
    lot_ref = _acct_ref(wid).collection("creditLots").document(lot_id)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=billing.CREDIT_VALID_DAYS)

    @firestore.transactional
    def run(txn):
        if lot_ref.get(transaction=txn).exists:
            return False
        ws_snap = ws_ref.get(transaction=txn)
        if not ws_snap.exists:
            return False
        new = billing.add_credits((ws_snap.to_dict() or {}).get("billing"), lot_id, amount, expires, now)
        txn.update(ws_ref, {"billing": new})
        txn.set(lot_ref, {"amount": amount, "source": source, "createdAt": now, "expiresAt": expires,
                          "by": actor, **(meta or {})})
        _ledger(txn, wid, {"kind": source, "amount": amount, "uid": actor, "lotId": lot_id, "expiresAt": expires,
                           **({"reason": meta["reason"]} if meta and meta.get("reason") else {})})
        return True

    added = run(db.transaction())
    if added:
        audit.log(wid, actor, f"billing.credits_{source}", lot_id, {"amount": amount})
    return added


def fulfill_purchase(session: dict) -> str | None:
    """Sesiune Checkout plătită (mode=payment) -> pachetul de credite. Apelat din webhook și din /billing/sync;
    idempotent după id-ul sesiunii. Pachetul vine din metadatele puse de server la crearea sesiunii.
    `no_payment_required` = un cod promoțional de 100%: nu există plată, dar pachetul se livrează."""
    if session.get("mode") != "payment" or session.get("payment_status") not in ("paid", "no_payment_required"):
        return None
    meta = session.get("metadata") or {}
    wid = session.get("client_reference_id") or meta.get("workspaceId")
    spec = billing.CREDIT_PACKS.get(meta.get("pack") or "")
    if not wid or not authz.valid_wid(wid) or not spec:
        print(f"[billing] ALERTĂ: plată unică {session.get('id')} fără cabinet sau pachet cunoscut — verificare manuală")
        return None
    add_lot(wid, session["id"], spec["credits"], "purchase", "stripe",
            {"pack": meta["pack"], "amountPaid": session.get("amount_total")})
    return wid


def grant(wid: str, amount: int, reason: str, actor: str) -> bool:
    return add_lot(wid, f"grant_{uuid.uuid4().hex[:16]}", amount, "grant", actor, {"reason": reason})


def remove(wid: str, amount: int, reason: str, actor: str) -> dict | None:
    """Ajustare negativă de super admin. None dacă soldul nu ajunge sau cabinetul nu există."""
    db = authz.db()
    ws_ref = db.collection("workspaces").document(wid)
    now = datetime.now(timezone.utc)

    @firestore.transactional
    def run(txn):
        snap = ws_ref.get(transaction=txn)
        if not snap.exists:
            return None
        new = billing.remove_credits((snap.to_dict() or {}).get("billing"), amount, now)
        if new is None:
            return None
        txn.update(ws_ref, {"billing": new})
        _ledger(txn, wid, {"kind": "adjust", "amount": -amount, "uid": actor, "reason": reason})
        return new

    new = run(db.transaction())
    if new is not None:
        audit.log(wid, actor, "billing.credits_adjust", wid, {"amount": -amount})
    return new


def ledger(wid: str, limit: int = 100) -> list[dict]:
    """Ultimele mișcări, cu denumirea clientului citită acum din fișa lui (nu e păstrată în jurnal: un client
    șters la cerere GDPR dispare și de aici)."""
    q = (_acct_ref(wid).collection("creditLedger")
         .order_by("at", direction=firestore.Query.DESCENDING).limit(limit))
    entries = [{"id": d.id, **(d.to_dict() or {})} for d in q.stream()]
    cids = sorted({e["clientId"] for e in entries if authz.valid_wid(e.get("clientId") or "")})
    names = {}
    if cids:
        refs = [_client_ref(wid, cid) for cid in cids]
        names = {snap.id: (snap.to_dict() or {}).get("denumire") for snap in authz.db().get_all(refs) if snap.exists}
    for e in entries:
        if e.get("clientId"):
            e["clientName"] = names.get(e["clientId"])
    return entries
