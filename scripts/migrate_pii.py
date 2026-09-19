"""Migrare unică: mută CNP/serie CI din documentele `clienti` (text clar) în vault-ul criptat.

Pentru fiecare persoană (titular, membriIF, asociati, administratori) cu `cnp`/`serie_numar`
completate: îi atribuie un `pid`, criptează valorile în `clienti/{cid}/pii/vault`, scrie în
document doar variantele mascate și golește câmpurile în clar. Idempotent: persoanele deja
migrate (cu `pid` și fără valori în clar) sunt sărite.

Rulare (necesită VAULT_KMS_KEY sau, doar pentru dezvoltare, VAULT_LOCAL_KEK, plus credențiale):
    python scripts/migrate_pii.py --workspace <wid> [--dry-run]
    python scripts/migrate_pii.py --all [--dry-run]
    python scripts/migrate_pii.py --all --verify        # raportează CNP rămas în clar; cod de ieșire 1 dacă există
    python scripts/migrate_pii.py --purge-extractions   # șterge `fields` din istoricul vechi de extrageri

Măștile trebuie să rămână identice cu maskCnp/maskSerie din frontend/src/lib/pii.ts.
"""
from __future__ import annotations

import argparse
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PERSON_FIELDS = ("titular", "membriIF", "asociati", "administratori")


def mask_cnp(cnp: str) -> str:
    d = (cnp or "").strip()
    return "•" * max(0, len(d) - 4) + d[-4:] if d else ""


def mask_serie(s: str) -> str:
    v = (s or "").strip()
    if not v:
        return ""
    total = len(re.findall(r"\d", v))
    seen = 0
    out = []
    for ch in v:
        if ch.isdigit():
            seen += 1
            out.append(ch if seen > total - 2 else "•")
        else:
            out.append(ch)
    return "".join(out)


def normalize_cnp(v) -> str:
    """Aceleași reguli ca pii_api.normalize_cnp (păstrate identic; vezi testul de paritate)."""
    return re.sub(r"\s+", "", str(v or ""))


def normalize_serie(v) -> str:
    """Aceleași reguli ca pii_api.normalize_serie: spațiile, taburile și liniile noi devin un singur spațiu."""
    return " ".join(str(v or "").split())


def split_client(data: dict, pid_for=None) -> tuple[dict, dict[str, dict]]:
    """Întoarce (patch pentru documentul clientului, {pid: {cnp, serie_numar}} pentru vault).

    `pid_for(field, index)` permite id-uri deterministe (rerulări identice); implicit uuid4."""
    patch: dict = {}
    vault_persons: dict[str, dict] = {}

    def strip(p: dict, field: str, index: int) -> tuple[dict, bool]:
        if not (p.get("cnp") or p.get("serie_numar")):
            return p, False
        pid = p.get("pid") or (pid_for(field, index) if pid_for else uuid.uuid4().hex)
        cnp, serie = normalize_cnp(p.get("cnp")), normalize_serie(p.get("serie_numar"))
        vault_persons[pid] = {"cnp": cnp, "serie_numar": serie}
        return {**p, "pid": pid, "cnp": "", "serie_numar": "",
                "cnpMasked": mask_cnp(cnp),
                "serieMasked": mask_serie(serie)}, True

    for f in PERSON_FIELDS:
        v = data.get(f)
        if isinstance(v, list):
            res = [strip(p, f, i) for i, p in enumerate(v) if isinstance(p, dict)]
            if any(changed for _, changed in res):
                patch[f] = [p for p, _ in res]
        elif isinstance(v, dict):
            p, changed = strip(v, f, 0)
            if changed:
                patch[f] = p
    return patch, vault_persons


def migrate_workspace(wid: str, dry_run: bool = False) -> tuple[int, int]:
    import vault
    import authz
    from google.cloud import firestore

    db = authz.db()
    clients = db.collection("workspaces").document(wid).collection("clienti")
    migrated = persons = 0
    for doc in clients.stream():
        data = doc.to_dict() or {}
        patch, vault_persons = split_client(data)
        if not vault_persons:
            continue
        migrated += 1
        persons += len(vault_persons)
        if dry_run:
            continue
        vref = doc.reference.collection("pii").document("vault")
        existing = vref.get()
        stored = dict((existing.to_dict() or {}).get("persons", {})) if existing.exists else {}
        for pid, v in vault_persons.items():
            stored[pid] = vault.encrypt_record(wid, doc.id, pid, v)
        # Vault întâi, apoi documentul: la o întrerupere nu se pierd date (rerularea e sigură).
        vref.set({"persons": stored, "updatedAt": firestore.SERVER_TIMESTAMP})
        doc.reference.update(patch)
    return migrated, persons


def purge_extractions(dry_run: bool = False) -> int:
    """Elimină câmpul `fields` (date personale extrase din acte) din istoricul vechi
    `users/*/extractions`; păstrează metadatele (sursă, moment)."""
    import authz
    from google.cloud import firestore

    n = 0
    for doc in authz.db().collection_group("extractions").stream():
        if "fields" in (doc.to_dict() or {}):
            n += 1
            if not dry_run:
                doc.reference.update({"fields": firestore.DELETE_FIELD})
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--workspace")
    g.add_argument("--all", action="store_true")
    g.add_argument("--purge-extractions", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verify", action="store_true", help="doar raportează; cod de ieșire 1 dacă mai există CNP în clar")
    args = ap.parse_args()

    import firebase_admin
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    import authz

    if args.purge_extractions:
        n = purge_extractions(args.dry_run)
        print(f"{n} înregistrări de istoric cu date personale{' (dry-run, nimic șters)' if args.dry_run else ' curățate'}.")
        return
    if args.verify:
        args.dry_run = True

    wids = [args.workspace] if args.workspace else [d.id for d in authz.db().collection("workspaces").stream()]
    total_c = total_p = 0
    for wid in wids:
        c, p = migrate_workspace(wid, args.dry_run)
        total_c += c
        total_p += p
        if c:
            print(f"{wid}: {c} clienți, {p} persoane{' (dry-run)' if args.dry_run else ''}")
    print(f"Gata: {total_c} clienți, {total_p} persoane{' (dry-run, nimic scris)' if args.dry_run else ''}.")
    if args.verify and total_p:
        print("ATENȚIE: mai există CNP/serie în clar în documentele clienților.")
        sys.exit(1)


if __name__ == "__main__":
    main()
