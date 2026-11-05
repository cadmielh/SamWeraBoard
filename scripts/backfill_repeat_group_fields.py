"""Completează `repeatGroupFields` (etichetele din fiecare bloc {{#TAG}}) la șabloanele .docx salvate înainte.

  python scripts/backfill_repeat_group_fields.py --project samwera-board-eu --dry-run
  python scripts/backfill_repeat_group_fields.py --project samwera-board-eu

Cu el, verificarea dinainte de generare cere un câmp per-persoană doar persoanelor din blocul care îl conține
(ex. cetățenia cerută doar la asociați nu mai e raportată lipsă pentru un administrator). Șabloanele fără câmp
funcționează și fără script, cu verificarea veche. Idempotent: șabloanele care au deja câmpul sunt sărite;
nu modifică fișierul, revizia sau data modificării.
"""
from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from doc_filler import list_repeat_group_fields_in_docx  # noqa: E402


def run(db, dry_run: bool = False) -> dict:
    report = {"dry_run": dry_run, "updated": [], "skipped": 0, "failed": []}
    for snap in db.collection_group("docTemplates").stream():
        t = snap.to_dict() or {}
        if t.get("type") != "docx" or not t.get("fileBase64") or "repeatGroupFields" in t:
            report["skipped"] += 1
            continue
        try:
            fields = list_repeat_group_fields_in_docx(base64.b64decode(t["fileBase64"]))
        except Exception as e:  # noqa: BLE001 — un fișier necitibil rămâne cu verificarea veche
            report["failed"].append((snap.reference.path, type(e).__name__))
            continue
        report["updated"].append(snap.reference.path)
        if not dry_run:
            snap.reference.update({"repeatGroupFields": fields})
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    from google.cloud import firestore
    r = run(firestore.Client(project=a.project), a.dry_run)
    print("DRY-RUN (nimic scris)" if r["dry_run"] else "COMPLETAT")
    print(f"  șabloane completate: {len(r['updated'])}")
    print(f"  sărite (deja completate, Google Docs sau fără fișier): {r['skipped']}")
    if r["failed"]:
        print(f"  necitibile (rămân cu verificarea veche): {r['failed']}")


if __name__ == "__main__":
    main()
