"""Migrare completă din proiectul vechi în cel nou (UE), păstrând totul ca înainte.

Ce se copiază (cu aceleași id-uri de document și aceleași marcaje de timp):
  - workspaces/*           (nume, membri, owner, configurul de facturare, feature flags) + status=active
  - workspaces/*/clienti/* CNP și serie CI mută în vault-ul criptat; în document rămân doar mascate;
                           subcolecțiile (ex. docGenerations) se copiază
  - workspaces/*/dosare, sarcini, docTemplates
  - users/*                (activeWorkspaceId, isSuperAdmin — rolul de super admin se păstrează)
  - users/*/extractions    DOAR metadate (sursă, dată); câmpul `fields` cu date personale NU se copiază
  - invitations            cele în așteptare, convertite în noul format (valabile 14 zile)
  - superAdminGrants

Conturile de autentificare se mută separat, cu UID-uri păstrate:
  firebase auth:export conturi.json --project <vechi>   →   firebase auth:import conturi.json --project <nou>

Workspace-urile migrate nu au consimțământ pentru termeni/DPA: adminii îl acceptă la primul login
(ecran dedicat), iar până atunci serverul refuză operațiunile cu date personale. La rerulări, un consimțământ
deja acceptat în țintă se păstrează.

Rulare (necesită VAULT_KMS_KEY sau, doar pentru repetiții locale, VAULT_LOCAL_KEK):
  Cloud Shell (credențiale ADC pentru ambele proiecte):
      python scripts/migrate_project.py --source samwera-board --target samwera-board-eu --dry-run
      python scripts/migrate_project.py --source samwera-board --target samwera-board-eu
  Repetiție locală (sursa reală, ținta = emulatorul Firestore):
      FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 python scripts/migrate_project.py \
          --source samwera-board --source-credentials firebase-service-account.json --target samwera-board-eu

Idempotent: se poate rula de mai multe ori; rezultatul e același (id-urile persoanelor din vault sunt deterministe).
Nu afișează niciodată conținutul documentelor — doar numere.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate_pii  # noqa: E402

INVITE_TTL = timedelta(days=14)
EXTRACTION_TTL = timedelta(days=30)
_NS = uuid.UUID("6f1c2b1e-5a55-4c33-9a0e-2d1f0a4b7c11")  # spațiu de nume fix pentru id-uri deterministe


class Report(dict):
    def add(self, key: str, n: int = 1) -> None:
        self[key] = self.get(key, 0) + n


def _pid_for(wid: str, cid: str):
    """Id deterministe pentru persoane: aceeași intrare => același pid la fiecare rulare."""
    return lambda field, index: uuid.uuid5(_NS, f"{wid}/{cid}/{field}/{index}").hex


def copy_tree(src_ref, dst_ref, report: Report, label: str, dry_run: bool, skip: frozenset = frozenset()) -> None:
    """Copiază recursiv subcolecțiile unui document (fără cele din `skip`)."""
    for sub in src_ref.collections():
        if sub.id in skip:
            continue
        for d in sub.stream():
            report.add(f"{label}/{sub.id}")
            if not dry_run:
                dst_ref.collection(sub.id).document(d.id).set(d.to_dict() or {})
            copy_tree(d.reference, dst_ref.collection(sub.id).document(d.id), report, f"{label}/{sub.id}", dry_run)


def migrate_workspace(src_ws, target, report: Report, dry_run: bool, vault_mod) -> None:
    wid = src_ws.id
    data = src_ws.to_dict() or {}
    dst_ws = target.collection("workspaces").document(wid)
    report.add("workspaces")
    if not dry_run:
        # Consimțământul (termeni + DPA) se dă în aplicația nouă, nu există în sursă: la prima migrare lipsește (adminul
        # îl acceptă la primul login, vezi ConsentGate), iar la RERULĂRI se păstrează pe cel deja acceptat în țintă.
        existing = dst_ws.get()
        consent = (existing.to_dict() or {}).get("consent") if existing.exists else None
        dst_ws.set({**data, "status": "active", **({"consent": consent} if consent else {})})

    for coll in ("dosare", "sarcini", "docTemplates"):
        for d in src_ws.reference.collection(coll).stream():
            report.add(coll)
            if not dry_run:
                dst_ws.collection(coll).document(d.id).set(d.to_dict() or {})
            copy_tree(d.reference, dst_ws.collection(coll).document(d.id), report, coll, dry_run)

    for c in src_ws.reference.collection("clienti").stream():
        report.add("clienti")
        cdata = c.to_dict() or {}
        patch, vault_persons = migrate_pii.split_client(cdata, pid_for=_pid_for(wid, c.id))
        report.add("persoane_în_vault", len(vault_persons))
        if dry_run:
            continue
        dst_c = dst_ws.collection("clienti").document(c.id)
        # Vault întâi, documentul după; vault-ul se reconstruiește complet (rerulare = același rezultat).
        # Persoanele fără CNP/serie nu au intrare; dacă documentul sursă are deja `pid`, se păstrează.
        stored = {pid: vault_mod.encrypt_record(wid, c.id, pid, v) for pid, v in vault_persons.items()}
        if stored:
            dst_c.collection("pii").document("vault").set({"persons": stored, "updatedAt": datetime.now(timezone.utc)})
        dst_c.set({**cdata, **patch})
        copy_tree(c.reference, dst_c, report, "clienti", dry_run, skip=frozenset({"pii"}))

    if not dry_run:
        dst_ws.collection("auditLog").add({
            "ts": datetime.now(timezone.utc), "actorUid": "system", "action": "migration.import",
            "target": wid, "meta": {"source": "samwera-board"}, "ip": "", "ua": "scripts/migrate_project.py",
            "expireAt": datetime.now(timezone.utc) + timedelta(days=400),
        })


def migrate_users(source, target, report: Report, dry_run: bool, only_uids: set[str] | None = None) -> None:
    for u in source.collection("users").stream():
        if only_uids is not None and u.id not in only_uids:
            continue
        report.add("users")
        if not dry_run:
            target.collection("users").document(u.id).set(u.to_dict() or {})
        for e in u.reference.collection("extractions").stream():
            # Doar metadate: `fields` conține CNP, serie CI, adresă în clar și nu se copiază.
            v = e.to_dict() or {}
            created = v.get("createdAt")
            base = created if isinstance(created, datetime) else datetime.now(timezone.utc)
            report.add("extractions_metadate")
            if "fields" in v:
                report.add("extractions_cu_date_personale_omise")
            if not dry_run:
                target.collection("users").document(u.id).collection("extractions").document(e.id).set({
                    "createdAt": created or base,
                    "sourceFile": v.get("sourceFile", ""),
                    "expireAt": base + EXTRACTION_TTL,
                })


def migrate_invitations(source, target, report: Report, dry_run: bool) -> None:
    for i in source.collection("invitations").stream():
        v = i.to_dict() or {}
        if v.get("used") or not v.get("email") or not v.get("workspaceId"):
            report.add("invitații_omise")
            continue
        ws = (target.collection("workspaces").document(v["workspaceId"]).get() if not dry_run else None)
        inviter = ((ws.to_dict() or {}).get("members", {}).get(v.get("invitedBy"), {}) if ws is not None and ws.exists else {})
        email = v["email"].strip().lower()
        report.add("invitations")
        if not dry_run:
            new_id = f"{v['workspaceId']}_{hashlib.sha256(email.encode()).hexdigest()[:20]}"
            target.collection("invitations").document(new_id).set({
                "workspaceId": v["workspaceId"], "workspaceName": v.get("workspaceName", ""), "email": email,
                "role": v.get("role", "member"), "invitedBy": v.get("invitedBy", ""),
                "invitedByEmail": inviter.get("email", ""), "invitedAt": v.get("invitedAt") or datetime.now(timezone.utc),
                "expiresAt": datetime.now(timezone.utc) + INVITE_TTL, "status": "pending",
            })
    for g in source.collection("superAdminGrants").stream():
        report.add("superAdminGrants")
        if not dry_run:
            target.collection("superAdminGrants").document(g.id).set(g.to_dict() or {})


def _count(col) -> int:
    return sum(1 for _ in col.stream())


def verify(source, target, only_workspaces: list[str] | None = None) -> list[str]:
    """Compară numărul de documente (sursă vs țintă) și caută CNP rămas în clar. Întoarce lista problemelor."""
    problems: list[str] = []
    for src_ws in source.collection("workspaces").stream():
        if only_workspaces and src_ws.id not in only_workspaces:
            continue
        dst_ws = target.collection("workspaces").document(src_ws.id)
        if not dst_ws.get().exists:
            problems.append(f"{src_ws.id}: workspace lipsă în țintă")
            continue
        for coll in ("clienti", "dosare", "sarcini", "docTemplates"):
            a, b = _count(src_ws.reference.collection(coll)), _count(dst_ws.collection(coll))
            if a != b:
                problems.append(f"{src_ws.id}/{coll}: sursă {a} ≠ țintă {b}")
        for c in dst_ws.collection("clienti").stream():
            _, plain = migrate_pii.split_client(c.to_dict() or {})
            if plain:
                problems.append(f"{src_ws.id}/clienti/{c.id}: CNP/serie încă în clar")
    a, b = _count(source.collection("users")), _count(target.collection("users"))
    if a != b:
        problems.append(f"users: sursă {a} ≠ țintă {b}")
    return problems


def run(source, target, dry_run: bool = False, only_workspaces: list[str] | None = None) -> Report:
    import authz
    import vault

    report = Report()
    authz._db = target  # vault-ul își ține cheile de workspace în baza țintă
    member_uids: set[str] = set()
    for src_ws in source.collection("workspaces").stream():
        if only_workspaces and src_ws.id not in only_workspaces:
            continue
        member_uids |= set((src_ws.to_dict() or {}).get("members", {}) or {})
        migrate_workspace(src_ws, target, report, dry_run, vault)
    # Cu filtru pe cabinete, se copiază doar conturile membre ale lor (repetiții locale pe datele propriului cont).
    migrate_users(source, target, report, dry_run, member_uids if only_workspaces else None)
    migrate_invitations(source, target, report, dry_run)
    return report


# ── CLI ──────────────────────────────────────────────────────────────────────

@contextmanager
def _env(name: str, value: str | None):
    """Setează/șterge temporar o variabilă de mediu (clientul Firestore o citește la construire)."""
    old = os.environ.get(name)
    if value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = value
    try:
        yield
    finally:
        if old is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = old


def make_client(project: str, credentials_file: str | None, emulator_host: str | None):
    from google.cloud import firestore
    with _env("FIRESTORE_EMULATOR_HOST", emulator_host):
        if credentials_file:
            from google.oauth2 import service_account
            creds = service_account.Credentials.from_service_account_file(credentials_file)
            return firestore.Client(project=project, credentials=creds)
        return firestore.Client(project=project)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True, help="ID-ul proiectului vechi")
    ap.add_argument("--target", required=True, help="ID-ul proiectului nou")
    ap.add_argument("--source-credentials", help="fișier de service account pentru sursă (altfel ADC)")
    ap.add_argument("--workspace", action="append", help="migrează doar acest workspace (repetabil)")
    ap.add_argument("--dry-run", action="store_true", help="doar numără; nu scrie nimic")
    ap.add_argument("--verify-only", action="store_true", help="doar compară sursa cu ținta")
    args = ap.parse_args()

    target_emulator = os.environ.get("FIRESTORE_EMULATOR_HOST")
    source = make_client(args.source, args.source_credentials, None)   # sursa e mereu cloud real
    target = make_client(args.target, None, target_emulator)
    print(f"Sursă: {args.source} (cloud) → țintă: {args.target} ({'EMULATOR ' + target_emulator if target_emulator else 'cloud'})")

    if not args.verify_only:
        report = run(source, target, args.dry_run, args.workspace)
        print("Rezultat" + (" (dry-run, nimic scris)" if args.dry_run else "") + ":")
        for k in sorted(report):
            print(f"  {k}: {report[k]}")
    if not args.dry_run:
        problems = verify(source, target, args.workspace)
        if problems:
            print("PROBLEME la verificare:")
            for p in problems:
                print("  -", p)
            sys.exit(1)
        print("Verificare: numărul de documente coincide și nu există CNP în clar în țintă.")


if __name__ == "__main__":
    main()
