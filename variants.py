"""Variante gramaticale din documente, alese automat la generare.

Șabloanele conțin adesea alternative separate prin „/”: „numit/ă”, „Domnul/Doamna”, „asociat unic/asociați”,
„va/vor”, „social/profesional”, „CNP/NIF”. Motorul de aici alege varianta potrivită, fără ca șablonul să fie modificat
(deci funcționează și pentru șabloanele proprii ale utilizatorilor, dacă folosesc formulările uzuale):

  * după sex      — numit/ă, născut/ă, Domnul/Doamna, Subsemnatul(a), doamnei/domnului, el/ea …
  * după număr    — asociat unic/asociați, Administratorul/Administratorii, va/vor, poate/pot, nemulțumit/nemulțumiți …
  * după categorie — social/profesional (PJ / PFA, II, IF), județ/sector (București), CNP/NIF

Reguli de siguranță (documente juridice): nu se ghicește niciodată. Dacă sexul persoanei sau numărul nu se cunosc,
alternativa rămâne neschimbată în document, iar persoana apare în lista de avertismente.

Contextul (`ctx`) vine de la aplicație:
    {"sex": {"ASOCIAT_1": "F", "DECLARANT": None, ...},   # prefixul etichetelor persoanei → "M" | "F" | None (necunoscut)
     "asociati": 1, "administratori": 2, "tip": "PJ" | "PF"}
"""
from __future__ import annotations

import re
import unicodedata

from docx.text.paragraph import Paragraph

_LETTER = r"[^\W\d_]"
_WORD = rf"{_LETTER}+"
_TAG_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")

# Câmpurile persoanei singulare (fără prefix), ca în lib/placeholders.ts (ID_FIELD_MAP)
SINGULAR_PERSON_TAGS = {
    "CNP", "NUME", "PRENUME", "SERIE_NUMAR", "DATA_NASTERII", "LOCUL_NASTERII", "CETATENIA", "ADRESA", "JUDET",
    "EMISA_DE", "VALABILA_DE_LA", "VALABILA_PANA_LA",
}

# Participii/adjective care descriu DOCUMENTUL, nu persoana („emis(ă) de”): nu se acordă după sexul persoanei.
_NOT_ABOUT_PERSON = {"emis", "eliberat", "valabil", "expirat", "intocmit", "redactat", "autentificat", "semnat"}

_SEX_PAIRS = {  # formă masculină → formă feminină (comparație fără diacritice, minuscule)
    "domnul": "doamna", "domnului": "doamnei", "dumnealui": "dumneaei", "el": "ea", "dansul": "dansa",
    "asociatului": "asociatei", "asociatul": "asociata",
}
_HONORIFICS = {"domnul", "doamna", "domnului", "doamnei", "dumnealui", "dumneaei", "subsemnatul", "subsemnata"}

_NUMBER_TOKENS = {  # (singular, plural) → domeniul numărului
    ("va", "vor"): "asociati", ("poate", "pot"): "asociati",
    ("nemultumit", "nemultumiti"): "asociati", ("desemnat", "desemnati"): "asociati",
    ("administratorul", "administratorii"): "administratori", ("administrator", "administratori"): "administratori",
    ("administratorului", "administratorilor"): "administratori",
    ("are", "au"): "asociati", ("este", "sunt"): "asociati", ("acesta", "acestia"): "asociati",
}

# „asociat unic/asociați”, „asociatului unic/ asociaților”, „asociatul/ asociații”, „ASOCIAT UNIC/ASOCIAȚI”
_ASOCIAT_PHRASE = re.compile(
    rf"(?<!\w)(asociat(?:ul|ului)?(?:\s+unic)?)\s*/\s*(asocia[țţ](?:i|ii|ilor))(?!\w)", re.IGNORECASE)
_PAIR = re.compile(rf"(?<![\w/])({_WORD})\s*/\s*({_WORD})(?![\w]|\s*/)")
_PAREN = re.compile(rf"(?<!\w)({_WORD})\((ă|a)\)")


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.casefold())
    return "".join(c for c in s if not unicodedata.combining(c))


def _match_case(original: str, chosen: str) -> str:
    """Alegerea preia majusculele locului: început de propoziție → prima literă mare; text integral cu majuscule → majuscule."""
    letters = [c for c in original if c.isalpha()]
    if len(letters) > 1 and all(c.isupper() for c in letters):
        return chosen.upper()
    if letters and letters[0].isupper() and chosen[:1].islower():
        return chosen[:1].upper() + chosen[1:]
    return chosen


class Choice:
    """Un loc din paragraf cu alternative: [start, end) în text și ce se pune acolo (None = rămâne neschimbat)."""
    __slots__ = ("start", "end", "text", "kind", "person")

    def __init__(self, start: int, end: int, text: str | None, kind: str, person: str | None = None):
        self.start, self.end, self.text, self.kind, self.person = start, end, text, kind, person


def _person_tags(text: str, sex_map: dict) -> list[tuple[int, str]]:
    """(poziție, prefix persoană) pentru etichetele care aparțin unei persoane cunoscute din context."""
    keys = sorted(sex_map, key=len, reverse=True)
    out: list[tuple[int, str]] = []
    for m in _TAG_RE.finditer(text):
        name = m.group(1)
        for k in keys:
            if (k and (name == k or name.startswith(k + "_"))) or (k == "" and name in SINGULAR_PERSON_TAGS):
                out.append((m.start(), k))
                break
    return out


def _sex_form(a: str, b: str) -> tuple[str, str] | None:
    """Pentru „a/b”: (formă masculină, formă feminină) dacă e o pereche după sex cunoscută; altfel None."""
    na, nb = _norm(a), _norm(b)
    if _SEX_PAIRS.get(na) == nb:
        return a, b
    if _SEX_PAIRS.get(nb) == na:
        return b, a
    if nb == "ul" and na.endswith("a"):          # Subsemnata/ul
        return a[:-1] + b, a
    if nb == "a" and na.endswith("ul"):          # Subsemnatul/a
        return a, a[:-2] + b
    if b.casefold() == "ă" and na not in _NOT_ABOUT_PERSON:  # numit/ă (atenție: _norm scoate diacriticele)
        return a, a + b
    # două cuvinte întregi: născut/născută, domiciliat/domiciliată, Subsemnatul/Subsemnata (în oricare ordine)
    for masc, fem, nmasc, nfem in ((a, b, na, nb), (b, a, nb, na)):
        if nmasc in _NOT_ABOUT_PERSON or len(nmasc) < 3:
            continue
        if nfem == nmasc + "a" or (nmasc.endswith("tul") and nfem == nmasc[:-2] + "a"):   # doar participii: Subsemnatul/Subsemnata, nu unul/una
            return masc, fem
    return None


def _decide_sex(pos: int, word: str, tags: list[tuple[int, str]], sex_map: dict,
                fixed: tuple[str | None, str | None] | None) -> tuple[str | None, str | None]:
    """(„M”/„F”/None, persoana) pentru o alternativă după sex."""
    if fixed is not None:
        return fixed[0], fixed[1]
    if not tags:                                  # fără persoană numită în paragraf: nu se ghicește
        return None, None
    after = next((t for t in tags if t[0] >= pos), None)
    before = next((t for t in reversed(tags) if t[0] < pos), None)
    honorific = _norm(word) in _HONORIFICS
    pick = (after or before) if honorific else (before or after)
    return sex_map.get(pick[1]), pick[1]


def _next_tag(text: str, pos: int, suffix: str) -> str | None:
    for m in _TAG_RE.finditer(text, pos):
        n = m.group(1)
        if n == suffix or n.endswith("_" + suffix):
            return n
    return None


def find_choices(text: str, ctx: dict, replacements: dict[str, str],
                 fixed: tuple[str | None, str | None] | None = None) -> list[Choice]:
    sex_map: dict = ctx.get("sex") or {}
    tags = _person_tags(text, sex_map)
    taken: list[tuple[int, int]] = []
    out: list[Choice] = []

    def free(s: int, e: int) -> bool:
        return all(e <= a or s >= b for a, b in taken)

    def add(c: Choice) -> None:
        taken.append((c.start, c.end))
        out.append(c)

    def by_count(n) -> int | None:
        if not isinstance(n, int) or n < 1:
            return None
        return 0 if n == 1 else 1

    # 1) fraze despre asociați (singular/plural)
    for m in _ASOCIAT_PHRASE.finditer(text):
        if not free(m.start(), m.end()):
            continue
        i = by_count(ctx.get("asociati"))
        chosen = None if i is None else _match_case(m.group(0), m.group(1 + i))
        add(Choice(m.start(), m.end(), chosen, "number"))

    # 2) perechi „a/b”
    for m in _PAIR.finditer(text):
        if not free(m.start(), m.end()):
            continue
        a, b = m.group(1), m.group(2)
        na, nb = _norm(a), _norm(b)
        whole = m.group(0)
        if (na, nb) in _NUMBER_TOKENS or (nb, na) in _NUMBER_TOKENS:
            reversed_order = (na, nb) not in _NUMBER_TOKENS           # „au/are”: pluralul apare primul
            domain = _NUMBER_TOKENS[(nb, na) if reversed_order else (na, nb)]
            i = by_count(ctx.get(domain))
            if i is not None and reversed_order:
                i = 1 - i
            add(Choice(m.start(), m.end(), None if i is None else _match_case(whole, (a, b)[i]), "number"))
            continue
        if {na, nb} == {"social", "profesional"}:
            tip = ctx.get("tip")
            want = "social" if tip == "PJ" else "profesional" if tip == "PF" else None
            chosen = None if want is None else _match_case(whole, a if na == want else b)
            add(Choice(m.start(), m.end(), chosen, "category"))
            continue
        if {na, nb} == {"judet", "sector"}:
            nxt = _next_tag(text, m.end(), "JUDET")
            val = _norm(replacements.get("{{" + nxt + "}}", "")).strip() if nxt else ""
            want = None if val in ("", "-") else ("sector" if "bucuresti" in val else "judet")
            chosen = None if want is None else _match_case(whole, a if na == want else b)
            add(Choice(m.start(), m.end(), chosen, "category"))
            continue
        if {na, nb} == {"cnp", "nif"}:
            nxt = _next_tag(text, m.end(), "CNP")
            val = (replacements.get("{{" + nxt + "}}", "") if nxt else "").strip()
            want = None if not val else ("nif" if val[0] == "9" else "cnp" if val[0] in "12345678" else None)
            chosen = None if want is None else _match_case(whole, a if na == want else b)
            add(Choice(m.start(), m.end(), chosen, "category"))
            continue
        forms = _sex_form(a, b)
        if forms:
            sx, person = _decide_sex(m.start(), a, tags, sex_map, fixed)
            if sx in ("M", "F"):
                add(Choice(m.start(), m.end(), _match_case(whole, forms[0 if sx == "M" else 1]), "sex", person))
            else:
                add(Choice(m.start(), m.end(), None, "sex", person))

    # 3) forme cu paranteză: Subsemnatul(a), domiciliat(ă)
    for m in _PAREN.finditer(text):
        if not free(m.start(), m.end()):
            continue
        w, p = m.group(1), m.group(2)
        if _norm(w) in _NOT_ABOUT_PERSON:
            continue
        if p == "a" and _norm(w).endswith("ul"):
            masc, fem = w, w[:-2] + "a"
        elif p == "ă":
            masc, fem = w, w + "ă"
        else:
            continue
        sx, person = _decide_sex(m.start(), w, tags, sex_map, fixed)
        if sx in ("M", "F"):
            add(Choice(m.start(), m.end(), _match_case(m.group(0), masc if sx == "M" else fem), "sex", person))
        else:
            add(Choice(m.start(), m.end(), None, "sex", person))
    return out


def _replace_span(paragraph: Paragraph, start: int, end: int, value: str) -> None:
    """Înlocuiește [start, end) din textul paragrafului, păstrând formatarea run-urilor neatinse (ca doc_filler._replace_in_paragraph)."""
    runs = paragraph.runs
    bounds, pos = [], 0
    for r in runs:
        bounds.append((pos, pos + len(r.text)))
        pos += len(r.text)
    idxs = [i for i, (rs, re_) in enumerate(bounds) if rs < end and re_ > start]
    if not idxs:
        return
    first, last = idxs[0], idxs[-1]
    prefix = runs[first].text[:start - bounds[first][0]]
    suffix = runs[last].text[end - bounds[last][0]:]
    runs[first].text = prefix + value + (suffix if first == last else "")
    if first != last:
        runs[last].text = suffix
        for mid in idxs[1:-1]:
            runs[mid].text = ""


def resolve_paragraph(paragraph: Paragraph, ctx: dict, replacements: dict[str, str],
                      fixed: tuple[str | None, str | None] | None = None) -> list[Choice]:
    """Aplică alegerile într-un paragraf; întoarce alegerile (inclusiv cele nerezolvate, cu text None)."""
    if not paragraph.runs:
        return []
    text = "".join(r.text for r in paragraph.runs)
    if "/" not in text and "(" not in text:
        return []
    choices = find_choices(text, ctx, replacements, fixed)
    for c in sorted((c for c in choices if c.text is not None), key=lambda c: c.start, reverse=True):
        _replace_span(paragraph, c.start, c.end, c.text)
    return choices


def unresolved_persons(choices: list[Choice]) -> set[str]:
    """Persoanele (prefixe) pentru care sexul nu s-a putut stabili, deci alternativele au rămas în document."""
    return {c.person for c in choices if c.kind == "sex" and c.text is None and c.person}


def sanitize_ctx(raw) -> dict:
    """Validează contextul primit de la client (nu se are încredere în el): chei și valori simple, dimensiuni mici."""
    if not isinstance(raw, dict):
        return {}
    sex: dict = {}
    src = raw.get("sex")
    if isinstance(src, dict):
        for k, v in list(src.items())[:200]:
            if isinstance(k, str) and re.fullmatch(r"[A-Z0-9_]{0,60}", k):
                sex[k] = v if v in ("M", "F") else None
    def cnt(v):
        return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 1000 else None
    tip = raw.get("tip")
    return {"sex": sex, "asociati": cnt(raw.get("asociati")), "administratori": cnt(raw.get("administratori")),
            "tip": tip if tip in ("PJ", "PF") else None}
