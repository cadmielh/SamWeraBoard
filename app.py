import io
import json
import os
import re
import sys
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor, TimeoutError as _FutureTimeoutError
from datetime import date
from pathlib import Path

# Consola Windows (cp1252) crapă la print() cu diacritice (ex. "ț", "ă") — apare
# frecvent la loguri de diagnostic cu text real de pe CI. Pe Linux (Cloud Run/
# Firebase Functions, stdout implicit UTF-8) asta e un no-op. errors="replace"
# înlocuiește caracterul neafișabil în loc să arunce excepție și să piardă răspunsul.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(errors="replace")

import requests as http_requests

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.utils import secure_filename

load_dotenv()
# .env.local nu e citit de Firebase Functions la deploy (doar de emulator/dev local) —
# aici ţinem cheile reale, ca să nu se coreleze cu SecretParam-urile omonime în producţie.
load_dotenv(".env.local", override=True)

import firebase_admin
from firebase_admin import credentials as fb_creds



import audit
import authz
import ratelimit
import local_extractor
import azure_extractor
from doc_filler import fill_docx, list_placeholders_in_docx, list_clauses_in_docx
from pdf_filler import fill_pdf, list_pdf_fields

# Pre-load EasyOCR models at container startup so requests don't time out waiting
# for model download. Runs in a background thread — module import must return
# fast: the Firebase CLI's local "determine backend specification" step imports
# this module too and fails deployment if it doesn't return within ~10s.
def _preload_easyocr() -> None:
    try:
        local_extractor._get_reader()
        print("[startup] EasyOCR reader pre-loaded")
    except Exception as _pre_err:
        print(f"[startup] EasyOCR pre-load failed (will retry on first request): {_pre_err}")


threading.Thread(target=_preload_easyocr, daemon=True).start()

# Plafon dur pentru fallback-ul OCR local (vezi comentariul din /extract) —
# rulează izolat într-un thread ca să poată fi întrerupt cu future.result(timeout=...).
_LOCAL_OCR_TIMEOUT = 45  # secunde
_local_ocr_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="local-ocr")

# ── Firebase Admin init ───────────────────────────────────────────────────────
_sa_file = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "firebase-service-account.json")
if Path(_sa_file).exists():
    firebase_admin.initialize_app(fb_creds.Certificate(_sa_file))
else:
    # Cloud Run: uses Application Default Credentials automatically
    firebase_admin.initialize_app()

if not (os.getenv("VAULT_KMS_KEY") or os.getenv("VAULT_LOCAL_KEK")):
    print("[vault] ATENȚIE: nici VAULT_KMS_KEY, nici VAULT_LOCAL_KEK nu sunt setate — "
          "CNP/serie CI nu se pot salva până la configurare (vezi docs/vault-rollout.md).")

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024  # 15 MB — OCR uploads only need a few MB
# Fără fallback "*": dacă FRONTEND_ORIGIN lipsește, nicio origine cross-site nu e acceptată.
_cors_origins = [o.strip() for o in os.getenv("FRONTEND_ORIGIN", "").split(",") if o.strip()]
CORS(app, origins=_cors_origins,
     allow_headers=["Content-Type", "X-Firebase-Token", "X-Workspace-Id"],
     expose_headers=["Content-Disposition", "Retry-After", "X-Variant-Warnings"])

limiter = Limiter(get_remote_address, app=app, default_limits=["200 per hour"])

import workspaces_api  # noqa: E402  (după init Firebase Admin și limiter)
import pii_api  # noqa: E402
limiter.limit("120 per hour")(workspaces_api.bp)
app.register_blueprint(workspaces_api.bp)
# Plafon pe citirea datelor sensibile: încetinește o eventuală exfiltrare în masă.
limiter.limit("60 per minute")(pii_api.bp)
app.register_blueprint(pii_api.bp)

UPLOAD_FOLDER = Path(os.getenv("UPLOAD_FOLDER", "uploads"))
UPLOAD_FOLDER.mkdir(exist_ok=True)
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _verify(min_role: str = "member", consent: bool = False, limit: str | None = None) -> str:
    """Autentifică (token Firebase nerevocat, e-mail verificat) ȘI autorizează: utilizatorul trebuie să fie membru
    al workspace-ului din `X-Workspace-Id` cu cel puțin `min_role`. Întoarce uid-ul.
    Serverul NU primește și nu folosește tokenul Google al utilizatorului: operațiunile Drive/Docs se fac din browser."""
    principal = authz.authenticate()
    authz.require_role(principal, request.headers.get("X-Workspace-Id", ""), min_role, consent=consent)
    if limit:
        ratelimit.check(principal.uid, request.headers.get("X-Workspace-Id", ""), limit)
    return principal.uid


def _auth_error(e: Exception):
    # Mesaj fix: nu reflectăm detalii despre de ce a fost respins accesul.
    if isinstance(e, authz.AuthError):
        return authz.error_response(e)
    return jsonify({"error": "Unauthorized"}), 401


def _server_error(public_message: str, exc: Exception, status: int = 500):
    """Loghează doar tipul excepției (mesajul poate conține date personale sau
    identificatori Drive) și întoarce clientului un mesaj generic."""
    print(f"[error] {public_message} ({type(exc).__name__})")
    return jsonify({"error": public_message}), status


def _audit(uid: str, action: str, meta: dict | None = None) -> None:
    """Jurnal de acces (scris de server). Niciodată valori de date personale sau nume de fișiere:
    doar ce s-a făcut, cu ce fel de șablon, câte câmpuri și dacă a fost inclus un CNP."""
    audit.log(request.headers.get("X-Workspace-Id", ""), uid, action, None, meta)


def _ocr_meta(source: str, engine: str, outcome: str, size: int, fields: dict | None) -> dict:
    return {"source": source, "engine": engine, "outcome": outcome, "sizeKb": size // 1024,
            "cnp": bool((fields or {}).get("cnp"))}


def _template_source(builtin_key: str | None) -> str:
    return f"builtin:{builtin_key}" if builtin_key else "upload"


def _clean_choice(value: str | None, allowed: tuple[str, ...], default: str) -> str:
    """Valori raportate de client doar pentru jurnal: acceptăm strict o listă mică, orice altceva devine implicit."""
    return value if value in allowed else default


def _fill_meta(fmt: str, template: str, replacements: dict, destination: str = "download") -> dict:
    return {"format": fmt, "template": template, "destination": destination,
            "fields": sum(1 for v in replacements.values() if v),
            "cnp": any(v and "CNP" in str(k).upper() for k, v in replacements.items())}


# ── Extraction ────────────────────────────────────────────────────────────────

@app.route("/extract", methods=["POST"])
@limiter.limit("20 per minute")
def extract():
    try:
        uid = _verify(consent=True, limit="ocr")
    except PermissionError as e:
        return _auth_error(e)

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename or not _allowed(file.filename):
        return jsonify({"error": "Unsupported file type"}), 400

    file_bytes = file.read()
    filename   = file.filename
    source     = _clean_choice(request.form.get("source"), ("upload", "drive"), "upload")   # doar pentru jurnal

    def _postprocess(fields: dict) -> dict:
        """Curăță spațiile/liniile noi din valorile extrase (OCR-ul desparte adesea seria de număr pe linii diferite);
        re-derive DOB from CNP if valid; clear CNP if invalid."""
        for k, v in list(fields.items()):
            if isinstance(v, str):
                fields[k] = " ".join(v.split())
        cnp = fields.get("cnp", "")
        if cnp and local_extractor._validate_cnp(cnp):
            dob = local_extractor._cnp_to_dob(cnp)
            if dob:
                fields["data_nasterii"] = dob
        elif cnp:
            fields["cnp"] = ""
        return fields

    _empty = {"cnp":"","nume":"","prenume":"","serie_numar":"","data_nasterii":"",
              "locul_nasterii":"","cetatenia":"","adresa":"","judet":"","emisa_de":"",
              "valabila_de_la":"","valabila_pana_la":""}

    # ── Azure — sursă principală ───────────────────────────────────────────────
    ai_fields: dict = {}
    ai_score = 0.0
    try:
        id_data = azure_extractor.extract_from_bytes(file_bytes, filename)
        ai_fields = _postprocess(id_data.model_dump())
        ai_score = local_extractor._quality_score(ai_fields)
        print(f"[extract] azure score={ai_score:.2f} cnp={local_extractor.mask_cnp(ai_fields.get('cnp', ''))}")
    except Exception as ai_err:
        print(f"[extract] Azure extraction failed ({type(ai_err).__name__})")

    if ai_score >= local_extractor.QUALITY_THRESHOLD:
        _audit(uid, "ocr.extract", _ocr_meta(source, "azure", "ok", len(file_bytes), ai_fields))
        return jsonify(_empty | ai_fields)

    # ── OCR local — doar dacă Azure n-a dat suficient (eșec sau scor mic) ──────
    # EasyOCR pe CPU poate rula minute întregi pe scanuri slabe (2 pass-uri ×
    # OCR complet + bandă MRZ) — fără plafon de timp, cererea rămâne agățată în
    # loading pe frontend la nesfârșit. Plafonăm dur la _LOCAL_OCR_TIMEOUT: dacă
    # se depășește, ne mulțumim cu ce a găsit Azure (chiar sub prag) în loc să
    # blocăm utilizatorul.
    print(f"[extract] azure score {ai_score:.2f} < {local_extractor.QUALITY_THRESHOLD} — local OCR fallback")
    local_fields: dict = {}
    local_score = 0.0
    try:
        future = _local_ocr_executor.submit(local_extractor.extract_local, file_bytes, filename)
        local_fields, local_score = future.result(timeout=_LOCAL_OCR_TIMEOUT)
        local_fields = _postprocess(local_fields)
        print(f"[extract] local score={local_score:.2f} cnp={local_extractor.mask_cnp(local_fields.get('cnp', ''))}")
    except _FutureTimeoutError:
        print(f"[extract] Local OCR timed out after {_LOCAL_OCR_TIMEOUT}s — falling back to Azure result")
    except Exception as local_err:
        print(f"[extract] Local OCR failed ({type(local_err).__name__})")

    best = local_fields if local_score > ai_score else ai_fields
    # CNP validat local e mai sigur decât cel din Azure (verificare cu cifra de control)
    local_cnp = local_fields.get("cnp", "")
    if local_cnp and local_extractor._validate_cnp(local_cnp):
        best["cnp"] = local_cnp
        dob = local_extractor._cnp_to_dob(local_cnp)
        if dob:
            best["data_nasterii"] = dob
    _audit(uid, "ocr.extract", _ocr_meta(source, "local" if local_score > ai_score else "azure",
                                         "ok" if any(best.values()) else "empty", len(file_bytes), best))
    return jsonify(_empty | best)


# ── Șabloane de bază ("built-in") ────────────────────────────────────────────
# Servite direct din fisiere_template/, nu copiate în Firestore — orice workspace
# le vede identice și la zi, fără pas de seed/versionare. Userul care vrea să le
# personalizeze le "Duplică" (fluxul obișnuit de upload) în șabloanele proprii.

BUILTIN_TEMPLATE_DIR = Path(__file__).resolve().parent / "fisiere_template"


def _resolve_template_file(directory: Path, filename: str) -> Path:
    """Găsește fișierul șablonului indiferent de forma Unicode a diacriticelor din nume.

    macOS stochează numele „descompuse” (NFD) și le tratează identic cu cele „compuse” (NFC); Linux (Cloud Run) nu.
    Registrul scrie NFC, dar arhiva încărcată de pe Mac conține NFD: fără această potrivire, funcția nu pornea în cloud
    (`FileNotFoundError` la import). Se compară în forma NFC."""
    direct = directory / filename
    if direct.is_file():
        return direct
    wanted = unicodedata.normalize("NFC", filename)
    for f in directory.iterdir():
        if unicodedata.normalize("NFC", f.name) == wanted:
            return f
    raise FileNotFoundError(f"Șablon lipsă: {filename}")


def _load_builtin_templates() -> dict[str, dict]:
    registry_path = BUILTIN_TEMPLATE_DIR / "registry.json"
    if not registry_path.exists():
        return {}
    entries = json.loads(registry_path.read_text(encoding="utf-8"))
    result: dict[str, dict] = {}
    for entry in entries:
        file_bytes = _resolve_template_file(BUILTIN_TEMPLATE_DIR, entry["filename"]).read_bytes()
        if entry.get("type", "docx") == "pdf":
            result[entry["key"]] = {
                **entry,
                "bytes": file_bytes,
                "placeholders": [],
                "clauses": [],
                "pdfFields": list_pdf_fields(file_bytes),
            }
        else:
            result[entry["key"]] = {
                **entry,
                "bytes": file_bytes,
                "placeholders": list_placeholders_in_docx(file_bytes),
                "clauses": list_clauses_in_docx(file_bytes),
            }
    return result


BUILTIN_TEMPLATES = _load_builtin_templates()


@app.route("/templates/builtin", methods=["GET"])
def list_builtin_templates():
    try:
        _verify()
    except PermissionError as e:
        return _auth_error(e)
    return jsonify({"templates": [
        {k: v for k, v in tpl.items() if k != "bytes"} for tpl in BUILTIN_TEMPLATES.values()
    ]})


@app.route("/templates/builtin/<key>", methods=["GET"])
def get_builtin_template(key: str):
    try:
        _verify()
    except PermissionError as e:
        return _auth_error(e)
    tpl = BUILTIN_TEMPLATES.get(key)
    if not tpl:
        return jsonify({"error": "Unknown built-in template"}), 404
    mimetype = "application/pdf" if tpl.get("type") == "pdf" \
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return send_file(io.BytesIO(tpl["bytes"]), as_attachment=True, download_name=tpl["filename"],
                     mimetype=mimetype)


# ── Template filling ──────────────────────────────────────────────────────────

@app.route("/fill/docx", methods=["POST"])
def fill_docx_route():
    try:
        uid = _verify(limit="fill")
    except PermissionError as e:
        return _auth_error(e)

    template_builtin_key = request.form.get("template_builtin_key")
    if template_builtin_key:
        tpl = BUILTIN_TEMPLATES.get(template_builtin_key)
        if not tpl:
            return jsonify({"error": "Unknown built-in template"}), 400
        file_bytes, original_name = tpl["bytes"], tpl["filename"]
    elif "template" in request.files:
        template_file = request.files["template"]
        if Path(template_file.filename).suffix.lower() != ".docx":
            return jsonify({"error": "Template must be a .docx file"}), 400
        file_bytes    = template_file.read()
        original_name = template_file.filename
    else:
        return jsonify({"error": "No template provided (upload file or set template_builtin_key)"}), 400

    try:
        fields       = request.form.to_dict()
        fields.pop("template_builtin_key", None)
        destination  = _clean_choice(fields.pop("_destination", None), ("download", "drive"), "download")   # doar pentru jurnal
        output_name  = fields.pop("_output_name", None) or None
        groups_raw   = fields.pop("_groups", None)
        groups       = json.loads(groups_raw) if groups_raw else None
        clauses_raw       = fields.pop("_clauses", None)
        selected_clauses  = json.loads(clauses_raw) if clauses_raw else None
        row_groups_raw    = fields.pop("_row_groups", None)
        row_groups        = json.loads(row_groups_raw) if row_groups_raw else None
        ctx_raw           = fields.pop("_ctx", None)          # context pentru variantele „a/b” (sex, număr, categorie)
        try:
            variant_ctx = json.loads(ctx_raw) if ctx_raw else None
        except ValueError:
            return jsonify({"error": "invalid_ctx"}), 400
        variant_warnings: set = set()
        # Cheile trimise de frontend sunt deja în forma {{CAMP}} — nu se re-împachetează.
        replacements = {k: v for k, v in fields.items() if v}
        filled_bytes = fill_docx(file_bytes, replacements, groups, selected_clauses, row_groups, variant_ctx, variant_warnings)
    except Exception as e:
        return _server_error("Fill failed", e)

    out_name = secure_filename(output_name) if output_name else "completat_" + secure_filename(original_name)
    _audit(uid, "document.generate", _fill_meta("docx", _template_source(request.form.get("template_builtin_key")), replacements, destination))
    resp = send_file(io.BytesIO(filled_bytes), as_attachment=True, download_name=out_name,
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    if variant_warnings:
        resp.headers["X-Variant-Warnings"] = json.dumps(sorted(variant_warnings)[:20])   # persoane cu sex necunoscut (ASCII)
    return resp


@app.route("/fill/pdf", methods=["POST"])
def fill_pdf_route():
    try:
        uid = _verify(limit="fill")
    except PermissionError as e:
        return _auth_error(e)

    template_builtin_key = request.form.get("template_builtin_key")
    if template_builtin_key:
        tpl = BUILTIN_TEMPLATES.get(template_builtin_key)
        if not tpl:
            return jsonify({"error": "Unknown built-in template"}), 400
        file_bytes, original_name = tpl["bytes"], tpl["filename"]
    elif "template" in request.files:
        template_file = request.files["template"]
        if Path(template_file.filename).suffix.lower() != ".pdf":
            return jsonify({"error": "Template must be a .pdf file"}), 400
        file_bytes    = template_file.read()
        original_name = template_file.filename
    else:
        return jsonify({"error": "No template provided (upload file or set template_builtin_key)"}), 400

    try:
        fields = request.form.to_dict()
        fields.pop("template_builtin_key", None)
        output_name = fields.pop("_output_name", None) or None
        # Spre deosebire de /fill/docx, aici nu filtrăm valorile goale — un
        # câmp PDF necompletat rămâne pur și simplu gol, nu apare vreun text
        # de tip {{CAMP}} needefinit care ar trebui evitat.
        filled_bytes = fill_pdf(file_bytes, fields)
    except Exception as e:
        return _server_error("Fill failed", e)

    out_name = secure_filename(output_name) if output_name else "completat_" + secure_filename(original_name)
    _audit(uid, "document.generate", _fill_meta("pdf", _template_source(request.form.get("template_builtin_key")), fields))
    return send_file(io.BytesIO(filled_bytes), as_attachment=True, download_name=out_name,
                     mimetype="application/pdf")


@app.route("/audit/document", methods=["POST"])
def audit_document():
    """Jurnalul de acces pentru documente generate în afara serverului (ex. un Google Doc completat din browser).
    Raport al clientului: se acceptă doar metadate cu formă strictă, niciodată valori ale câmpurilor."""
    try:
        uid = _verify(consent=True, limit="fill")
    except PermissionError as e:
        return _auth_error(e)
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        return jsonify({"error": "invalid_body"}), 400
    fmt, template, dest = d.get("format"), d.get("template"), d.get("destination")
    n = d.get("fields")
    if (fmt not in ("docx", "pdf", "gdoc") or dest not in ("download", "drive")
            or not isinstance(template, str) or not re.fullmatch(r"builtin:[a-z0-9_]{1,60}|drive|upload", template)
            or not isinstance(n, int) or isinstance(n, bool) or not 0 <= n <= 5000
            or not isinstance(d.get("cnp"), bool)):
        return jsonify({"error": "invalid_report"}), 400
    _audit(uid, "document.generate", {"format": fmt, "template": template, "destination": dest,
                                       "fields": n, "cnp": d["cnp"], "reportedBy": "client"})
    return jsonify({"ok": True})


@app.route("/template/placeholders", methods=["POST"])
def get_placeholders():
    try:
        _verify()
    except PermissionError as e:
        return _auth_error(e)
    if "template" not in request.files:
        return jsonify({"error": "No file"}), 400
    file_bytes = request.files["template"].read()
    return jsonify({
        "placeholders": list_placeholders_in_docx(file_bytes),
        "clauses": list_clauses_in_docx(file_bytes),
    })


_ANAF_URL        = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva"
_CUISCAN_URL     = "https://cuiscan.ro/api.php"

# Ordinea contează: formele mai lungi/specifice înaintea celor mai scurte
_FORME_JURIDICE = [
    ("SRL",       r"\bS\.?R\.?L\.?\b"),
    ("SNC",       r"\bS\.?N\.?C\.?\b"),
    ("SCS",       r"\bS\.?C\.?S\.?\b"),
    ("SNA",       r"\bS\.?N\.?A\.?\b"),
    ("SA",        r"\bS\.?A\.?\b"),
    ("PFA",       r"\bP\.?F\.?A\.?\b"),
    ("IF",        r"\bI\.?F\.?\b"),
    ("II",        r"\bI\.?I\.?\b"),
    ("RA",        r"\bR\.?A\.?\b"),
    ("ONG",       r"\bO\.?N\.?G\.?\b"),
    ("Asociație", r"\bAsoci[aă][tț]i"),
    ("Fundație",  r"\bFunda[tț]i"),
]


def _detect_forma_juridica(denumire: str) -> str:
    for forma, pattern in _FORME_JURIDICE:
        if re.search(pattern, denumire, re.IGNORECASE):
            return forma
    return ""


def _parse_company_response(denumire: str, adresa: str, nr_reg_com: str,
                             telefon: str, caen_cod: str, stare: str,
                             radiata: bool, platitor_tva: bool,
                             perioada_tva: str,
                             forma_juridica: str | None = None,
                             tva_la_incasare: bool = False,
                             inactiv_anaf: bool | None = None,
                             split_tva: bool | None = None,
                             e_factura: bool | None = None,
                             adresa_componente: dict | None = None) -> dict:
    # Stem-uri, nu forme complete — textul de stare variază după sursă/flexiune
    # ("Radiere" la ONRC vs. "RADIAT" la ANAF, "Suspendare" vs. "SUSPENDAT" etc.).
    stare_up = stare.upper()
    if radiata or "RADI" in stare_up or "DIZOLV" in stare_up:
        statut = "radiat"
    elif "INACTIV" in stare_up or "SUSPEND" in stare_up:
        statut = "inactiv"
    else:
        statut = "activ"

    return {
        "found":         True,
        "denumire":      denumire.strip(),
        "formaJuridica": forma_juridica if forma_juridica is not None else _detect_forma_juridica(denumire),
        "adresa":               adresa,
        "adresaSediuComponente": adresa_componente,
        "nrRegCom":      nr_reg_com,
        "telefon":       telefon,
        "caenCod":       caen_cod,
        # Fără "caenSecundare" aici — API-ul ANAF v9 gratuit nu oferă lista de
        # coduri CAEN secundare; cheia lipsește intenționat din răspuns (nu se
        # trimite listă goală), ca frontend-ul să păstreze codurile secundare
        # deja completate de user, nu să le șteargă crezând că ANAF a
        # confirmat "zero coduri secundare".
        "statutFiscal":  statut,
        "platitorTva":   platitor_tva,
        "periodaTva":    perioada_tva,
        "tvaLaIncasare": tva_la_incasare,
        "inactivAnaf":   inactiv_anaf,
        "splitTva":      split_tva,
        "eFactura":      e_factura,
    }


def _pad_caen(cod) -> str:
    """Codurile CAEN au mereu 4 cifre — sursele externe serializează uneori codul ca număr
    JSON, ceea ce pierde zero-ul din faţă la codurile din secţiuni ca 0610, 0620 etc."""
    s = str(cod or "").strip()
    return s.zfill(4) if s else ""


def _query_anaf(cif_int: int) -> dict | None:
    """Returnează răspunsul brut ANAF v9 (sincron), sau None dacă serviciul e indisponibil.
    Sursă critică — fără ea nu putem servi cererea deloc."""
    payload = [{"cui": cif_int, "data": date.today().isoformat()}]
    try:
        resp = http_requests.post(
            _ANAF_URL,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (compatible; Cabinio/1.0)",
            },
            timeout=10,
        )
        resp.raise_for_status()
        body = resp.json()
        return body if "found" in body else None
    except Exception:
        return None


def _query_cuiscan(cif_str: str) -> dict | None:
    """Date enrichment de la cuiscan.ro — administratori și sediul social structurat,
    best-effort peste sursa critică ANAF. Dacă cuiscan.ro pică sau dispare, cererea tot
    reuşeşte, doar câmpurile respective rămân necompletate/preiau fallback-ul de la ANAF."""
    try:
        resp = http_requests.get(
            _CUISCAN_URL,
            params={"action": "company", "cui": cif_str},
            timeout=5,
        )
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        return None


def _optional_fields(**fields) -> dict:
    """Filtrează un set de câmpuri opționale, păstrând doar cheile cu valoare
    nevidă — convenție comună pentru date pe care sursele externe (ANAF v9
    gratuit, cuiscan.ro) nu le oferă mereu (ex. coduri CAEN secundare,
    administratori). Cheia trebuie să LIPSEASCĂ din răspunsul JSON, nu să
    apară cu o listă/valoare goală — altfel frontend-ul (care face
    `result.câmp ? nou : păstrează valoarea existentă a clientului`) ar crede
    că sursa confirmă explicit "gol" și ar șterge ce completase userul manual.
    Când o sursă nouă (sau un API ANAF mai complet) chiar oferă un astfel de
    câmp, adaugă-l aici, ex.:
        result.update(_optional_fields(caenSecundare=caen_secundare_din_sursa))
    — fără alte modificări în frontend, care deja tratează corect atât
    prezența cât și absența cheii.
    """
    return {k: v for k, v in fields.items() if v}


def _format_adresa_sediu(strada, numar, localitate, judet, detalii=None) -> str:
    """Compune un rând de adresă lizibil dintr-o adresă structurată (sediu social),
    în acelaşi stil cu textul liber întors de ANAF pentru domiciliul fiscal."""
    parts = []
    if judet:
        parts.append(str(judet).strip())
    if localitate:
        parts.append(str(localitate).strip())
    strada_s = str(strada).strip() if strada else ""
    if strada_s and numar:
        parts.append(f"{strada_s}, NR.{str(numar).strip()}")
    elif strada_s:
        parts.append(strada_s)
    elif numar:
        parts.append(f"NR.{str(numar).strip()}")
    if detalii:
        parts.append(str(detalii).strip())
    return ", ".join(p for p in parts if p)


@app.route("/anaf/company")
@limiter.limit("30 per minute")
def anaf_company():
    try:
        _verify()
    except PermissionError as e:
        return _auth_error(e)

    cif_raw = request.args.get("cif", "").strip()
    cif_str = re.sub(r"^RO\s*", "", cif_raw, flags=re.IGNORECASE).strip()
    if not cif_str.isdigit():
        return jsonify({"error": "CIF invalid"}), 400

    cif_int = int(cif_str)

    # --- Sursă critică: ANAF v9 oficial (sincron, gratuit, fără cheie) ---
    anaf_data = _query_anaf(cif_int)
    if anaf_data is None:
        return jsonify({"error": "Serviciile de date fiscale sunt indisponibile momentan"}), 502

    found = anaf_data.get("found", [])
    if not found:
        return jsonify({"found": False}), 200

    dg            = found[0].get("date_generale", {}) or {}
    inreg         = found[0].get("inregistrare_scop_Tva", {}) or {}
    inreg_rtvai   = found[0].get("inregistrare_RTVAI", {}) or {}
    stare_inactiv = found[0].get("stare_inactiv", {}) or {}
    split_tva     = found[0].get("inregistrare_SplitTVA", {}) or {}

    # API-ul public ANAF nu expune periodicitatea declarării TVA (lunar/trimestrial) —
    # câmpul rămâne necompletat din această sursă, nu se ghicește.
    platitor_tva    = bool(inreg.get("scpTVA"))
    tva_la_incasare = bool(inreg_rtvai.get("statusTvaIncasare"))
    radiata = bool(stare_inactiv.get("dataRadiere"))

    cuiscan_data = _query_cuiscan(cif_str)

    # "adresa" trebuie să fie sediul social, nu domiciliul fiscal (pot diferi) — ANAF
    # v9 îl oferă structurat în adresa_sediu_social; dacă lipseşte, încercăm acelaşi
    # câmp de la cuiscan.ro; ca ultim fallback folosim domiciliul fiscal (mai bine
    # decât un câmp gol).
    sediu_anaf = found[0].get("adresa_sediu_social") or {}
    cs_sediu = (cuiscan_data or {}).get("adresaSediu") or {}
    # Componente individuale, cu fallback cuiscan.ro pe fiecare câmp separat —
    # spre deosebire de "adresa_sediu" (string), care alegea o sursă întreagă
    # (ANAF sau cuiscan), aici putem combina câmpuri din ambele surse.
    adresa_sediu_componente = {
        "strada":        sediu_anaf.get("sdenumire_Strada")     or cs_sediu.get("strada")     or "",
        "numar":         sediu_anaf.get("snumar_Strada")        or cs_sediu.get("numar")      or "",
        "localitate":    sediu_anaf.get("sdenumire_Localitate") or cs_sediu.get("localitate") or "",
        "judet":         sediu_anaf.get("sdenumire_Judet")      or cs_sediu.get("judet")      or "",
        "detaliiAdresa": sediu_anaf.get("sdetalii_Adresa") or "",  # cuiscan nu oferă echivalent structurat
    }

    # "adresa" trebuie să fie sediul social, nu domiciliul fiscal (pot diferi) — ANAF
    # v9 îl oferă structurat în adresa_sediu_social; dacă lipseşte, încercăm acelaşi
    # câmp de la cuiscan.ro; ca ultim fallback folosim domiciliul fiscal (mai bine
    # decât un câmp gol). Păstrat ca string aplatizat pentru compatibilitate — frontend-ul
    # foloseşte acum, în primul rând, adresa_sediu_componente (mai sus).
    adresa_sediu = _format_adresa_sediu(
        sediu_anaf.get("sdenumire_Strada"), sediu_anaf.get("snumar_Strada"),
        sediu_anaf.get("sdenumire_Localitate"), sediu_anaf.get("sdenumire_Judet"),
        sediu_anaf.get("sdetalii_Adresa"),
    )
    if not adresa_sediu and cuiscan_data:
        adresa_sediu = _format_adresa_sediu(
            cs_sediu.get("strada"), cs_sediu.get("numar"),
            cs_sediu.get("localitate"), cs_sediu.get("judet"),
        )
    if not adresa_sediu:
        adresa_sediu = dg.get("adresa") or ""

    result = _parse_company_response(
        denumire     = dg.get("denumire") or "",
        adresa       = adresa_sediu,
        adresa_componente = adresa_sediu_componente,
        nr_reg_com   = dg.get("nrRegCom") or "",
        telefon      = dg.get("telefon") or "",
        caen_cod     = _pad_caen(dg.get("cod_CAEN")),
        stare        = dg.get("stare_inregistrare") or "",
        radiata      = radiata,
        platitor_tva = platitor_tva,
        perioada_tva = "",
        tva_la_incasare = tva_la_incasare,
        inactiv_anaf = bool(stare_inactiv.get("statusInactivi")),
        split_tva    = bool(split_tva.get("statusSplitTVA")),
        e_factura    = bool(dg.get("statusRO_e_Factura")),
    )

    # --- Enrichment opţional: administratori, de la cuiscan.ro (best-effort) ---
    administratori = (cuiscan_data or {}).get("administratori") or []
    admin_list = [
        {"nume": a.get("name") or "", "rol": a.get("role") or ""}
        for a in administratori if a.get("name")
    ]

    # Câmpuri pe care sursele actuale nu le oferă mereu (sau deloc, în cazul
    # ANAF v9 gratuit + coduri CAEN secundare) — vezi _optional_fields: cheia
    # apare în răspuns doar când chiar există o valoare, ca frontend-ul să
    # păstreze ce avea clientul deja completat, nu să creadă că sursa
    # confirmă explicit "gol". `caenSecundare` e pregătit aici, gol, exact
    # pentru ziua în care o sursă (ANAF sau alt enrichment) chiar îl oferă —
    # se completează variabila cu lista reală, fără alte modificări.
    caen_secundare: list[str] = []
    result.update(_optional_fields(
        administratoriAnaf=admin_list,
        caenSecundare=caen_secundare,
    ))

    return jsonify(result)


@app.route("/health")
def health():
    # Versiunile șabloanelor de bază încărcate de instanța care răspunde: după un deploy se poate verifica ce rulează efectiv.
    return jsonify({"status": "ok", "templates": {k: t.get("version") for k, t in BUILTIN_TEMPLATES.items()}})


if __name__ == "__main__":
    # 5001, nu 5000: pe macOS portul 5000 e ocupat de AirPlay Receiver (răspunde în locul Flask).
    app.run(debug=False, port=int(os.getenv("PORT", "5001")))
