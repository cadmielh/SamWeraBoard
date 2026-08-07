"""
Local OCR extraction for Romanian ID cards.
Pipeline: CLAHE → deskew → full OCR + dedicated MRZ strip OCR → field extraction.
"""

import io
import re
import sys
import subprocess
import numpy as np
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import fitz  # PyMuPDF

_reader = None


# ── System packages bootstrap (cv2, easyocr live in system Python) ────────────

def _add_sys_packages() -> None:
    try:
        import cv2  # noqa
        return
    except ImportError:
        pass
    try:
        sp = subprocess.check_output(
            ["python", "-c", "import site; print(site.getsitepackages()[0])"],
            text=True, timeout=5,
        ).strip()
        if sp and sp not in sys.path:
            sys.path.insert(0, sp)
    except Exception:
        pass


_add_sys_packages()


def _get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(
            ["ro", "en"],
            gpu=False,
            verbose=False,
            model_storage_directory="/tmp/easyocr",
        )
    return _reader


# ── Image loading & normalization ─────────────────────────────────────────────

def _load_image(file_bytes: bytes, filename: str) -> Image.Image:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        doc.close()
    else:
        img = Image.open(io.BytesIO(file_bytes)).convert("RGB")

    w, h = img.size
    if w < 1000:
        scale = 1000 / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    elif w > 2000:
        scale = 2000 / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img


# ── CLAHE preprocessing ───────────────────────────────────────────────────────

def _clahe(image: Image.Image) -> Image.Image:
    """Contrast Limited Adaptive Histogram Equalization — handles uneven lighting."""
    try:
        import cv2
        img = np.array(image)
        lab = cv2.cvtColor(img, cv2.COLOR_RGB2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        merged = cv2.merge([l, a, b])
        return Image.fromarray(cv2.cvtColor(merged, cv2.COLOR_LAB2RGB))
    except ImportError:
        # PIL fallback: autocontrast + mild sharpen
        img = ImageOps.autocontrast(image.convert("L"), cutoff=1).convert("RGB")
        return ImageEnhance.Sharpness(img).enhance(1.8)


# ── Deskewing ─────────────────────────────────────────────────────────────────

def _deskew(image: Image.Image) -> Image.Image:
    """Detect and correct small rotation angle (±15°) using Hough lines."""
    try:
        import cv2
        gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100,
                                 minLineLength=image.width // 5, maxLineGap=20)
        if lines is None:
            return image

        angles = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            if x2 != x1:
                angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
                if abs(angle) < 15:  # only small tilts
                    angles.append(angle)

        if not angles:
            return image

        median_angle = float(np.median(angles))
        if abs(median_angle) < 0.5:  # not worth rotating
            return image

        return image.rotate(-median_angle, expand=True,
                             fillcolor=(255, 255, 255), resample=Image.BICUBIC)
    except Exception:
        return image


# ── Adaptive thresholding for retry passes ────────────────────────────────────

def _adaptive_thresh(image: Image.Image) -> Image.Image:
    """Binary image via adaptive thresholding — good for low-contrast scans."""
    try:
        import cv2
        gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
        binary = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, blockSize=15, C=8,
        )
        # Slight dilation to reconnect broken strokes
        kernel = np.ones((1, 1), np.uint8)
        result = cv2.dilate(binary, kernel, iterations=1)
        return Image.fromarray(result).convert("RGB")
    except Exception:
        img = ImageOps.autocontrast(image.convert("L"), cutoff=2)
        return ImageEnhance.Contrast(img).enhance(3.0).convert("RGB")


def _sharpen_upscale(image: Image.Image) -> Image.Image:
    """Upscale 1.5× + strong sharpening — helps with compressed/blurry photos."""
    w, h = image.size
    img = image.resize((int(w * 1.5), int(h * 1.5)), Image.LANCZOS)
    img = ImageEnhance.Sharpness(img).enhance(3.0)
    img = ImageEnhance.Contrast(img).enhance(1.8)
    return img.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))


# ── OCR grouping helpers ──────────────────────────────────────────────────────

def _cy(bbox) -> float:
    ys = [p[1] for p in bbox]
    return (min(ys) + max(ys)) / 2.0


_CONF_THRESHOLD = 0.35


def _group_lines(results, tol: int = 14) -> list[list]:
    results = [r for r in results if r[2] >= _CONF_THRESHOLD]
    if not results:
        return []
    items = sorted(results, key=lambda r: (_cy(r[0]), r[0][0][0]))
    lines, cur = [], [items[0]]
    for item in items[1:]:
        if abs(_cy(item[0]) - _cy(cur[-1][0])) < tol:
            cur.append(item)
        else:
            lines.append(sorted(cur, key=lambda r: r[0][0][0]))
            cur = [item]
    lines.append(cur)
    return lines


def _line_text(line) -> str:
    return " ".join(item[1] for item in line)


# ── CNP helpers ───────────────────────────────────────────────────────────────

_CNP_WEIGHTS = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9]


def mask_cnp(cnp: str) -> str:
    """Mask a CNP for logging — CNP is special-category personal data (GDPR)."""
    if not cnp:
        return "–"
    return f"{cnp[:2]}{'*' * max(len(cnp) - 4, 0)}{cnp[-2:]}" if len(cnp) > 4 else "*" * len(cnp)


def _validate_cnp(cnp: str) -> bool:
    """Full CNP validation: check digit + embedded date must be a real calendar date."""
    if len(cnp) != 13 or not cnp.isdigit() or cnp[0] == "0":
        return False
    # Check digit
    total = sum(int(cnp[i]) * _CNP_WEIGHTS[i] for i in range(12))
    check = total % 11
    if check == 10:
        check = 1
    if check != int(cnp[12]):
        return False
    # Embedded date must be a valid calendar date
    s = int(cnp[0])
    century = _CNP_CENTURY.get(s)
    if century:
        try:
            import datetime
            yy, mm, dd = cnp[1:3], cnp[3:5], cnp[5:7]
            datetime.date(int(century + yy), int(mm), int(dd))
        except ValueError:
            return False  # month/day out of range — false positive
    return True


def _find_cnp(text: str) -> str:
    compressed = re.sub(r"(\d)\s+(\d)", r"\1\2", text)
    for m in re.finditer(r"\b([1-9]\d{12})\b", compressed):
        if _validate_cnp(m.group(1)):
            return m.group(1)
    return ""


_CNP_CENTURY = {1: "19", 2: "19", 3: "18", 4: "18", 5: "20", 6: "20"}
# 7,8 = foreign residents (century ambiguous), 9 = foreign nationals


def _cnp_to_dob(cnp: str) -> str:
    """Derive date of birth from Romanian CNP with century detection."""
    if len(cnp) != 13 or not cnp.isdigit():
        return ""
    s = int(cnp[0])
    century = _CNP_CENTURY.get(s)
    if century is None:
        return ""  # 7/8/9 — century cannot be determined reliably
    yy, mm, dd = cnp[1:3], cnp[3:5], cnp[5:7]
    year = century + yy
    try:
        import datetime
        datetime.date(int(year), int(mm), int(dd))
        return f"{dd}.{mm}.{year}"
    except ValueError:
        return ""


# ── Field regex extractors ────────────────────────────────────────────────────

def _find_serie_numar(text: str) -> str:
    m = re.search(r"\b([A-Z]{2})\s?(\d{6})\b", text)
    return f"{m.group(1)} {m.group(2)}" if m else ""


def _find_dates(text: str) -> list[str]:
    hits = re.findall(r"\b(\d{2})[./\-](\d{2})[./\-](\d{2,4})\b", text)
    out = []
    for d, m, y in hits:
        if len(y) == 2:
            y = ("19" if int(y) > 24 else "20") + y
        try:
            import datetime
            datetime.date(int(y), int(m), int(d))
            out.append(f"{d}.{m}.{y}")
        except ValueError:
            pass
    return out


# ── MRZ check digits (ICAO 9303) ──────────────────────────────────────────────
# Aceleași principii ca la validarea CNP-ului, dar pentru cifrele de control
# tipărite direct în banda MRZ (independent de CNP, funcționează și pentru
# documente unde CNP-ul nu poate fi determinat — ex. pașapoarte, în viitor).

_MRZ_CHECK_WEIGHTS = [7, 3, 1]


def _mrz_char_value(ch: str) -> int:
    if ch.isdigit():
        return int(ch)
    if ch == "<":
        return 0
    if "A" <= ch <= "Z":
        return ord(ch) - ord("A") + 10
    return 0


def _mrz_check_digit(data: str) -> int:
    """Cifră de control ICAO 9303 (ponderi ciclice 7-3-1)."""
    total = sum(_mrz_char_value(c) * _MRZ_CHECK_WEIGHTS[i % 3] for i, c in enumerate(data))
    return total % 10


def _detect_mrz_format(mrz: list[str]) -> str:
    """TD1 (buletin, 3 linii x 30) vs TD3 (pașaport, 2 linii x 44).
    Doar detecție de format — parsarea completă TD3 nu e implementată încă,
    dar pregătește terenul pentru suport pașaport pe viitor."""
    lens = [len(l) for l in mrz]
    if len(mrz) >= 3 and sum(1 for l in lens if 28 <= l <= 31) >= 3:
        return "TD1"
    if len(mrz) >= 2 and sum(1 for l in lens if 42 <= l <= 45) >= 2:
        return "TD3"
    return "unknown"


# ── MRZ parsing ───────────────────────────────────────────────────────────────

def _parse_mrz(lines: list[list]) -> tuple[dict[str, str], bool]:
    """Returnează (câmpuri, mrz_checks_ok) — al doilea element e True doar dacă
    toate cifrele de control MRZ găsite (document, dată naștere, expirare) au validat."""
    out: dict[str, str] = {}
    mrz = []
    # Collect MRZ-like lines (all caps + digits + '<', no spaces, long enough)
    for line in lines[-12:]:
        raw = "".join(item[1] for item in line).replace(" ", "").upper()
        cleaned = re.sub(r"[^A-Z0-9<]", "", raw)
        if len(cleaned) >= 20 and re.match(r"^[A-Z0-9<]+$", cleaned):
            mrz.append(cleaned)

    if not mrz:
        return out, False

    mrz_format = _detect_mrz_format(mrz)
    checks_attempted = 0
    checks_passed = 0

    # Name line: contains '<<' separator (normalize spaced variants like "< <")
    name_line = next((l for l in mrz if "<<" in l or re.search(r"<\s+<", l)), None)
    if name_line:
        name_line = re.sub(r"<\s+<", "<<", name_line)
        name_part = re.sub(r"^ID[A-Z]{3}[A-Z0-9<]*?(?=[A-Z]{2,})", "", name_line)
        parts = name_part.split("<<")
        if parts[0]:
            out["nume"] = parts[0].lstrip("<").replace("<", " ").strip()
        if len(parts) > 1 and parts[1]:
            out["prenume"] = parts[1].split("<")[0].replace("<", " ").strip()

    if mrz_format == "TD1":
        # Line 1: ID + țară emitentă (3) + serie/număr document (9) + cifră control
        doc_line = next((l for l in mrz if re.match(r"^ID[A-Z]{3}", l)), None)
        if doc_line and len(doc_line) >= 15:
            doc_number, doc_check = doc_line[5:14], doc_line[14]
            if doc_check.isdigit():
                checks_attempted += 1
                if _mrz_check_digit(doc_number) == int(doc_check):
                    checks_passed += 1
                    number = doc_number.rstrip("<")
                    if len(number) >= 2 and not out.get("serie_numar"):
                        out["serie_numar"] = f"{number[:2]} {number[2:]}".strip()

    # Date + sex line: YYMMDD[check][MF]YYMMDD[check]...
    # CNP (13 digits) appears at the start of this line on Romanian IDs
    for l in mrz:
        m = re.search(r"(\d{6})(\d)([MF])(\d{6})(\d)?", l)
        if m:
            bd, bd_check, ed, ed_check = m.group(1), m.group(2), m.group(4), m.group(5)
            by, bmo, bdd = bd[:2], bd[2:4], bd[4:6]
            ey, emo, edd = ed[:2], ed[2:4], ed[4:6]
            birth_year = f"19{by}" if int(by) > 24 else f"20{by}"
            exp_year = f"20{ey}"

            checks_attempted += 1
            if _mrz_check_digit(bd) == int(bd_check):
                checks_passed += 1
            if ed_check is not None:
                checks_attempted += 1
                if _mrz_check_digit(ed) == int(ed_check):
                    checks_passed += 1

            try:
                import datetime
                datetime.date(int(birth_year), int(bmo), int(bdd))
                out["data_nasterii"] = f"{bdd}.{bmo}.{birth_year}"
                out["valabila_pana_la"] = f"{edd}.{emo}.{exp_year}"
            except ValueError:
                pass
            # Extract CNP from start of this line (13 digits before the date block)
            digits = re.sub(r"[^0-9]", "", l)
            for start in range(max(0, len(digits) - 19), max(0, len(digits) - 12)):
                candidate = digits[start:start + 13]
                if len(candidate) == 13 and _validate_cnp(candidate):
                    out["cnp"] = candidate
                    break
            break

    checks_ok = checks_attempted > 0 and checks_passed == checks_attempted
    return out, checks_ok


def _ocr_mrz_strip(image: Image.Image) -> tuple[dict[str, str], bool]:
    """Run a dedicated OCR pass on the bottom 30% of the image for MRZ.
    Uses MRZ character allowlist — no confidence filter since OCR-B is clean."""
    w, h = image.size
    strip = image.crop((0, int(h * 0.68), w, h))
    # Scale up for better recognition
    sw, sh = strip.size
    if sw < 2000:
        scale = 2000 / sw
        strip = strip.resize((int(sw * scale), int(sh * scale)), Image.LANCZOS)

    reader = _get_reader()
    results = reader.readtext(
        np.array(strip),
        allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        detail=1,
    )
    # No confidence filter for MRZ — trust all results
    lines = _group_lines(results, tol=20) if results else []
    return _parse_mrz(lines)


# ── Label-based extraction ────────────────────────────────────────────────────

LABELS: dict[str, list[str]] = {
    "nume":             [r"SURNAME", r"\bNUME\b(?!\s*LE)"],
    "prenume":          [r"FIRST\s+NAME", r"GIVEN\s+NAME", r"PRENUME"],
    "data_nasterii":    [r"DATE\s+OF\s+BIRTH", r"DATA\s+NA[ȘS]TERII"],
    "locul_nasterii":   [r"PLACE\s+OF\s+BIRTH", r"LOCUL\s+NA[ȘS]TERII"],
    "cetatenia":        [r"NATIONALITY", r"CET[ĂA][TȚ]ENIA"],
    "adresa":           [r"ADDRESS", r"ADRES[AĂ]"],
    "judet":            [r"COUNTY", r"JUD[EȘ][TȚ]UL"],
    "emisa_de":         [r"ISSUED\s+BY", r"EMIS[AĂ]\s+DE"],
    "valabila_de_la":   [r"DATA\s+ELIBER[AĂ]RII", r"ISSU(?:E|ING)\s+DATE", r"VALABIL[AĂ]\s+DE\s+LA"],
    "valabila_pana_la": [r"EXPIRY\s+DATE", r"EXPIRY", r"VALABIL[AĂ]\s+P[AÂ]N[AĂ]\s+LA"],
}

ALL_LABEL_RES = [p for patterns in LABELS.values() for p in patterns]


def _is_label(text: str) -> bool:
    return any(re.search(p, text.upper()) for p in ALL_LABEL_RES)


def _label_scan(lines: list[list]) -> dict[str, str]:
    found: dict[str, str] = {}
    for i, line in enumerate(lines):
        lt = _line_text(line)
        lt_up = lt.upper()
        for field, patterns in LABELS.items():
            if field in found:
                continue
            for pat in patterns:
                if re.search(pat, lt_up):
                    after = re.sub(pat, "", lt, flags=re.IGNORECASE).strip().lstrip(":/").strip()
                    if len(after) > 1:
                        found[field] = after
                        break
                    # Look on next 1-3 lines
                    for j in range(i + 1, min(i + 4, len(lines))):
                        nlt = _line_text(lines[j])
                        if not _is_label(nlt) and len(nlt.strip()) > 1:
                            # For address, collect up to 2 continuation lines
                            if field == "adresa" and j + 1 < len(lines):
                                nlt2 = _line_text(lines[j + 1])
                                if not _is_label(nlt2) and len(nlt2.strip()) > 1:
                                    nlt = nlt.strip() + ", " + nlt2.strip()
                            val = nlt.strip()
                            # Non-address fields: truncate at first comma/newline-like break
                            if field not in ("adresa",) and len(val) > 60:
                                val = val[:60].rsplit(" ", 1)[0]
                            found[field] = val
                            break
                    break
    return found


# ── Name cleanup ──────────────────────────────────────────────────────────────

_NAME_RE = re.compile(r"[^A-ZĂÂÎȘȚ\s\-]", re.IGNORECASE)

# Known Romanian counties pentru validarea județului — chei normalizate (majuscule,
# fără diacritice) pentru potrivire tolerantă cu textul OCR zgomotos; valorile sunt
# forma de afișat (identică cu frontend/src/lib/counties.ts JUDETE_ROMANIA și cu
# azure_extractor._JUDET_COD_MAP, ca toate sursele de extragere să afișeze la fel).
_JUDETE_DISPLAY: dict[str, str] = {
    "ALBA": "Alba", "ARAD": "Arad", "ARGES": "Argeș", "BACAU": "Bacău",
    "BIHOR": "Bihor", "BISTRITA-NASAUD": "Bistrița-Năsăud", "BOTOSANI": "Botoșani",
    "BRAILA": "Brăila", "BRASOV": "Brașov", "BUCURESTI": "București",
    "BUZAU": "Buzău", "CALARASI": "Călărași", "CARAS-SEVERIN": "Caraș-Severin",
    "CLUJ": "Cluj", "CONSTANTA": "Constanța", "COVASNA": "Covasna",
    "DAMBOVITA": "Dâmbovița", "DOLJ": "Dolj", "GALATI": "Galați",
    "GIURGIU": "Giurgiu", "GORJ": "Gorj", "HARGHITA": "Harghita",
    "HUNEDOARA": "Hunedoara", "IALOMITA": "Ialomița", "IASI": "Iași",
    "ILFOV": "Ilfov", "MARAMURES": "Maramureș", "MEHEDINTI": "Mehedinți",
    "MURES": "Mureș", "NEAMT": "Neamț", "OLT": "Olt", "PRAHOVA": "Prahova",
    "SALAJ": "Sălaj", "SATU MARE": "Satu Mare", "SIBIU": "Sibiu",
    "SUCEAVA": "Suceava", "TELEORMAN": "Teleorman", "TIMIS": "Timiș",
    "TULCEA": "Tulcea", "VALCEA": "Vâlcea", "VASLUI": "Vaslui", "VRANCEA": "Vrancea",
}
_JUDETE = set(_JUDETE_DISPLAY.keys())


# Substrings that indicate OCR noise / document metadata, never real field values
_GARBAGE_FRAGMENTS = re.compile(
    r"MRZ\s*reader|IDROU|OCR[\s\-]B|machine\s*readable|document\s*number",
    re.IGNORECASE,
)


def _is_garbage(value: str) -> bool:
    return bool(_GARBAGE_FRAGMENTS.search(value))


def _clean_name(text: str) -> str:
    return _NAME_RE.sub("", text).strip().upper()


def _clean_judet(text: str) -> str:
    """Return the display form (cu diacritice) if text matches a known Romanian county."""
    normalized = re.sub(r"[^A-Z\s\-]", "", text.upper()).strip()
    if normalized in _JUDETE:
        return _JUDETE_DISPLAY[normalized]
    # Partial match
    for j in _JUDETE:
        if j in normalized or normalized in j:
            return _JUDETE_DISPLAY[j]
    return text  # keep as-is if no match


# ── Quality scoring ───────────────────────────────────────────────────────────

QUALITY_THRESHOLD = 0.50
_MAX_RETRIES = 2


def _quality_score(fields: dict, mrz_valid: bool = False) -> float:
    score = 0.0
    if fields.get("cnp") and _validate_cnp(fields["cnp"]):
        score += 0.40
    if fields.get("data_nasterii"):
        score += 0.15
    if fields.get("nume") and len(fields["nume"]) >= 2:
        score += 0.10
    if fields.get("prenume") and len(fields["prenume"]) >= 2:
        score += 0.10
    if fields.get("serie_numar"):
        score += 0.10
    others = ["adresa", "locul_nasterii", "emisa_de", "valabila_de_la", "valabila_pana_la"]
    score += min(0.15, sum(0.04 for k in others if fields.get(k)))
    if mrz_valid:
        score += 0.10  # cifrele de control MRZ (ICAO 9303) au validat — semnal suplimentar
    return round(min(score, 1.0), 2)


# ── Core OCR pipeline ─────────────────────────────────────────────────────────

def _run_ocr(image: Image.Image) -> tuple[dict, bool]:
    reader = _get_reader()
    results = reader.readtext(np.array(image))
    lines = _group_lines(results, tol=14)
    full_text = "\n".join(_line_text(l) for l in lines)

    fields: dict = {k: "" for k in [
        "cnp", "nume", "prenume", "serie_numar", "data_nasterii",
        "locul_nasterii", "cetatenia", "adresa", "judet", "emisa_de",
        "valabila_de_la", "valabila_pana_la",
    ]}

    # MRZ dedicated strip (most reliable)
    mrz, mrz_valid = _ocr_mrz_strip(image)
    for k, v in mrz.items():
        if v:
            fields[k] = v

    # MRZ from full-image OCR (fallback / supplement)
    mrz2, mrz2_valid = _parse_mrz(lines)
    for k, v in mrz2.items():
        if v and not fields[k]:
            fields[k] = v

    mrz_checks_ok = mrz_valid or mrz2_valid

    # CNP with check-digit validation
    fields["cnp"] = _find_cnp(full_text)

    # Date of birth derived from CNP — always authoritative over OCR/MRZ
    # (mathematical derivation, not subject to OCR errors)
    if fields["cnp"]:
        dob = _cnp_to_dob(fields["cnp"])
        if dob:
            fields["data_nasterii"] = dob  # overwrites any MRZ or visual OCR result

    # Serie/număr — OCR-ul vizual are prioritate; păstrăm valoarea din MRZ
    # (linia 1, validată prin cifra de control) doar dacă zona vizuală n-a găsit nimic.
    visual_serie_numar = _find_serie_numar(full_text)
    if visual_serie_numar:
        fields["serie_numar"] = visual_serie_numar

    # Dates from visual zone
    dates = _find_dates(full_text)
    if not fields["data_nasterii"] and dates:
        fields["data_nasterii"] = dates[0]
    if not fields["valabila_pana_la"] and len(dates) >= 2:
        fields["valabila_pana_la"] = dates[-1]
    if not fields["valabila_de_la"] and len(dates) >= 3:
        fields["valabila_de_la"] = dates[1]  # middle date — issue date between DOB and expiry

    # Label-based scan
    from_labels = _label_scan(lines)
    for k, v in from_labels.items():
        if v and not fields.get(k) and not _is_garbage(v):
            fields[k] = v

    # Name cleanup
    for k in ("nume", "prenume"):
        if fields[k]:
            fields[k] = _clean_name(fields[k])

    # County validation
    if fields.get("judet"):
        fields["judet"] = _clean_judet(fields["judet"])

    return fields, mrz_checks_ok


# ── Public API ────────────────────────────────────────────────────────────────

def extract_local(file_bytes: bytes, filename: str) -> tuple[dict, float]:
    """
    Extract Romanian ID fields with EasyOCR.
    Attempt 0: CLAHE + deskew (standard).
    Attempt 1: Adaptive threshold.
    Attempt 2: Sharpen + upscale 1.5×.
    Always returns (best_fields, best_score) — never raises on low quality.
    Azure e sursa principală (vezi app.py /extract) — acest OCR local rulează
    doar ca fallback, când Azure eșuează sau dă un scor sub QUALITY_THRESHOLD.
    """
    image = _load_image(file_bytes, filename)

    preprocessors = [
        lambda img: _clahe(_deskew(img)),
        _adaptive_thresh,
    ]

    best_fields: dict = {}
    best_score = 0.0

    for attempt, preprocess in enumerate(preprocessors):
        img = preprocess(image)
        fields, mrz_checks_ok = _run_ocr(img)
        score = _quality_score(fields, mrz_valid=mrz_checks_ok)
        print(f"[ocr] attempt={attempt} score={score:.2f} mrz_ok={mrz_checks_ok} "
              f"cnp={mask_cnp(fields.get('cnp',''))}")

        if score > best_score:
            best_score = score
            best_fields = fields

        if score >= QUALITY_THRESHOLD:
            break

    return best_fields, best_score
