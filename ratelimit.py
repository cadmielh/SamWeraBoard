"""Limitare a cererilor per utilizator și per workspace, cu contoare partajate în Firestore.

De ce nu doar `flask-limiter`: acela numără în memoria fiecărei instanțe (cu mai multe instanțe limita reală
se înmulțește) și pe adresă IP (în spatele proxy-urilor Google adresa nu identifică utilizatorul). Aici
contorul e comun tuturor instanțelor și legat de cont, deci protejează costul OCR (Azure) și încetinește
o eventuală exfiltrare în masă chiar și cu un cont compromis. `flask-limiter` rămâne ca plasă de siguranță pe IP.

Ferestre fixe: contor per (domeniu, utilizator sau workspace, acțiune, fereastră) în `rateLimits/*`
(fără acces din client), cu `expireAt` pentru ștergere automată (politică TTL).
Dacă Firestore nu răspunde, cererea trece (fail-open), cu avertisment în log: indisponibilitatea
contorului nu trebuie să blocheze munca utilizatorilor.
"""
from __future__ import annotations

import hashlib
import random
import time
from datetime import datetime, timezone

from firebase_admin import firestore
from google.api_core import exceptions as gexc

import authz

# acțiune -> [(domeniu, limită, fereastră în secunde)]. Se ajustează într-un singur loc și se
# poate lega ulterior de planul cabinetului (cote de abonament).
LIMITS: dict[str, list[tuple[str, int, int]]] = {
    # OCR: costă bani (Azure) și procesează acte de identitate
    "ocr": [("user", 20, 60), ("workspace", 300, 86400)],
    # citiri de CNP în clar: încetinește exfiltrarea
    "pii": [("user", 120, 60)],
    # generare de documente cu date personale
    "fill": [("user", 60, 60)],
    # sugestii AI (Gemini) pentru locurile libere needeslușite — costă bani (vezi ai_suggest.py); limita e
    # simultan un plafon de cost, nu doar de trafic — apăsată explicit de utilizator, o dată per șablon, nu
    # per document generat.
    "ai_suggest": [("user", 10, 3600), ("workspace", 50, 86400)],
}

_RETRIES = 6          # reîncercări externe la concurență
_TXN_ATTEMPTS = 15    # încercări interne ale unei tranzacții


def _doc_id(scope: str, subject: str, action: str, window: int, bucket: int) -> str:
    raw = f"{scope}|{subject}|{action}|{window}|{bucket}"
    return hashlib.sha256(raw.encode()).hexdigest()[:40]


def check(uid: str, wid: str, action: str, now: float | None = None) -> None:
    """Numără cererea și ridică `authz.RateLimited` dacă o limită a acțiunii e depășită."""
    rules = LIMITS.get(action)
    if not rules:
        return
    now = time.time() if now is None else now
    db = None
    try:
        db = authz.db()
        plan = []
        for scope, limit, window in rules:
            subject = uid if scope == "user" else wid
            bucket = int(now // window)
            plan.append((db.collection("rateLimits").document(_doc_id(scope, subject, action, window, bucket)),
                         limit, window, bucket))

        @firestore.transactional
        def run(txn):
            snaps = [ref.get(transaction=txn) for ref, *_ in plan]                       # citiri înaintea scrierilor
            counts = [(s.to_dict() or {}).get("count", 0) if s.exists else 0 for s in snaps]
            for (ref, limit, window, bucket), count in zip(plan, counts):
                if count >= limit:
                    return max(1, int((bucket + 1) * window - now) + 1)                  # secunde până la resetare
            for (ref, limit, window, bucket), count in zip(plan, counts):
                txn.set(ref, {"count": count + 1, "action": action,
                              "expireAt": datetime.fromtimestamp((bucket + 2) * window, timezone.utc)})
            return 0

        retry_after = 0
        for attempt in range(_RETRIES + 1):
            try:
                retry_after = run(db.transaction(max_attempts=_TXN_ATTEMPTS))
                break
            except (gexc.Aborted, ValueError) as e:
                # Concurență pe același contor: clientul Firestore ridică Aborted sau, după ce își epuizează
                # încercările, ValueError("Failed to commit transaction…"). Nu e o indisponibilitate.
                if isinstance(e, ValueError) and "commit" not in str(e).lower():
                    raise
                if attempt == _RETRIES:
                    # Cereri simultane persistente pe același cont: mai sigur să încetinim decât să lăsăm să treacă.
                    raise authz.RateLimited(1)
                time.sleep(random.uniform(0.02, 0.08) * (attempt + 1))
    except authz.RateLimited:
        raise
    except Exception as e:  # noqa: BLE001 — fail-open, dar vizibil
        print(f"[ratelimit] indisponibil, cererea trece ({type(e).__name__})")
        return
    if retry_after:
        raise authz.RateLimited(retry_after)

