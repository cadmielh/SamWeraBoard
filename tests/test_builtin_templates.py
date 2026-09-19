"""Șabloanele de bază se încarcă indiferent de forma Unicode a numelor (macOS = NFD, Linux/Cloud Run = sensibil)."""
import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app as flask_app  # noqa: E402

NAME_NFC = "Declarație proprie răspundere desfășurare activități.docx"
NAME_NFD = unicodedata.normalize("NFD", NAME_NFC)


def test_resolves_a_file_stored_in_decomposed_form_when_the_registry_uses_composed_form(tmp_path, monkeypatch):
    (tmp_path / NAME_NFD).write_bytes(b"x")
    assert NAME_NFC != NAME_NFD
    # Pe Linux calea „compusă” nu există: simulăm comportamentul (pe macOS sistemul de fișiere ar potrivi singur).
    monkeypatch.setattr(Path, "is_file", lambda self: False)
    found = flask_app._resolve_template_file(tmp_path, NAME_NFC)
    assert unicodedata.normalize("NFC", found.name) == NAME_NFC


def test_resolves_the_direct_name_when_it_exists(tmp_path):
    (tmp_path / "Simplu.docx").write_bytes(b"x")
    assert flask_app._resolve_template_file(tmp_path, "Simplu.docx").name == "Simplu.docx"


def test_missing_template_raises_a_clear_error(tmp_path):
    (tmp_path / "Alt.docx").write_bytes(b"x")
    try:
        flask_app._resolve_template_file(tmp_path, "Lipsa.docx")
    except FileNotFoundError as e:
        assert "Lipsa.docx" in str(e)
    else:
        raise AssertionError("ar fi trebuit să ridice FileNotFoundError")


def test_every_registry_entry_is_loaded():
    registry = json.loads((flask_app.BUILTIN_TEMPLATE_DIR / "registry.json").read_text(encoding="utf-8"))
    assert {e["key"] for e in registry} == set(flask_app.BUILTIN_TEMPLATES)
    assert all(t["bytes"] for t in flask_app.BUILTIN_TEMPLATES.values())
