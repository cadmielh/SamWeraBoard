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
