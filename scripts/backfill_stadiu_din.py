"""Completează `stadiuDin` (de când stă dosarul în stadiul curent) la dosarele create înainte de alerte.

  python scripts/backfill_stadiu_din.py --project samwera-board-eu --dry-run
  python scripts/backfill_stadiu_din.py --project samwera-board-eu
  python scripts/backfill_stadiu_din.py --project samwera-board-eu --workspace <ID>

Câmpul e intern (nu apare nicăieri în interfață) și îl folosește doar alerta „Dosar blocat în același stadiu”
(alerte.py). La dosarele vechi lipsește, iar alerta ar socoti atunci de la data creării: la pornirea alertelor,
aproape orice dosar nefinalizat mai vechi de 14 zile ar apărea deodată ca „blocat”. Scriptul pune momentul rulării,
deci blocajele încep să se numere de azi.

Idempotent: dosarele care au deja `stadiuDin` sunt sărite. Se rulează ÎNAINTE de pornirea flag-ului `alerte`
(altfel fiecare dosar scris declanșează și recalcularea alertelor lui).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

LOT = 400   # scrieri pe lot (limita Firestore e 500)


def run(db, dry_run: bool = False, workspace: str | None = None, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    report = {"dry_run": dry_run, "cabinete": 0, "completate": 0, "sarite": 0}
    wss = [db.collection("workspaces").document(workspace)] if workspace else \
        [s.reference for s in db.collection("workspaces").stream()]
    for ws_ref in wss:
        report["cabinete"] += 1
        batch, n = db.batch(), 0
        for snap in ws_ref.collection("dosare").stream():
            if (snap.to_dict() or {}).get("stadiuDin"):
                report["sarite"] += 1
                continue
            report["completate"] += 1
            if dry_run:
                continue
            batch.update(snap.reference, {"stadiuDin": now})
            n += 1
            if n >= LOT:
                batch.commit()
                batch, n = db.batch(), 0
        if n:
            batch.commit()
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--workspace", help="doar acest cabinet (implicit: toate)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    from google.cloud import firestore
    r = run(firestore.Client(project=a.project), a.dry_run, a.workspace)
    print("DRY-RUN (nimic scris)" if r["dry_run"] else "COMPLETAT")
    print(f"  cabinete: {r['cabinete']}")
    print(f"  dosare fără stadiuDin {'de completat' if r['dry_run'] else 'completate'}: {r['completate']}")
    print(f"  dosare care aveau deja stadiuDin (sărite): {r['sarite']}")


if __name__ == "__main__":
    main()
