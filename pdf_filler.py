"""Fill PDF AcroForm templates (fillable government/ONRC forms) by field name."""

import io
import re
from pathlib import Path

import fitz  # PyMuPDF

# PyMuPDF's AcroForm widget appearance generator (Widget.update()) is hard-limited
# to the 14 base fonts (Helvetica/Courier/Times/Symbol/ZapfDingbats), which only
# cover WinAnsiEncoding (cp1252). Romanian's comma-below letters (ș/ş, ț/ţ) and ă
# fall outside that set: for auto-sized fields (text_fontsize 0, the vast majority
# in this form) widget.update() produces a completely blank appearance for any
# value containing them; for the handful of fields with a fixed text_fontsize it
# instead renders every *representable* character at its normal position and
# skips only the unsupported ones — which, since our replacement text is drawn
# separately afterwards, would otherwise double-render as garbled overlapping
# text (confirmed by rendering to an image in both cases). DejaVu Sans has full
# coverage, so for values with unsupported characters we blank out whatever the
# native appearance produced and paint the text ourselves instead.
_FONT_PATH = Path(__file__).parent / "fonts" / "DejaVuSans.ttf"
_FONT_NAME = "DejaVuSansPdfFiller"

_ALIGN_BY_Q = {0: fitz.TEXT_ALIGN_LEFT, 1: fitz.TEXT_ALIGN_CENTER, 2: fitz.TEXT_ALIGN_RIGHT}
_AP_N_RE = re.compile(r"/N\s+(\d+)\s+0\s+R")


def _needs_unicode_fallback(text: str) -> bool:
    """True if `text` has a character the base-14 WinAnsi fonts can't render."""
    try:
        text.encode("cp1252")
        return False
    except UnicodeEncodeError:
        return True


def _autosize_fontsize(font: fitz.Font, text: str, rect: fitz.Rect) -> float:
    """Pick the largest font size (capped by field height) that fits the field width.

    insert_textbox() needs about 1.4x the font size as line height (measured
    empirically — it silently draws nothing at all if the box is even slightly
    too short for one line), hence the /1.42 divisor rather than a flat padding.
    """
    max_by_height = max(rect.height / 1.42, 4)
    size = min(max_by_height, 10)
    while size > 4 and font.text_length(text, fontsize=size) > rect.width - 2:
        size -= 0.5
    return size


def _field_align(doc: fitz.Document, widget: fitz.Widget) -> int:
    """Read the field's /Q (text justification) straight from the PDF object."""
    kind, value = doc.xref_get_key(widget.xref, "Q")
    if kind == "int":
        return _ALIGN_BY_Q.get(int(value), fitz.TEXT_ALIGN_LEFT)
    return fitz.TEXT_ALIGN_LEFT


def _blank_widget_appearance(doc: fitz.Document, widget: fitz.Widget) -> None:
    """Empty out the widget's own (broken/partial) rendering of the value."""
    kind, value = doc.xref_get_key(widget.xref, "AP")
    if kind != "dict":
        return
    m = _AP_N_RE.search(value)
    if m:
        doc.update_stream(int(m.group(1)), b"")


def _draw_unicode_overlay(page: fitz.Page, rect: fitz.Rect, align: int, value: str, font: fitz.Font) -> None:
    # A small top/bottom inset so the text doesn't sit flush against the
    # field's top border (insert_textbox() top-anchors within the box) — kept
    # modest since _autosize_fontsize derives its size from this same box, so
    # a bigger inset just means a smaller (still guaranteed-to-fit) font.
    pad = min(rect.height * 0.1, 1.2)
    box = fitz.Rect(rect.x0 + 1, rect.y0 + pad, rect.x1 - 1, rect.y1)
    fontsize = _autosize_fontsize(font, value, box)
    page.insert_textbox(
        box, value,
        fontname=_FONT_NAME, fontfile=str(_FONT_PATH), fontsize=fontsize,
        align=align, border_width=0,
    )


def fill_pdf(template_bytes: bytes, field_values: dict[str, str]) -> bytes:
    """
    Fill a PDF's AcroForm text fields by name.

    Unknown keys in `field_values` (no matching field in the PDF) are ignored;
    fields with no entry in `field_values` are left as-is (blank, for a fresh
    template). `widget.update()` is called per filled field — this regenerates
    the field's appearance stream so the new text actually renders in any
    viewer/printer, not just ones that honor the PDF's NeedAppearances flag.

    Values containing characters outside WinAnsiEncoding (Romanian ș/ț/ă) are
    additionally painted with an embedded Unicode font, since the AcroForm
    appearance generator can't render them (see module docstring above).

    Returns the filled document as bytes.
    """
    doc = fitz.open(stream=template_bytes, filetype="pdf")
    try:
        unicode_font = None
        for page in doc:
            # Two passes: all widget.update() calls happen first, then all
            # Unicode-fallback overlays. insert_textbox() mutates the page's
            # content stream, which invalidates in-flight widget objects/
            # iteration if interleaved with reading widget.rect below.
            overlays = []
            for widget in list(page.widgets() or []):
                if widget.field_name not in field_values:
                    continue
                value = field_values[widget.field_name]
                widget.field_value = value
                widget.update()
                if value and _needs_unicode_fallback(value):
                    _blank_widget_appearance(doc, widget)
                    overlays.append((widget.rect, _field_align(doc, widget), value))
            if overlays:
                if unicode_font is None:
                    unicode_font = fitz.Font(fontfile=str(_FONT_PATH))
                for rect, align, value in overlays:
                    _draw_unicode_overlay(page, rect, align, value, unicode_font)
        out = io.BytesIO()
        doc.save(out)
        return out.getvalue()
    finally:
        doc.close()


def list_pdf_fields(template_bytes: bytes) -> list[str]:
    """Return the names of every AcroForm field in the PDF, in document order."""
    doc = fitz.open(stream=template_bytes, filetype="pdf")
    try:
        names = []
        for page in doc:
            for widget in page.widgets() or []:
                names.append(widget.field_name)
        return names
    finally:
        doc.close()
