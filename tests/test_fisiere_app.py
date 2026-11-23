"""Funcția separată pentru transferul documentelor (fisiere_app.py): rute, CORS și limita de mărime."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _app(monkeypatch):
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "/nonexistent/none.json")
    monkeypatch.setenv("FRONTEND_ORIGIN", "https://cabinio.web.app")
    sys.modules.pop("fisiere_app", None)
    import fisiere_app  # noqa: PLC0415  (după setarea mediului)
    return fisiere_app


def test_rutele_documentelor_sunt_inregistrate(monkeypatch):
    app = _app(monkeypatch).app
    rute = {(m, r.rule) for r in app.url_map.iter_rules() for m in r.methods - {"HEAD", "OPTIONS"}}
    assert {("POST", "/fisiere"), ("GET", "/fisiere/<fid>/continut"), ("GET", "/health")} <= rute


def test_cors_doar_pentru_originea_aplicatiei(monkeypatch):
    c = _app(monkeypatch).app.test_client()
    ok = c.options("/fisiere", headers={"Origin": "https://cabinio.web.app", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("Access-Control-Allow-Origin") == "https://cabinio.web.app"
    rau = c.options("/fisiere", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "Access-Control-Allow-Origin" not in rau.headers


def test_limita_cererii_acopera_un_fisier_de_15_mb(monkeypatch):
    mod = _app(monkeypatch)
    import fisiere  # noqa: PLC0415
    assert mod.app.config["MAX_CONTENT_LENGTH"] > fisiere.MAX_BYTES
    assert os.getenv("FRONTEND_ORIGIN") == "https://cabinio.web.app"
