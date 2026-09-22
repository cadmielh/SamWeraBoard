"""Fill Word (.docx) and Google Docs templates with extracted ID data."""

import copy
import io
import re
from docx import Document
from docx.text.paragraph import Paragraph

import variants


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


def _expand_repeat_blocks(doc: Document, groups: dict[str, list[dict[str, str]]],
                          variant_ctx: dict | None = None, variant_warnings: set | None = None) -> None:
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
                # Sexul persoanei din acest element (SEX / SEX_REF) decide variantele „numit/ă”, „Domnul/Doamna” din blocul ei.
                fixed = (person.get("SEX") or None, person.get("SEX_REF") or None)
                for bp in block_paragraphs:
                    clone = copy.deepcopy(bp._p)
                    anchor.addprevious(clone)
                    clone_par = Paragraph(clone, bp._parent)
                    if variant_ctx is not None:
                        choices = variants.resolve_paragraph(clone_par, variant_ctx, {}, fixed)
                        if variant_warnings is not None:
                            variant_warnings |= variants.unresolved_persons(choices)
                    _replace_in_paragraph(clone_par, item_replacements)

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


_PLURAL_RO = {"ASOCIAT": "asociați", "ADMINISTRATOR": "administratori", "MEMBRU_IF": "membri de familie"}


def _numbered_positions_in(paragraphs) -> dict[str, set[int]]:
    """(prefix -> {N, ...}) pentru toate etichetele numerotate găsite ca text literal în paragrafele date."""
    out: dict[str, set[int]] = {}
    for p in paragraphs:
        text = "".join(r.text for r in p.runs)
        for m in _NUMBERED_TAG_RE.finditer(text):
            out.setdefault(m.group(1), set()).add(int(m.group(2)))
    return out


def _capacity_note_missing(prefix: str, template_max: int, have: int) -> str:
    plural = _PLURAL_RO.get(prefix, prefix.lower())
    return (f"Șablonul are text scris pentru {template_max} {plural}, dar sunt {have} — cei de la poziția "
            f"{template_max + 1} în sus nu apar deloc în document. Verifică manual sau folosește un șablon cu bloc repetitiv "
            f"(se adaptează automat la orice număr).")


def _capacity_note_left_visible(prefix: str, position: int) -> str:
    plural = _PLURAL_RO.get(prefix, prefix.lower())
    return (f"Șablonul are un paragraf scris pentru {position} {plural}, dar nu toate datele sunt disponibile — o parte din "
            f"text a rămas vizibilă ca etichetă necompletată ({{...}}) în document, ca să nu dispară datele deja completate. "
            f"Verifică documentul înainte de a-l folosi.")


#  Atribut XML temporar (fără spațiu de nume — invalid pentru schema OOXML, dar șters mereu înainte de salvare,
#  deci nu ajunge niciodată în fișierul final) folosit ca marcaj stabil pentru un paragraf anume. Identitatea
#  Python a elementelor lxml NU e stabilă între interogări repetate ale arborelui (doc.paragraphs poate întoarce
#  un proxy Python nou pentru același nod XML la fiecare apel, deci id(paragraph._p) diferă de la o etapă la
#  alta) — un atribut scris direct pe nodul XML rămâne vizibil oricărui proxy care îl citește ulterior.
_PROTECT_ATTR = "swbProtected"


def _protected_numbered_paragraphs(all_paragraphs, max_idx: dict[str, int]) -> dict[str, str]:
    """Marchează (vezi _PROTECT_ATTR) paragrafele care amestecă o poziție rezolvată (N <= max) cu una nerezolvată
    (N > max) a aceluiași prefix — ștergerea întregului paragraf ar arunca și persoana deja rezolvată din el.
    Întoarce {marcaj: mesaj}, verificat mai târziu la curățare."""
    notes: dict[str, str] = {}
    n = 0
    for p in all_paragraphs:
        text = "".join(r.text for r in p.runs)
        seen: dict[str, set[int]] = {}
        for m in _NUMBERED_TAG_RE.finditer(text):
            seen.setdefault(m.group(1), set()).add(int(m.group(2)))
        for prefix, ns in seen.items():
            mx = max_idx.get(prefix, 0)
            if any(nn <= mx for nn in ns) and any(nn > mx for nn in ns):
                n += 1
                marker = f"p{n}"
                p._p.set(_PROTECT_ATTR, marker)
                notes[marker] = _capacity_note_left_visible(prefix, mx)
                break  # un singur marcaj per paragraf e suficient
    return notes


def _strip_protect_markers(all_paragraphs) -> None:
    for p in all_paragraphs:
        if p._p.get(_PROTECT_ATTR) is not None:
            del p._p.attrib[_PROTECT_ATTR]


def _all_paragraphs(doc: Document) -> list:
    """Corp + tabele (inclusiv imbricate) + antete/subsoluri — același univers peste care rulează completarea."""
    out = list(doc.paragraphs)
    for table in _iter_all_tables(doc):
        for row in table.rows:
            for cell in row.cells:
                out.extend(cell.paragraphs)
    for section in doc.sections:
        for part in (section.header, section.first_page_header, section.even_page_header,
                     section.footer, section.first_page_footer, section.even_page_footer):
            if part is not None:
                out.extend(part.paragraphs)
    return out


def _clean_unresolved_numbered_positions(
    doc: Document, replacements: dict[str, str], protected: dict[str, str] | None = None,
    capacity_warnings: set[str] | None = None,
) -> None:
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

    Exception: a paragraph marked in `protected` (see `_protected_numbered_paragraphs`, computed before the
    flat replace pass, since afterwards a resolved position is no longer literal text to detect) also contains
    a *resolved* position of the same prefix — deleting it wholesale would silently discard that resolved
    person's data along with the unresolved leftover. It's left as-is (visible `{{...}}`) and reported instead.
    """
    max_idx = _max_numbered_index(replacements)
    if not max_idx:
        return
    protected = protected or {}

    def note_for(paragraph) -> str | None:
        marker = paragraph._p.get(_PROTECT_ATTR)
        return protected.get(marker) if marker else None

    def delete_paragraph(paragraph) -> None:
        p = paragraph._p
        parent = p.getparent()
        if parent is not None:
            parent.remove(p)

    def handle_deletable(paragraphs) -> None:
        for paragraph in list(paragraphs):
            text = "".join(run.text for run in paragraph.runs)
            if not _has_unresolved_numbered_tag(text, max_idx):
                continue
            note = note_for(paragraph)
            if note:
                if capacity_warnings is not None:
                    capacity_warnings.add(note)
                continue
            delete_paragraph(paragraph)

    handle_deletable(doc.paragraphs)

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    text = "".join(run.text for run in paragraph.runs)
                    if not _has_unresolved_numbered_tag(text, max_idx):
                        continue
                    note = note_for(paragraph)
                    if note:
                        if capacity_warnings is not None:
                            capacity_warnings.add(note)
                        continue
                    for run in paragraph.runs:
                        run.text = ""

    for section in doc.sections:
        for header in [section.header, section.first_page_header, section.even_page_header]:
            if header is not None:
                handle_deletable(header.paragraphs)
        for footer in [section.footer, section.first_page_footer, section.even_page_footer]:
            if footer is not None:
                handle_deletable(footer.paragraphs)


def fill_docx(
    template_bytes: bytes,
    replacements: dict[str, str],
    groups: dict[str, list[dict[str, str]]] | None = None,
    selected_clauses: list[str] | None = None,
    row_groups: dict[str, list[dict[str, str]]] | None = None,
    variant_ctx: dict | None = None,
    variant_warnings: set | None = None,
    capacity_warnings: set | None = None,
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

    `capacity_warnings`, if given, collects Romanian sentences (mutated set) when a numbered-position
    template (ASOCIAT_N_*, ADMINISTRATOR_N_*, ...) doesn't have room for everyone: either some people
    have no matching position anywhere in the template (silently missing otherwise — see
    _capacity_note_missing), or a paragraph mixing a resolved and an unresolved position was kept
    instead of deleted, to avoid losing the resolved person's data (see _capacity_note_left_visible).
    A template built with {{#ASOCIATI}}/{{#ADMINISTRATORI}} blocks isn't affected — it already scales.

    Returns the filled document as bytes.
    """
    doc = Document(io.BytesIO(template_bytes))
    ctx = variants.sanitize_ctx(variant_ctx) if variant_ctx is not None else None

    # Câte poziții numerotate are ȘABLONUL ORIGINAL (înainte de orice expandare) pentru fiecare prefix — dacă
    # clientul are mai multe persoane decât poziții scrise în șablon, cele în plus n-ar apărea nicăieri, fără
    # niciun semn vizibil. Un șablon care folosește exclusiv {{#ASOCIATI}}/{{#ADMINISTRATORI}} (fără nicio
    # poziție numerotată) nu are această problemă — se sare peste verificare pentru acel prefix.
    if capacity_warnings is not None:
        template_positions = _numbered_positions_in(_all_paragraphs(doc))
        for prefix, have in _max_numbered_index(replacements).items():
            template_max = template_positions.get(prefix)
            if template_max and have > max(template_max):
                capacity_warnings.add(_capacity_note_missing(prefix, max(template_max), have))

    if groups:
        _expand_repeat_blocks(doc, groups, ctx, variant_warnings)

    _expand_repeat_table_rows(doc, row_groups)

    _expand_clause_library(doc, selected_clauses)

    # Paragrafele care amestecă o poziție rezolvată cu una nerezolvată a aceluiași prefix — calculat ACUM, cât
    # etichetele numerotate sunt încă text literal (după înlocuire, poziția rezolvată nu mai lasă nicio urmă
    # de identificat) — protejate mai jos de ștergere, la _clean_unresolved_numbered_positions.
    protected_paragraphs = _protected_numbered_paragraphs(_all_paragraphs(doc), _max_numbered_index(replacements))

    # Variante „a/b” (sex, număr, categorie) — înaintea înlocuirii etichetelor, ca să se vadă persoanele la care se referă
    if ctx is not None:
        _resolve_variants(doc, ctx, replacements, variant_warnings)

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

    _clean_unresolved_numbered_positions(doc, replacements, protected_paragraphs, capacity_warnings)
    if protected_paragraphs:
        _strip_protect_markers(_all_paragraphs(doc))  # marcaj intern, nu trebuie să ajungă în fișierul salvat

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def _resolve_variants(doc: Document, ctx: dict, replacements: dict[str, str], warnings: set | None) -> None:
    def run(paragraphs) -> None:
        for p in paragraphs:
            ch = variants.resolve_paragraph(p, ctx, replacements)
            if warnings is not None:
                warnings.update(variants.unresolved_persons(ch))

    run(doc.paragraphs)
    for table in _iter_all_tables(doc):
        for row in table.rows:
            for cell in row.cells:
                run(cell.paragraphs)
    for section in doc.sections:
        for part in (section.header, section.first_page_header, section.even_page_header,
                     section.footer, section.first_page_footer, section.even_page_footer):
            if part is not None:
                run(part.paragraphs)


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
