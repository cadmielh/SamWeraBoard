"""Ce ajunge în arhiva încărcată la deploy-ul funcțiilor.

Firebase CLI ignoră `.firebaseignore` pentru funcții: singura protecție e `functions[0].ignore` din firebase.json.
La primul deploy lipsea, iar arhiva (740 MB) conținea `.venv`, cheia de service account și fișierele .env locale.
Testul de mai jos păstrează excluderile obligatorii.
"""
import fnmatch
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IGNORE = json.loads((ROOT / "firebase.json").read_text(encoding="utf-8"))["functions"][0]["ignore"]

MUST_IGNORE = [
    ".venv", "venv", "node_modules", "frontend", "tests",              # dependențe și cod care nu rulează în funcție
    ".env", ".env.local", ".env.samwera-board-eu", "firebase-service-account.json",   # secrete/mediu (mediul se transmite din .env.<proiect>)
    "credentials.json", "token.json", ".emulator-data-google", "firebase-export-abc123",   # chei și date reale de test
    "migrare.zip", "firestore-debug.log",
    "fisiere_template/SabloaneAvocatTavi", "fisiere_template/3 Hot AGA_original.docx", "fisiere_template/Facturare_Sami_Adi.xlsx",   # documente reale ale unor clienți (CNP, adrese), nefolosite de aplicație
]
MUST_SHIP = ["app.py", "main.py", "authz.py", "billing.py", "billing_api.py", "billing_webhook_app.py", "vault.py", "ratelimit.py", "workspace_deletion.py", "templates_api.py", "template_safety.py", "variants.py", "blanks.py", "doc_filler.py", "requirements.txt",
             "fisiere_template/registry.json", "fonts/DejaVuSans.ttf", "local_extractor.py"]


def ignored(path: str) -> bool:
    parts = path.split("/")
    for pat in IGNORE:
        if fnmatch.fnmatch(path, pat) or any(fnmatch.fnmatch(p, pat) for p in parts):
            return True
    return False


def test_secrets_and_local_data_never_ship():
    for p in MUST_IGNORE:
        assert ignored(p), f"{p} ar fi încărcat la deploy"
        assert ignored(f"{p}/x") or "." in Path(p).name, f"conținutul lui {p} ar fi încărcat"


def test_runtime_files_are_still_shipped():
    for p in MUST_SHIP:
        assert (ROOT / p).exists(), p
        assert not ignored(p), f"{p} e necesar la rulare, dar ar fi exclus"


def test_only_the_expected_python_modules_ship():
    """Orice modul Python nou din rădăcină trebuie să ajungă în cloud (dacă e importat) — nu le excludem prin greșeală."""
    for py in ROOT.glob("*.py"):
        assert not ignored(py.name), py.name


def test_production_env_is_invite_only():
    env = (ROOT / ".env.samwera-board-eu").read_text(encoding="utf-8")
    assert "SIGNUP_MODE=invite" in env.splitlines()


def test_csp_is_enforced_and_allows_the_firebase_auth_frame():
    """Firebase Auth încarcă un cadru de pe domeniul aplicației (authDomain = cabinio.ro): fără 'self' în frame-src, login-ul se strică."""
    hosting = json.loads((ROOT / "firebase.json").read_text(encoding="utf-8"))["hosting"]
    for site in hosting:
        headers = {h["key"]: h["value"] for block in site["headers"] for h in block["headers"]}
        assert "Content-Security-Policy-Report-Only" not in headers
        directives = dict(d.strip().split(" ", 1) for d in headers["Content-Security-Policy"].split(";") if d.strip())
        assert "'self'" in directives["frame-src"].split()
        assert "https://accounts.google.com/gsi/client" in directives["script-src"].split()
        assert directives["frame-ancestors"] == "'none'" and directives["object-src"] == "'none'"
