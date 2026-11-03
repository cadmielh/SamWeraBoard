"""Verificarea și curățarea șabloanelor .docx încărcate de utilizatori.

Un .docx e o arhivă ZIP cu XML-uri. Înainte ca python-docx să-l deschidă (și înainte de a-l păstra sau livra
altui cabinet), aici se resping: arhivele-bombă, macro-urile, obiectele încorporate executabile, conținutul
încărcat de la distanță (șablon atașat, cadre) și declarațiile DOCTYPE/ENTITY din XML.

`inspect_content` și `strip_metadata` sunt folosite doar la livrarea unui șablon către alt cabinet
(templates_api.py): acolo documentul trebuie să nu conțină date personale, comentarii sau urme de autor.

Modul fără Flask și fără Firestore: primește octeți, întoarce octeți sau ridică `TemplateRejected`.
"""
from __future__ import annotations

import io
import re
import zipfile
from datetime import date

from lxml import etree

# Limita fișierului păstrat în Firestore (documentul are maximum 1 MiB, iar base64 crește dimensiunea cu 4/3).
# Aceeași valoare ca MAX_BASE64_BYTES din frontend (TemplateLibrary.tsx).
MAX_STORED_BYTES = 500 * 1024

_MAX_ENTRIES = 1000
_MAX_ENTRY_BYTES = 20 * 1024 * 1024
_MAX_TOTAL_BYTES = 50 * 1024 * 1024

_DOCX_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
_HYPERLINK_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
_EMBEDDED_OK = (".xlsx", ".docx", ".pptx")     # pachete OOXML fără macro (ex. foaia de calcul a unui grafic)

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_NS = {"w": _W}
_TEXT_PARTS = re.compile(r"^word/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$")
_TRACKED = ("ins", "del", "moveFrom", "moveTo")

# Parser fără entități externe și fără rețea; DOCTYPE e oricum respins înainte de parsare.
_PARSER = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)


class TemplateRejected(ValueError):
    """Șablon refuzat; `code` e codul de eroare trimis clientului (fără detalii din conținut)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _open(data: bytes) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, ValueError):
        raise TemplateRejected("invalid_template")


def _read(zf: zipfile.ZipFile, name: str) -> bytes:
    try:
        return zf.read(name)
    except (KeyError, zipfile.BadZipFile, ValueError, RuntimeError):     # RuntimeError: arhivă criptată
        raise TemplateRejected("invalid_template")


def _xml(raw: bytes):
    try:
        return etree.fromstring(raw, _PARSER)
    except etree.XMLSyntaxError:
        raise TemplateRejected("invalid_template")


def validate_docx(data: bytes | None, max_bytes: int = MAX_STORED_BYTES) -> None:
    """Ridică `TemplateRejected` dacă fișierul nu e un document Word sigur de prelucrat și de păstrat.

    Coduri: template_too_large, invalid_template, template_macros, template_embedded_objects,
    template_external_content."""
    if not data:
        raise TemplateRejected("invalid_template")
    if len(data) > max_bytes:
        raise TemplateRejected("template_too_large")
    zf = _open(data)
    infos = zf.infolist()
    # Dimensiunile declarate sunt o limită sigură: zipfile nu decomprimă mai mult decât declară intrarea.
    if (len(infos) > _MAX_ENTRIES or any(i.file_size > _MAX_ENTRY_BYTES for i in infos)
            or sum(i.file_size for i in infos) > _MAX_TOTAL_BYTES):
        raise TemplateRejected("invalid_template")
    names = {i.filename for i in infos}
    if "[Content_Types].xml" not in names:
        raise TemplateRejected("invalid_template")

    for name in names:
        low = name.lower()
        # Fișierele .bin în afara word/embeddings/ sunt legitime (ex. word/printerSettings/printerSettings1.bin).
        if "vbaproject" in low or low.startswith("word/vbadata"):
            raise TemplateRejected("template_macros")
        if low.startswith("word/activex/"):
            raise TemplateRejected("template_embedded_objects")
        if low.startswith("word/embeddings/") and not low.endswith(_EMBEDDED_OK):
            raise TemplateRejected("template_embedded_objects")

    for name in names:
        if not name.lower().endswith((".xml", ".rels")):
            continue
        raw = _read(zf, name)
        if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
            raise TemplateRejected("invalid_template")
        if name.lower().endswith(".rels"):
            for rel in _xml(raw):
                if rel.get("TargetMode") == "External" and rel.get("Type") != _HYPERLINK_REL:
                    raise TemplateRejected("template_external_content")

    types = _xml(_read(zf, "[Content_Types].xml"))
    content_types = {el.get("ContentType", "") for el in types}
    if _DOCX_MAIN not in content_types:
        # include .docm (macroEnabled.main+xml) și .dotx/.dotm (template.main+xml) redenumite în .docx
        raise TemplateRejected("template_macros" if any("macroEnabled" in t for t in content_types)
                               else "invalid_template")


# ── Conținut (doar la livrare) ───────────────────────────────────────────────

_CNP_WEIGHTS = (2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9)


def _valid_cnp(cnp: str) -> bool:
    """Cifra de control și data nașterii (sexul/secolul 1–8, luna, ziua). Cifra 9 (străini) nu codifică secolul."""
    total = sum(int(cnp[i]) * _CNP_WEIGHTS[i] for i in range(12))
    check = 1 if total % 11 == 10 else total % 11
    if check != int(cnp[12]):
        return False
    s, yy, mm, dd = int(cnp[0]), int(cnp[1:3]), int(cnp[3:5]), int(cnp[5:7])
    century = {1: 1900, 2: 1900, 3: 1800, 4: 1800, 5: 2000, 6: 2000, 7: 1900, 8: 1900, 9: 1900}.get(s)
    if century is None:
        return False
    try:
        date(century + yy, mm, dd)
    except ValueError:
        return False
    return True


def contains_real_cnp(text: str) -> bool:
    """Un șir de 13 cifre care trece verificarea CNP (cifrele pot fi despărțite de spații)."""
    compressed = re.sub(r"(\d)\s+(\d)", r"\1\2", text)
    return any(_valid_cnp(m.group(1)) for m in re.finditer(r"(?<!\d)([1-9]\d{12})(?!\d)", compressed))


def _paragraph_texts(root) -> list[str]:
    return ["".join(t.text or "" for t in p.iter(f"{{{_W}}}t")) for p in root.iter(f"{{{_W}}}p")]


def inspect_content(data: bytes) -> list[str]:
    """Problemele care blochează livrarea, ca listă de coduri (goală = documentul poate pleca).

    personal_data (un CNP valid), comments, tracked_changes, custom_properties. Se apelează după `validate_docx`."""
    zf = _open(data)
    problems: set[str] = set()
    for name in zf.namelist():
        if not _TEXT_PARTS.match(name):
            continue
        root = _xml(_read(zf, name))
        if name == "word/comments.xml":
            if root.find("w:comment", _NS) is not None:
                problems.add("comments")
        elif any(root.find(f".//w:{tag}", _NS) is not None for tag in _TRACKED):
            problems.add("tracked_changes")
        if any(contains_real_cnp(t) for t in _paragraph_texts(root)):
            problems.add("personal_data")
    if "docProps/custom.xml" in zf.namelist() and len(_xml(_read(zf, "docProps/custom.xml"))):
        problems.add("custom_properties")
    return sorted(problems)


# Proprietățile documentului care pot identifica autorul sau clientul (docProps/core.xml și app.xml).
_CORE_CLEAR = {"creator", "lastModifiedBy", "title", "subject", "description", "keywords", "category",
               "lastPrinted", "contentStatus", "identifier"}
_APP_CLEAR = {"Company", "Manager", "HyperlinkBase"}


def _clear_children(raw: bytes, local_names: set[str]) -> bytes:
    root = _xml(raw)
    for el in list(root):
        if etree.QName(el).localname in local_names:
            root.remove(el)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def strip_metadata(data: bytes) -> bytes:
    """Aceeași arhivă, fără autor, ultimul modificator, titlu, companie etc. Restul intrărilor se copiază neatinse."""
    src = _open(data)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for info in src.infolist():
            raw = _read(src, info.filename)
            if info.filename == "docProps/core.xml":
                raw = _clear_children(raw, _CORE_CLEAR)
            elif info.filename == "docProps/app.xml":
                raw = _clear_children(raw, _APP_CLEAR)
            dst.writestr(info, raw, compress_type=info.compress_type)
    return out.getvalue()
