"""Fill Word (.docx) and Google Docs templates with extracted ID data."""

import copy
import io
import re
from docx import Document
from docx.text.paragraph import Paragraph


def _replace_in_paragraph(paragraph, replacements: dict[str, str]) -> None:
    """Replace placeholders in a paragraph, preserving each run's own formatting
    (bold/italic/etc.) — a placeholder typed in bold in the template comes out
    bold in the generated document, while surrounding plain text stays plain.

    Placeholders fully contained in one run are replaced in place (the common
    case). As a fallback, placeholders that Word split across multiple runs are
    resolved by merging just those runs, so unrelated text elsewhere in the
    paragraph is left untouched.
    """
    runs = paragraph.runs
    if not runs:
        return

    for run in runs:
        for placeholder, value in replacements.items():
            if placeholder in run.text:
                run.text = run.text.replace(placeholder, value)

    full_text = "".join(run.text for run in runs)
    if not any(placeholder in full_text for placeholder in replacements):
        return

    run_bounds = []
    pos = 0
    for run in runs:
        run_bounds.append((pos, pos + len(run.text)))
        pos += len(run.text)

    pattern = re.compile("|".join(re.escape(k) for k in sorted(replacements, key=len, reverse=True)))
    for m in reversed(list(pattern.finditer(full_text))):
        start, end = m.start(), m.end()
        value = replacements[m.group(0)]
        idxs = [i for i, (rs, re_) in enumerate(run_bounds) if rs < end and re_ > start]
        if not idxs:
            continue
        first_i, last_i = idxs[0], idxs[-1]
        rs = run_bounds[first_i][0]
        ls = run_bounds[last_i][0]
        prefix = runs[first_i].text[:start - rs]
        suffix = runs[last_i].text[end - ls:]
        runs[first_i].text = prefix + value + (suffix if first_i == last_i else "")
        if first_i != last_i:
            runs[last_i].text = suffix
            for mid_i in idxs[1:-1]:
                runs[mid_i].text = ""


def _para_text(paragraph) -> str:
    return "".join(run.text for run in paragraph.runs).strip()


def _iter_all_tables(container, _seen: set | None = None):
    """Yield every table reachable from `container` (a Document or a table
    cell), recursing into tables nested inside cells. python-docx's own
    `Document.tables`/`_Cell.tables` are shallow — they only list tables that
    are *direct* children, so a table nested inside another table's cell (as
    in the ONRC "Declarație activitate" template, where each 3.1/3.2/3.3
    section cell holds its own CAEN/sedii table) is otherwise invisible to
    both placeholder replacement and discovery.

    A horizontally/vertically merged cell (gridSpan/vMerge) is the *same*
    underlying `<w:tc>` XML element referenced once per spanned grid
    column/row by python-docx's `row.cells` — walking it naively would visit
    (and, for row-group expansion, mutate) the same nested table 2-3x. `_seen`
    dedupes by the nested table's own XML element identity.
    """
    if _seen is None:
        _seen = set()
    for table in container.tables:
        if id(table._tbl) in _seen:
            continue
        _seen.add(id(table._tbl))
        yield table
        for row in table.rows:
            for cell in row.cells:
                yield from _iter_all_tables(cell, _seen)


def _cell_text(cell) -> str:
    return "".join("".join(r.text for r in p.runs) for p in cell.paragraphs).strip()


def _expand_repeat_blocks(doc: Document, groups: dict[str, list[dict[str, str]]]) -> None:
    """
    Expand {{#TAG}} ... {{/TAG}} paragraph ranges (top-level body paragraphs) into
    one copy of the enclosed paragraphs per item in groups[TAG], substituting
    singular placeholders (e.g. {{NUME}}, {{CNP}}, {{INDEX}}) from that item.
    The original marker paragraphs and the template block are removed afterwards.
    Tags with no matching group, or malformed (missing end tag), are left as-is.
    """
    for tag, items in groups.items():
        start_marker = f"{{{{#{tag}}}}}"
        end_marker = f"{{{{/{tag}}}}}"

        while True:
            paragraphs = doc.paragraphs
            start_idx = next((i for i, p in enumerate(paragraphs) if _para_text(p) == start_marker), None)
            if start_idx is None:
                break
            end_idx = next(
                (i for i in range(start_idx + 1, len(paragraphs)) if _para_text(paragraphs[i]) == end_marker),
                None,
            )
            if end_idx is None:
                break  # no matching end tag — leave the stray start marker as-is

            block_paragraphs = paragraphs[start_idx + 1:end_idx]
            anchor = paragraphs[end_idx]._p

            for i, item in enumerate(items, start=1):
                person = {**item, "INDEX": str(i)}
                item_replacements = {"{{" + k + "}}": v for k, v in person.items()}
                for bp in block_paragraphs:
                    clone = copy.deepcopy(bp._p)
                    anchor.addprevious(clone)
                    _replace_in_paragraph(Paragraph(clone, bp._parent), item_replacements)

            # Remove the original template block + both markers
            for bp in block_paragraphs:
                bp._p.getparent().remove(bp._p)
            paragraphs[end_idx]._p.getparent().remove(paragraphs[end_idx]._p)
            paragraphs[start_idx]._p.getparent().remove(paragraphs[start_idx]._p)


def _row_distinct_cells(row) -> list:
    """`row.cells`, deduplicated — a horizontally/vertically merged cell
    (gridSpan/vMerge) is the same underlying `<w:tc>` returned once per
    spanned column/row, which would otherwise process it multiple times."""
    seen: set[int] = set()
    cells = []
    for cell in row.cells:
        key = id(cell._tc)
        if key in seen:
            continue
        seen.add(key)
        cells.append(cell)
    return cells


def _row_text(row) -> str:
    return "".join(_cell_text(c) for c in _row_distinct_cells(row)).strip()


def _expand_repeat_table_rows(doc: Document, row_groups: dict[str, list[dict[str, str]]] | None) -> None:
    """
    Table-row analogue of _expand_repeat_blocks, needed for templates where the
    repeatable content lives inside a table (e.g. the ONRC "Declarație
    activitate" CAEN/sedii secundare tables) rather than as body paragraphs —
    Word tables can grow to fit however many rows a client actually needs,
    with none of the fixed AcroForm slot limits the old PDF version had.

    A start row whose own text is exactly "{{#TAG}}" and an end row whose text
    is exactly "{{/TAG}}" (each typically a single row merged across the full
    table width) delimit one or more "template rows" carrying the per-item
    placeholders (e.g. {{CAEN}}, {{CAEN_DESC}}). One copy of the template rows
    is inserted per item in row_groups[TAG] (substituting {{INDEX}} plus that
    item's own fields), then the original template rows and both marker rows
    are removed. Tags with no matching group, or malformed (missing end row),
    are left as-is. Searches every table reachable via _iter_all_tables, so it
    works the same whether the marker rows sit in a top-level or nested table.
    """
    if not row_groups:
        return
    for table in _iter_all_tables(doc):
        for tag, items in row_groups.items():
            start_marker = f"{{{{#{tag}}}}}"
            end_marker = f"{{{{/{tag}}}}}"

            while True:
                rows = table.rows
                start_idx = next((i for i, r in enumerate(rows) if _row_text(r) == start_marker), None)
                if start_idx is None:
                    break
                end_idx = next(
                    (i for i in range(start_idx + 1, len(rows)) if _row_text(rows[i]) == end_marker),
                    None,
                )
                if end_idx is None:
                    break  # no matching end row — leave the stray start marker as-is

                start_tr = rows[start_idx]._tr
                end_tr = rows[end_idx]._tr
                template_trs = [r._tr for r in rows[start_idx + 1:end_idx]]

                for i, item in enumerate(items, start=1):
                    row_item = {**item, "INDEX": str(i)}
                    item_replacements = {"{{" + k + "}}": v for k, v in row_item.items()}
                    for tr in template_trs:
                        clone = copy.deepcopy(tr)
                        end_tr.addprevious(clone)
                        clone_row = next(r for r in table.rows if r._tr is clone)
                        for cell in _row_distinct_cells(clone_row):
                            for paragraph in cell.paragraphs:
                                _replace_in_paragraph(paragraph, item_replacements)

                # Remove the original template rows + both markers
                for tr in template_trs:
                    tr.getparent().remove(tr)
                start_tr.getparent().remove(start_tr)
                end_tr.getparent().remove(end_tr)


_NUMBERED_TAG_RE = re.compile(r"\{\{(ASOCIAT|ADMINISTRATOR|MEMBRU_IF)_(\d+)_[A-Z_]+\}\}")
_NUMBERED_KEY_RE = re.compile(r"^\{\{(ASOCIAT|ADMINISTRATOR|MEMBRU_IF)_(\d+)_")

_CLAUZE_START = "{{#CLAUZE}}"
_CLAUZE_END = "{{/CLAUZE}}"
_DENUMIRE_RE = re.compile(r"^Denumire:\s*(.+)$")
_ART_NR_PLACEHOLDER = "{{ART_NR}}"


_DIACRITICS = str.maketrans("ăâîșşțţĂÂÎȘŞȚŢ", "aaissttAAISSTT")


def _slugify_clause(label: str) -> str:
    """"SCHIMBARE SEDIU SOCIAL" -> "SCHIMBARE_SEDIU_SOCIAL", "ADĂUGARE COD CAEN"
    -> "ADAUGARE_COD_CAEN" — used as the clause's stable selection tag, derived
    from its "Denumire:" label so template authors never have to invent/maintain
    a separate tag by hand. Romanian diacritics are transliterated (not just
    stripped) so tags stay readable — both ș/ț and their legacy cedilla
    look-alikes ş/ţ are covered."""
    ascii_label = label.strip().translate(_DIACRITICS)
    return re.sub(r"[^A-Za-z0-9]+", "_", ascii_label.upper()).strip("_")


def _parse_clause_library(doc: Document):
    """
    Scans top-level body paragraphs between a {{#CLAUZE}} and {{/CLAUZE}}
    marker pair, splitting the paragraphs in between into clauses on
    paragraphs matching "Denumire: <label>" (that paragraph is a delimiter —
    excluded from every clause's own paragraph list).

    Returns (start_marker, end_marker, clauses), where clauses is a list of
    {"tag", "label", "denumire_paragraph", "paragraphs"} dicts in document
    order. Returns (None, None, []) if the markers aren't both present —
    callers treat that as "not a clause-library document".
    """
    paragraphs = doc.paragraphs
    start_idx = next((i for i, p in enumerate(paragraphs) if _para_text(p) == _CLAUZE_START), None)
    if start_idx is None:
        return None, None, []
    end_idx = next(
        (i for i in range(start_idx + 1, len(paragraphs)) if _para_text(paragraphs[i]) == _CLAUZE_END),
        None,
    )
    if end_idx is None:
        return None, None, []

    clauses: list[dict] = []
    current: dict | None = None
    for p in paragraphs[start_idx + 1:end_idx]:
        m = _DENUMIRE_RE.match(_para_text(p))
        if m:
            current = {"tag": _slugify_clause(m.group(1)), "label": m.group(1).strip(), "denumire_paragraph": p, "paragraphs": []}
            clauses.append(current)
        elif current is not None:
            current["paragraphs"].append(p)

    return paragraphs[start_idx], paragraphs[end_idx], clauses


def _expand_clause_library(doc: Document, selected_tags: list[str] | None) -> None:
    """
    Keeps only the clauses (from _parse_clause_library) whose tag is in
    selected_tags, in their original document order, numbering {{ART_NR}}
    sequentially (1, 2, 3…) over the kept clauses only. The "Denumire:" line
    of every clause (kept or not) is removed — it's an authoring delimiter,
    never meant to appear in the generated document. Clauses not selected are
    removed entirely, along with the {{#CLAUZE}}/{{/CLAUZE}} markers
    themselves.

    Every other placeholder inside a kept clause (e.g. {{SEDIU_NOU}}) is left
    untouched here — it's filled by the regular flat-replacement pass that
    runs afterward in fill_docx, exactly like any other placeholder.

    No-op if the document has no {{#CLAUZE}}/{{/CLAUZE}} pair — existing
    flat/repeat-block-only templates are unaffected.
    """
    start_p, end_p, clauses = _parse_clause_library(doc)
    if start_p is None:
        return

    selected = set(selected_tags or [])

    def delete_paragraph(paragraph) -> None:
        p = paragraph._p
        parent = p.getparent()
        if parent is not None:
            parent.remove(p)

    art_nr = 0
    for c in clauses:
        delete_paragraph(c["denumire_paragraph"])
        if c["tag"] in selected:
            art_nr += 1
            for p in c["paragraphs"]:
                _replace_in_paragraph(p, {_ART_NR_PLACEHOLDER: str(art_nr)})
        else:
            for p in c["paragraphs"]:
                delete_paragraph(p)

    delete_paragraph(start_p)
    delete_paragraph(end_p)


def _max_numbered_index(replacements: dict[str, str]) -> dict[str, int]:
    """Highest N actually present for each known numbered prefix (ASOCIAT_N_*, ...)."""
    max_idx: dict[str, int] = {}
    for key in replacements:
        m = _NUMBERED_KEY_RE.match(key)
        if m:
            prefix, n = m.group(1), int(m.group(2))
            if n > max_idx.get(prefix, 0):
                max_idx[prefix] = n
    return max_idx


def _has_unresolved_numbered_tag(text: str, max_idx: dict[str, int]) -> bool:
    for m in _NUMBERED_TAG_RE.finditer(text):
        prefix, n = m.group(1), int(m.group(2))
        if n > max_idx.get(prefix, 0):
            return True
    return False


def _clean_unresolved_numbered_positions(doc: Document, replacements: dict[str, str]) -> None:
    """
    Known numbered tags (ASOCIAT_N_*, ADMINISTRATOR_N_*, MEMBRU_IF_N_*) that
    reference a position beyond how many actually exist — e.g. {{ASOCIAT_3_NUME}}
    when there are only 2 asociați — are cleaned up instead of left as literal
    braces in the output:
      - in the main body/headers/footers, the whole paragraph is deleted (a
        half-finished sentence reads worse than no sentence);
      - in a table cell, only the cell's text is cleared, so the table itself
        isn't structurally broken.
    Unrecognized/misspelled tags are left untouched, so they stay visible —
    a clear signal something needs fixing before the document is final.
    """
    max_idx = _max_numbered_index(replacements)
    if not max_idx:
        return

    def delete_paragraph(paragraph) -> None:
        p = paragraph._p
        parent = p.getparent()
        if parent is not None:
            parent.remove(p)

    for paragraph in list(doc.paragraphs):
        text = "".join(run.text for run in paragraph.runs)
        if _has_unresolved_numbered_tag(text, max_idx):
            delete_paragraph(paragraph)

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    text = "".join(run.text for run in paragraph.runs)
                    if _has_unresolved_numbered_tag(text, max_idx):
                        for run in paragraph.runs:
                            run.text = ""

    for section in doc.sections:
        for header in [section.header, section.first_page_header, section.even_page_header]:
            if header is not None:
                for paragraph in list(header.paragraphs):
                    text = "".join(run.text for run in paragraph.runs)
                    if _has_unresolved_numbered_tag(text, max_idx):
                        delete_paragraph(paragraph)
        for footer in [section.footer, section.first_page_footer, section.even_page_footer]:
            if footer is not None:
                for paragraph in list(footer.paragraphs):
                    text = "".join(run.text for run in paragraph.runs)
                    if _has_unresolved_numbered_tag(text, max_idx):
                        delete_paragraph(paragraph)


def fill_docx(
    template_bytes: bytes,
    replacements: dict[str, str],
    groups: dict[str, list[dict[str, str]]] | None = None,
    selected_clauses: list[str] | None = None,
    row_groups: dict[str, list[dict[str, str]]] | None = None,
) -> bytes:
    """
    Fill a .docx template by replacing {{PLACEHOLDER}} markers.

    If `groups` is given, {{#TAG}}...{{/TAG}} paragraph blocks are expanded
    first — once per item in groups[TAG] — before the flat placeholder pass
    runs over the whole (now expanded) document.

    If `row_groups` is given, {{#TAG}}...{{/TAG}} *table row* ranges (see
    _expand_repeat_table_rows) are expanded the same way — used for
    repeatable content that lives inside a table (e.g. a variable-length list
    of CAEN codes) rather than as body paragraphs.

    If the template contains a {{#CLAUZE}}...{{/CLAUZE}} section (a "clause
    library" — several optional "Denumire: X" articles), only the clauses
    whose tag is in `selected_clauses` are kept, with {{ART_NR}} numbered
    sequentially over just the kept ones. Templates without that section are
    unaffected regardless of `selected_clauses`.

    Returns the filled document as bytes.
    """
    doc = Document(io.BytesIO(template_bytes))

    if groups:
        _expand_repeat_blocks(doc, groups)

    _expand_repeat_table_rows(doc, row_groups)

    _expand_clause_library(doc, selected_clauses)

    # Replace in main body paragraphs
    for paragraph in doc.paragraphs:
        _replace_in_paragraph(paragraph, replacements)

    # Replace in tables, including tables nested inside a cell (e.g. the
    # per-section CAEN/sedii tables in the ONRC "Declarație activitate"
    # template) — plain `doc.tables` only lists top-level tables.
    for table in _iter_all_tables(doc):
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

    _clean_unresolved_numbered_positions(doc, replacements)

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def list_placeholders_in_docx(template_bytes: bytes) -> list[str]:
    """Return all unique {{PLACEHOLDER}} markers found in the template.

    Excludes {{#TAG}}/{{/TAG}} repeat-block markers — those are structural,
    not fillable fields.
    """
    doc = Document(io.BytesIO(template_bytes))
    pattern = re.compile(r"\{\{[^}]+\}\}")
    marker_pattern = re.compile(r"^\{\{[#/]")
    found: set[str] = set()

    def scan_paragraphs(paragraphs):
        for p in paragraphs:
            text = "".join(r.text for r in p.runs)
            for match in pattern.findall(text):
                if not marker_pattern.match(match):
                    found.add(match)

    scan_paragraphs(doc.paragraphs)
    for table in _iter_all_tables(doc):
        for row in table.rows:
            for cell in row.cells:
                scan_paragraphs(cell.paragraphs)

    return sorted(found)


def list_clauses_in_docx(template_bytes: bytes) -> list[dict]:
    """
    Return [{"tag", "label", "placeholders"}] for each "Denumire: X" clause
    found inside a {{#CLAUZE}}...{{/CLAUZE}} section, in document order.

    `placeholders` are the unique {{X}} markers used only by that clause
    (excluding {{ART_NR}}, which is auto-numbered — never asked of the user
    — and nested {{#TAG}}/{{/TAG}} repeat-block markers, which are
    structural). Returns [] if the template has no clause-library section.
    """
    doc = Document(io.BytesIO(template_bytes))
    _, _, clauses = _parse_clause_library(doc)

    pattern = re.compile(r"\{\{[^}]+\}\}")
    marker_pattern = re.compile(r"^\{\{[#/]")

    result = []
    for c in clauses:
        found: set[str] = set()
        for p in c["paragraphs"]:
            text = "".join(r.text for r in p.runs)
            for match in pattern.findall(text):
                if not marker_pattern.match(match) and match != _ART_NR_PLACEHOLDER:
                    found.add(match)
        result.append({"tag": c["tag"], "label": c["label"], "placeholders": sorted(found)})
    return result
