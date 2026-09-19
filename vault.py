"""Criptare la nivel de câmp pentru datele cele mai sensibile (CNP, serie/număr CI).

Schema (envelope encryption):
  - fiecare workspace are o cheie de date (DEK, AES-256) generată la prima folosire;
  - DEK-ul e „învelit” (wrapped) cu o cheie din Cloud KMS (KEK, regiune UE) și doar
    forma învelită se păstrează în Firestore (`workspaceKeys/{wid}`, fără acces din client);
  - fiecare înregistrare se criptează cu AES-256-GCM, cu `wid:cid:pid` ca date
    autentificate (AAD): un ciphertext mutat în alt client/workspace nu se mai decriptează.

KEK: `VAULT_KMS_KEY` (calea resursei KMS) în producție. `VAULT_LOCAL_KEK` (32 de octeți,
base64) există DOAR pentru dezvoltare/teste; dacă niciuna nu e setată, vault-ul refuză
să funcționeze (fail closed) — nu există cheie implicită.
"""
from __future__ import annotations

import base64
import json
import os
import threading
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from google.api_core import exceptions as gexc
from google.cloud import firestore as _fs

import authz

_VERSION = "v1"
_DEK_TTL = 300  # secunde: limitează apelurile KMS, dar și cât trăiește o cheie în memorie
_cache: dict[str, tuple[bytes, float]] = {}
_lock = threading.Lock()


class VaultError(Exception):
    pass


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ── KEK: învelirea DEK-ului ──────────────────────────────────────────────────

def _kek_type() -> str:
    if os.getenv("VAULT_KMS_KEY"):
        return "kms"
    if os.getenv("VAULT_LOCAL_KEK"):
        return "local"
    raise VaultError("vault not configured")


def _wrap(dek: bytes, wid: str, kek_type: str) -> str:
    aad = f"dek:{wid}".encode()
    if kek_type == "kms":
        from google.cloud import kms
        resp = kms.KeyManagementServiceClient().encrypt(request={
            "name": os.environ["VAULT_KMS_KEY"], "plaintext": dek,
            "additional_authenticated_data": aad,
        })
        return _b64e(resp.ciphertext)
    kek = _b64d(os.environ["VAULT_LOCAL_KEK"])
    nonce = os.urandom(12)
    return _b64e(nonce + AESGCM(kek).encrypt(nonce, dek, aad))


def _unwrap(blob: str, wid: str, kek_type: str) -> bytes:
    aad = f"dek:{wid}".encode()
    raw = _b64d(blob)
    if kek_type == "kms":
        from google.cloud import kms
        resp = kms.KeyManagementServiceClient().decrypt(request={
            "name": os.environ["VAULT_KMS_KEY"], "ciphertext": raw,
            "additional_authenticated_data": aad,
        })
        return resp.plaintext
    kek = _b64d(os.environ["VAULT_LOCAL_KEK"])
    return AESGCM(kek).decrypt(raw[:12], raw[12:], aad)


# ── DEK per workspace ────────────────────────────────────────────────────────

def _key_ref(wid: str):
    return authz.db().collection("workspaceKeys").document(wid)


def _get_dek(wid: str) -> bytes:
    now = time.time()
    with _lock:
        hit = _cache.get(wid)
        if hit and hit[1] > now:
            return hit[0]

    snap = _key_ref(wid).get()
    if snap.exists:
        d = snap.to_dict()
        if d.get("kekType") != _kek_type():
            raise VaultError("key type mismatch")
        dek = _unwrap(d["wrapped"], wid, d["kekType"])
    else:
        kek_type = _kek_type()
        dek = AESGCM.generate_key(bit_length=256)
        try:
            _key_ref(wid).create({
                "wrapped": _wrap(dek, wid, kek_type),
                "kekType": kek_type,
                "createdAt": _fs.SERVER_TIMESTAMP,
            })
        except gexc.AlreadyExists:  # altă instanță a creat-o între timp
            d = _key_ref(wid).get().to_dict()
            dek = _unwrap(d["wrapped"], wid, d["kekType"])

    with _lock:
        _cache[wid] = (dek, now + _DEK_TTL)
    return dek


def forget_cached_key(wid: str) -> None:
    with _lock:
        _cache.pop(wid, None)


def destroy_workspace_key(wid: str) -> None:
    """Șterge DEK-ul workspace-ului: datele criptate devin ilizibile. Notă: copiile
    din backup-uri conțin DEK-ul învelit până expiră retenția backup-ului (vezi
    politica de retenție); distrugerea completă cere KEK per workspace."""
    forget_cached_key(wid)
    _key_ref(wid).delete()


# ── Înregistrări ─────────────────────────────────────────────────────────────

def _aad(wid: str, cid: str, pid: str) -> bytes:
    return f"{wid}:{cid}:{pid}".encode()


def encrypt_record(wid: str, cid: str, pid: str, data: dict) -> str:
    nonce = os.urandom(12)
    ct = AESGCM(_get_dek(wid)).encrypt(
        nonce, json.dumps(data, separators=(",", ":")).encode(), _aad(wid, cid, pid))
    return f"{_VERSION}.{_b64e(nonce)}.{_b64e(ct)}"


def decrypt_record(wid: str, cid: str, pid: str, token: str) -> dict:
    try:
        ver, nonce, ct = token.split(".")
        if ver != _VERSION:
            raise ValueError("version")
        pt = AESGCM(_get_dek(wid)).decrypt(_b64d(nonce), _b64d(ct), _aad(wid, cid, pid))
        return json.loads(pt)
    except VaultError:
        raise
    except Exception as e:
        raise VaultError("decrypt failed") from e
