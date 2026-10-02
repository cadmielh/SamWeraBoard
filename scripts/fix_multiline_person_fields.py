"""Migrare unică: curăță rupturile de linie rămase în câmpurile text ale persoanelor (titular, membriIF,
asociati, administratori) — provenite dintr-un bug real din azure_extractor.py (reparat separat): la scanarea
CI, Azure păstrează rupturile de linie originale de PE ACT pentru câmpuri scrise pe mai multe rânduri fizice
(mai ales adresa) — un „\\n” literal ajungea în valoare, apoi LITERAL în documentele generate (Word desena
rând nou acolo, diferit de șablon). Reparația din azure_extractor.py oprește problema la SCANĂRI NOI — acest
script curăță ce a fost deja salvat înainte de reparație.

CNP/serie CI NU sunt afectate — sunt fie deja golite (mutate în vault, vezi migrate_pii.py), fie normalizate
deja acolo (normalize_serie colapsează orice rupturi de linie).

Rulare (necesită credențiale Firestore reale — la fel ca migrate_pii.py):
    python scripts/fix_multiline_person_fields.py --workspace <wid> [--dry-run]
    python scripts/fix_multiline_person_fields.py --all [--dry-run]

Idempotent (o a doua rulare nu mai găsește nimic de curățat) și SIGUR: nu afișează niciodată conținutul
câmpurilor (nume/adresă/etc.), doar câți clienți/persoane au fost afectate, per workspace.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PERSON_FIELDS = ("titular", "membriIF", "asociati", "administratori")
# Câmpuri text ale unei persoane care pot conține text liber (nu numere/coduri) — vezi
# frontend/src/lib/placeholders.ts: PERSOANA_FIELD_MAP.
TEXT_KEYS = ("nume", "prenume", "adresa", "judet", "data_nasterii", "locul_nasterii", "cetatenia",
             "emisa_de", "valabila_de_la", "valabila_pana_la", "calitate")

_LINE_BREAK_RE = re.compile(r"[\r\n]")


def _clean(v: str) -> str:
    """Aceeași normalizare ca azure_extractor._clean_field_text — orice ruptură de linie devine un spațiu."""
    return re.sub(r"\s*[\r\n]+\s*", " ", v).strip()


def _fix_person(p) -> tuple[dict, bool]:
    if not isinstance(p, dict):
        return p, False
    changed = False
    out = dict(p)
    for k in TEXT_KEYS:
        v = p.get(k)
        if isinstance(v, str) and _LINE_BREAK_RE.search(v):
            out[k] = _clean(v)
            changed = True
    return out, changed


def fix_client(data: dict) -> tuple[dict, int]:
    """Întoarce (patch pentru documentul clientului, câte persoane au fost afectate)."""
    patch: dict = {}
    affected = 0
    for f in PERSON_FIELDS:
        v = data.get(f)
        if isinstance(v, list):
            results = [_fix_person(p) for p in v]
            if any(changed for _, changed in results):
                patch[f] = [p for p, _ in results]
                affected += sum(1 for _, changed in results if changed)
        elif isinstance(v, dict):
            p, changed = _fix_person(v)
            if changed:
                patch[f] = p
                affected += 1
    return patch, affected


def fix_workspace(wid: str, dry_run: bool = False) -> tuple[int, int]:
    import authz

    db = authz.db()
    clients = db.collection("workspaces").document(wid).collection("clienti")
    fixed_clients = fixed_persons = 0
    for doc in clients.stream():
        data = doc.to_dict() or {}
        patch, affected = fix_client(data)
        if not affected:
            continue
        fixed_clients += 1
        fixed_persons += affected
        if not dry_run:
            doc.reference.update(patch)
    return fixed_clients, fixed_persons


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--workspace")
    g.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    import firebase_admin
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    import authz

    wids = [args.workspace] if args.workspace else [d.id for d in authz.db().collection("workspaces").stream()]
    total_c = total_p = 0
    for wid in wids:
        c, p = fix_workspace(wid, args.dry_run)
        total_c += c
        total_p += p
        if c:
            print(f"{wid}: {c} clienți, {p} persoane{' (dry-run)' if args.dry_run else ''}")
    print(f"Gata: {total_c} clienți, {total_p} persoane{' (dry-run, nimic scris)' if args.dry_run else ''}.")


if __name__ == "__main__":
    main()
