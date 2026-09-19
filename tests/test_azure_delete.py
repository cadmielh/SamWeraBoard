"""Azure păstrează temporar (max. 24 h) fișierul trimis și rezultatul; aplicația cere ștergerea imediată după procesare."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import azure_extractor as az  # noqa: E402

OP = "https://x.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-idDocument/analyzeResults/abc123?api-version=2024-11-30"


class R:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code, self._b, self.headers, self.text = status, body or {}, headers or {}, "x"

    def json(self):
        return self._b


@pytest.fixture()
def calls(monkeypatch):
    monkeypatch.setenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "https://x.cognitiveservices.azure.com")
    monkeypatch.setenv("AZURE_DOCUMENT_INTELLIGENCE_KEY", "k")
    monkeypatch.setattr(az.time, "sleep", lambda *_: None)
    rec = {"delete": []}
    monkeypatch.setattr(az._req, "post", lambda *a, **k: R(202, headers={"Operation-Location": OP}))
    monkeypatch.setattr(az._req, "delete", lambda url, **k: rec["delete"].append((url, k["headers"]["Ocp-Apim-Subscription-Key"])) or R(204))
    return rec


def test_result_is_deleted_right_after_a_successful_analysis(calls, monkeypatch):
    monkeypatch.setattr(az._req, "get", lambda *a, **k: R(200, {"status": "succeeded", "analyzeResult": {"documents": ["ok"]}}))
    assert az._analyze(b"x", "image/jpeg") == {"documents": ["ok"]}
    assert calls["delete"] == [(OP, "k")]                       # exact URL-ul operației, cu cheia serviciului


def test_result_is_deleted_even_when_the_analysis_fails(calls, monkeypatch):
    monkeypatch.setattr(az._req, "get", lambda *a, **k: R(200, {"status": "failed", "error": {"code": "x"}}))
    with pytest.raises(RuntimeError):
        az._analyze(b"x", "image/jpeg")
    assert len(calls["delete"]) == 1


def test_result_is_deleted_on_polling_timeout_and_http_errors(calls, monkeypatch):
    monkeypatch.setattr(az, "_POLL_MAX_WAIT", 3.0)
    monkeypatch.setattr(az._req, "get", lambda *a, **k: R(200, {"status": "running"}))
    with pytest.raises(RuntimeError, match="timeout"):
        az._analyze(b"x", "image/jpeg")
    monkeypatch.setattr(az._req, "get", lambda *a, **k: R(500))
    with pytest.raises(RuntimeError, match="poll"):
        az._analyze(b"x", "image/jpeg")
    assert len(calls["delete"]) == 2


def test_a_failing_delete_never_breaks_the_extraction(calls, monkeypatch, capsys):
    monkeypatch.setattr(az._req, "get", lambda *a, **k: R(200, {"status": "succeeded", "analyzeResult": {"a": 1}}))

    def boom(*a, **k):
        raise ConnectionError("rețea")
    monkeypatch.setattr(az._req, "delete", boom)
    assert az._analyze(b"x", "image/jpeg") == {"a": 1}
    assert "ștergerea rezultatului a eșuat" in capsys.readouterr().out


def test_nothing_is_deleted_when_the_analysis_never_started(monkeypatch):
    monkeypatch.setenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "https://x.cognitiveservices.azure.com")
    monkeypatch.setenv("AZURE_DOCUMENT_INTELLIGENCE_KEY", "k")
    deleted = []
    monkeypatch.setattr(az._req, "post", lambda *a, **k: R(400))
    monkeypatch.setattr(az._req, "delete", lambda *a, **k: deleted.append(1) or R(204))
    with pytest.raises(RuntimeError):
        az._analyze(b"x", "image/jpeg")
    assert deleted == []
