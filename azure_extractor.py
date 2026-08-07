"""
Extracție folosind Azure AI Document Intelligence (model prebuilt-idDocument).

Maparea câmpurilor Azure → schema aplicației (mai jos, în _map_azure_fields) a fost
confirmată prin teste reale (2026-08-07) contra unui buletin scanat. Azure a întors
ca și câmpuri structurate: DocumentNumber, FirstName, LastName, DateOfExpiration,
DateOfIssue, Address, PlaceOfBirth, Sex, PersonalNumber (= CNP). NU a întors:
DateOfBirth (nu e o problemă — data nașterii se derivă oricum din CNP, mai sigur),
Nationality, CountryRegion, MachineReadableZone, IssuingAuthority — de-asta
"cetatenia" are fallback la "Română", iar "judet" și "emisa_de" NU vin din câmpuri
structurate, ci din textul brut al paginii (analyzeResult.content / content-ul
câmpului Address) — vezi _extract_judet / _extract_emisa_de. Tot din text brut se
rezolvă și confuzia Azure între DateOfIssue/DateOfExpiration (vezi
_split_validity_content) — pe CI românesc apar pe aceeași linie, separate de "-",
iar valueDate-ul structurat le pune greșit pe amândouă la aceeași dată.
Dacă un scan viitor întoarce câmpuri diferite, verificați log-ul
`[azure] fields received: [...]` și ajustați maparea aici.
"""

import os
import re
import time
from pathlib import Path

import requests as _req
from dotenv import load_dotenv
from pydantic import BaseModel

import local_extractor

load_dotenv()

_TIMEOUT = (8, 20)  # (connect, read) secunde per cerere HTTP
_POLL_INTERVAL = 1.5
_POLL_MAX_WAIT = 20  # secunde totale de polling — buget dur, ca la fallback-ul vechi
_API_VERSION = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_API_VERSION", "2024-11-30")
_MODEL_ID = "prebuilt-idDocument"

_CETATENIE_MAP = {"ROU": "Română", "ROMANIA": "Română", "ROMÂNIA": "Română"}

# Instituții emitente confirmate (surse oficiale MAI/DGEP): SPCEP, SPCLEP, SPCJEP
# (servicii publice locale/județene) și DEPABD/DGEP (denumirea veche/nouă a
# direcției naționale) — tolerăm și varianta punctată (ex. "S.P.C.L.E.P.").
_INSTITUTIE_RE = re.compile(
    r"S\.?\s?P\.?\s?C\.?\s?(?:L\.?\s?E\.?\s?P|J\.?\s?E\.?\s?P|E\.?\s?P)\.?"
    r"|D\.?\s?E\.?\s?P\.?\s?A\.?\s?B\.?\s?D\.?"
    r"|D\.?\s?G\.?\s?E\.?\s?P\.?",
    re.IGNORECASE,
)

# Coduri de județ după sistemul de înmatriculare auto (stabil de decenii) —
# confirmat prin test real: CI-urile românești scrise de Azure folosesc acest
# format ("Jud.BH"), nu numele complet al județului. Nume cu diacritice,
# identice cu lista din frontend (frontend/src/lib/counties.ts JUDETE_ROMANIA)
# — necesar pentru potrivire exactă în Combobox-ul de județ din UI.
_JUDET_COD_MAP = {
    "AB": "Alba", "AR": "Arad", "AG": "Argeș", "BC": "Bacău", "BH": "Bihor",
    "BN": "Bistrița-Năsăud", "BT": "Botoșani", "BR": "Brăila", "BV": "Brașov",
    "B":  "București", "BZ": "Buzău", "CS": "Caraș-Severin", "CL": "Călărași",
    "CJ": "Cluj", "CT": "Constanța", "CV": "Covasna", "DB": "Dâmbovița",
    "DJ": "Dolj", "GL": "Galați", "GR": "Giurgiu", "GJ": "Gorj",
    "HR": "Harghita", "HD": "Hunedoara", "IL": "Ialomița", "IS": "Iași",
    "IF": "Ilfov", "MM": "Maramureș", "MH": "Mehedinți", "MS": "Mureș",
    "NT": "Neamț", "OT": "Olt", "PH": "Prahova", "SM": "Satu Mare",
    "SJ": "Sălaj", "SB": "Sibiu", "SV": "Suceava", "TR": "Teleorman",
    "TM": "Timiș", "TL": "Tulcea", "VS": "Vaslui", "VL": "Vâlcea", "VN": "Vrancea",
}
_JUDET_COD_RE = re.compile(r"\bJUD\.?\s*([A-Z]{1,2})\b", re.IGNORECASE)


class RomanianIDData(BaseModel):
    cnp:               str = ""
    nume:              str = ""
    prenume:           str = ""
    serie_numar:       str = ""
    data_nasterii:     str = ""
    locul_nasterii:    str = ""
    cetatenia:         str = ""
    adresa:            str = ""
    judet:             str = ""
    emisa_de:          str = ""
    valabila_de_la:    str = ""
    valabila_pana_la:  str = ""

    def to_placeholders(self) -> dict[str, str]:
        return {
            "{{CNP}}":              self.cnp,
            "{{NUME}}":             self.nume,
            "{{PRENUME}}":          self.prenume,
            "{{SERIE_NUMAR}}":      self.serie_numar,
            "{{DATA_NASTERII}}":    self.data_nasterii,
            "{{LOCUL_NASTERII}}":   self.locul_nasterii,
            "{{CETATENIA}}":        self.cetatenia,
            "{{ADRESA}}":           self.adresa,
            "{{JUDET}}":            self.judet,
            "{{EMISA_DE}}":         self.emisa_de,
            "{{VALABILA_DE_LA}}":   self.valabila_de_la,
            "{{VALABILA_PANA_LA}}": self.valabila_pana_la,
        }


# ── Apel Azure Document Intelligence (async: submit + poll) ───────────────────

def _analyze(file_bytes: bytes, media_type: str) -> dict:
    endpoint = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "").strip().rstrip("/")
    api_key  = os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY", "").strip()
    if not endpoint or not api_key:
        raise RuntimeError(
            "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT / AZURE_DOCUMENT_INTELLIGENCE_KEY nu sunt "
            "configurate. Creați o resursă Azure AI Document Intelligence (regiune UE "
            "recomandată) și puneți cheile în .env.local."
        )

    analyze_url = f"{endpoint}/documentintelligence/documentModels/{_MODEL_ID}:analyze"
    headers = {
        "Ocp-Apim-Subscription-Key": api_key,
        "Content-Type": media_type,
    }

    print(f"[azure] sending document ({len(file_bytes)//1024}KB, {media_type}) for analysis...")
    resp = _req.post(analyze_url, headers=headers, params={"api-version": _API_VERSION},
                      data=file_bytes, timeout=_TIMEOUT)
    if resp.status_code != 202:
        raise RuntimeError(f"Azure analyze: HTTP {resp.status_code} — {resp.text[:200]}")

    operation_location = resp.headers.get("Operation-Location")
    if not operation_location:
        raise RuntimeError("Azure analyze: răspuns fără header Operation-Location")

    waited = 0.0
    while waited < _POLL_MAX_WAIT:
        time.sleep(_POLL_INTERVAL)
        waited += _POLL_INTERVAL
        poll = _req.get(operation_location, headers={"Ocp-Apim-Subscription-Key": api_key},
                         timeout=_TIMEOUT)
        if poll.status_code != 200:
            raise RuntimeError(f"Azure poll: HTTP {poll.status_code} — {poll.text[:200]}")
        data = poll.json()
        status = data.get("status")
        if status == "succeeded":
            return data.get("analyzeResult", {})
        if status == "failed":
            raise RuntimeError(f"Azure analyze failed: {data.get('error')}")
        # altfel "running"/"notStarted" — continuăm polling-ul

    raise RuntimeError(f"Azure analyze: timeout după {_POLL_MAX_WAIT}s de polling")


# ── Mapare câmpuri Azure → schema aplicației ───────────────────────────────────

def _field_value(field: dict | None) -> str:
    """Extrage valoarea dintr-un obiect câmp Azure (cheia variază după `type`)."""
    if not field:
        return ""
    for key in ("valueString", "valueCountryRegion", "valueDate", "valuePhoneNumber"):
        if key in field and field[key] not in (None, ""):
            return str(field[key])
    return (field.get("content") or "").strip()


def _field_name_value(field: dict | None) -> str:
    """Ca _field_value, dar pentru nume/prenume preferăm "content" (textul brut
    citit de pe card) — util dacă vreodată "valueString" normalizează diacriticele
    diferit de "content". NOTĂ (test real, 2026-08-07): pe unele scanări, Azure nu
    recunoaște deloc diacritica Ș/Ț la nivel de OCR (ambele câmpuri identice, fără
    diacritică) — e o limită de acuratețe a modelului pe caractere subtile, nu o
    problemă de mapare; corecție posibilă doar manual, din UI."""
    if not field:
        return ""
    content = (field.get("content") or "").strip()
    return content or _field_value(field)


def _azure_date_to_ro(value: str) -> str:
    """Azure întoarce date ISO (YYYY-MM-DD) — convertim la formatul DD.MM.YYYY
    folosit peste tot în aplicație (același format produs de local_extractor)."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", value or "")
    if not m:
        return ""
    y, mo, d = m.groups()
    return f"{d}.{mo}.{y}"


# Confirmat prin test real (2026-08-07): pe CI românesc, "valabilă de la" și
# "valabilă până la" apar pe aceeași linie fizică, separate doar de "-"
# (ex. "28.09.22-03.08.2031") — Azure întoarce acest text brut identic pentru
# ambele câmpuri (DateOfIssue/DateOfExpiration) în "content", dar "valueDate"
# structurat le confundă (ambele ajung să indice a doua dată). Parsăm noi
# direct textul brut, mai de încredere aici decât valueDate.
_VALIDITY_PAIR_RE = re.compile(r"(\d{2}\.\d{2}\.\d{2,4})\s*-\s*(\d{2}\.\d{2}\.\d{4})")


def _split_validity_content(content: str) -> tuple[str, str]:
    m = _VALIDITY_PAIR_RE.match((content or "").strip())
    if not m:
        return "", ""
    start_raw, end_raw = m.group(1), m.group(2)
    # prima dată poate avea anul pe 2 cifre — extindem cu aceeași euristică de
    # secol folosită în local_extractor._find_dates (an > 24 -> secolul trecut)
    d, mo, y = start_raw.split(".")
    if len(y) == 2:
        y = ("19" if int(y) > 24 else "20") + y
    ed, emo, ey = end_raw.split(".")
    try:
        import datetime
        datetime.date(int(y), int(mo), int(d))
        datetime.date(int(ey), int(emo), int(ed))
    except ValueError:
        return "", ""
    return f"{d}.{mo}.{y}", f"{ed}.{emo}.{ey}"


def _extract_judet(address_content: str) -> str:
    """Codul de județ (ex. "Jud.BH") apare direct în textul brut al adresei —
    îl mapăm la numele complet (cu diacritice) prin _JUDET_COD_MAP."""
    m = _JUDET_COD_RE.search(address_content or "")
    if not m:
        return ""
    return _JUDET_COD_MAP.get(m.group(1).upper(), "")


def _extract_emisa_de(page_content: str) -> str:
    """Instituția emitentă (ex. "SPCLEP Beiuș") apare pe propria linie în textul
    brut al paginii — Azure n-o expune ca și câmp structurat dedicat pe CI românești."""
    m = _INSTITUTIE_RE.search(page_content or "")
    if not m:
        return ""
    line_start = page_content.rfind("\n", 0, m.start()) + 1
    line_end = page_content.find("\n", m.end())
    if line_end == -1:
        line_end = len(page_content)
    return page_content[line_start:line_end].strip()


def _mrz_lines_from_text(text: str) -> list[list]:
    """Adaptor: transformă textul MRZ brut (dacă Azure îl expune) în formatul
    list[list] așteptat de local_extractor._parse_mrz (linii stil EasyOCR:
    [(bbox, text, confidence), ...]) — reutilizăm parsarea + validarea cifrelor
    de control deja scrisă pentru OCR-ul local, în loc s-o duplicăm."""
    lines = []
    for raw_line in text.splitlines():
        raw_line = raw_line.strip()
        if raw_line:
            lines.append([((0, 0), raw_line, 1.0)])
    return lines


def _map_azure_fields(analyze_result: dict) -> RomanianIDData:
    documents = analyze_result.get("documents") or []
    fields = documents[0].get("fields", {}) if documents else {}

    # Punct de descoperire (vezi docstring-ul fișierului) — logăm doar NUMELE
    # câmpurilor primite (nu valorile, care pot conține CNP/date personale).
    print(f"[azure] fields received: {sorted(fields.keys())}")

    cnp = _field_value(fields.get("PersonalNumber"))
    if not cnp or not local_extractor._validate_cnp(cnp):
        cnp = ""

    cet_raw = _field_value(fields.get("Nationality")) or _field_value(fields.get("CountryRegion"))
    cetatenia = _CETATENIE_MAP.get(cet_raw.upper(), cet_raw)
    if not cetatenia:
        # Confirmat prin test real: Azure nu întoarce "Nationality"/"CountryRegion" pentru
        # buletinele scanate — aplicația fiind strict pentru CI românești, presupunem "Română"
        # (același comportament avea și prompt-ul vechi OpenRouter).
        cetatenia = "Română"

    issue_field, expiry_field = fields.get("DateOfIssue"), fields.get("DateOfExpiration")
    issue_content = (issue_field or {}).get("content", "")
    expiry_content = (expiry_field or {}).get("content", "")
    valabila_de_la, valabila_pana_la = "", ""
    if issue_content and issue_content == expiry_content:
        valabila_de_la, valabila_pana_la = _split_validity_content(issue_content)
    if not valabila_de_la:
        valabila_de_la = _azure_date_to_ro(_field_value(issue_field))
    if not valabila_pana_la:
        valabila_pana_la = _azure_date_to_ro(_field_value(expiry_field))

    adresa_content = (fields.get("Address") or {}).get("content", "")
    page_content = analyze_result.get("content", "")

    result = RomanianIDData(
        cnp=cnp,
        nume=_field_name_value(fields.get("LastName")),
        prenume=_field_name_value(fields.get("FirstName")),
        serie_numar=_field_value(fields.get("DocumentNumber")),
        data_nasterii=_azure_date_to_ro(_field_value(fields.get("DateOfBirth"))),
        locul_nasterii=_field_value(fields.get("PlaceOfBirth")),
        cetatenia=cetatenia,
        adresa=_field_value(fields.get("Address")),
        # Nu sunt câmpuri structurate Azure — extrase din textul brut al paginii
        # (vezi _extract_judet / _extract_emisa_de), confirmat prin test real.
        judet=_extract_judet(adresa_content),
        emisa_de=_extract_emisa_de(page_content),
        valabila_de_la=valabila_de_la,
        valabila_pana_la=valabila_pana_la,
    )

    # Fallback pe banda MRZ brută (dacă Azure o expune) pentru câmpurile lipsă —
    # cross-validate/completează prin cifrele de control ICAO deja implementate.
    mrz_text = _field_value(fields.get("MachineReadableZone"))
    if mrz_text and (not result.cnp or not result.data_nasterii):
        mrz_fields, _ = local_extractor._parse_mrz(_mrz_lines_from_text(mrz_text))
        if not result.cnp and mrz_fields.get("cnp"):
            result.cnp = mrz_fields["cnp"]
        if not result.data_nasterii and mrz_fields.get("data_nasterii"):
            result.data_nasterii = mrz_fields["data_nasterii"]
        if not result.valabila_pana_la and mrz_fields.get("valabila_pana_la"):
            result.valabila_pana_la = mrz_fields["valabila_pana_la"]
        if not result.nume and mrz_fields.get("nume"):
            result.nume = mrz_fields["nume"]
        if not result.prenume and mrz_fields.get("prenume"):
            result.prenume = mrz_fields["prenume"]

    print(f"[azure] extracted cnp={local_extractor.mask_cnp(result.cnp)} "
          f"fields_filled={sum(1 for v in result.model_dump().values() if v)}/12")
    return result


# ── API public ──────────────────────────────────────────────────────────────

def extraction_mode() -> str:
    return "azure-document-intelligence"


def extract_from_bytes(file_bytes: bytes, filename: str) -> RomanianIDData:
    ext = Path(filename).suffix.lower()
    media_type = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png",  ".webp": "image/webp",
        ".pdf": "application/pdf",
    }.get(ext, "image/jpeg")

    # Azure acceptă PDF nativ — spre deosebire de fallback-ul anterior, nu mai
    # e nevoie de conversie PDF→imagine înainte de trimitere.
    analyze_result = _analyze(file_bytes, media_type)
    return _map_azure_fields(analyze_result)
