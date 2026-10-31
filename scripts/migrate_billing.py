"""Inițializează starea de abonament (`workspaces/{id}.billing`) pentru cabinetele create înainte de abonamente.

  python scripts/migrate_billing.py --project samwera-board-eu --dry-run
  python scripts/migrate_billing.py --project samwera-board-eu
  python scripts/migrate_billing.py --project samwera-board-eu --trial-for <ID1>,<ID2>

Implicit, fiecare cabinet existent (din pilot) primește acces gratuit până la --comp-until (implicit 31.12.2026,
sfârșitul zilei, ora României — prețul de pilot promis pe pagina de prezentare). Cabinetele din --trial-for
primesc în schimb o perioadă de probă de 14 zile de acum. Ajustările individuale se fac apoi din pagina
de super admin. Se scrie și revendicarea de probă (`trialClaims`) pentru e-mailul proprietarului, ca un
cabinet nou al aceluiași om să nu mai primească probă.

Idempotent: cabinetele care au deja `billing.schema` sunt sărite. Se rulează ÎNAINTE de publicarea regulilor
Firestore cu `billingOk` (fără câmpul `billing`, regulile noi refuză orice scriere).
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import billing  # noqa: E402

DEFAULT_COMP_UNTIL = datetime(2026, 12, 31, 23, 59, 59, tzinfo=ZoneInfo("Europe/Bucharest"))


def run(db, comp_until: datetime, trial_for: set[str], dry_run: bool = False,
        now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    report = {"dry_run": dry_run, "comp": [], "trial": [], "skipped": [], "missing_billing_after": 0}
    for snap in db.collection("workspaces").stream():
        ws = snap.to_dict() or {}
        if (ws.get("billing") or {}).get("schema"):
            report["skipped"].append(snap.id)
            continue
        if snap.id in trial_for:
            state = billing.initial_trial(now)
            report["trial"].append(snap.id)
        else:
            state = billing.set_comp(None, comp_until, "pilot", now)
            report["comp"].append(snap.id)
        if dry_run:
            continue
        snap.reference.update({"billing": state})
        owner_email = ((ws.get("members") or {}).get(ws.get("ownerId")) or {}).get("email")
        if owner_email:
            db.collection("trialClaims").document(
                billing.claim_id("email", billing.normalize_email(owner_email))
            ).set({"kind": "email", "workspaceId": snap.id, "claimedAt": now, "source": "migration"}, merge=True)
    if not dry_run:
        report["missing_billing_after"] = sum(
            1 for s in db.collection("workspaces").stream()
            if not ((s.to_dict() or {}).get("billing") or {}).get("accessUntil"))
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--comp-until", help="data (AAAA-LL-ZZ) până la care cabinetele pilot au acces gratuit")
    ap.add_argument("--trial-for", default="", help="ID-uri de cabinete (separate prin virgulă) care primesc probă")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    comp_until = DEFAULT_COMP_UNTIL
    if a.comp_until:
        comp_until = datetime.fromisoformat(a.comp_until).replace(
            hour=23, minute=59, second=59, tzinfo=ZoneInfo("Europe/Bucharest"))
    from google.cloud import firestore
    r = run(firestore.Client(project=a.project), comp_until,
            {w.strip() for w in a.trial_for.split(",") if w.strip()}, a.dry_run)
    print("DRY-RUN (nimic scris)" if r["dry_run"] else "MIGRAT")
    print(f"  acces gratuit până la {comp_until.isoformat()}: {len(r['comp'])} {r['comp']}")
    print(f"  probă 14 zile: {len(r['trial'])} {r['trial']}")
    print(f"  deja migrate (sărite): {len(r['skipped'])}")
    if not r["dry_run"]:
        print(f"  cabinete fără billing.accessUntil după migrare: {r['missing_billing_after']}"
              + ("  ← NU publica regulile până nu e 0" if r["missing_billing_after"] else "  ← se pot publica regulile"))


if __name__ == "__main__":
    main()
