"""Anexele 2a (cerere ONRC, PJ) și 2b (PFA, II, IF): șabloanele generate de scripts/genereaza_anexa2{a,b}_docx.py se
completează integral.

Formularele dedicate (frontend/src/lib/anexa2{a,b}Filler.ts) trimit o valoare nevidă pentru fiecare etichetă; testele de
acolo verifică lista de etichete față de anexa2{a,b}Filler.placeholders.json. Aici se verifică documentul real: lista e aceeași,
nicio etichetă nu rămâne în text după completare, iar casetele/opțiunile apar ca simboluri.
"""
import io
import json
import sys
from pathlib import Path

import pytest
from docx import Document

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from doc_filler import _iter_all_tables, fill_docx, list_placeholders_in_docx  # noqa: E402

TPL_DIR = ROOT / "fisiere_template"
LIB = ROOT / "frontend" / "src" / "lib"
# (prefix, cheie în registry, fișier, lista de etichete pentru frontend, tipTemplate)
ANEXE = [
    ("A2A", "anexa2a_cerere_inregistrare_pj", "Anexa 2a - Cerere înregistrare în registrul comerțului.docx",
     "anexa2aFiller.placeholders.json", "PJ"),
    ("A2B", "anexa2b_cerere_inregistrare_pf", "Anexa 2b - Cerere înregistrare în registrul comerțului (PFA, II, IF).docx",
     "anexa2bFiller.placeholders.json", "PF"),
]

pytestmark = [
    pytest.mark.skipif(not all((TPL_DIR / a[2]).is_file() for a in ANEXE),
                       reason="șabloanele (fisiere_template/, ignorat de git) lipsesc pe acest calculator"),
    pytest.mark.parametrize("prefix,key,filename,tags_json,tip", ANEXE, ids=[a[0] for a in ANEXE]),
]


def _all_text(doc_bytes: bytes) -> str:
    doc = Document(io.BytesIO(doc_bytes))
    parts = [p.text for p in doc.paragraphs]
    for t in _iter_all_tables(doc):
        for row in t.rows:
            for cell in row.cells:
                parts.extend(p.text for p in cell.paragraphs)
    return "\n".join(parts)


def _value(tag: str, prefix: str) -> str:
    inner = tag[2:-2]
    if inner.startswith(f"{prefix}_B_"):
        return "☒"
    if inner.startswith(f"{prefix}_O_"):
        return "●"
    return "Valoare"


def test_tag_list_matches_the_frontend_fixture(prefix, key, filename, tags_json, tip):
    tags = list_placeholders_in_docx((TPL_DIR / filename).read_bytes())
    assert tags == json.loads((LIB / tags_json).read_text(encoding="utf-8"))
    assert len(tags) == len(set(tags))
    assert all(t.startswith(f"{{{{{prefix}_") for t in tags)


def test_every_tag_is_replaced(prefix, key, filename, tags_json, tip):
    src = (TPL_DIR / filename).read_bytes()
    tags = list_placeholders_in_docx(src)
    out = fill_docx(src, {t: _value(t, prefix) for t in tags})
    text = _all_text(out)
    assert "{{" not in text and "}}" not in text
    assert "☒" in text and "●" in text
    assert list_placeholders_in_docx(out) == []


def test_registry_entry_points_to_the_template(prefix, key, filename, tags_json, tip):
    registry = json.loads((TPL_DIR / "registry.json").read_text(encoding="utf-8"))
    entry = next(e for e in registry if e["key"] == key)
    assert entry["filename"] == filename
    assert entry["tipTemplate"] == tip
