import io
import json
import os
import re
import sys
import threading
import time
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
from firebase_admin import auth as fb_auth, credentials as fb_creds



import local_extractor
import azure_extractor
import gdrive
from doc_filler import fill_docx, list_placeholders_in_docx

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

# ── Firebase Admin init ───────────────────────────────────────────────────────
_sa_file = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "firebase-service-account.json")
if Path(_sa_file).exists():
    firebase_admin.initialize_app(fb_creds.Certificate(_sa_file))
else:
    # Cloud Run: uses Application Default Credentials automatically
    firebase_admin.initialize_app()

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024  # 15 MB — OCR uploads only need a few MB
_cors_origins = [o.strip() for o in os.getenv("FRONTEND_ORIGIN", "*").split(",") if o.strip()]
CORS(app, origins=_cors_origins or "*",
     allow_headers=["Content-Type", "Authorization", "X-Firebase-Token"])

limiter = Limiter(get_remote_address, app=app, default_limits=["200 per hour"])

UPLOAD_FOLDER = Path(os.getenv("UPLOAD_FOLDER", "uploads"))
UPLOAD_FOLDER.mkdir(exist_ok=True)
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _verify() -> tuple[str, str]:
    """Verify Firebase ID token, return (uid, google_access_token)."""
    id_token     = request.headers.get("X-Firebase-Token", "")
    access_token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    try:
        decoded = fb_auth.verify_id_token(id_token)
        return decoded["uid"], access_token
    except Exception as e:
        raise PermissionError(f"Unauthorized: {e}")


def _auth_error(e: Exception):
    return jsonify({"error": str(e)}), 401


# ── Extraction ────────────────────────────────────────────────────────────────

@app.route("/extract", methods=["POST"])
@limiter.limit("20 per minute")
def extract():
    try:
        uid, _ = _verify()
    except PermissionError as e:
        return _auth_error(e)

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename or not _allowed(file.filename):
        return jsonify({"error": "Unsupported file type"}), 400

    file_bytes = file.read()
    filename   = file.filename

    def _postprocess(fields: dict) -> dict:
        """Re-derive DOB from CNP if valid; clear CNP if invalid."""
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
        print(f"[extract] Azure extraction failed: {ai_err}")

    if ai_score >= local_extractor.QUALITY_THRESHOLD:
        return jsonify({**(_empty | ai_fields), "uid": uid})

    # ── OCR local — doar dacă Azure n-a dat suficient (eșec sau scor mic) ──────
    print(f"[extract] azure score {ai_score:.2f} < {local_extractor.QUALITY_THRESHOLD} — local OCR fallback")
    local_fields: dict = {}
    local_score = 0.0
    try:
        local_fields, local_score = local_extractor.extract_local(file_bytes, filename)
        local_fields = _postprocess(local_fields)
        print(f"[extract] local score={local_score:.2f} cnp={local_extractor.mask_cnp(local_fields.get('cnp', ''))}")
    except Exception as local_err:
        print(f"[extract] Local OCR failed: {local_err}")

    best = local_fields if local_score > ai_score else ai_fields
    # CNP validat local e mai sigur decât cel din Azure (verificare cu cifra de control)
    local_cnp = local_fields.get("cnp", "")
    if local_cnp and local_extractor._validate_cnp(local_cnp):
        best["cnp"] = local_cnp
        dob = local_extractor._cnp_to_dob(local_cnp)
        if dob:
            best["data_nasterii"] = dob
    return jsonify({**(_empty | best), "uid": uid})


@app.route("/extract/drive", methods=["POST"])
@limiter.limit("20 per minute")
def extract_from_drive():
    try:
        _, access_token = _verify()
    except PermissionError as e:
        return _auth_error(e)

    data    = request.get_json() or {}
    file_id = data.get("file_id")
    if not file_id:
        return jsonify({"error": "file_id required"}), 400
    if not access_token:
        return jsonify({"error": "Google access_token required"}), 400

    try:
        file_bytes, filename, _ = gdrive.download_file(access_token, file_id)
        id_data = azure_extractor.extract_from_bytes(file_bytes, filename)
    except Exception as e:
        return jsonify({"error": f"Extraction failed: {e}"}), 500

    return jsonify(id_data.model_dump())


# ── Drive browsing ────────────────────────────────────────────────────────────

@app.route("/drive/files")
def drive_files():
    try:
        _, access_token = _verify()
    except PermissionError as e:
        return _auth_error(e)
    if not access_token:
        return jsonify({"error": "Google access_token required"}), 400

    folder_id  = request.args.get("folder_id", "root")
    page_token = request.args.get("page_token")
    try:
        result = gdrive.list_files(access_token, folder_id=folder_id, page_token=page_token)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(result)


# ── Template filling ──────────────────────────────────────────────────────────

@app.route("/fill/docx", methods=["POST"])
def fill_docx_route():
    try:
        _, access_token = _verify()
    except PermissionError as e:
        return _auth_error(e)

    template_drive_id = request.form.get("template_drive_id")
    if template_drive_id:
        if not access_token:
            return jsonify({"error": "Google access_token required for Drive template"}), 400
        try:
            file_bytes, original_name, _ = gdrive.download_file(access_token, template_drive_id)
        except Exception as e:
            return jsonify({"error": f"Failed to download template from Drive: {e}"}), 500
    elif "template" in request.files:
        template_file = request.files["template"]
        if Path(template_file.filename).suffix.lower() != ".docx":
            return jsonify({"error": "Template must be a .docx file"}), 400
        file_bytes    = template_file.read()
        original_name = template_file.filename
    else:
        return jsonify({"error": "No template provided (upload file or set template_drive_id)"}), 400

    try:
        fields       = request.form.to_dict()
        fields.pop("template_drive_id", None)
        output_name  = fields.pop("_output_name", None) or None
        groups_raw   = fields.pop("_groups", None)
        groups       = json.loads(groups_raw) if groups_raw else None
        # Cheile trimise de frontend sunt deja în forma {{CAMP}} — nu se re-împachetează.
        replacements = {k: v for k, v in fields.items() if v}
        filled_bytes = fill_docx(file_bytes, replacements, groups)
    except Exception as e:
        return jsonify({"error": f"Fill failed: {e}"}), 500

    out_name = secure_filename(output_name) if output_name else "completat_" + secure_filename(original_name)
    return send_file(io.BytesIO(filled_bytes), as_attachment=True, download_name=out_name,
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.route("/fill/docx/upload-to-drive", methods=["POST"])
def fill_docx_and_upload():
    try:
        _, access_token = _verify()
    except PermissionError as e:
        return _auth_error(e)
    if not access_token:
        return jsonify({"error": "Google access_token required"}), 400

    template_drive_id = request.form.get("template_drive_id")
    if template_drive_id:
        try:
            file_bytes, original_name, _ = gdrive.download_file(access_token, template_drive_id)
        except Exception as e:
            return jsonify({"error": f"Failed to download template from Drive: {e}"}), 500
    elif "template" in request.files:
        template_file = request.files["template"]
        file_bytes    = template_file.read()
        original_name = template_file.filename
    else:
        return jsonify({"error": "No template provided"}), 400

    fields      = request.form.to_dict()
    fields.pop("template_drive_id", None)
    folder_id   = fields.pop("_drive_folder_id", None)
    output_name = fields.pop("_output_name", None) or None
    groups_raw  = fields.pop("_groups", None)
    groups      = json.loads(groups_raw) if groups_raw else None
    # Cheile trimise de frontend sunt deja în forma {{CAMP}} — nu se re-împachetează.
    replacements = {k: v for k, v in fields.items() if v}

    try:
        filled_bytes = fill_docx(file_bytes, replacements, groups)
        out_name     = output_name or ("completat_" + secure_filename(original_name))
        meta = gdrive.upload_file(access_token, filled_bytes, out_name,
                                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                  folder_id=folder_id)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"file_id": meta["id"], "name": meta["name"], "link": meta.get("webViewLink", "")})


@app.route("/fill/gdoc", methods=["POST"])
def fill_gdoc_route():
    try:
        _, access_token = _verify()
    except PermissionError as e:
        return _auth_error(e)
    if not access_token:
        return jsonify({"error": "Google access_token required"}), 400

    data            = request.get_json() or {}
    template_doc_id = data.get("template_doc_id")
    fields: dict    = data.get("fields", {})
    output_name     = data.get("output_name") or None
    if not template_doc_id:
        return jsonify({"error": "template_doc_id required"}), 400

    # Cheile trimise de frontend sunt deja în forma {{CAMP}} — nu se re-împachetează.
    replacements = {k: v for k, v in fields.items() if v}
    try:
        new_id = gdrive.fill_google_doc(access_token, template_doc_id, replacements, output_name=output_name)
        link   = gdrive.get_doc_web_link(access_token, new_id)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"doc_id": new_id, "link": link})


@app.route("/template/placeholders", methods=["POST"])
def get_placeholders():
    try:
        _verify()
    except PermissionError as e:
        return _auth_error(e)
    if "template" not in request.files:
        return jsonify({"error": "No file"}), 400
    return jsonify({"placeholders": list_placeholders_in_docx(request.files["template"].read())})


_ANAF_POST       = "https://webservicesp.anaf.ro/AsynchWebService/api/v8/ws/tva"
_ANAF_GET        = "https://webservicesp.anaf.ro/AsynchWebService/api/v7/ws/tva"
_DEMOANAF_BASE   = "https://demoanaf.ro/api/company"

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
                             caen_secundare: list[str] | None = None) -> dict:
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
        "adresa":        adresa,
        "nrRegCom":      nr_reg_com,
        "telefon":       telefon,
        "caenCod":       caen_cod,
        "caenSecundare": caen_secundare or [],
        "statutFiscal":  statut,
        "platitorTva":   platitor_tva,
        "periodaTva":    perioada_tva,
        "tvaLaIncasare": tva_la_incasare,
        "inactivAnaf":   inactiv_anaf,
        "splitTva":      split_tva,
        "eFactura":      e_factura,
    }


def _query_demoanaf(cif_str: str) -> dict | None:
    """Returnează dict cu date firmă din demoanaf.ro (proxy live pe date ANAF+ONRC),
    sau None dacă nu e configurată cheia sau serviciul e indisponibil."""
    api_key = os.getenv("DEMOANAF_API_KEY", "")
    if not api_key:
        return None
    try:
        resp = http_requests.get(
            f"{_DEMOANAF_BASE}/{cif_str}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=8,
        )
        if resp.status_code != 200:
            return None
        body = resp.json()
        if not body.get("success"):
            return None
        return body.get("data")
    except Exception:
        return None


def _pad_caen(cod) -> str:
    """Codurile CAEN au mereu 4 cifre — demoanaf.ro serializează uneori codul ca număr JSON,
    ceea ce pierde zero-ul din faţă la codurile din secţiuni ca 0610, 0620 etc."""
    s = str(cod or "").strip()
    return s.zfill(4) if s else ""


def _parse_demoanaf_response(data: dict) -> dict:
    stare = f'{data.get("registrationState") or ""} {data.get("onrcStatusLabel") or ""}'.strip()
    caen_cod = _pad_caen(data.get("caenCode"))
    # authorizedCaenCodes include şi codul principal — restul sunt activităţile secundare
    caen_secundare = [
        padded for c in (data.get("authorizedCaenCodes") or [])
        if (padded := _pad_caen(c)) != caen_cod
    ]
    result = _parse_company_response(
        denumire     = data.get("name") or "",
        adresa       = data.get("address") or "",
        nr_reg_com   = data.get("registrationNumber") or "",
        telefon      = data.get("phone") or "",
        caen_cod     = caen_cod,
        stare        = stare,
        radiata      = False,
        platitor_tva = bool(data.get("vatRegistered")),
        perioada_tva = "",
        forma_juridica   = data.get("legalForm") or None,
        tva_la_incasare  = bool(data.get("cashBasisVat")),
        inactiv_anaf     = bool(data.get("inactive")),
        split_tva        = bool(data.get("splitVat")),
        e_factura        = bool(data.get("eFacturaRegistered")),
        caen_secundare   = caen_secundare,
    )
    # Doar nume + rol — API-ul nu oferă CNP/CI, deci e strict informativ
    # (nu se poate mapa fiabil pe structura Persoana folosită la generarea documentelor).
    result["administratoriAnaf"] = [
        {"nume": a.get("name") or "", "rol": a.get("role") or ""}
        for a in (data.get("administrators") or []) if not a.get("gdprHidden") and a.get("name")
    ]
    return result


def _query_anaf(cif_int: int) -> dict | None:
    """Returnează răspunsul brut ANAF async v8, sau None dacă serviciul e indisponibil."""
    payload = [{"cui": cif_int, "data": date.today().isoformat()}]
    try:
        post_resp = http_requests.post(
            _ANAF_POST,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (compatible; SamWeraBoard/1.0)",
            },
            timeout=8,
        )
        post_resp.raise_for_status()
        correlation_id = post_resp.json().get("correlationId")
        if not correlation_id:
            return None
    except Exception:
        return None

    # Polling GET — răspunsul se poate descărca o singură dată
    for attempt in range(4):
        time.sleep(3 if attempt == 0 else 2)
        try:
            get_resp = http_requests.get(
                _ANAF_GET,
                params={"id": correlation_id},
                timeout=8,
            )
            if get_resp.status_code == 200:
                body = get_resp.json()
                if "found" in body:
                    return body
        except Exception:
            continue
    return None


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

    # --- Sursă 1: demoanaf.ro — proxy live pe date ANAF+ONRC, rapid, un singur apel ---
    ddata = _query_demoanaf(cif_str)
    if ddata is not None:
        return jsonify(_parse_demoanaf_response(ddata))

    # --- Sursă 2: ANAF async v8 oficial ---
    anaf_data = _query_anaf(cif_int)
    if anaf_data is not None:
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
        return jsonify(_parse_company_response(
            denumire     = dg.get("denumire") or "",
            adresa       = dg.get("adresa") or "",
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
        ))

    return jsonify({"error": "Serviciile de date fiscale sunt indisponibile momentan"}), 502


@app.route("/health")
def health():
    return jsonify({"status": "ok", "ocr_mode": "azure+local"})


if __name__ == "__main__":
    app.run(debug=False, port=5000)
