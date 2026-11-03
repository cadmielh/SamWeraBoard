"""Funcția zilnică `purge_deletions` (main.py) rulează într-o instanță fără app.py, deci fără Firebase Admin inițializat.

Pe emulator `authz.db()` nu are nevoie de aplicația Firebase, așa că testele de ștergere nu prind lipsa inițializării.
Aici se verifică într-un proces separat, fără emulator, că funcția o face înainte de a atinge baza sau contul.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCRIPT = """
import firebase_admin
import main
import workspace_deletion

seen = {}
def fake_purge_due(db, delete_user):
    seen["apps"] = bool(firebase_admin._apps)
    return {}

workspace_deletion.purge_due = fake_purge_due
import authz
authz.db = lambda: None
assert not firebase_admin._apps
main.purge_deletions.__wrapped__(None)          # funcția Python, fără decoratorul scheduler_fn
assert seen == {"apps": True}, seen
print("ok")
"""


def test_purge_initializes_firebase_admin_before_use():
    env = {"PATH": "", "GOOGLE_APPLICATION_CREDENTIALS": str(ROOT / "nu-exista.json"), "GCLOUD_PROJECT": "demo-samwera"}
    r = subprocess.run([sys.executable, "-c", SCRIPT], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and r.stdout.strip().endswith("ok"), r.stderr[-2000:]
