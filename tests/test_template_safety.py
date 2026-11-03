"""Teste pentru template_safety.py: ce .docx se acceptă ca șablon și ce se curăță la livrare."""
import io
import sys
import zipfile
from pathlib import Path

import pytest
from docx import Document

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import template_safety as ts  # noqa: E402
from template_safety import TemplateRejected  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def make_docx(text: str = "Societatea {{SOCIETATE_DENUMIRE}}", author: str = "Ion Popescu") -> bytes:
    doc = Document()
    doc.add_paragraph(text)
    doc.core_properties.author = author
    doc.core_properties.last_modified_by = author
    doc.core_properties.title = "Act SRL Exemplu"
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def rewrite(data: bytes, replace: dict[str, bytes] | None = None, add: dict[str, bytes] | None = None) -> bytes:
    """Aceeași arhivă, cu intrări înlocuite sau adăugate."""
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            dst.writestr(info.filename, (replace or {}).get(info.filename, src.read(info.filename)))
        for name, raw in (add or {}).items():
            dst.writestr(name, raw)
    return out.getvalue()


def code_of(data: bytes, **kw) -> str:
    with pytest.raises(TemplateRejected) as e:
        ts.validate_docx(data, **kw)
    return e.value.code


def part(data: bytes, name: str) -> bytes:
    return zipfile.ZipFile(io.BytesIO(data)).read(name)


# ── validate_docx ────────────────────────────────────────────────────────────

def test_document_word_obisnuit_e_acceptat():
    ts.validate_docx(make_docx())


def test_sabloanele_de_baza_sunt_acceptate():
    for f in (ROOT / "fisiere_template").glob("*.docx"):
        ts.validate_docx(f.read_bytes(), max_bytes=5 * 1024 * 1024)


def test_gol_sau_non_zip_e_refuzat():
    assert code_of(b"") == "invalid_template"
    assert code_of(b"nu e o arhiva") == "invalid_template"


def test_peste_limita_de_marime():
    assert code_of(make_docx(), max_bytes=100) == "template_too_large"


def test_arhiva_bomba_e_refuzata():
    bomb = rewrite(make_docx(), add={"word/media/mare.bin": b"\0" * (21 * 1024 * 1024)})
    assert code_of(bomb, max_bytes=10 * 1024 * 1024) == "invalid_template"


def test_fisier_zip_fara_continut_word():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("ceva.txt", "x")
    assert code_of(out.getvalue()) == "invalid_template"


def test_macro_e_refuzat():
    assert code_of(rewrite(make_docx(), add={"word/vbaProject.bin": b"x"})) == "template_macros"


def test_docm_redenumit_e_refuzat():
    data = make_docx()
    ct = part(data, "[Content_Types].xml").replace(
        b"wordprocessingml.document.main+xml", b"ms-word.document.macroEnabled.main+xml")
    assert code_of(rewrite(data, replace={"[Content_Types].xml": ct})) == "template_macros"


def test_setarile_imprimantei_sunt_permise():
    ts.validate_docx(rewrite(make_docx(), add={"word/printerSettings/printerSettings1.bin": b"x"}))


def test_obiect_ole_sau_activex_e_refuzat():
    assert code_of(rewrite(make_docx(), add={"word/embeddings/oleObject1.bin": b"x"})) == "template_embedded_objects"
    assert code_of(rewrite(make_docx(), add={"word/activeX/activeX1.xml": b"<a/>"})) == "template_embedded_objects"


def test_foaie_de_calcul_incorporata_e_permisa():
    ts.validate_docx(rewrite(make_docx(), add={"word/embeddings/Microsoft_Excel_Worksheet.xlsx": b"x"}))


def _with_rel(rel_type: str) -> bytes:
    data = make_docx()
    rels = part(data, "word/_rels/document.xml.rels").replace(
        b"</Relationships>",
        f'<Relationship Id="rIdX" Type="{rel_type}" Target="https://exemplu.ro/x" TargetMode="External"/>'
        f"</Relationships>".encode())
    return rewrite(data, replace={"word/_rels/document.xml.rels": rels})


def test_continut_extern_e_refuzat_dar_linkurile_sunt_permise():
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
    assert code_of(_with_rel(rel + "attachedTemplate")) == "template_external_content"
    ts.validate_docx(_with_rel(rel + "hyperlink"))


def test_doctype_e_refuzat():
    data = make_docx()
    doc = part(data, "word/document.xml").replace(b"?>", b'?><!DOCTYPE x [<!ENTITY a "b">]>', 1)
    assert code_of(rewrite(data, replace={"word/document.xml": doc})) == "invalid_template"


def test_completarea_verifica_doar_structura():
    """check_archive (folosit la /fill/docx) refuză bomba și DOCTYPE-ul, dar acceptă macro-uri și un șablon atașat."""
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
    ts.check_archive(_with_rel(rel + "attachedTemplate"), max_bytes=ts.MAX_STORED_BYTES)
    ts.check_archive(rewrite(make_docx(), add={"word/vbaProject.bin": b"x"}), max_bytes=ts.MAX_STORED_BYTES)
    bomb = rewrite(make_docx(), add={"word/media/mare.bin": b"\0" * (21 * 1024 * 1024)})
    with pytest.raises(TemplateRejected, match="invalid_template"):
        ts.check_archive(bomb, max_bytes=10 * 1024 * 1024)
    data = make_docx()
    doc = part(data, "word/document.xml").replace(b"?>", b'?><!DOCTYPE x [<!ENTITY a "b">]>', 1)
    with pytest.raises(TemplateRejected, match="invalid_template"):
        ts.check_archive(rewrite(data, replace={"word/document.xml": doc}), max_bytes=ts.MAX_STORED_BYTES)


# ── inspect_content ──────────────────────────────────────────────────────────

def test_document_curat_nu_are_probleme():
    assert ts.inspect_content(make_docx()) == []


def test_cnp_real_blocheaza_chiar_si_despartit_de_spatii():
    assert ts.inspect_content(make_docx("CNP 1900101123457")) == ["personal_data"]
    assert ts.inspect_content(make_docx("CNP 1 900101 123457")) == ["personal_data"]
    assert ts.inspect_content(make_docx("CNP 1 9 0 0 1 0 1 1 2 3 4 5 7")) == ["personal_data"]   # cifră cu cifră


def test_cnp_urmat_de_alte_numere_blocheaza():
    assert ts.contains_real_cnp("CNP 1900101123457 2023")
    assert ts.contains_real_cnp("1900101123457 01.01.2020")


def test_numere_care_nu_sunt_cnp_nu_blocheaza():
    assert ts.inspect_content(make_docx("Capital 1000000000000 lei")) == []      # cifră de control greșită
    assert ts.inspect_content(make_docx("Cod 1901301123450")) == []               # luna 13


def test_cnp_din_antet_blocheaza():
    doc = Document()
    doc.sections[0].header.paragraphs[0].text = "1900101123457"
    buf = io.BytesIO()
    doc.save(buf)
    assert ts.inspect_content(buf.getvalue()) == ["personal_data"]


def test_comentarii_si_modificari_urmarite_blocheaza():
    data = make_docx()
    w = b'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    comments = b'<?xml version="1.0"?><w:comments ' + w + b'><w:comment w:id="0"><w:p/></w:comment></w:comments>'
    assert ts.inspect_content(rewrite(data, add={"word/comments.xml": comments})) == ["comments"]
    tracked = part(data, "word/document.xml").replace(b"<w:body>", b'<w:body><w:p><w:ins w:id="1"/></w:p>', 1)
    assert ts.inspect_content(rewrite(data, replace={"word/document.xml": tracked})) == ["tracked_changes"]


def test_proprietati_personalizate_blocheaza():
    custom = (b'<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/'
              b'custom-properties"><property name="Client"/></Properties>')
    assert ts.inspect_content(rewrite(make_docx(), add={"docProps/custom.xml": custom})) == ["custom_properties"]


# ── strip_metadata ───────────────────────────────────────────────────────────

def test_metadatele_de_autor_sunt_golite_iar_continutul_ramane():
    cleaned = ts.strip_metadata(make_docx())
    ts.validate_docx(cleaned)
    props = Document(io.BytesIO(cleaned)).core_properties
    assert props.author == "" and props.last_modified_by == "" and props.title == ""
    assert "{{SOCIETATE_DENUMIRE}}" in Document(io.BytesIO(cleaned)).paragraphs[0].text
