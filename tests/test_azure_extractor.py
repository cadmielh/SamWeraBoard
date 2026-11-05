"""Mapare câmpuri Azure Document Intelligence → schema aplicației (vezi azure_extractor.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import azure_extractor as az  # noqa: E402


def test_adresa_pe_doua_randuri_fizice_devine_un_singur_spatiu_nu_ruptura_literala():
    """Bug real, găsit pe un document real: Azure păstrează rupturile de linie originale de pe act în
    „content” (ex. adresa scrisă pe 2 rânduri fizice pe buletin) — un „\\n” literal, nu doar spațiu. Netratat,
    acel „\\n” ajungea literal în documentul generat (Word desena rând nou acolo, diferit de șablon)."""
    field = {"content": "Str. Exemplu nr. 5\nCluj-Napoca, jud. Cluj"}
    assert az._field_value(field) == "Str. Exemplu nr. 5 Cluj-Napoca, jud. Cluj"


def test_valuestring_cu_ruptura_de_linie_e_curatat_la_fel():
    field = {"valueString": "Str. Exemplu nr. 5\r\n  Cluj-Napoca"}
    assert az._field_value(field) == "Str. Exemplu nr. 5 Cluj-Napoca"


def test_field_name_value_cu_ruptura_de_linie_e_curatat():
    field = {"content": "IONESCU\nMARIA"}
    assert az._field_name_value(field) == "IONESCU MARIA"


def test_camp_gol_ramane_gol():
    assert az._field_value(None) == ""
    assert az._field_value({}) == ""
    assert az._field_name_value(None) == ""


def test_judet_din_cod_nume_complet_si_bucuresti():
    assert az._extract_judet("Jud.BH Mun.Oradea Str.Exemplu nr.5") == "Bihor"
    assert az._extract_judet("Str. Exemplu nr. 5 Cluj-Napoca, jud. Cluj") == "Cluj"
    assert az._extract_judet("Jud. Satu Mare Mun.Satu Mare") == "Satu Mare"
    assert az._extract_judet("Jud.Bistrița-Năsăud Com.Exemplu") == "Bistrița-Năsăud"
    assert az._extract_judet("Mun.București Sec.3 Str.Exemplu nr.1") == "București"
    assert az._extract_judet("Str. Exemplu nr. 5") == ""


def test_adresa_si_judetul_din_textul_paginii_cand_lipseste_campul_address():
    page = ("ROMANIA\nCARTE DE IDENTITATE\nDomiciliu/Adresse/Address\n"
            "Jud.CJ Mun.Cluj-Napoca\nStr.Exemplu nr.5 ap.2\n"
            "Emisă de/Délivrée par/Issued by\nSPCLEP Cluj-Napoca\n")
    result = az._map_azure_fields({"content": page, "documents": [{"fields": {}}]})
    assert result.adresa == "Jud.CJ Mun.Cluj-Napoca Str.Exemplu nr.5 ap.2"
    assert result.judet == "Cluj"


def test_cnp_cu_spatii_e_acceptat():
    result = az._map_azure_fields({"content": "", "documents": [{"fields": {
        "PersonalNumber": {"valueString": "1960515 012349"}}}]})
    assert result.cnp == "1960515012349"


def test_serie_numar_fara_eticheta_nr_citita_ca_na():
    assert az._normalize_serie_numar("TZ NA 123456") == "TZ 123456"
    assert az._normalize_serie_numar("TZ NR 123456") == "TZ 123456"
    assert az._normalize_serie_numar("SERIA TZ NR. 123456") == "TZ 123456"
    assert az._normalize_serie_numar("TZ123456") == "TZ 123456"
    assert az._normalize_serie_numar("TZ 123456") == "TZ 123456"
    assert az._normalize_serie_numar("") == ""


def test_serie_numar_cei_noua_cu_7_cifre():
    assert az._normalize_serie_numar("TZ NR 1234567") == "TZ 1234567"
    assert az._normalize_serie_numar("TZ1234567") == "TZ 1234567"
    assert az.local_extractor._find_serie_numar("SERIA TZ NR 1234567") == "TZ 1234567"
    assert az.local_extractor._find_serie_numar("TZ 123456") == "TZ 123456"
    assert az.local_extractor._find_serie_numar("SERIA TZ NR 123456") == "TZ 123456"
    assert az.local_extractor._find_serie_numar("NR 123456") == ""
