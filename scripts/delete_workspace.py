"""Ștergerea definitivă a unui workspace (DPA: la încetare, datele se șterg în cel mult 30 de zile).

  python scripts/delete_workspace.py --project samwera-board-eu --workspace <ID> --dry-run
  python scripts/delete_workspace.py --project samwera-board-eu --workspace <ID> --confirm <ID>

Ce face, în ordine:
  0. anulează imediat abonamentul Stripe al cabinetului, dacă există (altfel Stripe continuă să încaseze); cere
     STRIPE_SECRET_KEY în mediu — fără ea, scriptul se oprește înainte de orice ștergere;
  1. blochează imediat accesul (status = pendingDeletion: API-ul refuză orice cerere pentru acel workspace);
  2. șterge cheia de date a workspace-ului (`workspaceKeys/{id}`): valorile din vault devin ilizibile chiar și în copiile de siguranță
     care nu expiraseră încă (crypto-shredding, vezi limitările din docs/vault-rollout.md);
  3. șterge recursiv tot ce ține de workspace (clienți, vault, istoric generări, dosare, sarcini, șabloane, jurnal de acces, membri)
     și datele lui de facturare din aplicație (`billingAccounts/{id}`; facturile fiscale rămân în SmartBill, plățile în Stripe);
  4. șterge invitațiile lui și golește `activeWorkspaceId` al utilizatorilor care îl aveau activ;
  5. lasă o înregistrare fără date personale în `deletionLog/{id}` (dovada ștergerii: moment, numere de documente).
Înainte de ștergere, cabinetul poate primi jurnalul de acces (scripts/incident_tools.py audit) dacă îl cere.
Se rulează din Cloud Shell, cu credențialele tale. Copiile de siguranță (PITR, 7 zile) expiră singure.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from workspace_deletion import COUNTED, run  # noqa: E402,F401  (reexportate pentru teste)


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

    import authz
    authz._db = firestore.Client(project=a.project)   # vault-ul își găsește cheile în aceeași bază
    r = run(authz._db, a.workspace, a.dry_run)
    print(("DRY-RUN (nimic șters)" if r["dry_run"] else "ȘTERS DEFINITIV") + f": {r['workspace']}")
    if r["stripeSubscription"]:
        print(f"  abonament Stripe: {r['stripeSubscription']}" + (" (de anulat)" if r["dry_run"] else " (anulat dacă era activ)"))
    for k, v in r["counts"].items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
