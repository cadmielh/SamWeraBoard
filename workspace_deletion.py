"""Ștergerea cabinetelor și a conturilor, cu perioadă de grație.

Din aplicație, o ștergere se PROGRAMEAZĂ: accesul se blochează imediat, abonamentul Stripe se anulează, iar datele rămân
`GRACE_DAYS` zile, timp în care super adminul le poate restaura. Funcția zilnică `purge_due` face apoi ștergerea definitivă
(`run`, pașii din scripts/delete_workspace.py). Scriptul rămâne ștergere imediată, pentru incidente.
`db` trebuie să fie aceeași bază ca `authz.db()`, pentru că vault-ul își caută cheile acolo.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from google.cloud.firestore_v1 import DELETE_FIELD
from google.cloud.firestore_v1.base_query import FieldFilter

GRACE_DAYS = 14          # DPA: ștergere în cel mult 30 de zile de la cerere
PENDING = "pendingDeletion"
ACCOUNTS = "accountDeletions"

COUNTED = ("clienti", "dosare", "sarcini", "docTemplates", "auditLog")


def run(db, wid: str, dry_run: bool = False, actor: str = "operator") -> dict:
    import vault

    ref = db.collection("workspaces").document(wid)
    snap = ref.get()
    if not snap.exists:
        raise SystemExit(f"Workspace-ul {wid} nu există.")
    data = snap.to_dict() or {}
    members = list((data.get("members") or {}).keys())
    counts = {c: sum(1 for _ in ref.collection(c).stream()) for c in COUNTED}
    counts["membri"] = len(members)
    invites = list(db.collection("invitations").where("workspaceId", "==", wid).stream())
    counts["invitații"] = len(invites)
    acct_ref = db.collection("billingAccounts").document(wid)
    sub_id = (acct_ref.get().to_dict() or {}).get("stripeSubscriptionId") if acct_ref.get().exists else None
    report = {"workspace": wid, "dry_run": dry_run, "counts": counts, "stripeSubscription": sub_id}
    if dry_run:
        return report

    if sub_id and (data.get("billing") or {}).get("hasSubscription") and not data.get("subscriptionCanceledAt"):
        import billing_api                                        # 0) oprește încasarea (dacă nu s-a oprit la programare)
        billing_api.stripe_subscription_cancel(sub_id)
    ref.update({"status": "pendingDeletion"})                     # 1) acces blocat imediat
    vault.destroy_workspace_key(wid)                              # 2) crypto-shredding
    db.recursive_delete(ref)                                      # 3) tot ce ține de workspace
    db.recursive_delete(acct_ref)                                 #    + datele de facturare din aplicație
    for inv in invites:                                           # 4) invitații + indicatorul de workspace activ
        inv.reference.delete()
    for uid in members:
        u = db.collection("users").document(uid)
        if (u.get().to_dict() or {}).get("activeWorkspaceId") == wid:
            u.update({"activeWorkspaceId": None})
    db.collection("deletionLog").document(wid).set({                # 5) dovada ștergerii, fără date personale
        "workspaceId": wid, "deletedAt": datetime.now(timezone.utc), "deletedBy": actor, "counts": counts,
    })
    return report


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(timezone.utc)


def schedule(db, wid: str, actor: str, reason: str, now: datetime | None = None) -> datetime:
    """Blochează cabinetul și programează ștergerea. Anulează abonamentul acum, ca să nu se mai încaseze în perioada de grație."""
    ref = db.collection("workspaces").document(wid)
    data = ref.get().to_dict()
    if data is None:
        raise SystemExit(f"Workspace-ul {wid} nu există.")
    if data.get("status") == PENDING and data.get("deleteAfter"):
        return data["deleteAfter"]
    update = {"status": PENDING, "deleteAfter": _now(now) + timedelta(days=GRACE_DAYS),
              "deletionRequestedBy": actor, "deletionReason": reason}
    acct = db.collection("billingAccounts").document(wid).get().to_dict() or {}
    if acct.get("stripeSubscriptionId") and (data.get("billing") or {}).get("hasSubscription"):
        import billing_api
        billing_api.stripe_subscription_cancel(acct["stripeSubscriptionId"])   # dacă eșuează, nu se programează nimic
        update["subscriptionCanceledAt"] = _now(now)
    ref.update(update)
    return update["deleteAfter"]


def restore(db, wid: str) -> bool:
    """Anulează o ștergere programată. Abonamentul anulat nu revine: se reia din aplicație sau prin acces gratuit."""
    ref = db.collection("workspaces").document(wid)
    data = ref.get().to_dict()
    if not data or data.get("status") != PENDING:
        return False
    ref.update({"status": "active", "deleteAfter": DELETE_FIELD, "deletionRequestedBy": DELETE_FIELD, "deletionReason": DELETE_FIELD})
    return True


def schedule_account(db, uid: str, email: str, workspaces: list[str], now: datetime | None = None) -> datetime:
    """Programează ștergerea contului; `workspaces` = cabinetele în care e singurul membru (programate și ele)."""
    for wid in workspaces:
        schedule(db, wid, actor=uid, reason="account", now=now)
    delete_after = _now(now) + timedelta(days=GRACE_DAYS)
    db.collection(ACCOUNTS).document(uid).set({"uid": uid, "email": email, "workspaces": workspaces,
                                               "requestedAt": _now(now), "deleteAfter": delete_after})
    return delete_after


def restore_account(db, uid: str) -> bool:
    ref = db.collection(ACCOUNTS).document(uid)
    data = ref.get().to_dict()
    if not data:
        return False
    for wid in data.get("workspaces") or []:
        restore(db, wid)
    ref.delete()
    return True


def purge_account(db, uid: str, email: str, delete_user) -> None:
    """Ștergerea definitivă a contului: calitatea de membru, invitațiile, profilul, apoi contul Firebase."""
    import audit
    q = db.collection("workspaces").where(filter=FieldFilter(f"members.{uid}.role", "in", ["admin", "member", "viewer"]))
    for snap in q.stream():
        if len((snap.to_dict() or {}).get("members") or {}) == 1:
            run(db, snap.id, actor=uid)
        else:
            snap.reference.update({f"members.{uid}": DELETE_FIELD})
            audit.log(snap.id, uid, "member.account_deleted", uid)
    if email:
        for inv in db.collection("invitations").where(filter=FieldFilter("email", "==", email)).stream():
            inv.reference.delete()
    db.recursive_delete(db.collection("users").document(uid))
    delete_user(uid)
    db.collection(ACCOUNTS).document(uid).delete()


def purge_due(db, delete_user, now: datetime | None = None) -> dict:
    """Ștergerea definitivă a tot ce a ieșit din perioada de grație. Erorile nu opresc restul; se reîncearcă a doua zi."""
    done = {"workspaces": 0, "accounts": 0, "errors": 0}
    for snap in db.collection(ACCOUNTS).where(filter=FieldFilter("deleteAfter", "<=", _now(now))).stream():
        acc = snap.to_dict() or {}
        try:
            purge_account(db, snap.id, acc.get("email") or "", delete_user)
            done["accounts"] += 1
        except Exception as e:
            print(f"[purge] account failed: {type(e).__name__}")
            done["errors"] += 1
    for snap in db.collection("workspaces").where(filter=FieldFilter("deleteAfter", "<=", _now(now))).stream():
        if (snap.to_dict() or {}).get("status") != PENDING:
            continue
        try:
            run(db, snap.id, actor="purge")
            done["workspaces"] += 1
        except Exception as e:
            print(f"[purge] workspace failed: {type(e).__name__}")
            done["errors"] += 1
    return done
