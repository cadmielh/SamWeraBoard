"""Unelte pentru răspunsul la incidente (docs/procedura-incident.md). Se rulează din Cloud Shell, cu credențialele tale.

  python scripts/incident_tools.py contacts --project samwera-board-eu --all
  python scripts/incident_tools.py contacts --project samwera-board-eu --workspace <ID>
  python scripts/incident_tools.py audit    --project samwera-board-eu --workspace <ID> [--since 2026-09-01] --out incident.csv

`contacts`: administratorii spațiilor de lucru (destinatarii notificării).
`audit`: exportă jurnalul de acces al unui spațiu (același conținut ca „Exportă CSV” din aplicație: fără valori ale datelor personale).
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from datetime import datetime, timezone


def contacts(db, workspace: str | None = None) -> list[dict]:
    """Administratorii (email, nume) ai spațiilor de lucru, cu numele spațiului."""
    docs = [db.collection("workspaces").document(workspace).get()] if workspace else list(db.collection("workspaces").stream())
    out = []
    for w in docs:
        if not w.exists:
            continue
        d = w.to_dict() or {}
        for uid, m in (d.get("members") or {}).items():
            if m.get("role") == "admin":
                out.append({"workspace": w.id, "name": d.get("name", ""), "uid": uid,
                            "email": m.get("email", ""), "displayName": m.get("displayName", "")})
    return out


def export_audit(db, workspace: str, since: datetime | None = None) -> str:
    """Jurnalul unui spațiu ca text CSV, de la cele mai vechi la cele mai noi."""
    q = db.collection("workspaces").document(workspace).collection("auditLog").order_by("ts")
    if since:
        from google.cloud.firestore_v1.base_query import FieldFilter
        q = q.where(filter=FieldFilter("ts", ">=", since))
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_ALL)
    w.writerow(["ts", "actorUid", "action", "target", "meta", "ip"])
    for e in q.stream():
        v = e.to_dict() or {}
        ts = v.get("ts")
        cells = [ts.isoformat() if ts else "", v.get("actorUid", ""), v.get("action", ""), v.get("target") or "",
                 json.dumps(v.get("meta") or {}, ensure_ascii=False, sort_keys=True), v.get("ip", "")]
        # apărare împotriva formulelor Excel
        w.writerow([("'" + c) if isinstance(c, str) and c[:1] in "=+-@" else c for c in cells])
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=("contacts", "audit"))
    ap.add_argument("--project", required=True)
    ap.add_argument("--workspace")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--since", help="AAAA-LL-ZZ")
    ap.add_argument("--out")
    a = ap.parse_args()

    from google.cloud import firestore
    db = firestore.Client(project=a.project)

    if a.command == "contacts":
        if not (a.workspace or a.all):
            ap.error("contacts cere --workspace <ID> sau --all")
        rows = contacts(db, None if a.all else a.workspace)
        for r in rows:
            print(f"{r['workspace']}\t{r['name']}\t{r['displayName']}\t{r['email']}")
        print(f"\n{len(rows)} administratori.", file=sys.stderr)
    else:
        if not a.workspace:
            ap.error("audit cere --workspace <ID>")
        since = datetime.strptime(a.since, "%Y-%m-%d").replace(tzinfo=timezone.utc) if a.since else None
        text = export_audit(db, a.workspace, since)
        if a.out:
            open(a.out, "w", encoding="utf-8-sig", newline="").write(text)
            print(f"Scris {a.out} ({text.count(chr(10)) - 1} intrări).", file=sys.stderr)
        else:
            print(text)


if __name__ == "__main__":
    main()
