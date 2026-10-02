"""Curățarea rupturilor de linie rămase în datele deja salvate ale clienților (scripts/fix_multiline_person_fields.py)
— bug real, reparat separat în azure_extractor.py; acest script curăță ce a fost deja salvat înainte de reparație."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import fix_multiline_person_fields as fx  # noqa: E402


def test_fix_person_curata_doar_campurile_cu_ruptura_de_linie():
    p = {"nume": "Ionescu", "adresa": "Str. Exemplu nr. 5\nCluj-Napoca, jud. Cluj", "judet": "Cluj"}
    out, changed = fx._fix_person(p)
    assert changed
    assert out["adresa"] == "Str. Exemplu nr. 5 Cluj-Napoca, jud. Cluj"
    assert out["nume"] == "Ionescu" and out["judet"] == "Cluj"     # neatinse, fără ruptură


def test_fix_person_fara_ruptura_nu_schimba_nimic():
    p = {"nume": "Ionescu", "adresa": "Cluj-Napoca, str. Exemplu nr. 5"}
    out, changed = fx._fix_person(p)
    assert not changed and out == p


def test_fix_client_pe_titular_lista_si_idempotent():
    data = {
        "titular": {"nume": "A", "adresa": "Str. X\nY"},
        "asociati": [{"nume": "B", "adresa": "Str. Z\nW"}, {"nume": "C", "adresa": "curat"}],
        "administratori": [],
    }
    patch, affected = fx.fix_client(data)
    assert affected == 2
    assert patch["titular"]["adresa"] == "Str. X Y"
    assert patch["asociati"][0]["adresa"] == "Str. Z W" and patch["asociati"][1]["adresa"] == "curat"
    # a doua rulare pe rezultat: nimic de curățat
    again, affected2 = fx.fix_client({**data, **patch})
    assert affected2 == 0 and again == {}


def test_fix_client_fara_persoane_afectate_nu_schimba_nimic():
    assert fx.fix_client({"denumire": "X", "asociati": []}) == ({}, 0)


@pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")
def test_fix_workspace_end_to_end(monkeypatch):
    from google.cloud import firestore as gcf
    import authz

    db = gcf.Client(project="demo-samwera")
    monkeypatch.setattr(authz, "db", lambda: db)
    wid, cid = "workspaceMULTILINE01", "clientMULTILINE0001"
    ref = db.collection("workspaces").document(wid).collection("clienti").document(cid)
    ref.set({"denumire": "X", "titular": {"nume": "A", "adresa": "Str. Exemplu nr. 5\nCluj-Napoca"}})

    assert fx.fix_workspace(wid, dry_run=True) == (1, 1)
    assert "\n" in ref.get().to_dict()["titular"]["adresa"]      # dry-run nu scrie

    assert fx.fix_workspace(wid) == (1, 1)
    assert ref.get().to_dict()["titular"]["adresa"] == "Str. Exemplu nr. 5 Cluj-Napoca"
    assert fx.fix_workspace(wid) == (0, 0)                       # idempotent
