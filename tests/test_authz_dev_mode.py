"""Garda modului local „Auth real + Firestore emulat” (authz._dev_verify_only) și
comportamentul lui `authenticate`. Nu au nevoie de emulatoare."""
import sys
from pathlib import Path

import pytest
from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import authz  # noqa: E402


@pytest.fixture()
def clean_env(monkeypatch):
    for k in ("AUTH_DEV_VERIFY_ONLY", "FIRESTORE_EMULATOR_HOST", "K_SERVICE", "GCLOUD_PROJECT"):
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_dev_mode_is_off_by_default(clean_env):
    assert authz._dev_verify_only() is False


def test_dev_mode_requires_flag_and_emulated_firestore(clean_env):
    clean_env.setenv("AUTH_DEV_VERIFY_ONLY", "1")
    assert authz._dev_verify_only() is False           # fără Firestore emulat
    clean_env.delenv("AUTH_DEV_VERIFY_ONLY")
    clean_env.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
    assert authz._dev_verify_only() is False           # fără flag explicit
    clean_env.setenv("AUTH_DEV_VERIFY_ONLY", "1")
    assert authz._dev_verify_only() is True


def test_dev_mode_can_never_activate_on_cloud_run(clean_env):
    clean_env.setenv("AUTH_DEV_VERIFY_ONLY", "1")
    clean_env.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
    clean_env.setenv("K_SERVICE", "api")                # setat automat în Cloud Run / Functions gen2
    assert authz._dev_verify_only() is False


def _call_authenticate():
    app = Flask(__name__)
    with app.test_request_context(headers={"X-Firebase-Token": "tok"}):
        return authz.authenticate()


def test_prod_path_uses_admin_sdk_with_revocation_check(clean_env):
    seen = {}

    def fake_verify(token, check_revoked=False):
        seen["check_revoked"] = check_revoked
        return {"uid": "u1", "email": "A@Ex.ro", "email_verified": True, "name": "A"}

    clean_env.setattr(authz.fb_auth, "verify_id_token", fake_verify)
    p = _call_authenticate()
    assert seen["check_revoked"] is True
    assert (p.uid, p.email) == ("u1", "a@ex.ro")


def test_dev_path_verifies_google_signature_and_still_requires_verified_email(clean_env):
    from google.oauth2 import id_token as g_id_token
    clean_env.setenv("AUTH_DEV_VERIFY_ONLY", "1")
    clean_env.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
    clean_env.setenv("GCLOUD_PROJECT", "samwera-board-eu")

    calls = {}

    def fake_verify(token, request, audience=None):
        calls["audience"] = audience
        return {"sub": "g1", "user_id": "g1", "email": "a@ex.ro", "email_verified": True, "name": "A"}

    clean_env.setattr(g_id_token, "verify_firebase_token", fake_verify)
    assert _call_authenticate().uid == "g1"
    assert calls["audience"] == "samwera-board-eu"     # audiența = proiectul, nu orice token Google

    clean_env.setattr(g_id_token, "verify_firebase_token",
                      lambda *a, **k: {"sub": "g1", "email": "a@ex.ro", "email_verified": False})
    with pytest.raises(authz.AuthError):
        _call_authenticate()

    def boom(*a, **k):
        raise ValueError("Token used too late")
    clean_env.setattr(g_id_token, "verify_firebase_token", boom)
    with pytest.raises(authz.AuthError):
        _call_authenticate()
