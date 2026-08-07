"""Teste unitare pentru validarea cifrelor de control MRZ (ICAO 9303).

Doar logică pură, fără rețea/EasyOCR — verifică algoritmul de checksum și
integrarea lui în _parse_mrz cu un MRZ TD1 (buletin) sintetic.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import local_extractor as le


def _mrz_line(text: str, conf: float = 1.0) -> list:
    """Construiește o "linie" în formatul list[(bbox, text, confidence)] așteptat
    de _parse_mrz, la fel ca rezultatul grupat al EasyOCR."""
    return [((0, 0), text, conf)]


# ── _mrz_check_digit ──────────────────────────────────────────────────────────

def test_check_digit_pure_digits():
    assert le._mrz_check_digit("520727") == 3


def test_check_digit_all_zeros():
    assert le._mrz_check_digit("000000") == 0


def test_check_digit_with_letters_and_filler():
    # A=10, B=11 -> ponderi 7,3,1,7,3,1,7,3,1 pe "AB1234<<<"
    assert le._mrz_check_digit("AB1234<<<") == 1


def test_check_digit_single_char():
    assert le._mrz_check_digit("9") == 3


# ── _detect_mrz_format ────────────────────────────────────────────────────────

def test_detect_format_td1():
    lines = ["X" * 30, "Y" * 30, "Z" * 30]
    assert le._detect_mrz_format(lines) == "TD1"


def test_detect_format_td3():
    lines = ["X" * 44, "Y" * 44]
    assert le._detect_mrz_format(lines) == "TD3"


def test_detect_format_unknown():
    assert le._detect_mrz_format(["X" * 10]) == "unknown"


# ── _parse_mrz — integrare cu MRZ TD1 sintetic ─────────────────────────────────

# Linia 1: ID + ROU + serie/număr "TM729123<" (9) + cifră control validă (1) + filler (15)
# Filler-ul e "0" (nu "<") ca să nu declanșeze eronat euristica de detecție a
# liniei de nume (care caută "<<"), la fel cum s-ar putea întâmpla pe carduri
# reale dacă zona opțională e umplută integral cu "<".
_LINE1 = "IDROUTM729123<1" + "0" * 15
# Linia 2: DOB 900315 + cifră control 2 + sex M + expirare 300315 + cifră control 0 + filler
# (filler "0", nu "<", pentru același motiv ca la linia 1)
_LINE2 = "9003152M3003150ROU" + "0" * 12
# Linia 3: nume
_LINE3 = "POPESCU<<ION" + "<" * 18


def test_parse_mrz_valid_checksums():
    lines = [_mrz_line(_LINE1), _mrz_line(_LINE2), _mrz_line(_LINE3)]
    fields, checks_ok = le._parse_mrz(lines)

    assert checks_ok is True
    assert fields["serie_numar"] == "TM 729123"
    assert fields["data_nasterii"] == "15.03.1990"
    assert fields["valabila_pana_la"] == "15.03.2030"
    assert fields["nume"] == "POPESCU"
    assert fields["prenume"] == "ION"


def test_parse_mrz_invalid_document_check_digit():
    # Stricăm cifra de control a documentului (poziția 14): "1" -> "9"
    bad_line1 = _LINE1[:14] + "9" + _LINE1[15:]
    lines = [_mrz_line(bad_line1), _mrz_line(_LINE2), _mrz_line(_LINE3)]
    fields, checks_ok = le._parse_mrz(lines)

    assert checks_ok is False
    # documentul cu cifră de control greșită nu completează serie_numar
    assert "serie_numar" not in fields


def test_parse_mrz_invalid_date_check_digit():
    # Stricăm cifra de control a datei nașterii (poziția 6 din linia 2): "2" -> "5"
    bad_line2 = _LINE2[:6] + "5" + _LINE2[7:]
    lines = [_mrz_line(_LINE1), _mrz_line(bad_line2), _mrz_line(_LINE3)]
    fields, checks_ok = le._parse_mrz(lines)

    assert checks_ok is False
    # data e totuși extrasă (nu depinde de validarea cifrei de control ca să fie citită)
    assert fields["data_nasterii"] == "15.03.1990"
