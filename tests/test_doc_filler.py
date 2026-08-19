"""Teste unitare pentru doc_filler.py — biblioteca de clauze opționale
({{#CLAUZE}}...{{/CLAUZE}}) și non-regresia motorului existent (placeholdere
plate + blocuri repetitive {{#TAG}}...{{/TAG}})."""

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from docx import Document

import doc_filler as df


def _build_docx(paragraphs: list[str]) -> bytes:
    """Construiește un .docx minimal, un paragraf per element din listă."""
    doc = Document()
    for text in paragraphs:
        doc.add_paragraph(text)
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def _read_paragraphs(docx_bytes: bytes) -> list[str]:
    doc = Document(io.BytesIO(docx_bytes))
    return ["".join(r.text for r in p.runs) for p in doc.paragraphs]


CLAUSE_TEMPLATE = [
    "Titlu document",
    "{{#CLAUZE}}",
    "Denumire: CLAUZA A",
    "Art. {{ART_NR}} Text clauza A cu {{CAMP_A}}.",
    "Denumire: CLAUZA B",
    "Art. {{ART_NR}} Text clauza B cu {{CAMP_B}}.",
    "Denumire: CLAUZA C",
    "Art. {{ART_NR}} Text clauza C cu {{CAMP_C}}.",
    "{{/CLAUZE}}",
    "Semnătură",
]


# ── list_clauses_in_docx ────────────────────────────────────────────────────

def test_list_clauses_detects_all_three_in_order():
    clauses = df.list_clauses_in_docx(_build_docx(CLAUSE_TEMPLATE))
    assert [c["tag"] for c in clauses] == ["CLAUZA_A", "CLAUZA_B", "CLAUZA_C"]
    assert clauses[0]["label"] == "CLAUZA A"
    assert clauses[0]["placeholders"] == ["{{CAMP_A}}"]


def test_list_clauses_excludes_art_nr():
    clauses = df.list_clauses_in_docx(_build_docx(CLAUSE_TEMPLATE))
    for c in clauses:
        assert "{{ART_NR}}" not in c["placeholders"]


def test_list_clauses_empty_without_markers():
    assert df.list_clauses_in_docx(_build_docx(["Text simplu", "{{NUME}}"])) == []


# ── fill_docx cu selected_clauses ───────────────────────────────────────────

def test_fill_docx_keeps_only_selected_clauses_in_template_order():
    replacements = {"{{CAMP_A}}": "A", "{{CAMP_B}}": "B", "{{CAMP_C}}": "C"}
    out = df.fill_docx(_build_docx(CLAUSE_TEMPLATE), replacements, selected_clauses=["CLAUZA_C", "CLAUZA_A"])
    joined = "\n".join(_read_paragraphs(out))
    assert "clauza A" in joined
    assert "clauza C" in joined
    assert "clauza B" not in joined
    assert "Denumire:" not in joined
    assert "{{#CLAUZE}}" not in joined and "{{/CLAUZE}}" not in joined


def test_fill_docx_numbers_art_nr_sequentially_over_kept_clauses_only():
    # Selectate în ordine "greșită" (C înaintea A) — ordinea din document tot câștigă.
    replacements = {"{{CAMP_A}}": "A", "{{CAMP_C}}": "C"}
    out = df.fill_docx(_build_docx(CLAUSE_TEMPLATE), replacements, selected_clauses=["CLAUZA_C", "CLAUZA_A"])
    texts = [t for t in _read_paragraphs(out) if t.strip()]
    assert "Art. 1 Text clauza A cu A." in texts
    assert "Art. 2 Text clauza C cu C." in texts


def test_fill_docx_single_clause_selected():
    out = df.fill_docx(_build_docx(CLAUSE_TEMPLATE), {"{{CAMP_B}}": "B"}, selected_clauses=["CLAUZA_B"])
    texts = [t for t in _read_paragraphs(out) if t.strip()]
    assert "Art. 1 Text clauza B cu B." in texts
    assert not any("clauza A" in t or "clauza C" in t for t in texts)


def test_fill_docx_no_clauses_selected_removes_all_articles():
    out = df.fill_docx(_build_docx(CLAUSE_TEMPLATE), {}, selected_clauses=[])
    texts = [t for t in _read_paragraphs(out) if t.strip()]
    assert texts == ["Titlu document", "Semnătură"]


# ── Non-regresie ────────────────────────────────────────────────────────────

def test_fill_docx_without_clauze_markers_behaves_as_before():
    """Un document fără {{#CLAUZE}} nu e afectat de selected_clauses — motorul
    existent (placeholdere plate) rămâne neschimbat, indiferent ce se pasează."""
    template = _build_docx(["Bună, {{NUME}}!"])
    out_without = df.fill_docx(template, {"{{NUME}}": "Ion"})
    out_with = df.fill_docx(template, {"{{NUME}}": "Ion"}, selected_clauses=["ORICE"])
    assert out_without == out_with
    assert "Bună, Ion!" in _read_paragraphs(out_without)


def test_fill_docx_repeat_blocks_still_work_alongside_clause_library():
    """{{#ASOCIATI}} (bloc repetitiv existent) funcționează neschimbat chiar și
    într-un document care are și o secțiune {{#CLAUZE}}."""
    template = _build_docx([
        "{{#ASOCIATI}}",
        "{{INDEX}}. {{NUME}}",
        "{{/ASOCIATI}}",
        "{{#CLAUZE}}",
        "Denumire: CLAUZA A",
        "Art. {{ART_NR}} {{CAMP_A}}",
        "{{/CLAUZE}}",
    ])
    groups = {"ASOCIATI": [{"NUME": "Popescu"}, {"NUME": "Ionescu"}]}
    out = df.fill_docx(template, {"{{CAMP_A}}": "text"}, groups=groups, selected_clauses=["CLAUZA_A"])
    texts = [t for t in _read_paragraphs(out) if t.strip()]
    assert "1. Popescu" in texts
    assert "2. Ionescu" in texts
    assert "Art. 1 text" in texts


def test_fill_docx_nested_repeat_group_inside_a_clause():
    """Un bloc {{#TAG}} imbricat în interiorul unei clauze (ex. structura
    rezultată după cesiune) e expandat corect înainte de filtrarea clauzelor."""
    template = _build_docx([
        "{{#CLAUZE}}",
        "Denumire: CESIUNE",
        "Art. {{ART_NR}} Structura rezultată:",
        "{{#STRUCTURA}}",
        "{{NUME}} - {{PROCENT}}%",
        "{{/STRUCTURA}}",
        "{{/CLAUZE}}",
    ])
    groups = {"STRUCTURA": [{"NUME": "Ionescu", "PROCENT": "100"}]}
    out = df.fill_docx(template, {}, groups=groups, selected_clauses=["CESIUNE"])
    texts = [t for t in _read_paragraphs(out) if t.strip()]
    assert "Ionescu - 100%" in texts
