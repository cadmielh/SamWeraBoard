"""Ștergerea definitivă a unui workspace (DPA: la încetare, datele se șterg în cel mult 30 de zile).

  python scripts/delete_workspace.py --project samwera-board-eu --workspace <ID> --dry-run
  python scripts/delete_workspace.py --project samwera-board-eu --workspace <ID> --confirm <ID>

Ce face, în ordine:
  1. blochează imediat accesul (status = pendingDeletion: API-ul refuză orice cerere pentru acel workspace);
  2. șterge cheia de date a workspace-ului (`workspaceKeys/{id}`): valorile din vault devin ilizibile chiar și în copiile de siguranță
     care nu expiraseră încă (crypto-shredding, vezi limitările din docs/vault-rollout.md);
  3. șterge recursiv tot ce ține de workspace (clienți, vault, istoric generări, dosare, sarcini, șabloane, jurnal de acces, membri);
  4. șterge invitațiile lui și golește `activeWorkspaceId` al utilizatorilor care îl aveau activ;
  5. lasă o înregistrare fără date personale în `deletionLog/{id}` (dovada ștergerii: moment, numere de documente).
Înainte de ștergere, cabinetul poate primi jurnalul de acces (scripts/incident_tools.py audit) dacă îl cere.
Se rulează din Cloud Shell, cu credențialele tale. Copiile de siguranță (PITR, 7 zile) expiră singure.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

COUNTED = ("clienti", "dosare", "sarcini", "docTemplates", "auditLog")


def run(db, wid: str, dry_run: bool = False, actor: str = "operator") -> dict:
    import authz
    import vault

    authz._db = db                       # vault-ul își găsește cheile în baza dată
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
    report = {"workspace": wid, "dry_run": dry_run, "counts": counts}
    if dry_run:
        return report

    ref.update({"status": "pendingDeletion"})                     # 1) acces blocat imediat
    vault.destroy_workspace_key(wid)                              # 2) crypto-shredding
    db.recursive_delete(ref)                                      # 3) tot ce ține de workspace
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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--confirm", help="repetă ID-ul workspace-ului pentru a confirma ștergerea definitivă")
    a = ap.parse_args()
    if not a.dry_run and a.confirm != a.workspace:
        ap.error("ștergerea e definitivă: adaugă --confirm <ID-ul workspace-ului> (sau folosește --dry-run)")
    from google.cloud import firestore
    r = run(firestore.Client(project=a.project), a.workspace, a.dry_run)
    print(("DRY-RUN (nimic șters)" if r["dry_run"] else "ȘTERS DEFINITIV") + f": {r['workspace']}")
    for k, v in r["counts"].items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
