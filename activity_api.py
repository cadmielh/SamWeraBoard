"""Statistici de utilizare pe cabinet, pentru pagina de super admin — doar citire.

Totul vine din jurnalul de acces existent (`workspaces/{wid}/auditLog`, păstrat ~13 luni): documente generate,
scanări, utilizatori activi și zile active, plus numărul de clienți și dosare. Nu se colectează nimic nou
(nici timp petrecut în aplicație) și nu se citesc valori de date personale: doar momentul, acțiunea și cine.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request

import authz

bp = Blueprint("activity", __name__)

RO = ZoneInfo("Europe/Bucharest")
MAX_DAYS = 120
# Intrări din jurnal care nu sunt făcute de un om din cabinet (webhook Stripe, sarcini programate).
_SYSTEM_ACTORS = {"stripe", "system", ""}


@bp.errorhandler(authz.AuthError)
def _handle_auth(e: authz.AuthError):
    return authz.error_response(e)


def ro_day(dt: datetime) -> str:
    return dt.astimezone(RO).strftime("%Y-%m-%d")


def workspace_activity(db, wid: str, days: int, now: datetime) -> dict:
    """Seria zilnică a ultimelor `days` zile (ora României) și ultima acțiune a unui om din cabinet."""
    today = now.astimezone(RO).date()
    keys = [(today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    series = {k: {"documents": 0, "scans": 0, "users": set()} for k in keys}
    since = datetime.combine(today - timedelta(days=days - 1), datetime.min.time(), tzinfo=RO)
    log = db.collection("workspaces").document(wid).collection("auditLog")

    last_event = None
    for e in log.where("ts", ">=", since).select(["ts", "action", "actorUid"]).stream():
        x = e.to_dict() or {}
        ts, actor, action = x.get("ts"), x.get("actorUid") or "", x.get("action") or ""
        if not ts or actor in _SYSTEM_ACTORS:
            continue
        day = series.get(ro_day(ts))
        if day is None:
            continue
        day["users"].add(actor)
        if action == "document.generate":
            day["documents"] += 1
        elif action == "ocr.extract":
            day["scans"] += 1
        if last_event is None or ts > last_event:
            last_event = ts

    if last_event is None:
        # Nimic în fereastră: ultima acțiune de oricând (cele de sistem se sar, deci câteva intrări, nu una).
        for e in log.order_by("ts", direction="DESCENDING").select(["ts", "actorUid"]).limit(20).stream():
            x = e.to_dict() or {}
            if x.get("ts") and (x.get("actorUid") or "") not in _SYSTEM_ACTORS:
                last_event = x["ts"]
                break

    users = set()
    for v in series.values():
        users |= v["users"]
    return {
        "series": [{"day": k, "documents": v["documents"], "scans": v["scans"], "activeUsers": len(v["users"])}
                   for k, v in series.items()],
        "lastEventAt": last_event.isoformat() if last_event else None,
        "activeUsers": len(users),
    }


def _count(query) -> int:
    try:
        return int(query.count().get()[0][0].value)
    except Exception as e:  # numărătoarea e doar informativă
        print(f"[activity] count indisponibil ({type(e).__name__})")
        return 0


@bp.get("/admin/activity")
def admin_activity():
    """Activitatea tuturor cabinetelor: seria zilnică + câți clienți și dosare au (numărați, fără conținut)."""
    authz.require_super_admin()
    try:
        days = max(7, min(MAX_DAYS, int(request.args.get("days", "90"))))
    except ValueError:
        days = 90
    db = authz.db()
    now = datetime.now(timezone.utc)
    out = {}
    for d in db.collection("workspaces").limit(1000).stream():
        out[d.id] = {
            **workspace_activity(db, d.id, days, now),
            "clients": _count(d.reference.collection("clienti")),
            "dosare": _count(d.reference.collection("dosare")),
        }
    return jsonify({"days": days, "today": ro_day(now), "workspaces": out})
