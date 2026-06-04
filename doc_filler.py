"""Fill Word (.docx) and Google Docs templates with extracted ID data."""

import copy
import io
import re
from docx import Document
from docx.oxml.ns import qn


def _replace_in_paragraph(paragraph, replacements: dict[str, str]) -> None:
    """Replace placeholders in a paragraph, handling runs that split a placeholder."""
    # Rebuild full paragraph text from runs
    full_text = "".join(run.text for run in paragraph.runs)
    new_text = full_text
    for placeholder, value in replacements.items():
        new_text = new_text.replace(placeholder, value)

    if new_text == full_text:
        return  # Nothing changed

    # Put the whole replaced text into the first run, clear the rest
    if paragraph.runs:
        paragraph.runs[0].text = new_text
        for run in paragraph.runs[1:]:
            run.text = ""


def fill_docx(template_bytes: bytes, replacements: dict[str, str]) -> bytes:
    """
    Fill a .docx template by replacing {{PLACEHOLDER}} markers.

    Returns the filled document as bytes.
    """
    doc = Document(io.BytesIO(template_bytes))

    # Replace in main body paragraphs
    for paragraph in doc.paragraphs:
        _replace_in_paragraph(paragraph, replacements)

    # Replace in tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    _replace_in_paragraph(paragraph, replacements)

    # Replace in headers and footers
    for section in doc.sections:
        for header in [section.header, section.first_page_header, section.even_page_header]:
            if header is not None:
                for paragraph in header.paragraphs:
                    _replace_in_paragraph(paragraph, replacements)
        for footer in [section.footer, section.first_page_footer, section.even_page_footer]:
            if footer is not None:
                for paragraph in footer.paragraphs:
                    _replace_in_paragraph(paragraph, replacements)

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def list_placeholders_in_docx(template_bytes: bytes) -> list[str]:
    """Return all unique {{PLACEHOLDER}} markers found in the template."""
    doc = Document(io.BytesIO(template_bytes))
    pattern = re.compile(r"\{\{[^}]+\}\}")
    found: set[str] = set()

    def scan_paragraphs(paragraphs):
        for p in paragraphs:
            text = "".join(r.text for r in p.runs)
            for match in pattern.findall(text):
                found.add(match)

    scan_paragraphs(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                scan_paragraphs(cell.paragraphs)

    return sorted(found)
