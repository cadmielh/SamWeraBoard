"""Variante gramaticale din documente, alese automat la generare.

Șabloanele conțin adesea alternative separate prin „/”: „numit/ă”, „Domnul/Doamna”, „asociat unic/asociați”,
„va/vor”, „social/profesional”, „CNP/NIF”. Motorul de aici alege varianta potrivită, fără ca șablonul să fie modificat
(deci funcționează și pentru șabloanele proprii ale utilizatorilor, dacă folosesc formulările uzuale):

  * după sex      — numit/ă, născut/ă, Domnul/Doamna, Subsemnatul(a), doamnei/domnului, el/ea …
  * după număr    — asociat unic/asociați, A.G.A./Asociatului Unic, Administratorul/Administratorii, va/vor,
                    poate/pot, nemulțumit/nemulțumiți, beneficiarul real/beneficiarii reali (și fără „/” alături) …
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
    # „administrator” nu urmează sufixul regulat de mai jos (născut/născută) — schimbă chiar rădăcina
    # cuvântului (administrator- → administratoar-), deci are nevoie de o pereche explicită, la fel ca asociat.
    "administratorul": "administratoarea", "administratorului": "administratoarei",
}
_HONORIFICS = {"domnul", "doamna", "domnului", "doamnei", "dumnealui", "dumneaei", "subsemnatul", "subsemnata"}

# Substantive de rol (asociat/administrator) scrise O SINGURĂ DATĂ în șablon, la masculin, FĂRĂ alternativa
# „/” alături (spre deosebire de „Domnul/Doamna”, aproape mereu scrisă cu ambele forme) — mai ales în
# paragrafele generate dintr-un bloc repetitiv (vezi blanks.py, _split_group_paragraph: „Asociatului ……
# îi revin ……”, fără nicio variantă scrisă). Când sexul persoanei e CONFIRMAT (fișă sau CNP — același
# mecanism sigur ca la perechile „a/b” de mai jos, nu o ghicire nouă), cuvântul se corectează automat.
# Deliberat un subset ÎNGUST din _SEX_PAIRS — nu „domnul”/„el”/„dansul”: acelea sunt cuvinte foarte comune,
# care ar putea apărea în text fără legătură cu persoana urmărită; „asociatul”/„administratorul” sunt
# substantive de rol fără ambiguitate.
_STANDALONE_ROLE_WORDS = {
    "asociatul": "asociata", "asociatului": "asociatei",
    "administratorul": "administratoarea", "administratorului": "administratoarei",
}
_STANDALONE_ROLE_WORDS_REV = {fem: masc for masc, fem in _STANDALONE_ROLE_WORDS.items()}
_SEX_WORD_RE = re.compile(
    rf"(?<!\w)({'|'.join(sorted({*_STANDALONE_ROLE_WORDS, *_STANDALONE_ROLE_WORDS_REV}, key=len, reverse=True))})(?!\w)",
    re.IGNORECASE,
)

_NUMBER_TOKENS = {  # (singular, plural) → domeniul numărului
    ("va", "vor"): "asociati", ("poate", "pot"): "asociati",
    ("nemultumit", "nemultumiti"): "asociati", ("desemnat", "desemnati"): "asociati",
    ("administratorul", "administratorii"): "administratori", ("administrator", "administratori"): "administratori",
    ("administratorului", "administratorilor"): "administratori",
    ("are", "au"): "asociati", ("este", "sunt"): "asociati", ("acesta", "acestia"): "asociati",
}

# Substantive de rol (asociat/administrator) la singular/plural, scrise O SINGURĂ formă, FĂRĂ „/” alături —
# ajustate după numărul REAL de asociați/administratori ai clientului (același mecanism ca _STANDALONE_ROLE_WORDS
# mai sus, dar pentru număr, nu sex). Deliberat DOAR substantivele, NU verbele din _NUMBER_TOKENS (este/sunt,
# va/vor, poate/pot, are/au…) — acelea sunt cuvinte mult prea generice pentru detectare fără „/”: ar rescrie
# propoziții fără nicio legătură cu asociații („Sediul social ESTE în București”, „Actul ESTE valabil”…).
# Cheile sunt fără diacritice (comparate prin _norm); valorile au diacriticele corecte, ca text de pus în document.
_STANDALONE_ROLE_NUMBER = {
    "asociatul": ("asociații", "asociati"), "asociatului": ("asociaților", "asociati"),
    "administratorul": ("administratorii", "administratori"), "administratorului": ("administratorilor", "administratori"),
}
_STANDALONE_ROLE_NUMBER_REV = {   # plural (fără diacritice) → (formă de singular, domeniu) — `_norm` nu e încă
    # definit la acest punct din fișier, de-asta cheile sunt scrise direct fără diacritice, ca peste tot mai sus.
    "asociatii": ("asociatul", "asociati"), "asociatilor": ("asociatului", "asociati"),
    "administratorii": ("administratorul", "administratori"), "administratorilor": ("administratorului", "administratori"),
}
_NUMBER_WORD_RE = re.compile(rf"(?<!\w)({_WORD})(?!\w)")

# „beneficiarul real (al)”/„beneficiarii reali (ai)” — folosit în declarațiile pe proprie răspundere privind
# beneficiarul real, unde subiectul întreg („beneficiarii reali ai societății ... sunt asociații ……”) trebuie
# să fie la același număr ca asociații înșiși (același domeniu „asociati”). Fraza întreagă (substantiv +
# adjectiv + articolul genitival care urmează adesea, „al/ai societății”), nu doar substantivul — „reali/real”
# și „ai/al” nu au o formă de rol proprie în _STANDALONE_ROLE_NUMBER, iar tratate separat, fără ancora
# „beneficiarul/beneficiarii” alături, ar fi mult prea generice (vezi explicația de la _STANDALONE_ROLE_NUMBER
# despre verbe — „al”/„ai” sunt la fel de comune, apar peste tot în text fără nicio legătură cu asociații).
# Articolul e opțional la potrivire (grupurile 3/6) — unele formulări nu-l au alături („beneficiarul real,
# cetățean...”) — dar, când apare, se schimbă ÎMPREUNĂ cu substantivul+adjectivul, ca o singură unitate.
_BENEFICIAR_REAL_RE = re.compile(
    r"(?<!\w)(beneficiarul)\s+(real)(?:\s+(al))?(?!\w)"
    r"|(?<!\w)(beneficiarii)\s+(reali)(?:\s+(ai))?(?!\w)", re.IGNORECASE)

# „este/sunt” imediat ÎNAINTEA substantivului de rol („sunt asociații ……”, „este asociatul ……”) — spre
# deosebire de un „este/sunt” oarecare (vezi avertismentul de la _STANDALONE_ROLE_NUMBER despre verbe prea
# generice), aici ancora e chiar cuvântul care urmează imediat: „este/sunt” + „asociat.../administrator...”
# nu poate fi despre altceva din document decât despre numărul lor. De-asta e sigur, spre deosebire de un
# „sunt”/„este” izolat oriunde în text (ex. „Sediul social ESTE în București”, neavând „asociat”/„administrator”
# alături). Separat de _STANDALONE_ROLE_NUMBER (acolo cuvântul corectat e substantivul însuși, aici e verbul
# dinaintea lui — pot coexista pe aceeași frază, pe poziții diferite, fără să se blocheze reciproc). Rădăcina
# „asocia” din lookahead acoperă AMBELE forme ale substantivului («asociaT-ul/ului», cu „t”, și «asociaȚ-ii/
# ilor», cu „ț/ţ») — spre deosebire de _ASOCIAT_PHRASE, nu avem nevoie să distingem care anume, numărul vine
# oricum din `ctx`, nu din cuvântul scris.
_VERB_ROLE_RE = re.compile(r"(?<!\w)(este|sunt)(?=\s+(asocia(?:t|[țţ])\w*|administrator\w*)(?!\w))", re.IGNORECASE)

# „asociat unic/asociați”, „asociatului unic/ asociaților”, „asociatul/ asociații”, „ASOCIAT UNIC/ASOCIAȚI”
_ASOCIAT_PHRASE = re.compile(
    rf"(?<!\w)(asociat(?:ul|ului)?(?:\s+unic)?)\s*/\s*(asocia[țţ](?:i|ii|ilor))(?!\w)", re.IGNORECASE)

# „Hotărârea/Hotărârii A.G.A./Asociatului Unic nr. …” — actul care a stat la baza modificării, din declarații
# sau referiri încrucișate la hotărârea asociaților. Nu încape în _ASOCIAT_PHRASE (acolo ambele forme sunt un
# singur cuvânt din aceeași rădăcină „asociat”) și nici în _PAIR de mai jos (_WORD = un singur cuvânt, fără
# puncte sau spații — „A.G.A.” are puncte, „Asociatului Unic” are un spațiu) — de-aceea o frază dedicată, ca
# _ASOCIAT_PHRASE. Grupul 1 e mereu forma de PLURAL (A.G.A. — Adunarea Generală a Asociaților), grupul 2 mereu
# forma de SINGULAR (Asociatului Unic), indiferent de ordinea scrisă în șablon.
_AGA_PHRASE = re.compile(
    r"(?<!\w)(A\.?G\.?A\.?)\s*/\s*(Asociatului\s+Unic)(?!\w)"
    r"|(?<!\w)(Asociatului\s+Unic)\s*/\s*(A\.?G\.?A\.?)(?!\w)",
    re.IGNORECASE)
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

    # 1b) „Hotărârea/Hotărârii A.G.A./Asociatului Unic nr. …” — actul invocat într-o declarație sau altă
    # referire încrucișată. Grupurile 1/3 = forma de plural (A.G.A.), 2/4 = forma de singular (Asociatului
    # Unic), indiferent de ordinea scrisă (vezi _AGA_PHRASE).
    for m in _AGA_PHRASE.finditer(text):
        if not free(m.start(), m.end()):
            continue
        i = by_count(ctx.get("asociati"))
        if i is None:
            add(Choice(m.start(), m.end(), None, "number"))
            continue
        plural, singular = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
        chosen = _match_case(m.group(0), singular if i == 0 else plural)
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

    # 4) substantive de rol la singular/plural, fără „/” alături (vezi _STANDALONE_ROLE_NUMBER) — ajustate după
    # numărul REAL de asociați/administratori ai clientului. DOAR în afara unui bloc {{#ROL}} (`fixed is None`)
    # — o clauză dintr-un bloc repetitiv (vezi doc_filler._expand_repeat_blocks) e mereu despre O SINGURĂ
    # persoană, chiar dacă firma are mai mulți asociați în total: „Asociatului {{NUME}}” nu devine niciodată
    # „Asociaților {{NUME}}” doar fiindcă mai există și alți asociați în alte clauze ale aceluiași bloc.
    # ÎNAINTEA pasului de sex de mai jos, dinadins: un cuvânt cu NUMĂRUL cunoscut (dar sexul necunoscut) tot
    # trebuie corectat — dacă sexul ar „ocupa” poziția primul (chiar nerezolvat, ca avertisment), numărul n-ar
    # mai apuca să încerce deloc aceeași poziție (vezi `free`/`taken` mai jos).
    if fixed is None:
        for m in _NUMBER_WORD_RE.finditer(text):
            if not free(m.start(), m.end()):
                continue
            word = m.group(1)
            nw = _norm(word)
            if nw in _STANDALONE_ROLE_NUMBER:
                other, domain = _STANDALONE_ROLE_NUMBER[nw]
                is_singular_written = True
            elif nw in _STANDALONE_ROLE_NUMBER_REV:
                other, domain = _STANDALONE_ROLE_NUMBER_REV[nw]
                is_singular_written = False
            else:
                continue
            i = by_count(ctx.get(domain))
            if i is None or (i == 0) == is_singular_written:
                continue      # număr necunoscut, sau deja forma corectă — nimic de schimbat/semnalat
            add(Choice(m.start(), m.end(), _match_case(word, other), "number"))

    # 4b) „beneficiarul real (al)/beneficiarii reali (ai)”, fără „/” alături — aceeași idee ca pasul 4, dar
    # pentru fraza (+ articol opțional) din declarațiile privind beneficiarul real (vezi _BENEFICIAR_REAL_RE).
    if fixed is None:
        for m in _BENEFICIAR_REAL_RE.finditer(text):
            if not free(m.start(), m.end()):
                continue
            is_singular_written = m.group(1) is not None
            has_article = (m.group(3) if is_singular_written else m.group(6)) is not None
            i = by_count(ctx.get("asociati"))
            if i is None or (i == 0) == is_singular_written:
                continue      # număr necunoscut, sau deja forma corectă — nimic de schimbat
            if i == 0:
                chosen = "beneficiarul real" + (" al" if has_article else "")
            else:
                chosen = "beneficiarii reali" + (" ai" if has_article else "")
            add(Choice(m.start(), m.end(), _match_case(m.group(0), chosen), "number"))

    # 4c) „este/sunt” înaintea substantivului de rol (vezi _VERB_ROLE_RE) — domeniul e dat de rolul care
    # urmează imediat, nu de numărul scris efectiv în șablon (acela se corectează separat, la pasul 4/4b).
    if fixed is None:
        for m in _VERB_ROLE_RE.finditer(text):
            if not free(m.start(), m.end()):
                continue
            domain = "asociati" if _norm(m.group(2)).startswith("asocia") else "administratori"
            i = by_count(ctx.get(domain))
            if i is None:
                continue
            chosen = "este" if i == 0 else "sunt"
            if _norm(m.group(1)) == chosen:
                continue      # deja forma corectă — nimic de schimbat
            add(Choice(m.start(), m.end(), _match_case(m.group(1), chosen), "number"))

    # 5) substantive de rol scrise O SINGURĂ dată, fără „/” alături (vezi _STANDALONE_ROLE_WORDS) — corectate
    # după sexul CONFIRMAT al persoanei, chiar dacă șablonul nu a scris explicit ambele forme. Poziția deja
    # „ocupată” de pasul 4 de mai sus (ex. cuvântul a devenit plural) e sărită automat, via `free`.
    for m in _SEX_WORD_RE.finditer(text):
        if not free(m.start(), m.end()):
            continue
        word = m.group(1)
        nw = _norm(word)
        masc = _STANDALONE_ROLE_WORDS_REV.get(nw, nw)
        fem = _STANDALONE_ROLE_WORDS.get(nw, nw)
        sx, person = _decide_sex(m.start(), word, tags, sex_map, fixed)
        if sx in ("M", "F"):
            chosen = masc if sx == "M" else fem
            if chosen != nw:      # deja forma corectă — nimic de schimbat
                add(Choice(m.start(), m.end(), _match_case(word, chosen), "sex", person))
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
    # „/” și „(” acoperă pașii 1-3 (perechi, paranteze) — pașii 4-5 (substantiv de rol singur, fără alternativă
    # scrisă) n-au niciunul din cele două, de-asta verificarea de mai jos le caută separat. `_norm`, nu doar
    # `.lower()`: „Asociații”/„Asociaților” (plural, cu ț) nu conțin literal substring-ul „asociat” (cu t simplu)
    # — fără normalizare, poarta bloca exact cazul „e deja plural, trebuie adus la singular”. „beneficiar” —
    # pentru _BENEFICIAR_REAL_RE (4b): „beneficiarul real”/„beneficiarii reali” poate apărea FĂRĂ „asociat”/
    # „administr” alăturat în același paragraf (ex. „beneficiarul real, cetățean...”), deci poarta trebuie să-l
    # recunoască separat, altfel scapă neschimbat.
    normalized = _norm(text)
    if ("/" not in text and "(" not in text and "asociat" not in normalized
            and "administr" not in normalized and "beneficiar" not in normalized):
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
