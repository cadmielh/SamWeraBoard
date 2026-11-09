"""Ruta /anaf/company: data înregistrării (de la care curg durata societății și mandatele primilor administratori)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _anaf(date_generale: dict) -> dict:
    return {"found": [{"date_generale": {"denumire": "EXEMPLU SRL", "nrRegCom": "J12/1/2020", **date_generale}}]}


def _get(monkeypatch, anaf_response: dict) -> dict:
    import app as app_module
    monkeypatch.setattr(app_module, "_verify", lambda *a, **k: "uid")
    monkeypatch.setattr(app_module, "_query_anaf", lambda cif: anaf_response)
    monkeypatch.setattr(app_module, "_query_cuiscan", lambda cif: None)
    return app_module.app.test_client().get("/anaf/company?cif=RO12345678").get_json()


def test_data_inregistrarii_e_trimisa_cand_anaf_o_are(monkeypatch):
    assert _get(monkeypatch, _anaf({"data_inregistrare": "2002-01-23"}))["dataInregistrare"] == "2002-01-23"


def test_fara_data_cheia_lipseste_ca_fisa_sa_pastreze_ce_avea(monkeypatch):
    assert "dataInregistrare" not in _get(monkeypatch, _anaf({"data_inregistrare": ""}))
