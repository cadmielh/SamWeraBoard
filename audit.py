"""Jurnal de audit, scris exclusiv de server (Admin SDK).

Colecția `workspaces/{wid}/auditLog` e append-only din perspectiva clienților:
regulile Firestore interzic orice scriere din browser. Nu se loghează niciodată
valori de date personale (CNP, nume etc.) — doar cine, ce acțiune, asupra cărui
obiect (id), când și de unde.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from firebase_admin import firestore
from flask import request

import authz

# Reținere jurnal: ~13 luni. Se aplică prin politica TTL Firestore pe `expireAt`.
RETENTION = timedelta(days=400)


def log(wid: str, actor_uid: str, action: str, target: str | None = None,
        meta: dict | None = None) -> None:
    now = datetime.now(timezone.utc)
    entry = {
        "ts": firestore.SERVER_TIMESTAMP,
        "actorUid": actor_uid,
        "action": action,
        "target": target,
        "meta": meta or {},
        "ip": authz.client_ip(),
        "ua": (request.headers.get("User-Agent", "") or "")[:200],
        "expireAt": now + RETENTION,
    }
    try:
        authz.db().collection("workspaces").document(wid).collection("auditLog").add(entry)
    except Exception as e:  # nu blocăm operația, dar eșecul trebuie să fie vizibil în log-uri
        print(f"[audit] WRITE FAILED action={action} ({type(e).__name__})")
