"""Teste unitare pentru pdf_filler.py — completare PDF cu câmpuri AcroForm."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fitz

import pdf_filler as pf


def _build_pdf(field_names: list[str]) -> bytes:
    """Construiește un PDF minimal, cu un câmp text AcroForm per nume dat."""
    doc = fitz.open()
    page = doc.new_page()
    for i, name in enumerate(field_names):
        widget = fitz.Widget()
        widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
        widget.field_name = name
        widget.rect = fitz.Rect(50, 50 + i * 30, 300, 70 + i * 30)
        page.add_widget(widget)
    out = doc.tobytes()
    doc.close()
    return out


def _read_field_values(pdf_bytes: bytes) -> dict[str, str]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    values = {}
    for page in doc:
        for widget in page.widgets() or []:
            values[widget.field_name] = widget.field_value or ""
    doc.close()
    return values


def test_list_pdf_fields_returns_all_names_in_order():
    pdf = _build_pdf(["Nume", "Prenume", "CNP"])
    assert pf.list_pdf_fields(pdf) == ["Nume", "Prenume", "CNP"]


def test_fill_pdf_sets_known_fields():
    pdf = _build_pdf(["Nume", "Prenume", "CNP"])
    out = pf.fill_pdf(pdf, {"Nume": "IONESCU", "Prenume": "Maria"})
    values = _read_field_values(out)
    assert values["Nume"] == "IONESCU"
    assert values["Prenume"] == "Maria"


def test_fill_pdf_leaves_unmentioned_fields_blank():
    pdf = _build_pdf(["Nume", "Prenume", "CNP"])
    out = pf.fill_pdf(pdf, {"Nume": "IONESCU"})
    values = _read_field_values(out)
    assert values["CNP"] == ""
    assert values["Prenume"] == ""


def test_fill_pdf_ignores_unknown_keys():
    pdf = _build_pdf(["Nume"])
    # Nu trebuie să ridice nicio eroare pentru chei fără câmp corespondent.
    out = pf.fill_pdf(pdf, {"Nume": "IONESCU", "CampInexistent": "oricare valoare"})
    values = _read_field_values(out)
    assert values["Nume"] == "IONESCU"
    assert "CampInexistent" not in values


def test_fill_pdf_handles_diacritics():
    pdf = _build_pdf(["Localitate"])
    out = pf.fill_pdf(pdf, {"Localitate": "Timișoara, județul Timiș"})
    values = _read_field_values(out)
    assert values["Localitate"] == "Timișoara, județul Timiș"


def test_fill_pdf_diacritics_render_as_visible_text():
    """Storing field_value correctly isn't enough: PyMuPDF's widget appearance
    generator is hard-limited to the base-14 fonts (Helv/Cour/...), which can't
    render ș/ț/ă at all, so the value must also actually be painted on the page."""
    pdf = _build_pdf(["Localitate"])
    out = pf.fill_pdf(pdf, {"Localitate": "Timișoara"})
    doc = fitz.open(stream=out, filetype="pdf")
    text = doc[0].get_text()
    doc.close()
    assert "Timișoara" in text


def test_fill_pdf_diacritics_with_fixed_fontsize_dont_double_render():
    """Auto-sized fields (text_fontsize 0) render nothing at all for diacritics,
    but fields with a *fixed* text_fontsize render every representable character
    via the native appearance and only skip the unsupported ones — if that isn't
    blanked out before painting our own text, the result is garbled overlapping
    text. Regression test for that (see _blank_widget_appearance)."""
    doc = fitz.open()
    page = doc.new_page()
    widget = fitz.Widget()
    widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    widget.field_name = "Descriere"
    widget.rect = fitz.Rect(50, 50, 400, 70)
    widget.text_fontsize = 8
    page.add_widget(widget)
    pdf = doc.tobytes()
    doc.close()

    out = pf.fill_pdf(pdf, {"Descriere": "Activități de realizare a soft-ului"})
    doc2 = fitz.open(stream=out, filetype="pdf")
    text = doc2[0].get_text()
    doc2.close()
    assert text.count("Activit") == 1
    assert "Activități de realizare a soft-ului" in text
