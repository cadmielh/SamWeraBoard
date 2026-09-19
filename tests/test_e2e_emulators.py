"""End-to-end cu emulatoarele Firebase Auth + Firestore, folosind token-uri reale
(semnate de emulator) pe aplicația Flask completă (`app.py`), nu simulări.

Acoperă ce testele unitare nu pot: `verify_id_token(check_revoked=True)`, condiția
`email_verified`, autorizarea pe workspace a rutelor existente (OCR etc.) și fluxul
complet workspace → invitație → vault, cu identități distincte.

Rulare (din rădăcina repo-ului):
    firebase emulators:exec --only auth,firestore --project demo-samwera \
        ".venv/bin/python -m pytest tests/test_e2e_emulators.py -q"
"""
import base64
import io
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    not (os.getenv("FIRESTORE_EMULATOR_HOST") and os.getenv("FIREBASE_AUTH_EMULATOR_HOST")),
    reason="necesită emulatoarele Auth + Firestore",
)

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

PROJECT = "demo-samwera"
CNP = "1800101221144"
PID = "person-e2e-0001"
CID = "clientE2E0000000001"


@pytest.fixture(scope="module")
def app_ctx():
    # Nu încărcăm cheia reală de service account din repo: totul rulează contra emulatoarelor.
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/nonexistent/none.json"
    os.environ["GCLOUD_PROJECT"] = PROJECT
    os.environ["FRONTEND_ORIGIN"] = "https://samwera-board.web.app"
    os.environ["VAULT_LOCAL_KEK"] = base64.b64encode(os.urandom(32)).decode()
    os.environ.pop("VAULT_KMS_KEY", None)

    import app as flask_app  # noqa: PLC0415  (importat după setarea mediului)
    import authz  # noqa: PLC0415
    from google.cloud import firestore as gcf  # noqa: PLC0415

    db = gcf.Client(project=PROJECT)
    original_db, original_limiter = authz.db, flask_app.limiter.enabled
    authz.db = lambda: db  # Firestore-ul emulat, fără credențiale ADC
    flask_app.limiter.enabled = False
    yield flask_app.app.test_client(), db
    authz.db, flask_app.limiter.enabled = original_db, original_limiter   # nu lăsăm patch-uri pentru alte teste


def _idp_sign_in(sub: str, email: str, verified: bool = True) -> dict:
    """Autentificare „Google” prin emulator (signInWithIdp) — același traseu ca în producție."""
    host = os.environ["FIREBASE_AUTH_EMULATOR_HOST"]
    fake_google_token = json.dumps({"sub": sub, "email": email, "email_verified": verified, "name": sub})
    body = json.dumps({
        "postBody": f"id_token={fake_google_token}&providerId=google.com",
        "requestUri": "http://localhost", "returnIdpCredential": True, "returnSecureToken": True,
    }).encode()
    req = urllib.request.Request(
        f"http://{host}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake",
        data=body, headers={"Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req))


def hdr(token: str, wid: str | None = None) -> dict:
    h = {"X-Firebase-Token": token}
    if wid:
        h["X-Workspace-Id"] = wid
    return h


def make_ws(c, token, name="Cabinet E2E"):
    from workspaces_api import DPA_VERSION, TOS_VERSION
    r = c.post("/workspaces", headers=hdr(token), json={"name": name, "consent": {"tos": TOS_VERSION, "dpa": DPA_VERSION}})
    assert r.status_code == 201, r.get_json()
    return r.get_json()["id"]


# ── Autentificare reală ──────────────────────────────────────────────────────
def test_google_signin_yields_verified_email_and_is_accepted(app_ctx):
    c, _ = app_ctx
    s = _idp_sign_in("g-alice-1", "alice1@ex.ro")
    assert make_ws(c, s["idToken"])  # cont Google cu e-mail verificat => acceptat


def test_unverified_email_is_rejected(app_ctx):
    c, _ = app_ctx
    s = _idp_sign_in("g-mallory", "mallory@ex.ro", verified=False)
    r = c.post("/workspaces", headers=hdr(s["idToken"]), json={"name": "x"})
    assert r.status_code == 401 and r.get_json() == {"error": "Unauthorized"}


def test_missing_and_garbage_tokens_are_rejected(app_ctx):
    c, _ = app_ctx
    assert c.post("/workspaces", json={"name": "x"}).status_code == 401
    assert c.post("/workspaces", headers=hdr("not.a.token"), json={"name": "x"}).status_code == 401
    assert c.get("/invitations", headers=hdr("")).status_code == 401


def test_revoked_token_is_rejected(app_ctx):
    from firebase_admin import auth
    c, _ = app_ctx
    s = _idp_sign_in("g-revoke-me", "revoke@ex.ro")
    assert c.get("/invitations", headers=hdr(s["idToken"])).status_code == 200
    time.sleep(1.2)  # granularitate de secundă pentru `validSince`
    auth.revoke_refresh_tokens(s["localId"])
    assert c.get("/invitations", headers=hdr(s["idToken"])).status_code == 401


# ── Autorizarea rutelor existente (OCR etc.) ─────────────────────────────────
def test_existing_routes_require_workspace_membership(app_ctx):
    c, _ = app_ctx
    alice = _idp_sign_in("g-alice-2", "alice2@ex.ro")["idToken"]
    eve = _idp_sign_in("g-eve", "eve@ex.ro")["idToken"]
    wid = make_ws(c, alice)

    # fără header de workspace / workspace străin / inexistent => 403
    assert c.post("/extract", headers=hdr(alice)).status_code == 403
    assert c.post("/extract", headers=hdr(eve, wid)).status_code == 403
    assert c.post("/extract", headers=hdr(alice, "workspaceInexistent1")).status_code == 403
    assert c.get("/templates/builtin", headers=hdr(eve, wid)).status_code == 403
    # membru => trece de autorizare și ajunge la validarea intrării (fără fișier => 400)
    assert c.post("/extract", headers=hdr(alice, wid)).status_code == 400
    assert c.get("/templates/builtin", headers=hdr(alice, wid)).status_code == 200
    # fără token => 401
    assert c.post("/extract", headers=hdr("", wid)).status_code == 401


# ── Flux complet: workspace → invitație → vault, cu identități reale ─────────
def test_full_flow_invite_accept_and_vault(app_ctx):
    c, db = app_ctx
    alice = _idp_sign_in("g-alice-3", "alice3@ex.ro")["idToken"]
    bob = _idp_sign_in("g-bob", "bob@ex.ro")["idToken"]
    eve = _idp_sign_in("g-eve-2", "eve2@ex.ro")["idToken"]
    wid = make_ws(c, alice)
    db.collection("workspaces").document(wid).collection("clienti").document(CID).set({"denumire": "Client"})

    # bob nu vede nimic până nu acceptă
    assert c.put(f"/clients/{CID}/pii", headers=hdr(bob, wid), json={"persons": {}}).status_code == 403

    r = c.post(f"/workspaces/{wid}/invites", headers=hdr(alice), json={"email": "bob@ex.ro", "role": "viewer"})
    assert r.status_code == 201
    inv = c.get("/invitations", headers=hdr(bob)).get_json()
    assert len(inv) == 1 and inv[0]["invitedByEmail"] == "alice3@ex.ro"
    assert c.get("/invitations", headers=hdr(eve)).get_json() == []          # eve nu vede invitația lui bob
    assert c.post(f"/invitations/{inv[0]['id']}/accept", headers=hdr(eve)).status_code == 404
    assert c.post(f"/invitations/{inv[0]['id']}/accept", headers=hdr(bob)).status_code == 200

    # alice scrie în vault; bob (viewer) poate citi dar nu scrie; eve nu poate nimic
    persons = {PID: {"cnp": CNP, "serie_numar": "MX 123456"}}
    assert c.put(f"/clients/{CID}/pii", headers=hdr(alice, wid), json={"persons": persons}).status_code == 200
    assert c.put(f"/clients/{CID}/pii", headers=hdr(bob, wid), json={"persons": persons}).status_code == 403
    got = c.get(f"/clients/{CID}/pii?purpose=view", headers=hdr(bob, wid)).get_json()
    assert got["persons"][PID]["cnp"] == CNP
    assert c.get(f"/clients/{CID}/pii", headers=hdr(eve, wid)).status_code == 403

    # audit: cine a citit, fără valori
    log = c.get(f"/workspaces/{wid}/audit", headers=hdr(alice, wid)).get_json()
    reveal = next(e for e in log if e["action"] == "pii.reveal")
    assert reveal["meta"]["purpose"] == "view" and CNP not in json.dumps(log)
    assert c.get(f"/workspaces/{wid}/audit", headers=hdr(bob, wid)).status_code == 403

    # ștergere client: doar admin, cu cascadă
    assert c.delete(f"/clients/{CID}", headers=hdr(bob, wid)).status_code == 403
    assert c.delete(f"/clients/{CID}", headers=hdr(alice, wid)).status_code == 200
    ref = db.collection("workspaces").document(wid).collection("clienti").document(CID)
    assert not ref.get().exists and not ref.collection("pii").document("vault").get().exists


def test_no_error_detail_leaks_to_client(app_ctx):
    c, _ = app_ctx
    tok = _idp_sign_in("g-alice-4", "alice4@ex.ro")["idToken"]
    wid = make_ws(c, tok)
    r = c.post("/fill/docx", headers=hdr(tok, wid))  # cerere invalidă (fără șablon)
    body = r.get_data(as_text=True)
    assert r.status_code in (400, 500)
    assert "Traceback" not in body and "site-packages" not in body


def test_cors_allows_only_configured_origins(app_ctx):
    import app as flask_app
    c, _ = app_ctx
    # Originile efective (din FRONTEND_ORIGIN; .env.local le poate suprascrie în dezvoltare).
    configured = flask_app._cors_origins
    assert configured and "*" not in configured
    good = configured[0]
    ok = c.options("/extract", headers={"Origin": good, "Access-Control-Request-Method": "POST"})
    bad = c.options("/extract", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("Access-Control-Allow-Origin") == good
    assert bad.headers.get("Access-Control-Allow-Origin") is None


def test_legacy_workspace_without_consent_blocks_ocr_until_admin_accepts(app_ctx):
    """Workspace migrat din proiectul vechi (fără acceptare): OCR-ul cere consimțământ."""
    from google.cloud import firestore as gcf
    from workspaces_api import DPA_VERSION, TOS_VERSION
    c, db = app_ctx
    admin = _idp_sign_in("g-legacy-admin", "legacyadmin@ex.ro")
    wid = make_ws(c, admin["idToken"], "Cabinet migrat")
    db.collection("workspaces").document(wid).update({"consent": gcf.DELETE_FIELD})

    r = c.post("/extract", headers=hdr(admin["idToken"], wid))
    assert r.status_code == 403 and r.get_json() == {"error": "consent_required"}
    assert c.post(f"/workspaces/{wid}/consent", headers=hdr(admin["idToken"]),
                  json={"tos": TOS_VERSION, "dpa": DPA_VERSION}).status_code == 200
    assert c.post("/extract", headers=hdr(admin["idToken"], wid)).status_code == 400      # trece de consimțământ; lipsește fișierul


def test_cors_preflight_allows_every_header_the_frontend_sends(app_ctx):
    """Regresie: fără X-Workspace-Id în allow_headers, browserul bloca toate apelurile cross-origin
    (preflight OK, cererea reală nu pleca)."""
    import app as flask_app
    c, _ = app_ctx
    origin = flask_app._cors_origins[0]
    sent = "content-type,x-firebase-token,x-workspace-id"   # ce trimite frontend/src/lib/api.ts (fără token Google)
    r = c.options("/workspaces/abc/consent", headers={
        "Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": sent})
    allowed = {h.strip().lower() for h in r.headers.get("Access-Control-Allow-Headers", "").split(",")}
    assert set(sent.split(",")) <= allowed, allowed
    assert "authorization" not in allowed          # serverul nu acceptă tokenul Google al utilizatorului
    ok = c.get("/health", headers={"Origin": origin})
    exposed = {h.strip().lower() for h in ok.headers.get("Access-Control-Expose-Headers", "").split(",")}
    assert {"retry-after", "content-disposition"} <= exposed       # frontend-ul le citește (mesaj 429, nume fișier)


# ── Audit pe OCR și generare de documente ────────────────────────────────────
VALID_CNP = "1800101221144"
SECRET_NAME = "Popescu-Secret"


class _FakeId:
    def __init__(self, fields):
        self._f = fields

    def model_dump(self):
        return dict(self._f)


def _audit_entries(c, token, wid, action):
    log = c.get(f"/workspaces/{wid}/audit?limit=500", headers=hdr(token, wid)).get_json()
    return [e for e in log if e["action"] == action], log


def _assert_no_personal_data(log):
    blob = json.dumps(log)
    for secret in (VALID_CNP, SECRET_NAME, "ci-secret.jpg", "Cnp-Secret-Doc"):
        assert secret not in blob, secret


def test_ocr_upload_is_audited_without_personal_data(app_ctx, monkeypatch):
    import azure_extractor
    import local_extractor
    c, _ = app_ctx
    tok = _idp_sign_in("g-ocr-1", "ocr1@ex.ro")["idToken"]
    wid = make_ws(c, tok)
    fields = {"cnp": VALID_CNP, "nume": SECRET_NAME, "prenume": "Ion", "serie_numar": "MX 123456"}
    monkeypatch.setattr(azure_extractor, "extract_from_bytes", lambda b, n: _FakeId(fields))
    monkeypatch.setattr(local_extractor, "_quality_score", lambda *_a, **_k: 1.0)      # Azure suficient

    r = c.post("/extract", headers=hdr(tok, wid), data={"file": (io.BytesIO(b"x" * 4096), "ci-secret.jpg")},
               content_type="multipart/form-data")
    assert r.status_code == 200 and r.get_json()["cnp"] == VALID_CNP

    entries, log = _audit_entries(c, tok, wid, "ocr.extract")
    assert len(entries) == 1
    assert entries[0]["meta"] == {"source": "upload", "engine": "azure", "outcome": "ok", "sizeKb": 4, "cnp": True}
    assert entries[0]["actorUid"] and entries[0]["ip"] is not None
    _assert_no_personal_data(log)


def test_ocr_local_fallback_and_empty_outcomes_are_audited(app_ctx, monkeypatch):
    import azure_extractor
    import local_extractor
    c, _ = app_ctx
    tok = _idp_sign_in("g-ocr-2", "ocr2@ex.ro")["idToken"]
    wid = make_ws(c, tok)
    up = lambda: {"file": (io.BytesIO(b"x" * 1024), "ci-secret.jpg")}                  # noqa: E731

    # Azure slab, OCR-ul local găsește ceva => engine local
    monkeypatch.setattr(azure_extractor, "extract_from_bytes", lambda b, n: _FakeId({"nume": "A"}))
    monkeypatch.setattr(local_extractor, "_quality_score", lambda f, **k: 0.0 if f.get("nume") == "A" else 0.9)
    monkeypatch.setattr(local_extractor, "extract_local", lambda b, n: ({"nume": SECRET_NAME, "cnp": ""}, 0.9))
    assert c.post("/extract", headers=hdr(tok, wid), data=up(), content_type="multipart/form-data").status_code == 200

    # Ambele motoare nu găsesc nimic => outcome empty
    def boom(b, n):
        raise RuntimeError("azure down")
    monkeypatch.setattr(azure_extractor, "extract_from_bytes", boom)
    monkeypatch.setattr(local_extractor, "extract_local", lambda b, n: ({}, 0.0))
    assert c.post("/extract", headers=hdr(tok, wid), data=up(), content_type="multipart/form-data").status_code == 200

    entries, log = _audit_entries(c, tok, wid, "ocr.extract")
    metas = sorted((e["meta"]["engine"], e["meta"]["outcome"], e["meta"]["cnp"]) for e in entries)
    assert metas == [("azure", "empty", False), ("local", "ok", False)]
    _assert_no_personal_data(log)


def test_ocr_source_is_only_reported_for_the_log_and_strictly_validated(app_ctx, monkeypatch):
    import azure_extractor
    import local_extractor
    c, _ = app_ctx
    tok = _idp_sign_in("g-ocr-3", "ocr3@ex.ro")["idToken"]
    wid = make_ws(c, tok)
    monkeypatch.setattr(azure_extractor, "extract_from_bytes", lambda b, n: _FakeId({"cnp": VALID_CNP, "nume": SECRET_NAME}))
    monkeypatch.setattr(local_extractor, "_quality_score", lambda *_a, **_k: 1.0)
    post = lambda **form: c.post("/extract", headers=hdr(tok, wid), content_type="multipart/form-data",   # noqa: E731
                                 data={"file": (io.BytesIO(b"x" * 1024), "ci-secret.jpg"), **form})
    assert post(source="drive").status_code == 200        # fișier adus din Drive de browser
    assert post(source="<script>alert(1)</script>").status_code == 200
    assert post().status_code == 200
    entries, log = _audit_entries(c, tok, wid, "ocr.extract")
    assert sorted(e["meta"]["source"] for e in entries) == ["drive", "upload", "upload"]      # valorile necunoscute devin „upload”
    _assert_no_personal_data(log)


def test_drive_routes_and_google_token_are_gone_from_the_server(app_ctx):
    """Cu drive.file, Drive/Docs se folosesc din browser: serverul nu mai are rute Drive și nu citește tokenul Google."""
    c, _ = app_ctx
    tok = _idp_sign_in("g-nodrive", "nodrive@ex.ro")["idToken"]
    wid = make_ws(c, tok)
    h = {**hdr(tok, wid), "Authorization": "Bearer ya29.token-google"}
    assert c.post("/extract/drive", headers=h, json={"file_id": "f"}).status_code == 404
    assert c.get("/drive/files", headers=h).status_code == 404
    assert c.post("/fill/gdoc", headers=h, json={"template_doc_id": "t", "fields": {}}).status_code == 404
    assert c.post("/fill/docx/upload-to-drive", headers=h, data={"template_builtin_key": "act_constitutiv"}).status_code == 404
    import app as flask_app
    src = Path(flask_app.__file__).read_text(encoding="utf-8")
    assert "gdrive" not in src and "access_token" not in src and "googleapiclient" not in src


def test_document_generation_is_audited_and_client_reports_are_validated(app_ctx):
    c, _ = app_ctx
    tok = _idp_sign_in("g-doc-1", "doc1@ex.ro")["idToken"]
    wid = make_ws(c, tok)
    h = hdr(tok, wid)
    form = {"template_builtin_key": "act_constitutiv", "CNP": VALID_CNP, "NUME": SECRET_NAME,
            "GOL": "", "_output_name": "Cnp-Secret-Doc.docx"}

    r = c.post("/fill/docx", headers=h, data=form)                                    # descărcare
    assert r.status_code == 200, r.get_data(as_text=True)[:200]
    assert c.post("/fill/docx", headers=h, data={**form, "_destination": "drive"}).status_code == 200   # browserul îl urcă în Drive
    assert c.post("/fill/docx", headers=h, data={**form, "_destination": "<x>"}).status_code == 200      # necunoscut => descărcare

    # Google Doc completat în browser: serverul primește doar un raport cu metadate
    rep = {"format": "gdoc", "template": "drive", "destination": "drive", "fields": 7, "cnp": True}
    assert c.post("/audit/document", headers=h, json=rep).status_code == 200
    for bad in (
        {**rep, "format": "exe"}, {**rep, "destination": "cloud"}, {**rep, "template": "../etc/passwd"},
        {**rep, "template": "builtin:" + "a" * 80}, {**rep, "fields": -1}, {**rep, "fields": 99999}, {**rep, "fields": True},
        {**rep, "fields": "7"}, {**rep, "cnp": "da"}, {k: v for k, v in rep.items() if k != "cnp"},
    ):
        assert c.post("/audit/document", headers=h, json=bad).status_code == 400, bad
    assert c.post("/audit/document", headers=h, data="nu json").status_code == 400
    assert c.post("/audit/document", headers=hdr("", wid), json=rep).status_code == 401
    eve = _idp_sign_in("g-doc-eve", "doceve@ex.ro")["idToken"]
    assert c.post("/audit/document", headers=hdr(eve, wid), json=rep).status_code == 403

    entries, log = _audit_entries(c, tok, wid, "document.generate")
    got = sorted((e["meta"]["format"], e["meta"]["template"], e["meta"]["destination"], e["meta"]["fields"],
                  e["meta"]["cnp"], e["meta"].get("reportedBy", "server")) for e in entries)
    assert got == [
        ("docx", "builtin:act_constitutiv", "download", 2, True, "server"),
        ("docx", "builtin:act_constitutiv", "download", 2, True, "server"),
        ("docx", "builtin:act_constitutiv", "drive", 2, True, "server"),
        ("gdoc", "drive", "drive", 7, True, "client"),
    ]
    _assert_no_personal_data(log)


def test_failed_or_unauthorized_requests_write_no_audit_entries(app_ctx, monkeypatch):
    import azure_extractor
    c, _ = app_ctx
    tok = _idp_sign_in("g-doc-2", "doc2@ex.ro")["idToken"]
    eve = _idp_sign_in("g-doc-3", "doc3@ex.ro")["idToken"]
    wid = make_ws(c, tok)
    monkeypatch.setattr(azure_extractor, "extract_from_bytes", lambda b, n: _FakeId({"cnp": VALID_CNP}))
    # străin: 403 și nimic în jurnalul lui wid; fără fișier: 400
    assert c.post("/extract", headers=hdr(eve, wid), data={"file": (io.BytesIO(b"x"), "a.jpg")}, content_type="multipart/form-data").status_code == 403
    assert c.post("/extract", headers=hdr(tok, wid)).status_code == 400
    assert c.post("/fill/docx", headers=hdr(tok, wid), data={"template_builtin_key": "nu-exista"}).status_code == 400
    entries, _ = _audit_entries(c, tok, wid, "ocr.extract")
    entries2, _ = _audit_entries(c, tok, wid, "document.generate")
    assert entries == [] and entries2 == []


# ── Limitare per utilizator pe rutele reale ──────────────────────────────────
def test_ocr_is_rate_limited_per_user_with_retry_after(app_ctx, monkeypatch):
    import azure_extractor
    import local_extractor
    import ratelimit
    c, _ = app_ctx
    a = _idp_sign_in("g-rl-a", "rla@ex.ro")["idToken"]
    b = _idp_sign_in("g-rl-b", "rlb@ex.ro")["idToken"]
    wid = make_ws(c, a)
    # b devine membru (acceptă o invitație), ca să arătăm că limita e per utilizator, nu per workspace
    inv = c.post(f"/workspaces/{wid}/invites", headers=hdr(a), json={"email": "rlb@ex.ro", "role": "member"})
    assert inv.status_code == 201
    iid = c.get("/invitations", headers=hdr(b)).get_json()[0]["id"]
    assert c.post(f"/invitations/{iid}/accept", headers=hdr(b)).status_code == 200

    monkeypatch.setattr(ratelimit, "LIMITS", {**ratelimit.LIMITS, "ocr": [("user", 2, 60)]})
    monkeypatch.setattr(azure_extractor, "extract_from_bytes", lambda bts, n: _FakeId({"cnp": VALID_CNP}))
    monkeypatch.setattr(local_extractor, "_quality_score", lambda *_a, **_k: 1.0)
    up = lambda: {"file": (io.BytesIO(b"x" * 100), "ci.jpg")}                         # noqa: E731

    assert [c.post("/extract", headers=hdr(a, wid), data=up(), content_type="multipart/form-data").status_code for _ in range(2)] == [200, 200]
    r = c.post("/extract", headers=hdr(a, wid), data=up(), content_type="multipart/form-data")
    assert r.status_code == 429 and r.get_json() == {"error": "rate_limited"}
    assert 1 <= int(r.headers["Retry-After"]) <= 60
    # colegul din același workspace nu e afectat
    assert c.post("/extract", headers=hdr(b, wid), data=up(), content_type="multipart/form-data").status_code == 200
    # cererea respinsă nu scrie în jurnal (doar cele 3 procesate)
    entries, _ = _audit_entries(c, a, wid, "ocr.extract")
    assert len(entries) == 3


def test_pii_reads_are_rate_limited(app_ctx, monkeypatch):
    import ratelimit
    c, db = app_ctx
    a = _idp_sign_in("g-rl-c", "rlc@ex.ro")["idToken"]
    wid = make_ws(c, a)
    db.collection("workspaces").document(wid).collection("clienti").document(CID).set({"denumire": "X"})
    monkeypatch.setattr(ratelimit, "LIMITS", {**ratelimit.LIMITS, "pii": [("user", 2, 60)]})
    codes = [c.get(f"/clients/{CID}/pii", headers=hdr(a, wid)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_ocr_result_is_cleaned_of_line_breaks_at_the_source(app_ctx, monkeypatch):
    import azure_extractor
    import local_extractor
    c, _ = app_ctx
    tok = _idp_sign_in("g-ocr-clean", "occlean@ex.ro")["idToken"]
    wid = make_ws(c, tok)
    monkeypatch.setattr(azure_extractor, "extract_from_bytes",
                        lambda b, n: _FakeId({"cnp": VALID_CNP, "serie_numar": "MX\n123456", "adresa": "Jud. TM\nSat X,  nr. 5"}))
    monkeypatch.setattr(local_extractor, "_quality_score", lambda *_a, **_k: 1.0)
    r = c.post("/extract", headers=hdr(tok, wid), content_type="multipart/form-data",
               data={"file": (io.BytesIO(b"x" * 100), "ci.jpg")})
    d = r.get_json()
    assert r.status_code == 200
    assert d["serie_numar"] == "MX 123456" and d["adresa"] == "Jud. TM Sat X, nr. 5"
    assert d["cnp"] == VALID_CNP
