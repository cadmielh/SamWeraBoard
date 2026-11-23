"""Încasări înregistrate manual de super admin (transfer, numerar), pe lângă cele din Stripe.

Două tipuri, sub `billingAccounts/{wid}/manualPayments/{id}`:
- `subscription`: abonament plătit pentru o perioadă. `workspaces/{wid}.billing.manualUntil` = cel mai târziu sfârșit
  de perioadă dintre încasările neanulate; accesul se calculează din el ca din orice abonament (billing.finalize).
- `credits`: pachet de credite vândut manual. Creează un pachet (`creditLots`, sursa `manual`) valabil 12 luni.

Nu se șterge nimic: o încasare greșită se anulează (rămâne în istoric, cu cine și când), iar accesul sau creditele
se recalculează. Factura fiscală se emite manual, ca la Stripe, și se marchează din Încasări.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from firebase_admin import firestore

import audit
import authz
import billing
import billing_credits

METHODS = ("transfer", "numerar", "card", "altele")
KINDS = ("subscription", "credits")


def _acct_ref(wid: str):
    return authz.db().collection("billingAccounts").document(wid)


def _coll(wid: str):
    return _acct_ref(wid).collection("manualPayments")


def _manual_until(docs: list[dict]) -> datetime | None:
    ends = [billing.to_utc(d.get("periodEnd")) for d in docs
            if d.get("kind") == "subscription" and not d.get("canceledAt")]
    return max((e for e in ends if e), default=None)


def _invoice(number: str | None, amount: int, actor: str, now: datetime) -> dict:
    if number:
        return {"status": "manual", "number": number, "issuedAt": now, "by": actor}
    return {"status": "pending" if amount > 0 else "skipped", "number": None, "issuedAt": None}


def record(wid: str, data: dict, actor: str) -> dict | None:
    """Înregistrează o încasare validată deja de API. None dacă cabinetul nu există."""
    db = authz.db()
    ws_ref = db.collection("workspaces").document(wid)
    now = datetime.now(timezone.utc)
    pid = f"man_{uuid.uuid4().hex[:20]}"
    doc = {
        "kind": data["kind"], "amount": data["amount"], "currency": "ron", "paidAt": data["paidAt"],
        "method": data["method"], "note": data.get("note") or None,
        "invoice": _invoice(data.get("invoiceNumber"), data["amount"], actor, now),
        "createdAt": now, "by": actor, "canceledAt": None,
    }
    if data["kind"] == "credits":
        lot_id = f"manual_{pid}"
        if not billing_credits.add_lot(wid, lot_id, data["credits"], "manual", actor,
                                       {"amountPaid": data["amount"], "manualPaymentId": pid}):
            return None
        doc.update(credits=data["credits"], lotId=lot_id)
        _coll(wid).document(pid).set(doc)
    else:
        doc.update(periodStart=data["periodStart"], periodEnd=data["periodEnd"], interval=data.get("interval"))

        @firestore.transactional
        def run(txn):
            snap = ws_ref.get(transaction=txn)
            if not snap.exists:
                return False
            existing = [d.to_dict() or {} for d in _coll(wid).where("kind", "==", "subscription").stream(transaction=txn)]
            new = billing.set_manual((snap.to_dict() or {}).get("billing"), _manual_until([*existing, doc]), now)
            txn.update(ws_ref, {"billing": new})
            txn.set(_coll(wid).document(pid), doc)
            return True

        if not run(db.transaction()):
            return None
    audit.log(wid, actor, "billing.manual_payment", pid, {"kind": data["kind"], "amount": data["amount"]})
    return {"id": pid, **doc}


def cancel(wid: str, pid: str, reason: str, actor: str) -> dict | None:
    """Anulează o încasare manuală: abonamentul se recalculează din celelalte, creditele rămase din pachet se scot.
    None dacă nu există; încasarea deja anulată se întoarce neschimbată."""
    db = authz.db()
    ws_ref = db.collection("workspaces").document(wid)
    ref = _coll(wid).document(pid)
    now = datetime.now(timezone.utc)
    marker = {"canceledAt": now, "canceledBy": actor, "cancelReason": reason or None}

    @firestore.transactional
    def run(txn):
        snap = ref.get(transaction=txn)
        ws_snap = ws_ref.get(transaction=txn)
        if not snap.exists or not ws_snap.exists:
            return None, 0, False
        d = snap.to_dict() or {}
        if d.get("canceledAt"):
            return d, 0, False
        prev = (ws_snap.to_dict() or {}).get("billing")
        removed = 0
        if d.get("kind") == "credits":
            new, removed = billing.remove_lot(prev, d.get("lotId") or "", now)
            if removed:
                txn.set(_acct_ref(wid).collection("creditLedger").document(), {
                    "kind": "adjust", "amount": -removed, "uid": actor, "lotId": d.get("lotId"),
                    "reason": "încasare manuală anulată", "at": firestore.SERVER_TIMESTAMP})
        else:
            others = [o.to_dict() or {} for o in _coll(wid).where("kind", "==", "subscription").stream(transaction=txn)
                      if o.id != pid]
            new = billing.set_manual(prev, _manual_until(others), now)
        txn.update(ws_ref, {"billing": new})
        txn.update(ref, marker)
        return {**d, **marker}, removed, True

    d, removed, changed = run(db.transaction())
    if d is None:
        return None
    if changed:
        audit.log(wid, actor, "billing.manual_payment_cancel", pid, {"kind": d.get("kind"), "creditsRemoved": removed})
    return {"id": pid, **d}


def list_payments(wid: str) -> list[dict]:
    rows = [{"id": d.id, **(d.to_dict() or {})} for d in _coll(wid).stream()]
    rows.sort(key=lambda r: billing.to_utc(r.get("paidAt")) or billing.EPOCH, reverse=True)
    return rows
