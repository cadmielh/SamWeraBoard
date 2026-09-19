"""Teste pentru vault.py + pii_api.py contra emulatorului Firestore.

Rulare (din rădăcina repo-ului):
    firebase emulators:exec --only firestore --project demo-samwera \
        ".venv/bin/python -m pytest tests/test_pii_api.py -q"
"""
import base64
import os
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore"
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask  # noqa: E402
from google.cloud import firestore as gcf  # noqa: E402

import authz  # noqa: E402
import pii_api  # noqa: E402
import vault  # noqa: E402
import workspaces_api  # noqa: E402

CONSENT = {"tos": workspaces_api.TOS_VERSION, "dpa": workspaces_api.DPA_VERSION}
CNP = "1800101221144"
CNP2 = "2900202334455"
CID = "clientAAAAAAAAAAA1"
PID1 = "person-aaaa-0001"
PID2 = "person-bbbb-0002"


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("VAULT_LOCAL_KEK", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.delenv("VAULT_KMS_KEY", raising=False)
    vault._cache.clear()
    client = gcf.Client(project="demo-samwera")
    for coll in ("workspaces", "invitations", "users", "workspaceKeys"):
        for d in client.collection(coll).stream():
            client.recursive_delete(d.reference)
    monkeypatch.setattr(authz, "db", lambda: client)

    def fake_authenticate():
        from flask import request
        raw = request.headers.get("X-Test-User", "")
        if not raw:
            raise authz.AuthError(401)
        uid, email = raw.split(":")
        return authz.Principal(uid=uid, email=email, name=uid)

    monkeypatch.setattr(authz, "authenticate", fake_authenticate)
    app = Flask(__name__)
    app.register_blueprint(workspaces_api.bp)
    app.register_blueprint(pii_api.bp)
    return app.test_client(), client


def call(c, uid, method, url, wid=None, **kw):
    hdr = {"X-Test-User": f"{uid}:{uid}@ex.ro"}
    if wid:
        hdr["X-Workspace-Id"] = wid
    return getattr(c, method)(url, headers=hdr, **kw)


def setup_ws(c, db):
    wid = call(c, "alice", "post", "/workspaces", json={"name": "Cabinet", "consent": CONSENT}).get_json()["id"]
    db.collection("workspaces").document(wid).update({
        "members.bob": {"role": "member", "email": "bob@ex.ro"},
        "members.vera": {"role": "viewer", "email": "vera@ex.ro"},
    })
    db.collection("workspaces").document(wid).collection("clienti").document(CID).set({"denumire": "X"})
    return wid


def put(c, uid, wid, persons, keep=None, cid=CID):
    body = {"persons": persons}
    if keep is not None:
        body["keep"] = keep
    return call(c, uid, "put", f"/clients/{cid}/pii", wid=wid, json=body)


def get(c, uid, wid, purpose="view", cid=CID):
    return call(c, uid, "get", f"/clients/{cid}/pii?purpose={purpose}", wid=wid)


# ── Criptare ─────────────────────────────────────────────────────────────────
def test_roundtrip_and_ciphertext_is_opaque(env):
    c, db = env
    wid = setup_ws(c, db)
    assert put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": "MX 123456"}}).status_code == 200
    r = get(c, "bob", wid)
    assert r.get_json()["persons"][PID1] == {"cnp": CNP, "serie_numar": "MX 123456"}

    raw = db.collection("workspaces").document(wid).collection("clienti").document(CID) \
        .collection("pii").document("vault").get().to_dict()
    token = raw["persons"][PID1]
    assert CNP not in token and "MX 123456" not in token and token.startswith("v1.")
    key_doc = db.collection("workspaceKeys").document(wid).get().to_dict()
    assert CNP not in str(key_doc) and key_doc["kekType"] == "local"


def test_ciphertext_bound_to_location(env):
    c, db = env
    wid = setup_ws(c, db)
    put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": ""}})
    vref = db.collection("workspaces").document(wid).collection("clienti").document(CID).collection("pii").document("vault")
    token = vref.get().to_dict()["persons"][PID1]
    with pytest.raises(vault.VaultError):
        vault.decrypt_record(wid, CID, PID2, token)             # alt person id
    with pytest.raises(vault.VaultError):
        vault.decrypt_record(wid, "altClientAAAAAAA1", PID1, token)  # alt client
    with pytest.raises(vault.VaultError):
        vault.decrypt_record("altWorkspaceAAAA1", CID, PID1, token)  # alt workspace


def test_each_workspace_has_its_own_key(env):
    c, db = env
    w1 = setup_ws(c, db)
    w2 = call(c, "zed", "post", "/workspaces", json={"name": "Alt", "consent": CONSENT}).get_json()["id"]
    put(c, "bob", w1, {PID1: {"cnp": CNP, "serie_numar": ""}})
    call(c, "zed", "put", f"/clients/{CID}/pii", wid=w2, json={"persons": {PID1: {"cnp": CNP2, "serie_numar": ""}}})
    k1 = db.collection("workspaceKeys").document(w1).get().to_dict()["wrapped"]
    k2 = db.collection("workspaceKeys").document(w2).get().to_dict()["wrapped"]
    assert k1 != k2


def test_fails_closed_without_kek(env, monkeypatch):
    c, db = env
    wid = setup_ws(c, db)
    monkeypatch.delenv("VAULT_LOCAL_KEK")
    vault._cache.clear()
    r = put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": ""}})
    assert r.status_code == 503 and r.get_json()["error"] == "vault_unavailable"


def test_destroying_key_makes_data_unreadable(env):
    c, db = env
    wid = setup_ws(c, db)
    put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": ""}})
    vault.destroy_workspace_key(wid)
    # se generează o cheie nouă: vechiul ciphertext nu se mai poate citi
    r = get(c, "bob", wid).get_json()
    assert r["persons"] == {} and r["failed"] == 1


# ── Autorizare ───────────────────────────────────────────────────────────────
def test_authorization_matrix(env):
    c, db = env
    wid = setup_ws(c, db)
    p = {PID1: {"cnp": CNP, "serie_numar": ""}}
    assert call(c, "bob", "put", f"/clients/{CID}/pii", json={"persons": p}).status_code == 403  # fără workspace
    assert put(c, "mallory", wid, p).status_code == 403          # străin
    assert put(c, "vera", wid, p).status_code == 403             # viewer nu scrie
    assert put(c, "bob", wid, p).status_code == 200
    assert get(c, "vera", wid).status_code == 200                # viewer poate citi
    assert get(c, "mallory", wid).status_code == 403
    assert c.get(f"/clients/{CID}/pii").status_code == 401       # fără token


def test_other_workspace_cannot_read_by_guessing_ids(env):
    c, db = env
    w1 = setup_ws(c, db)
    w2 = call(c, "zed", "post", "/workspaces", json={"name": "Alt", "consent": CONSENT}).get_json()["id"]
    put(c, "bob", w1, {PID1: {"cnp": CNP, "serie_numar": ""}})
    r = call(c, "zed", "get", f"/clients/{CID}/pii", wid=w2)
    assert r.status_code == 200 and r.get_json()["persons"] == {}   # vault-ul lui w2 e gol
    assert call(c, "zed", "get", f"/clients/{CID}/pii", wid=w1).status_code == 403


# ── Semantică scriere ────────────────────────────────────────────────────────
def test_merge_clear_and_keep_semantics(env):
    c, db = env
    wid = setup_ws(c, db)
    put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": "AB 1"}, PID2: {"cnp": CNP2, "serie_numar": ""}})
    # actualizează doar PID1; PID2 rămâne (nu e trimis, e în keep)
    put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": "AB 2"}}, keep=[PID1, PID2])
    got = get(c, "bob", wid).get_json()["persons"]
    assert got[PID1]["serie_numar"] == "AB 2" and got[PID2]["cnp"] == CNP2
    # golire explicită PID1
    put(c, "bob", wid, {PID1: {"cnp": "", "serie_numar": ""}}, keep=[PID1, PID2])
    got = get(c, "bob", wid).get_json()["persons"]
    assert PID1 not in got and PID2 in got
    # persoană scoasă din fișă (nu mai e în keep) => se șterge din vault
    put(c, "bob", wid, {}, keep=[])
    assert get(c, "bob", wid).get_json()["persons"] == {}


def test_input_validation(env):
    c, db = env
    wid = setup_ws(c, db)
    bad = [
        {PID1: {"cnp": "123", "serie_numar": ""}},
        {PID1: {"cnp": "abcdefghijklm", "serie_numar": ""}},
        {PID1: {"cnp": "", "serie_numar": "x" * 50}},
        {PID1: {"cnp": "", "serie_numar": "<script>"}},
        {"a/b": {"cnp": "", "serie_numar": ""}},
        {"x": {"cnp": "", "serie_numar": ""}},
    ]
    for p in bad:
        assert put(c, "bob", wid, p).status_code == 400, p
    assert put(c, "bob", wid, {f"person-{i:08d}": {"cnp": "", "serie_numar": ""} for i in range(pii_api.MAX_PERSONS + 1)}).status_code == 400
    assert call(c, "bob", "put", f"/clients/{CID}/pii", wid=wid, data="not json").status_code == 400
    assert get(c, "bob", wid, purpose="hack").status_code == 400
    assert get(c, "bob", wid, cid="../x").status_code == 404


# ── Audit ────────────────────────────────────────────────────────────────────
def test_audit_records_access_without_values(env):
    c, db = env
    wid = setup_ws(c, db)
    put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": "MX 123456"}})
    get(c, "vera", wid, purpose="generate")
    log = call(c, "alice", "get", f"/workspaces/{wid}/audit").get_json()
    actions = [e["action"] for e in log]
    assert "pii.write" in actions and "pii.reveal" in actions
    reveal = next(e for e in log if e["action"] == "pii.reveal")
    assert reveal["actorUid"] == "vera" and reveal["meta"] == {"purpose": "generate", "persons": 1}
    blob = str(log)
    assert CNP not in blob and "MX 123456" not in blob


# ── Ștergere client cu cascadă ───────────────────────────────────────────────
def test_delete_client_cascades_and_requires_admin(env):
    c, db = env
    wid = setup_ws(c, db)
    put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": ""}})
    cref = db.collection("workspaces").document(wid).collection("clienti").document(CID)
    cref.collection("docGenerations").document("g1").set({"templateId": "t"})

    assert call(c, "bob", "delete", f"/clients/{CID}", wid=wid).status_code == 403  # member
    assert call(c, "alice", "delete", f"/clients/{CID}", wid=wid).status_code == 200
    assert not cref.get().exists
    assert not cref.collection("pii").document("vault").get().exists
    assert not cref.collection("docGenerations").document("g1").get().exists
    assert call(c, "alice", "delete", f"/clients/{CID}", wid=wid).status_code == 404


# ── Ramura Cloud KMS (cu client simulat: emulatorul nu are KMS) ──────────────
class _FakeKms:
    """Simulează KeyManagementServiceClient: „criptează” prin XOR și verifică AAD."""
    calls: list = []

    class _Resp:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    def encrypt(self, request):
        _FakeKms.calls.append(("encrypt", dict(request)))
        return self._Resp(ciphertext=bytes(b ^ 0x5A for b in request["plaintext"]) + request["additional_authenticated_data"])

    def decrypt(self, request):
        _FakeKms.calls.append(("decrypt", dict(request)))
        ct, aad = request["ciphertext"], request["additional_authenticated_data"]
        assert ct.endswith(aad), "AAD nu corespunde"
        return self._Resp(plaintext=bytes(b ^ 0x5A for b in ct[: -len(aad)]))


def test_kms_branch_wraps_and_unwraps_with_workspace_aad(env, monkeypatch):
    from google.cloud import kms
    c, db = env
    monkeypatch.delenv("VAULT_LOCAL_KEK")
    monkeypatch.setenv("VAULT_KMS_KEY", "projects/p/locations/europe-west3/keyRings/r/cryptoKeys/k")
    monkeypatch.setattr(kms, "KeyManagementServiceClient", _FakeKms)
    _FakeKms.calls.clear()
    vault._cache.clear()

    wid = setup_ws(c, db)
    assert put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": ""}}).status_code == 200
    key_doc = db.collection("workspaceKeys").document(wid).get().to_dict()
    assert key_doc["kekType"] == "kms"

    enc = [r for op, r in _FakeKms.calls if op == "encrypt"]
    assert len(enc) == 1
    assert enc[0]["name"] == "projects/p/locations/europe-west3/keyRings/r/cryptoKeys/k"
    assert enc[0]["additional_authenticated_data"] == f"dek:{wid}".encode()

    vault._cache.clear()  # forțează decriptarea DEK-ului prin KMS
    assert get(c, "bob", wid).get_json()["persons"][PID1]["cnp"] == CNP
    assert any(op == "decrypt" for op, _ in _FakeKms.calls)


def test_key_type_mismatch_fails_closed(env, monkeypatch):
    """Cheie generată cu KEK local nu se folosește niciodată în modul KMS (și invers)."""
    c, db = env
    wid = setup_ws(c, db)
    put(c, "bob", wid, {PID1: {"cnp": CNP, "serie_numar": ""}})          # creează cheie „local”
    monkeypatch.setenv("VAULT_KMS_KEY", "projects/p/locations/l/keyRings/r/cryptoKeys/k")
    vault._cache.clear()
    r = get(c, "bob", wid)
    # la citire eșecul se raportează per persoană (`failed`), fără să returneze date; frontend-ul îl tratează ca eroare
    assert r.status_code == 200 and r.get_json() == {"persons": {}, "failed": 1}
    # la scriere, aceeași nepotrivire închide accesul (503)
    assert put(c, "bob", wid, {PID2: {"cnp": CNP2, "serie_numar": ""}}).status_code == 503


# ── Consimțământ (workspace-uri migrate, fără acceptare) ─────────────────────
def _drop_consent(db, wid):
    from google.cloud import firestore as gcf_
    db.collection("workspaces").document(wid).update({"consent": gcf_.DELETE_FIELD})


def test_pii_is_blocked_until_admin_accepts_current_terms(env):
    c, db = env
    wid = setup_ws(c, db)
    p = {PID1: {"cnp": CNP, "serie_numar": ""}}
    _drop_consent(db, wid)                                            # ca un workspace migrat din proiectul vechi
    for r in (put(c, "bob", wid, p), get(c, "bob", wid)):
        assert r.status_code == 403 and r.get_json() == {"error": "consent_required"}

    v = {"tos": workspaces_api.TOS_VERSION, "dpa": workspaces_api.DPA_VERSION}
    assert call(c, "bob", "post", f"/workspaces/{wid}/consent", json=v).status_code == 403     # membrul nu acceptă
    assert call(c, "alice", "post", f"/workspaces/{wid}/consent", json={"tos": "x", "dpa": "y"}).status_code == 400
    assert call(c, "alice", "post", f"/workspaces/{wid}/consent", json=v).status_code == 200
    assert put(c, "bob", wid, p).status_code == 200 and get(c, "bob", wid).status_code == 200

    ws = db.collection("workspaces").document(wid).get().to_dict()["consent"]
    assert ws["tos"] == v["tos"] and ws["acceptedBy"] == "alice"
    log = call(c, "alice", "get", f"/workspaces/{wid}/audit").get_json()
    assert sum(1 for e in log if e["action"] == "consent.accept") >= 2       # la creare + la reacceptare


def test_outdated_terms_version_requires_reacceptance(env):
    c, db = env
    wid = setup_ws(c, db)
    db.collection("workspaces").document(wid).update({"consent.tos": "versiune-veche"})
    r = get(c, "bob", wid)
    assert r.status_code == 403 and r.get_json() == {"error": "consent_required"}


def test_deleting_a_client_is_never_blocked_by_missing_consent(env):
    c, db = env
    wid = setup_ws(c, db)
    _drop_consent(db, wid)
    assert call(c, "alice", "delete", f"/clients/{CID}", wid=wid).status_code == 200


# ── Normalizarea seriei scanate pe două linii (bug găsit pe datele reale) ────
def test_serie_with_line_break_from_ocr_is_normalized_and_saved(env):
    """56 din 176 de persoane din datele reale aveau seria „MX⏎123456”: serverul le respingea cu invalid_person."""
    c, db = env
    wid = setup_ws(c, db)
    p = {PID1: {"cnp": CNP, "serie_numar": "MX\n123456"}, PID2: {"cnp": "1 800101 221144", "serie_numar": "  TM \t 99\r\n88 "}}
    assert put(c, "bob", wid, p).status_code == 200
    got = get(c, "bob", wid).get_json()["persons"]
    assert got[PID1] == {"cnp": CNP, "serie_numar": "MX 123456"}
    assert got[PID2] == {"cnp": "1800101221144", "serie_numar": "TM 99 88"}


def test_normalization_does_not_weaken_validation(env):
    c, db = env
    wid = setup_ws(c, db)
    for bad in (
        {"cnp": "123", "serie_numar": ""},                        # CNP prea scurt
        {"cnp": "18001012211445", "serie_numar": ""},             # 14 cifre
        {"cnp": "", "serie_numar": "MX <script>"},                # caractere interzise
        {"cnp": "", "serie_numar": "A" * 31},                     # peste 30 după normalizare
    ):
        assert put(c, "bob", wid, {PID1: bad}).status_code == 400, bad
    assert put(c, "bob", wid, {PID1: {"cnp": "", "serie_numar": "A" * 30}}).status_code == 200


def test_normalization_rules_are_identical_in_migration_and_api():
    import pii_api
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import migrate_pii
    for v in ("MX\n123456", "  a \t b ", "", None, "MX 123456", "1 800101 221144", "\r\n"):
        assert pii_api.normalize_serie(v) == migrate_pii.normalize_serie(v)
        assert pii_api.normalize_cnp(v) == migrate_pii.normalize_cnp(v)
