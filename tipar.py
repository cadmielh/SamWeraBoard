"""„Pregătește pentru tipar”: pozele și PDF-urile unui client așezate pe pagini A4, într-un singur PDF.

- `ci`: buletinul (față și, la cartea electronică, verso) pe o pagină, la mărimea reală a cardului (85,6 × 54 mm), cu un
  contur fin pentru decupare — copia cerută de ONRC, bănci, notari;
- `pagina`: fiecare poză pe pagina ei, cât mai mare (cu margini), iar paginile PDF-urilor alăturate, în ordinea aleasă.

Conținutul vine deja verificat la încărcare (fisiere.detecteaza_tip); din PDF-uri se copiază doar desenul paginilor,
fără adnotări, formulare sau scripturi."""
from __future__ import annotations

import io

import fitz  # PyMuPDF
from PIL import Image

MM = 72 / 25.4
A4 = (210 * MM, 297 * MM)
CARD = (85.6 * MM, 53.98 * MM)
MARGINE = 10 * MM
SUS_CI = 25 * MM
INTRE_CI = 15 * MM
ASPECTE = ("ci", "pagina")
MAX_PAGINI = 60


class TiparRefuzat(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _marime_poza(data: bytes) -> tuple[int, int]:
    try:
        with Image.open(io.BytesIO(data)) as im:
            return im.size
    except Exception:  # noqa: BLE001
        raise TiparRefuzat("imagine_invalida")


def _incadreaza(cutie: fitz.Rect, w: float, h: float) -> fitz.Rect:
    """Cel mai mare dreptunghi cu proporțiile w:h, centrat în cutie."""
    k = min(cutie.width / w, cutie.height / h)
    cw, ch = w * k, h * k
    x, y = cutie.x0 + (cutie.width - cw) / 2, cutie.y0 + (cutie.height - ch) / 2
    return fitz.Rect(x, y, x + cw, y + ch)


def _pagina(doc: fitz.Document, culcata: bool) -> fitz.Page:
    w, h = A4
    return doc.new_page(width=h, height=w) if culcata else doc.new_page(width=w, height=h)


def pdf_tipar(continut: list[tuple[bytes, str]], aspect: str) -> bytes:
    """`continut`: (date, mime) în ordinea dorită. Întoarce PDF-ul gata de tipărit."""
    if aspect not in ASPECTE or not continut:
        raise TiparRefuzat("tipar_invalid")
    doc = fitz.open()
    if aspect == "ci":
        if len(continut) > 2 or any(not m.startswith("image/") for _, m in continut):
            raise TiparRefuzat("tipar_invalid")
        pag = _pagina(doc, culcata=False)
        y = SUS_CI
        for data, _ in continut:
            w, h = _marime_poza(data)
            cw, ch = CARD if w >= h else (CARD[1], CARD[0])
            x = (pag.rect.width - cw) / 2
            cutie = fitz.Rect(x, y, x + cw, y + ch)
            pag.insert_image(cutie, stream=data, keep_proportion=True)
            pag.draw_rect(cutie, color=(0.75, 0.75, 0.75), width=0.4, dashes="[3 2] 0")
            y += ch + INTRE_CI
    else:
        for data, mime in continut:
            if mime == "application/pdf":
                try:
                    src = fitz.open(stream=data, filetype="pdf")
                except Exception:  # noqa: BLE001
                    raise TiparRefuzat("pdf_invalid")
                if src.needs_pass:
                    raise TiparRefuzat("pdf_parola")
                for i, sp in enumerate(src):
                    pag = _pagina(doc, culcata=sp.rect.width > sp.rect.height)
                    pag.show_pdf_page(_incadreaza(pag.rect, sp.rect.width, sp.rect.height), src, i)
                    if doc.page_count > MAX_PAGINI:
                        raise TiparRefuzat("prea_multe_pagini")
            else:
                w, h = _marime_poza(data)
                pag = _pagina(doc, culcata=w > h)
                cutie = fitz.Rect(MARGINE, MARGINE, pag.rect.width - MARGINE, pag.rect.height - MARGINE)
                pag.insert_image(_incadreaza(cutie, w, h), stream=data, keep_proportion=True)
            if doc.page_count > MAX_PAGINI:
                raise TiparRefuzat("prea_multe_pagini")
    return doc.tobytes(garbage=3, deflate=True)


def nume_tipar(primul: str, aspect: str) -> str:
    """„CI Ion (față).jpg” → „CI Ion – față-verso.pdf”; „Contract p1.jpg” → „Contract p1 – pentru tipar.pdf”."""
    baza = primul.rsplit(".", 1)[0] if "." in primul[-6:] else primul
    for sufix in (" (față)", " (fata)", " (verso)", " (editat)"):
        if baza.lower().endswith(sufix):
            baza = baza[: -len(sufix)]
    baza = baza.strip() or "Document"
    return f"{baza} – {'față-verso' if aspect == 'ci' else 'pentru tipar'}.pdf"
