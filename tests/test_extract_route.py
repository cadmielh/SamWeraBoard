"""Ruta /extract: combinarea rezultatului Azure cu fallback-ul OCR local."""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import azure_extractor  # noqa: E402
import local_extractor  # noqa: E402


def test_ocr_local_castiga_dar_pastreaza_adresa_si_judetul_de_la_azure(monkeypatch):
    """Bug real: Azure citea adresa, dar un CNP greșit îl scotea sub prag; OCR-ul local găsea
    CNP-ul din MRZ, câștiga la scor și înlocuia tot rezultatul — adresa și județul rămâneau goale."""
    import app as app_module
    monkeypatch.setattr(app_module, "_verify", lambda *a, **k: "uid")
    monkeypatch.setattr(app_module, "_audit", lambda *a, **k: None)
    monkeypatch.setattr(azure_extractor, "extract_from_bytes", lambda *a: azure_extractor.RomanianIDData(
        nume="POPESCU", prenume="ION", adresa="Jud.CJ Mun.Cluj-Napoca Str.Exemplu nr.5", judet="Cluj"))
    monkeypatch.setattr(local_extractor, "extract_local", lambda *a: (
        {"cnp": "1960515012349", "nume": "POPESCU", "prenume": "ION", "adresa": "", "judet": ""}, 0.75))

    c = app_module.app.test_client()
    r = c.post("/extract", data={"file": (io.BytesIO(b"x"), "ci.jpg")}, content_type="multipart/form-data")
    body = r.get_json()
    assert body["cnp"] == "1960515012349"
    assert body["adresa"] == "Jud.CJ Mun.Cluj-Napoca Str.Exemplu nr.5"
    assert body["judet"] == "Cluj"


def test_judetul_se_deduce_din_adresa_ocr_local(monkeypatch):
    import app as app_module
    monkeypatch.setattr(app_module, "_verify", lambda *a, **k: "uid")
    monkeypatch.setattr(app_module, "_audit", lambda *a, **k: None)
    monkeypatch.setattr(azure_extractor, "extract_from_bytes", lambda *a: (_ for _ in ()).throw(RuntimeError()))
    monkeypatch.setattr(local_extractor, "extract_local", lambda *a: (
        {"cnp": "1960515012349", "adresa": "Jud.BH Mun.Oradea Str.Exemplu nr.1", "judet": ""}, 0.6))

    c = app_module.app.test_client()
    r = c.post("/extract", data={"file": (io.BytesIO(b"x"), "ci.jpg")}, content_type="multipart/form-data")
    assert r.get_json()["judet"] == "Bihor"
