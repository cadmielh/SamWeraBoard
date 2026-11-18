"""Construcția documentelor DOCX pentru formularele ONRC (Anexa 2a, Anexa 2b): text cu marcaje, chenare, tabele,
semnături, pagina A4 cu subsolul „Pag. x / y” și salvarea listei de etichete pentru testele din frontend.

Marcaje în text: **bold**  __italic__  ^superscript^  {{ETICHETĂ}}  \\n (rând nou)
"""
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

ROOT = Path(__file__).resolve().parent.parent

FONT = "Times New Roman"
SIZE = 10
CONTENT_W = 18.4   # cm, A4 cu margini de 1,3 cm

ALIGN = {"j": WD_ALIGN_PARAGRAPH.JUSTIFY, "l": WD_ALIGN_PARAGRAPH.LEFT,
         "c": WD_ALIGN_PARAGRAPH.CENTER, "r": WD_ALIGN_PARAGRAPH.RIGHT}

# **bold**  __italic__  ^superscript^  {{ETICHETĂ}}  \n (rând nou)
_TOKEN = re.compile(r"(\*\*|__|\^|\n|\{\{[A-Z0-9_]+\}\})")


def _runs(p, text, size=SIZE, bold=False):
    bold_on, ital_on, sup_on = bold, False, False
    for tok in _TOKEN.split(text):
        if not tok:
            continue
        if tok == "**":
            bold_on = not bold_on
        elif tok == "__":
            ital_on = not ital_on
        elif tok == "^":
            sup_on = not sup_on
        elif tok == "\n":
            p.add_run().add_break()
        else:
            r = p.add_run(tok)
            r.font.name = FONT
            r.font.size = Pt(size)
            # Valorile completate nu moștenesc stilul etichetei (ar ieși îngroșate în mijlocul unui rând obișnuit).
            is_tag = tok.startswith("{{")
            r.bold = bold_on and not is_tag
            r.italic = ital_on and not is_tag
            if sup_on:
                r.font.superscript = True


def P(container, text="", align="j", indent=0.0, size=SIZE, after=0.0, before=0.0, line=1.2, bold=False, keep=False):
    p = container.add_paragraph()
    fmt = p.paragraph_format
    fmt.alignment = ALIGN[align]
    fmt.space_after = Pt(after)
    fmt.space_before = Pt(before)
    fmt.line_spacing = line
    if indent:
        fmt.left_indent = Cm(indent)
    if keep:
        fmt.keep_with_next = True
    _runs(p, text, size=size, bold=bold)
    return p


def _set_cell_margins(cell, top=60, bottom=60, left=100, right=100):
    tcPr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for side, val in (("top", top), ("bottom", bottom), ("left", left), ("right", right)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tcPr.append(mar)


def _borders(table, size=6):
    """Chenar simplu pe tot tabelul, scris direct (nu doar prin stilul „Table Grid”, pe care unele programe îl ignoră)."""
    tblPr = table._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(size))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "000000")
        b.append(el)
    tblPr.append(b)


def _fixed_widths(table, widths):
    """Lățimi fixe pe coloane și pe tabel: fără ele, Word/Quick Look restrâng tabelul după conținut."""
    table.autofit = False
    for i, w in enumerate(widths):
        table.columns[i].width = Cm(w)
        for cell in table.columns[i].cells:
            cell.width = Cm(w)
    tblPr = table._tbl.tblPr
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.append(tblW)
    tblW.set(qn("w:w"), str(int(sum(widths) / 2.54 * 1440)))
    tblW.set(qn("w:type"), "dxa")


def _no_split(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:cantSplit")
    trPr.append(el)


def _first_par(cell):
    """Celula nouă are deja un paragraf gol: îl folosim pe el pentru primul rând, ca să nu rămână un rând alb sus."""
    return cell.paragraphs[0]


def cell_P(cell, text="", **kw):
    if len(cell.paragraphs) == 1 and not cell.paragraphs[0].runs:
        p = _first_par(cell)
        fmt = p.paragraph_format
        fmt.alignment = ALIGN[kw.get("align", "j")]
        fmt.space_after = Pt(kw.get("after", 0))
        fmt.space_before = Pt(kw.get("before", 0))
        fmt.line_spacing = kw.get("line", 1.2)
        if kw.get("indent"):
            fmt.left_indent = Cm(kw["indent"])
        _runs(p, text, size=kw.get("size", SIZE), bold=kw.get("bold", False))
        return p
    return P(cell, text, **kw)


def box(doc, gap_before=3):
    """Chenarul unei secțiuni (ca în formularul oficial): tabel cu o singură celulă, pe toată lățimea."""
    if gap_before:
        P(doc, "", size=2, line=1.0)
    t = doc.add_table(rows=1, cols=1)
    t.style = "Table Grid"
    _borders(t)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    _fixed_widths(t, [CONTENT_W])
    c = t.cell(0, 0)
    _set_cell_margins(c)
    return c


def grid(container, widths, rows=1, style=None):
    t = container.add_table(rows=rows, cols=len(widths))
    if style:
        t.style = style
        _borders(t)
    # Centrat, ca și chenarele secțiunilor (box): aliniat la stânga, Word îl decalează cu marginea celulei.
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    _fixed_widths(t, widths)
    for row in t.rows:
        for cell in row.cells:
            _set_cell_margins(cell, 20, 20, 60, 60)
    return t


def persoana_text(pre, regim=False):
    """Datele de identificare ale unei persoane fizice, în ordinea din formular."""
    t = (f"Nume {{{{{pre}_NUME}}}}, Prenume {{{{{pre}_PRENUME}}}}, CNP/NIF {{{{{pre}_CNP}}}}, domiciliat(ă) în localitatea "
         f"{{{{{pre}_DOM_LOC}}}}, str. {{{{{pre}_DOM_STR}}}}, nr. {{{{{pre}_DOM_NR}}}}, bloc {{{{{pre}_DOM_BL}}}}, scara {{{{{pre}_DOM_SC}}}}, "
         f"etaj {{{{{pre}_DOM_ET}}}}, ap. {{{{{pre}_DOM_AP}}}}, județ/sector {{{{{pre}_DOM_JUD}}}}, țara {{{{{pre}_DOM_TARA}}}}, "
         f"cetățenia {{{{{pre}_CET}}}}, născut(ă) în localitatea {{{{{pre}_NAST_LOC}}}}, sector/județ {{{{{pre}_NAST_JUD}}}}, "
         f"țara {{{{{pre}_NAST_TARA}}}}, la data de {{{{{pre}_NAST_DATA}}}}, act identitate {{{{{pre}_ACT_TIP}}}}, "
         f"seria {{{{{pre}_ACT_SERIA}}}}, nr. {{{{{pre}_ACT_NR}}}}, emis(ă) de {{{{{pre}_ACT_EMIS}}}}, la data {{{{{pre}_ACT_DATA}}}}, "
         f"valabil până la data {{{{{pre}_ACT_VALABIL}}}}")
    if regim:
        t += f", regimul matrimonial (după caz) {{{{{pre}_REGIM}}}}"
    return t


def semnaturi(cell, cols):
    """Trei coloane de semnătură (valoare deasupra, eticheta mică dedesubt), pe tab-uri centrate: un tabel imbricat
    e restrâns după conținut de unele programe, tab-urile nu."""
    for i, size in ((0, SIZE), (1, 8)):
        p = cell_P(cell, "\t" + "\t".join(c[i] for c in cols), align="l", size=size)
        for pos in (3.0, 9.0, 15.0):
            p.paragraph_format.tab_stops.add_tab_stop(Cm(pos), WD_TAB_ALIGNMENT.CENTER)


def document_nou():
    """Document A4 gol, cu stilul și subsolul „Pag. x / y” ale formularelor ONRC (folosit și de Anexa 2b)."""
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(1.3)
    sec.top_margin, sec.bottom_margin = Cm(1.0), Cm(1.0)
    sec.footer_distance = Cm(0.5)
    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal.font.size = Pt(SIZE)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    normal.paragraph_format.space_after = Pt(0)

    # Numerotarea paginilor, ca în formular („Pag. x / 4”), în subsol, la dreapta.
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    def _field(instr):
        r = fp.add_run()
        for kind, text in (("begin", None), (None, instr), ("end", None)):
            if kind:
                el = OxmlElement("w:fldChar")
                el.set(qn("w:fldCharType"), kind)
            else:
                el = OxmlElement("w:instrText")
                el.set(qn("xml:space"), "preserve")
                el.text = text
            r._r.append(el)
        r.font.size = Pt(8)
    lead = fp.add_run("Pag. ")
    lead.font.size = Pt(8)
    _field("PAGE")
    sep = fp.add_run(" / ")
    sep.font.size = Pt(8)
    _field("NUMPAGES")
    return doc


def salveaza(doc, titlu, out, tags_out):
    """Salvează documentul și lista etichetelor lui (pentru testul din frontend)."""
    doc.core_properties.author = ""
    doc.core_properties.title = titlu
    doc.save(out)
    print(f"Scris: {out.relative_to(ROOT)}")

    sys.path.insert(0, str(ROOT))
    import json
    from doc_filler import list_placeholders_in_docx
    tags = list_placeholders_in_docx(out.read_bytes())
    tags_out.write_text(json.dumps(tags, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"Scris: {tags_out.relative_to(ROOT)} ({len(tags)} etichete)")


def note(doc, texte):
    P(doc, "**Note :**", align="l", before=4, size=9)
    for i, txt in enumerate(texte, 1):
        p = P(doc, f"({i}) {txt}", size=8, line=1.0, after=1)
        p.paragraph_format.left_indent = Cm(0.9)
        p.paragraph_format.first_line_indent = Cm(-0.6)
