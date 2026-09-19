"""Autentificare și autorizare pe workspace (server-side).

Punctul unic prin care trece orice cerere care atinge date de client. Regulile
Firestore protejează accesul direct din browser; aici protejăm API-ul, care
folosește Admin SDK (ocolește regulile) și deci trebuie să verifice singur
apartenența la workspace și rolul.

Roluri (ordonate): viewer < member < admin.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

from firebase_admin import auth as fb_auth, firestore
from flask import request

import legal_versions

ROLE_RANK = {"viewer": 1, "member": 2, "admin": 3}
_WID_RE = re.compile(r"^[A-Za-z0-9]{10,40}$")

_db = None


def db():
    global _db
    if _db is None:
        if os.getenv("FIRESTORE_EMULATOR_HOST"):
            # Dezvoltare locală: Firestore emulat, fără credențiale de cloud.
            from google.cloud import firestore as gcf
            _db = gcf.Client(project=os.getenv("GCLOUD_PROJECT", "demo-samwera"))
        else:
            _db = firestore.client()
    return _db


class AuthError(PermissionError):
    """401 = neautentificat, 403 = autentificat dar fără drept. Mesajul către
    client e mereu generic (vezi `public`)."""

    def __init__(self, status: int = 401):
        super().__init__("Unauthorized" if status == 401 else "Forbidden")
        self.status = status

    @property
    def public(self) -> str:
        return "Unauthorized" if self.status == 401 else "Forbidden"


class ConsentRequired(AuthError):
    """Workspace-ul nu a acceptat versiunea curentă a termenilor/DPA: 403 cu cod distinct,
    ca aplicația să afișeze ecranul de acceptare (nu un simplu „interzis”)."""

    def __init__(self):
        super().__init__(403)

    @property
    def public(self) -> str:
        return "consent_required"


class RateLimited(AuthError):
    """Prea multe cereri: 429 cu `Retry-After` (secunde)."""

    def __init__(self, retry_after: int = 60):
        super().__init__(429)
        self.retry_after = retry_after

    @property
    def public(self) -> str:
        return "rate_limited"


def error_response(e: AuthError):
    """Răspunsul JSON standard pentru o eroare de acces (cod, mesaj generic, `Retry-After` dacă există)."""
    from flask import jsonify
    resp = jsonify({"error": e.public})
    resp.status_code = e.status
    if getattr(e, "retry_after", None):
        resp.headers["Retry-After"] = str(int(e.retry_after))
    return resp


@dataclass(frozen=True)
class Principal:
    uid: str
    email: str
    name: str


def _dev_verify_only() -> bool:
    """Doar pentru dezvoltare locală cu Firebase Auth REAL și Firestore emulat.

    Admin SDK nu poate verifica token-uri reale fără credențiale de cloud, așa că local
    verificăm doar semnătura/emitentul/audiența/expirarea (cu certificatele publice Google).
    Nu se verifică revocarea. Modul cere ambele condiții de mai jos și nu poate fi activat
    în Cloud Run / Cloud Functions (`K_SERVICE` e setat acolo) sau fără Firestore emulat.
    """
    return (
        os.getenv("AUTH_DEV_VERIFY_ONLY") == "1"
        and bool(os.getenv("FIRESTORE_EMULATOR_HOST"))
        and not os.getenv("K_SERVICE")
    )


def _verify_token(id_token: str) -> dict:
    if _dev_verify_only():
        from google.auth.transport import requests as g_requests
        from google.oauth2 import id_token as g_id_token
        claims = g_id_token.verify_firebase_token(
            id_token, g_requests.Request(), audience=os.environ["GCLOUD_PROJECT"])
        return {**claims, "uid": claims.get("user_id") or claims["sub"]}
    return fb_auth.verify_id_token(id_token, check_revoked=True)


def authenticate() -> Principal:
    """Verifică ID token-ul Firebase: nerevocat, cu e-mail verificat."""
    id_token = request.headers.get("X-Firebase-Token", "")
    try:
        decoded = _verify_token(id_token)
    except Exception as e:
        print(f"[auth] token rejected: {type(e).__name__}")
        raise AuthError(401)
    if not decoded.get("email_verified", False):
        raise AuthError(401)
    return Principal(
        uid=decoded["uid"],
        email=(decoded.get("email") or "").lower(),
        name=decoded.get("name") or decoded.get("email") or "",
    )


def valid_wid(wid: str) -> bool:
    return bool(wid) and bool(_WID_RE.match(wid))


def load_workspace(wid: str) -> dict | None:
    if not valid_wid(wid):
        return None
    snap = db().collection("workspaces").document(wid).get()
    return snap.to_dict() if snap.exists else None


def consent_ok(ws: dict) -> bool:
    c = ws.get("consent") or {}
    return c.get("tos") == legal_versions.TOS_VERSION and c.get("dpa") == legal_versions.DPA_VERSION


def require_role(principal: Principal, wid: str, min_role: str = "member", consent: bool = False) -> dict:
    """Întoarce documentul workspace-ului dacă utilizatorul e membru cu rol
    suficient; altfel AuthError(403). Nu distinge între „nu există” și „nu ești
    membru”, ca să nu dezvăluie existența unor workspace-uri străine."""
    ws = load_workspace(wid)
    if ws is None or ws.get("status") == "pendingDeletion":
        raise AuthError(403)
    member = (ws.get("members") or {}).get(principal.uid)
    if not member or ROLE_RANK.get(member.get("role"), 0) < ROLE_RANK[min_role]:
        raise AuthError(403)
    if consent and not consent_ok(ws):
        raise ConsentRequired()
    return ws


def client_ip() -> str:
    xff = request.headers.get("X-Forwarded-For", "")
    return (xff.split(",")[0].strip() or request.remote_addr or "")[:64]


def require_from_header(min_role: str = "member", consent: bool = False,
                        limit: str | None = None) -> tuple[Principal, str, dict]:
    """Autentifică și autorizează pe workspace-ul din `X-Workspace-Id`.
    `consent=True`: cere și acceptarea versiunii curente a termenilor/DPA (operațiuni cu date personale).
    `limit`: numele acțiunii din `ratelimit.LIMITS` (contor per utilizator/workspace)."""
    principal = authenticate()
    wid = request.headers.get("X-Workspace-Id", "")
    ws = require_role(principal, wid, min_role, consent=consent)
    if limit:
        import ratelimit
        ratelimit.check(principal.uid, wid, limit)
    return principal, wid, ws
