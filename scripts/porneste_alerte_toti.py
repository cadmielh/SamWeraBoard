"""Pornește flag-ul `alerte` la toate cabinetele care nu-l au (lansarea alertelor pentru toți, nov. 2026).

Pornirea declanșează triggerul `alerte_cabinet`, care recalculează alertele cabinetului. Cabinetele programate
pentru ștergere și cele cu flag-ul oprit explicit (`features.alerte == False`, de ex. oprit din Super admin) se sar.

Rulare (credențialele implicite, ADC):
    GOOGLE_CLOUD_PROJECT=samwera-board-eu .venv/bin/python scripts/porneste_alerte_toti.py            # doar listează
    GOOGLE_CLOUD_PROJECT=samwera-board-eu .venv/bin/python scripts/porneste_alerte_toti.py --aplica   # pornește
"""
from __future__ import annotations

import os
import sys

from google.cloud import firestore


def main() -> None:
    aplica = "--aplica" in sys.argv
    db = firestore.Client(project=os.environ.get("GOOGLE_CLOUD_PROJECT", "samwera-board-eu"))
    de_pornit, sarite = [], []
    for snap in db.collection("workspaces").stream():
        ws = snap.to_dict() or {}
        flag = (ws.get("features") or {}).get("alerte")
        nume = ws.get("name") or snap.id
        if flag is True:
            continue
        if ws.get("status") == "pendingDeletion" or flag is False:
            sarite.append((nume, "programat pentru ștergere" if ws.get("status") == "pendingDeletion" else "oprit explicit"))
            continue
        de_pornit.append((snap.id, nume))
    print(f"De pornit ({len(de_pornit)}):")
    for wid, nume in de_pornit:
        print(f"  {nume}  [{wid}]")
    for nume, motiv in sarite:
        print(f"Sărit: {nume} ({motiv})")
    if not aplica:
        print("\nProbă: nimic modificat. Rulează cu --aplica pentru pornire.")
        return
    for wid, _ in de_pornit:
        db.collection("workspaces").document(wid).update({"features.alerte": True})
    print(f"\nPornit la {len(de_pornit)} cabinete.")


if __name__ == "__main__":
    main()
