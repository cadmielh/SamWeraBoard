"""Șabloane fără etichete: locurile libere („……”, „.....”, „_____”) se recunosc din context și se leagă de câmpurile aplicației.

Fluxul (vezi rutele /template/blanks și /template/blanks/apply din app.py):
  1. `analyze(docx)` găsește fiecare loc liber, cu textul din jur, și propune câmpul potrivit (ex. „CNP ……” → CNP-ul persoanei,
     „sediul în ……” → sediul societății, „aport de …… lei” → aportul asociatului). Ce nu se recunoaște devine câmp manual.
  2. Utilizatorul confirmă sau corectează propunerile.
  3. `apply(docx, alegeri)` înlocuiește fiecare loc liber cu eticheta aleasă → un șablon obișnuit, pe care motorul existent
     (variante după sex/număr, „-” la câmpuri goale, procent de completare) îl completează.

Regulile sunt pentru formulările uzuale din actele societăților; propunerile sunt doar propuneri: nu se aplică nimic fără confirmare.
"""
from __future__ import annotations

import copy
import io
import re

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

from variants import _norm, _replace_span

BLANK_RE = re.compile(r"…+|\.{4,}|_{3,}")
_ARTIFACT_DOTS_RE = re.compile(r"\.{1,3}")


def _extend_past_artifact_dots(text: str, end: int) -> int:
    """„….,” / „….. jud” — puncte literale rămase lipite de o elipsă („…”): BLANK_RE prinde doar elipsa în
    sine, nu și punctele care mai rămân când autorul a tastat mai multe puncte decât a convertit Word automat
    (de obicei primele trei) în elipsă. Dacă imediat după aceste puncte urmează o literă mică sau o virgulă
    (propoziția chiar continuă), punctele fac parte din locul liber, nu sunt punctuație reală — altfel ar
    rămâne vizibile în documentul completat („cetătean romana., născut”). Dacă urmează literă mare sau
    paragraful se termină acolo, punctele sunt sfârșit de propoziție — rămân neschimbate."""
    m = _ARTIFACT_DOTS_RE.match(text, end)
    if not m:
        return end
    j = m.end()
    while j < len(text) and text[j] == " ":     # un spațiu între puncte și cuvântul următor nu schimbă nimic
        j += 1
    nxt = text[j:j + 1]
    if nxt == "," or (nxt.isalpha() and nxt.islower()):
        return m.end()
    return end

# Câmpuri ale societății (etichetele există deja în aplicație)
COMPANY_FIELDS = {
    "SOCIETATE_DENUMIRE": "Denumirea societății",
    "SOCIETATE_SEDIU": "Sediul societății (adresa completă)",
    "SOCIETATE_SEDIU_FARA_JUDET": "Sediul societății (fără județ — folosit când județul e un loc liber separat)",
    "SOCIETATE_JUDET": "Județul sediului",
    "SOCIETATE_CIF": "CUI / cod fiscal",
    "SOCIETATE_NR_REG": "Nr. de înmatriculare (J…/…/…)",
    "CAPITAL_SOCIAL_TOTAL": "Capitalul social (lei)",
    "PARTI_SOCIALE_TOTALE": "Numărul total de părți sociale",
    "CAEN_1": "Activitatea principală (cod și denumire)",
    "CAEN_DOMENIU": "Domeniul principal de activitate (grupa CAEN, cod și denumire)",
    "CAEN_PRINCIPAL_COD": "Cod CAEN principal",
    "CAEN": "O activitate secundară (cod și denumire)",
    "DATA_AZI": "Data de azi",
    "ASOCIATI_LISTA": "Numele tuturor asociaților, pe o linie („A, B și C”)",
    "ADMINISTRATORI_LISTA": "Numele tuturor administratorilor, pe o linie",
}

# Câmpuri per persoană: eticheta finală = {{ASOCIAT_n_CÂMP}} / {{ADMINISTRATOR_n_CÂMP}}
PERSON_FIELDS = {
    "NUME_COMPLET": "Nume și prenume",
    "NUME": "Nume",
    "PRENUME": "Prenume",
    "CNP": "CNP",
    "ADRESA": "Adresa de domiciliu",
    "JUDET": "Județul",
    "DATA_NASTERII": "Data nașterii",
    "LOCUL_NASTERII": "Locul nașterii",
    "CETATENIA": "Cetățenia",
    "SERIE_ACT": "Seria actului de identitate",
    "NR_ACT": "Numărul actului de identitate",
    "SERIE_NUMAR": "Seria și numărul actului",
    "EMISA_DE": "Actul eliberat de",
    "VALABILA_DE_LA": "Data eliberării actului",
    "VALABILA_PANA_LA": "Valabil până la",
    "COTA_PARTICIPARE": "Cota de participare",
    "CAPITAL_SOCIAL": "Aportul la capital (lei)",
    "PARTI_SOCIALE": "Numărul de părți sociale",
}

_MANUAL_PREFIX = "CAMP_"


def person_tag(role: str, n: int, field: str) -> str:
    """Eticheta finală pentru un câmp de persoană; câmpurile de capital folosesc formele existente (CAPITAL_SOCIAL_ASOCIAT_n)."""
    if field == "NUME_COMPLET":
        return f"{{{{{role}_{n}_NUME}}}} {{{{{role}_{n}_PRENUME}}}}"
    if field == "CAPITAL_SOCIAL":
        return f"{{{{CAPITAL_SOCIAL_ASOCIAT_{n}}}}}"
    if field == "PARTI_SOCIALE":
        return f"{{{{PARTI_SOCIALE_ASOCIAT_{n}}}}}"
    return f"{{{{{role}_{n}_{field}}}}}"


def manual_tag(label: str) -> str:
    words = re.sub(r"[^A-Z0-9]+", "_", _norm(label).upper()).strip("_")
    return "{{" + _MANUAL_PREFIX + (words[:40] or "VALOARE") + "}}"


def _paragraphs(doc):
    """Aceeași ordine la analiză și la aplicare: corp, apoi tabele (inclusiv imbricate)."""
    out = list(doc.paragraphs)
    seen: set = set()
    stack = list(doc.tables)
    while stack:
        t = stack.pop(0)
        for r in t.rows:
            for c in r.cells:
                if id(c._tc) in seen:
                    continue
                seen.add(id(c._tc))
                out.extend(c.paragraphs)
                stack.extend(c.tables)
    return out


class _State:
    """Ce s-a decis mai devreme în același paragraf (persoana curentă și câmpul anterior), pentru legături între locuri libere."""
    def __init__(self):
        self.person = 0          # persoanele „definite” (nume urmat de date de identitate)
        self.mention = 0         # persoanele doar amintite (liste de nume: „asociații X și Y”)
        self.last_field: str | None = None
        self.last_scope: str | None = None


def _role_for(before_text: str) -> str:
    return "ADMINISTRATOR" if "admin" in _norm(before_text) else "ASOCIAT"


def suggest(before: str, after: str, para_before: str, state: _State, pi: int = 99, alone: bool = False) -> dict:
    """Propunerea pentru un loc liber: {scope: company|person|manual, field, role, person, confidence}.

    `pi` = poziția paragrafului în document, `alone` = locul liber e singur în paragraf (ex. denumirea firmei sub titlu)."""
    b = _norm(before)[-90:]
    a = _norm(after)[:50]
    bt = b.rstrip(" :,;-–")

    def company(field, conf="high"):
        state.last_field, state.last_scope = field, "company"
        return {"scope": "company", "field": field, "confidence": conf}

    def person(field, conf="high", new_person=False, mention=False):
        if mention:                                   # persoană doar amintită: se numără separat de cele definite
            state.mention += 1
            n = state.mention
        else:
            if new_person or state.person == 0:
                state.person += 1
            n = state.person
        state.last_field, state.last_scope = field, "person"
        return {"scope": "person", "field": field, "role": _role_for(para_before), "person": n, "confidence": conf}

    if alone and pi <= 4:                              # denumirea firmei, singură pe rând sub titlu
        return company("SOCIETATE_DENUMIRE", "medium")

    # — identitate (câmpuri legate de persoana curentă) —
    if re.search(r"\bcnp\s*:?$", b):
        return person("CNP")
    if re.search(r"\bseria\s*:?$", b):
        return person("SERIE_ACT")
    if re.search(r"\bnr\.?\s*:?$", b) and state.last_field == "SERIE_ACT":
        return person("NR_ACT")
    if re.search(r"eliberat[a]?\s+de\s*$", b):
        return person("EMISA_DE")
    if re.search(r"\bla\s*(?:data\s+de\s*)?$", b) and state.last_field == "EMISA_DE":
        return person("VALABILA_DE_LA")
    if re.search(r"valabil[a]?\s+pana\s+la(?:\s+data\s+de)?\s*$", b):
        return person("VALABILA_PANA_LA")
    if re.search(r"nascut[a]?(?:/a)?\s+la\s+data\s+de\s*$", b) or re.search(r"nascut[a]?(?:/a)?\s+la\s*$", b):
        return person("DATA_NASTERII")
    if re.search(r"\bin\s*$", b) and state.last_field == "DATA_NASTERII":
        return person("LOCUL_NASTERII")
    if re.search(r"domiciliat[a]?(?:/a)?\s+in\s*$", b) or re.search(r"domiciliul\s*(?:in)?\s*$", b):
        return person("ADRESA")
    if re.search(r"\bjud\.?\s*$", b) and state.last_scope == "person":
        return person("JUDET", "medium")
    if re.search(r"cetatenia\s*$", b) or re.search(r"cetatean\s*$", b):
        return person("CETATENIA", "medium")

    # — societate —
    # „Domeniul principal de activitate” = grupa CAEN (3 cifre, cu denumirea ei — derivată în aplicație din
    # codul principal), distinctă de „Activitatea principală” (clasa CAEN, 4 cifre — CAEN_1); unele acte cer
    # amândouă, una după alta.
    if re.search(r"domeniul principal de activitate este:?\s*$", b):
        return company("CAEN_DOMENIU")
    if re.search(r"activitatea principala este:?\s*$", b):
        return company("CAEN_1")
    if re.search(r"c\.?\s?u\.?\s?i\.?\s*:?$", b) or re.search(r"cod\s+fiscal\s*:?$", b):
        return company("SOCIETATE_CIF")
    if re.search(r"\bsediul(?:\s+social)?(?:\s+in)?\s*$", b) or re.search(r"\bsediu\s+social\s*(?:in)?\s*$", b):
        # dacă imediat după urmează un „jud. ……” separat, sediul nu mai include județul — altfel ar apărea de două ori
        if re.match(r"^[\s,]{0,6}jud\.?\b", a):
            return company("SOCIETATE_SEDIU_FARA_JUDET")
        return company("SOCIETATE_SEDIU")
    if re.search(r"\bjud\.?\s*$", b) and (state.last_field in ("SOCIETATE_SEDIU", "SOCIETATE_SEDIU_FARA_JUDET", "SOCIETATE_JUDET")
                                          or re.search(r"teritoriul\s+jud\.?\s*$", b)):
        return company("SOCIETATE_JUDET", "medium")
    if state.last_scope == "company" and state.last_field in ("SOCIETATE_SEDIU", "SOCIETATE_JUDET") and re.match(r"^,?\s*c\.?\s?u\.?\s?i", a):
        return company("SOCIETATE_NR_REG", "medium")
    if re.search(r"denumirea\s*$", b) or re.search(r"societatii\s*$", b) or re.match(r"^\s*(?:s\.?r\.?l\.?)?\s*(?:cu\s+sediul|,\s*cu\s+sediul)", a) \
            or re.search(r"(?:beneficiarii? reali? ai )?societatii$", bt):
        return company("SOCIETATE_DENUMIRE")

    # — capital și părți sociale —
    if re.match(r"^\s*lei\b", a) and re.search(r"(?:capital\w*\s+social.*valoare\s+de|valoare\s+de)\s*$", b) and not re.search(r"\baport", b):
        return company("CAPITAL_SOCIAL_TOTAL")
    if re.match(r"^\s*lei\b", a) and re.search(r"\baport\w*", b):
        return person("CAPITAL_SOCIAL")
    if re.match(r"^\s*part", a) and re.search(r"\bin\s*$", b):
        return company("PARTI_SOCIALE_TOTALE", "medium")
    if re.match(r"^\s*part", a) and re.search(r"revin\s*$", b):
        return person("PARTI_SOCIALE")

    # — persoane: nume —
    identity_follows = bool(re.match(r"^\s*,\s*(?:cetatean|cetatenia|domiciliat|nascut|identificat)", a))
    if identity_follows:                               # nume urmat de date de identitate = persoană definită aici
        return person("NUME_COMPLET", "high", new_person=True)
    if re.search(r"\b(?:asociat\w*|administrator\w*|subsemnat\w*|domnul|doamna|dl\.|comodant\w*|comodatar\w*)\s*,?\s*$", b):
        return person("NUME_COMPLET", "medium", mention=True)      # „asociatul ……”, „administratorul ……”: doar o mențiune
    if re.search(r"(?:\bsi\s*|,\s*)$", b) and state.last_field == "NUME_COMPLET":
        return person("NUME_COMPLET", "medium", mention=True)      # continuarea unei liste: „X, Y si Z”
    if re.match(r"^\s*_{5,}", after) and not before.strip():   # nume înaintea liniei de semnătură
        return person("NUME_COMPLET", "medium", mention=True)

    # — date —
    if re.search(r"\b(?:semnat\s+azi|incheiat\s+astazi|astazi|azi)\s*$", b) or re.search(r"\bnr\.?\s*\S*\s*din\s*$", b):
        return {"scope": "company", "field": "DATA_AZI", "confidence": "medium"}

    # — câmpuri manuale, dar cu etichetă curată (nu ghicită din ultimele cuvinte) —
    # „a câte …. pagini”: numărul de pagini al documentului nu se poate calcula automat (paginarea reală ține
    # de motorul de randare — Word, LibreOffice —, nu de conținutul .docx), deci rămâne completat manual.
    if re.search(r"\bcate\s*$", b) and re.match(r"^\s*\.?\s*pagini\b", a):
        return {"scope": "manual", "field": None, "confidence": "high", "label": "Număr de pagini"}
    # „redactat în …… exemplare” — numărul de exemplare originale, tipic scris literal (ex. „2 exemplare”) în
    # șablonul lawyer-ului, nu ca loc liber; dacă a fost înlocuit cu „……”, rămâne tot manual, dar etichetat clar.
    if re.match(r"^\s*exemplare\b", a):
        return {"scope": "manual", "field": None, "confidence": "high", "label": "Număr de exemplare"}
    return {"scope": "manual", "field": None, "confidence": "low"}


def _label_before(before: str) -> str:
    words = re.sub(r"[^\w\s]", " ", before).split()
    return " ".join(words[-4:]) if words else "valoare"


_LIST_FIELD = {"ASOCIAT": "ASOCIATI_LISTA", "ADMINISTRATOR": "ADMINISTRATORI_LISTA"}
_CONNECTOR_RE = re.compile(r"^[\s,]*(?:si|și)?[\s,]*$", re.IGNORECASE)


# ── Obiectul de activitate (CAEN): uneori rămâne needitat la pregătirea documentului — nu are „……”, ci
# codurile și denumirile activităților firmei-exemplu din care a pornit șablonul („Domeniul principal de
# activitate este: 953 Repararea ...”, „Activitatea principală este: 9531 Repararea ...”, urmate de o listă de
# activități secundare, câte una pe rând, fără nicio frază introductivă proprie: „4672 Comerț cu ridicata
# ...”). Fără loc liber de găsit, secțiunea asta se recunoaște din formulare + cod CAEN (4 cifre), nu din BLANK_RE.
_CAEN_DIACRITICS = str.maketrans("ăâîșşțţĂÂÎȘŞȚŢ", "aaissttAAISSTT")


def _ascii(s: str) -> str:
    """Variantă fără diacritice, cu aceeași lungime ca originalul — spre deosebire de normalizarea Unicode NFD
    din variants._norm (schimbă lungimea), pozițiile găsite prin regex pe ea rămân valide pe textul original."""
    return s.translate(_CAEN_DIACRITICS).lower()


def _par_text(par) -> str:
    return "".join(r.text for r in par.runs)


_CAEN_DOMENIU_RE = re.compile(r"domeniul principal de activitate este:?\s*(\d{3,4})\s+(.+?)\s*(?:;|-{2,}|$)")
_CAEN_PRINCIPAL_RE = re.compile(r"activitatea principala este:?\s*(\d{4})\s+(.+?)\s*(?:;|-{2,}|$)")
_CAEN_LIST_TRIGGER_RE = re.compile(r"urmatoarele activitat")
_CAEN_LINE_RE = re.compile(r"^\s*(\d{4})\s+(.+?)\s*-{0,}\s*$")


def _find_caen_singles(text: str) -> list[dict]:
    """„Domeniul principal de activitate este: 953 ...” / „Activitatea principală este: 9531 ...” — codul și
    denumirea (nu fraza dinainte) devin locul liber: domeniul (grupa CAEN, 3 cifre) → {{CAEN_DOMENIU}},
    activitatea principală (clasa CAEN, 4 cifre) → {{CAEN_1}} — aplicația derivă automat grupa din clasă
    (vezi frontend/src/data/caenGrupe.ts), deci cele două rămân consistente fără completare separată."""
    norm = _ascii(text)
    out = []
    for rx, field in ((_CAEN_DOMENIU_RE, "CAEN_DOMENIU"), (_CAEN_PRINCIPAL_RE, "CAEN_1")):
        for m in rx.finditer(norm):
            out.append({"scope": "company", "field": field, "confidence": "high", "start": m.start(1), "end": m.end(2)})
    return out


def _find_caen_secondary_cluster(paragraphs: list, pi: int) -> list[int]:
    """Dacă paragraful `pi` e declanșatorul listei de activități secundare („...următoarele activități:”),
    întoarce indicii paragrafelor consecutive de după el care sunt doar „<cod CAEN> <denumire>”, fără nimic
    altceva (o listă de-a lungul mai multor paragrafe, nu în aceeași frază) — sau listă goală, altfel."""
    if not _CAEN_LIST_TRIGGER_RE.search(_ascii(_par_text(paragraphs[pi]))):
        return []
    lines, j = [], pi + 1
    while j < len(paragraphs) and _CAEN_LINE_RE.match(_par_text(paragraphs[j])):
        lines.append(j)
        j += 1
    return lines


# ── Indiciu explicit din paranteze: „…(CAEN PRINCIPAL)……” — utilizatorul scrie chiar el, lipit de locul
# liber, ce reprezintă acesta, când nu are încredere că formularea din jur e destul de clară pentru
# recunoașterea automată. Are prioritate maximă, înaintea oricărei ghiciri din context (vezi suggest()).
_HINT_RE = re.compile(r"\s*\(([^()]{1,80})\)")
_HINT_ALIASES = {
    "caen principal": ("company", "CAEN_1"),
    "caen secundar": ("company", "CAEN"),
    "caen secundara": ("company", "CAEN"),
    "caen secundare": ("company", "CAEN"),
    "caen secundari": ("company", "CAEN"),
    "caen domeniu": ("company", "CAEN_DOMENIU"),
    "domeniu caen": ("company", "CAEN_DOMENIU"),
    "domeniul caen": ("company", "CAEN_DOMENIU"),
    "domeniu principal": ("company", "CAEN_DOMENIU"),
    "domeniul principal": ("company", "CAEN_DOMENIU"),
}


def _resolve_hint(hint: str) -> tuple[str, str] | None:
    """(scope, field) pentru un indiciu din paranteze, sau None dacă nu se recunoaște — caz în care indiciul
    devine el însuși eticheta unui câmp manual (vezi analyze()), nu se ghicește nimic. Acceptă fie un alias
    cunoscut (tabelul de mai sus), fie chiar numele câmpului intern, scris direct (ex. „(SOCIETATE_SEDIU)”)."""
    norm = re.sub(r"[^a-z0-9]+", " ", _ascii(hint)).strip()
    if not norm:
        return None
    if norm in _HINT_ALIASES:
        return _HINT_ALIASES[norm]
    key = norm.upper().replace(" ", "_")
    if key in COMPANY_FIELDS:
        return ("company", key)
    if key in PERSON_FIELDS:
        return ("person", key)
    return None


def analyze(docx_bytes: bytes) -> list[dict]:
    """Lista locurilor libere, în ordinea documentului, cu context și propunere."""
    doc = Document(io.BytesIO(docx_bytes))
    pars = _paragraphs(doc)
    out: list[dict] = []
    sig_idx = 0
    for pi, par in enumerate(pars):
        text = _par_text(par)

        # obiectul de activitate (CAEN), needitat de la firma-exemplu — nu are „……”, se recunoaște din formulare,
        # nu din BLANK_RE (vezi _find_caen_singles/_find_caen_secondary_cluster mai sus)
        for cs in _find_caen_singles(text):
            cs.update({"id": len(out), "paragraph": pi, "before": text[max(0, cs["start"] - 70):cs["start"]],
                       "after": text[cs["end"]:cs["end"] + 40], "label": COMPANY_FIELDS[cs["field"]], "tag": "{{" + cs["field"] + "}}"})
            out.append(cs)
        for lj in _find_caen_secondary_cluster(pars, pi):
            line_text = _par_text(pars[lj])
            lm = _CAEN_LINE_RE.match(line_text)
            out.append({
                "id": len(out), "paragraph": lj, "scope": "company", "field": "CAEN", "role": "CAEN", "confidence": "high",
                "start": lm.start(1), "end": lm.end(2), "before": "", "after": line_text[lm.end(2):lm.end(2) + 40],
                "label": COMPANY_FIELDS["CAEN"], "tag": "{{CAEN}}",
            })

        # liniile lungi de „_____” sunt spații de semnătură, nu locuri de completat
        matches = [m for m in BLANK_RE.finditer(text) if not (set(m.group()) == {"_"} and len(m.group()) >= 10)]
        if not matches:
            continue
        state = _State()
        list_entry: dict | None = None     # entry-ul „ASOCIATI_LISTA”/„ADMINISTRATORI_LISTA” aflat în curs de extindere
        list_role: str | None = None       # rolul lui list_entry — ținut separat, fiindcă odată convertit entry-ul nu mai are „role”
        consumed_hint_blanks: set[int] = set()   # indicele (în `matches`) al blank-ului al 2-lea dintr-un „…(indiciu)……” deja înghițit
        for k, m in enumerate(matches):
            if k in consumed_hint_blanks:
                continue
            blank_end = _extend_past_artifact_dots(text, m.end())    # vezi _extend_past_artifact_dots
            before = text[max(0, m.start() - 110):m.start()]
            after = text[blank_end:blank_end + 60]

            # indiciu explicit lipit de locul liber, ex. „…(CAEN PRINCIPAL)……” — prioritate maximă, înaintea
            # oricărei ghiciri din context (vezi _resolve_hint); dacă mai urmează imediat un al doilea loc
            # liber (doar spații între ele), cele două + indiciul devin O SINGURĂ etichetă, nu două separate.
            hint_m = _HINT_RE.match(text, blank_end)
            if hint_m:
                end = hint_m.end()
                nxt = k + 1
                if nxt < len(matches) and not text[end:matches[nxt].start()].strip():
                    end = _extend_past_artifact_dots(text, matches[nxt].end())
                    consumed_hint_blanks.add(nxt)
                resolved = _resolve_hint(hint_m.group(1))
                if resolved:
                    scope, field = resolved
                    if scope == "company":
                        s = {"scope": "company", "field": field, "confidence": "high"}
                        if field == "CAEN":
                            s["role"] = "CAEN"
                    else:
                        if state.person == 0:
                            state.person = 1
                        s = {"scope": "person", "field": field, "role": _role_for(text[:m.start()]), "person": state.person, "confidence": "high"}
                    state.last_field, state.last_scope = field, scope
                else:
                    s = {"scope": "manual", "field": None, "confidence": "high", "_hint_label": hint_m.group(1).strip()}
                s.update({"id": len(out), "paragraph": pi, "start": m.start(), "end": end,
                          "before": before[-70:], "after": text[end:end + 40]})
                if s["scope"] == "manual":
                    s["label"] = s.pop("_hint_label")
                    s["tag"] = manual_tag(s["label"])
                elif s["scope"] == "company":
                    s["label"] = COMPANY_FIELDS[s["field"]]
                    s["tag"] = "{{" + s["field"] + "}}"
                else:
                    s["label"] = f'{PERSON_FIELDS[s["field"]]} ({"administrator" if s["role"] == "ADMINISTRATOR" else "asociat"} {s["person"]})'
                    s["tag"] = person_tag(s["role"], s["person"], s["field"])
                out.append(s)
                list_entry, list_role = None, None
                continue

            s = suggest(before, after, text[:m.start()], state, pi, alone=text.strip(" -\t") == text[m.start():blank_end])
            is_mention = s["scope"] == "person" and s["field"] == "NUME_COMPLET" and s["confidence"] == "medium"
            if is_mention and re.match(r"^\s*_{5,}", after) and not before.strip():
                sig_idx += 1                              # semnături: câte un paragraf per persoană, numărate pe tot documentul
                s["person"] = sig_idx
                is_mention = False                         # rămân individuale (câte o linie de semnat per persoană)
            # A doua (sau a N-a) mențiune consecutivă a aceluiași rol, „…… și ……”: în loc de poziții fixe
            # (ASOCIAT_1, ASOCIAT_2 — nu au loc pentru o a treia persoană dacă apare), entry-ul anterior devine un
            # singur câmp scalabil (ASOCIATI_LISTA), care merge la orice număr — vezi lib/placeholders.ts (joinNames).
            # O mențiune SINGURĂ (fără alta lângă ea) rămâne individuală, ca înainte — ar putea desemna o persoană
            # anume (ex. „administratorul ……” dintr-o singură mențiune), nu neapărat lista completă.
            if is_mention and list_entry is not None and list_role == s["role"] \
                    and _CONNECTOR_RE.match(text[list_entry["end"]:m.start()]):
                list_entry["end"] = blank_end
                list_entry["after"] = after[:40]
                if list_entry["scope"] != "company":
                    field = _LIST_FIELD[list_role]
                    list_entry.update(scope="company", field=field, role=None, person=None,
                                      label=COMPANY_FIELDS[field], tag="{{" + field + "}}")
                continue
            s.update({
                "id": len(out), "paragraph": pi, "start": m.start(), "end": blank_end,
                "before": before[-70:], "after": after[:40],
            })
            if s["scope"] == "manual":
                s["label"] = s.get("label") or _label_before(before)   # etichetă curată, dacă suggest() a dat una (ex. „Număr de pagini”)
                s["tag"] = manual_tag(s["label"])
            elif s["scope"] == "company":
                s["label"] = COMPANY_FIELDS[s["field"]]
                s["tag"] = "{{" + s["field"] + "}}"
            else:
                s["label"] = f'{PERSON_FIELDS[s["field"]]} ({"administrator" if s["role"] == "ADMINISTRATOR" else "asociat"} {s["person"]})'
                s["tag"] = person_tag(s["role"], s["person"], s["field"])
            out.append(s)
            list_entry, list_role = (s, s["role"]) if is_mention else (None, None)
    return out


# ── Blocuri repetitive: câte o persoană cu aceeași structură, repetată de câte ori e nevoie ──────────────────

_ROLE_PLURAL = {"ASOCIAT": "ASOCIATI", "ADMINISTRATOR": "ADMINISTRATORI", "CAEN": "CAEN_SECUNDARE"}
_ORDINAL_RE = re.compile(r"^(\s*)(\d+)(\.\s*)")

# „asociatul/asociații”, „administratorul/administratorii” (cu variații: verb schimbat — „este asociatul/sunt
# asociații” —, sau typo real „adminstratorul”) — autorul spune explicit că poate fi una sau mai multe
# persoane, chiar dacă a scris o singură persoană ca exemplu. Tolerant la forma exactă a cuvântului al doilea
# (`adm\w*strat\w*` prinde și typo-ul „adminstrator”, căruia îi lipsește un „i”).
_PLURAL_MARKER_RE = re.compile(r"(asociat\w*|adm\w*strat\w*)\s*/\s*(?:\w+\s+)?(asociat\w*|adm\w*strat\w*)")


def _has_plural_marker(text: str) -> bool:
    return bool(_PLURAL_MARKER_RE.search(_ascii(text)))


def _paragraph_has_plural_marker(paragraphs: list, pi: int, marker_start: int) -> bool:
    """Marcajul poate fi în ACELAȘI paragraf, înaintea persoanei (fraza obișnuită), sau — cum apare des în
    documentul real — într-un paragraf Word separat, chiar înaintea celui cu datele persoanei (o ruptură de
    paragraf pe care autorul n-a intenționat-o, dar care există în fișier)."""
    if _has_plural_marker(_par_text(paragraphs[pi])[:marker_start]):
        return True
    return pi > 0 and _has_plural_marker(_par_text(paragraphs[pi - 1])[-160:])


def detect_groups(blanks: list[dict], docx_bytes: bytes | None = None) -> list[dict]:
    """Grupuri candidate de bloc repetitiv: mai multe persoane cu exact aceeași structură de câmpuri, fie în
    aceeași frază ([]„X, cetățenia…, CNP … si Y, cetățenia…, CNP …”] — kind='inline'), fie în paragrafe separate
    consecutive (kind='paragraph'), fie o SINGURĂ persoană scrisă ca exemplu, dar cu marcaj explicit de plural
    alături („asociatul/asociații ……, cetățean…” — vezi _paragraph_has_plural_marker; are nevoie de `docx_bytes`,
    ca să poată citi și paragraful dinainte). Nu se schimbă nimic aici — doar se propun; utilizatorul alege în
    interfață dacă se repetă automat (scalează la orice număr) sau rămân poziții fixe (vezi apply())."""
    groups: list[dict] = []
    by_par: dict[int, list[dict]] = {}
    for b in blanks:
        by_par.setdefault(b["paragraph"], []).append(b)
    for items in by_par.values():
        by_par[items[0]["paragraph"]] = sorted(items, key=lambda x: x["start"])

    def is_marker(b: dict) -> bool:
        return b["scope"] == "person" and b["field"] == "NUME_COMPLET" and b["confidence"] == "high"

    # kind='inline' — mai multe persoane definite complet în ACELAȘI paragraf (unite prin „si”/„iar”).
    # ADRESA e tratată ca opțională la potrivirea formei: în documente reale, o persoană e uneori scrisă
    # „domiciliat/ă în jud.……” (doar județ, fără localitate separată) și alta „domiciliat/ă în ……, jud. ……”
    # (localitate + județ) — aceeași clauză, doar o mențiune mai scurtă a domiciliului. Fără relaxarea asta,
    # o asemenea diferență reală blochează gruparea și persoanele suplimentare dispar din acel paragraf.
    for pi, items in sorted(by_par.items()):
        person_items = [b for b in items if b["scope"] == "person"]
        markers = [i for i, b in enumerate(person_items) if is_marker(b)]
        if len(markers) < 2:
            continue
        bounds = markers + [len(person_items)]
        clauses_raw = [person_items[bounds[k]:bounds[k + 1]] for k in range(len(markers))]
        role = clauses_raw[0][0]["role"]
        if any(not clause or any(c["role"] != role for c in clause) for clause in clauses_raw):
            continue
        shapes = [tuple(c["field"] for c in clause) for clause in clauses_raw]
        norm_shapes = [tuple(f for f in s if f != "ADRESA") for s in shapes]
        if len(set(norm_shapes)) != 1:
            continue
        clauses = clauses_raw
        template_idx = max(range(len(shapes)), key=lambda i: len(shapes[i]))    # clauza cea mai completă, ca șablon
        blank_ids = [b["id"] for c in clauses for b in c]
        groups.append({
            "id": len(groups), "kind": "inline", "paragraph": pi, "role": role, "count": len(clauses),
            "blank_ids": blank_ids, "template_blank_ids": [b["id"] for b in clauses[template_idx]],
            "label": f'{"administratori" if role == "ADMINISTRATOR" else "asociați"} — {len(clauses)} persoane găsite în același paragraf',
        })

    # kind='paragraph' — paragrafe separate consecutive, fiecare cu exact o persoană, aceeași structură
    solo: list[tuple[int, str, tuple, list[dict]]] = []
    for pi, items in sorted(by_par.items()):
        person_items = [b for b in items if b["scope"] == "person"]
        if len(person_items) >= 2 and is_marker(person_items[0]) and sum(is_marker(b) for b in person_items) == 1:
            solo.append((pi, person_items[0]["role"], tuple(b["field"] for b in person_items), person_items))
    i = 0
    while i < len(solo):
        j = i
        pi0, role0, shape0, _ = solo[i]
        cluster = [solo[i]]
        while j + 1 < len(solo) and solo[j + 1][0] == cluster[-1][0] + 1 and solo[j + 1][1] == role0 and solo[j + 1][2] == shape0:
            cluster.append(solo[j + 1])
            j += 1
        if len(cluster) >= 2:
            groups.append({
                "id": len(groups), "kind": "paragraph", "paragraphs": [c[0] for c in cluster], "role": role0,
                "count": len(cluster), "blank_ids": [b["id"] for c in cluster for b in c[3]],
                "template_blank_ids": [b["id"] for b in cluster[0][3]],
                "label": f'{"administratori" if role0 == "ADMINISTRATOR" else "asociați"} — {len(cluster)} paragrafe consecutive, aceeași structură',
            })
        i = j + 1

    # kind='paragraph', role='CAEN' — activități CAEN secundare needitate de la firma-exemplu, câte un cod pe
    # rând (fără „……”, vezi _find_caen_secondary_cluster); spre deosebire de persoane, un cod pe rând e deja
    # o „clauză” completă, deci nu mai e nevoie de un prag minim de 2 — chiar și un singur cod găsit merită
    # convertit în bloc repetitiv, ca lista reală a clientului (oricâte activități are) să încapă.
    caen_lines = sorted((b for items in by_par.values() for b in items if b.get("role") == "CAEN"), key=lambda b: b["paragraph"])
    i = 0
    while i < len(caen_lines):
        j = i
        cluster = [caen_lines[i]]
        while j + 1 < len(caen_lines) and caen_lines[j + 1]["paragraph"] == cluster[-1]["paragraph"] + 1:
            cluster.append(caen_lines[j + 1])
            j += 1
        cod_word = "cod găsit" if len(cluster) == 1 else "coduri găsite"
        groups.append({
            "id": len(groups), "kind": "paragraph", "paragraphs": [b["paragraph"] for b in cluster], "role": "CAEN",
            "count": len(cluster), "blank_ids": [b["id"] for b in cluster], "template_blank_ids": [cluster[0]["id"]],
            "label": f'activități CAEN secundare — {len(cluster)} {cod_word}, câte unul pe rând',
        })
        i = j + 1

    # kind='inline', o SINGURĂ clauză — „asociatul/asociații ……, cetățean…” — marcaj explicit de plural,
    # chiar dacă e scrisă o singură persoană ca exemplu (vezi _paragraph_has_plural_marker mai sus). Se
    # oferă exact ca la 2+ clauze: „repeat” scalează la orice număr, „fixed” rămâne o singură poziție.
    if docx_bytes is not None:
        pars = _paragraphs(Document(io.BytesIO(docx_bytes)))
        already_grouped = {g["paragraph"] for g in groups if g["kind"] == "inline"} | \
            {pi for g in groups if g["kind"] == "paragraph" for pi in g["paragraphs"]}
        for pi, items in sorted(by_par.items()):
            if pi in already_grouped or pi >= len(pars):
                continue
            person_items = [b for b in items if b["scope"] == "person"]
            markers = [i for i, b in enumerate(person_items) if is_marker(b)]
            if len(markers) != 1:
                continue
            clause = person_items[markers[0]:]
            if not _paragraph_has_plural_marker(pars, pi, clause[0]["start"]):
                continue
            role = clause[0]["role"]
            groups.append({
                "id": len(groups), "kind": "inline", "paragraph": pi, "role": role, "count": 1,
                "blank_ids": [b["id"] for b in clause], "template_blank_ids": [b["id"] for b in clause],
                "label": f'{"administrator" if role == "ADMINISTRATOR" else "asociat"} — marcat cu '
                         f'„{"administratorul/administratorii" if role == "ADMINISTRATOR" else "asociatul/asociații"}”, '
                         f'o singură persoană scrisă ca exemplu',
            })
    return groups


def generic_person_tag(field: str) -> str:
    """Eticheta nenumerotată pentru un câmp de persoană dintr-un bloc {{#ASOCIATI}}/{{#ADMINISTRATORI}} — aceleași
    nume ca în lib/placeholders.ts (persoanaToSingularMap)."""
    if field == "NUME_COMPLET":
        return "{{NUME}} {{PRENUME}}"
    if field == "CAPITAL_SOCIAL":
        return "{{CAPITAL_SOCIAL}}"
    if field == "PARTI_SOCIALE":
        return "{{PARTI_SOCIALE}}"
    return "{{" + field + "}}"


def _dominant_rpr(paragraph: Paragraph):
    """Formatarea (rPr — font, mărime, bold…) a fugii (run) cu cel mai mult text din paragraf: reprezintă fontul
    de bază al paragrafului (Arial, Times New Roman, ce-o fi în șablon), nu neapărat al locului liber „……” în
    sine, care câteodată are formatare proprie (ex. subliniat)."""
    runs = [r for r in paragraph.runs if r.text]
    if not runs:
        return None
    dominant = max(runs, key=lambda r: len(r.text))
    rpr = dominant._r.find(qn("w:rPr"))
    return copy.deepcopy(rpr) if rpr is not None else None


def _insert_paragraph_before(anchor: Paragraph, text: str, rpr=None) -> Paragraph:
    """Paragraf nou, gol, inserat imediat înaintea lui `anchor`, cu aceeași aliniere/indentare (pPr) și, dacă e
    dat `rpr` (vezi _dominant_rpr), cu același font — altfel Word afișează fugile noi cu fontul implicit
    (adesea Times New Roman), diferit de restul șablonului (ex. Arial)."""
    new_p = OxmlElement("w:p")
    if anchor._p.pPr is not None:
        new_p.append(copy.deepcopy(anchor._p.pPr))
    anchor._p.addprevious(new_p)
    new_par = Paragraph(new_p, anchor._parent)
    if text:
        run = new_par.add_run(text)
        if rpr is not None:
            run._r.insert(0, copy.deepcopy(rpr))
    return new_par


def _local_replacements(text: str, blanks: list[dict], offset: int, tag_for) -> str:
    """Aplică `tag_for(blank)` (poate întoarce None = neschimbat) pe `text`, pentru blank-urile din `blanks`
    (coordonate absolute, decalate cu -offset), în ordine inversă, ca pozițiile nefolosite încă să rămână valide."""
    for b in sorted(blanks, key=lambda x: x["start"], reverse=True):
        tag = tag_for(b)
        if tag:
            s, e = b["start"] - offset, b["end"] - offset
            text = text[:s] + tag + text[e:]
    return text


def _split_group_paragraph(anchor: Paragraph, whole_text: str, template_span: tuple[int, int], group_end: int,
                           other_blanks: list[dict], template_blanks: list[dict], role: str,
                           choices: dict[int, str | None], prefix_end: int | None = None) -> None:
    """Un paragraf → prefix (text fix) / {{#ROL}} / clauza-șablon (etichete generice) / {{/ROL}} / sufix (text fix),
    fiecare ca paragraf separat, cu aceeași aliniere și font ca paragraful original (vezi _insert_paragraph_before
    și _dominant_rpr). Textul dintre sfârșitul clauzei-șablon și `group_end` (clauzele 2..N ale grupului,
    plus conectorul „si”/„iar” dintre ele, la varianta „inline”) se elimină — devine parte a blocului repetitiv,
    nu se mai scrie o singură dată. Blank-urile din afara grupului (prefix/sufix) primesc alegerea individuală a
    utilizatorului, exact ca la un loc liber obișnuit; cele lăsate „neschimbate” rămân „……” vizibil.

    `prefix_end` e limita prefixului (începutul primei clauze, în ordinea din text) — de obicei coincide cu
    începutul clauzei-șablon, dar nu întotdeauna: clauza-șablon poate fi alta decât prima (cea mai completă
    structural, ex. singura cu ADRESA), caz în care prefixul tot trebuie să se oprească înainte de PRIMA
    clauză, nu înainte de clauza-șablon — altfel clauza (clauzele) dinaintea ei ar rămâne text fix, needitat."""
    clause_start, clause_end = template_span
    if prefix_end is None:
        prefix_end = clause_start
    prefix_raw, clause_raw, suffix_raw = whole_text[:prefix_end], whole_text[clause_start:clause_end], whole_text[group_end:]
    role_plural = _ROLE_PLURAL[role]

    # un prefix format DOAR dintr-un număr de ordine ("1. ") aparține de fapt clauzei, ca {{INDEX}} — nu rămâne
    # text fix, altfel fiecare persoană repetată ar purta numărul primei. Se marchează ACUM (pe textul original,
    # neschimbat) și se aplică mai jos, DUPĂ substituirea locurilor libere din clauză — altfel ar strica offset-urile.
    ordinal = _ORDINAL_RE.match(prefix_raw)
    prepend_index = ordinal is not None and ordinal.end() >= len(prefix_raw.rstrip())
    if prepend_index:
        prefix_raw = ""

    prefix_blanks = [b for b in other_blanks if b["end"] <= prefix_end]
    suffix_blanks = [b for b in other_blanks if b["start"] >= group_end]

    # fontul paragrafului original (Arial, Times New Roman, ce-o fi) — altfel paragrafele noi ar ieși cu
    # fontul implicit din stilul „Normal” al documentului, diferit de restul șablonului.
    rpr = _dominant_rpr(anchor)

    if prefix_raw.strip():
        text = _local_replacements(prefix_raw, prefix_blanks, 0, lambda b: choices.get(b["id"]))
        _insert_paragraph_before(anchor, text, rpr)
    _insert_paragraph_before(anchor, f"{{{{#{role_plural}}}}}", rpr)
    clause_text = _local_replacements(clause_raw, template_blanks, clause_start, lambda b: generic_person_tag(b["field"]))
    if prepend_index:
        clause_text = "{{INDEX}}. " + clause_text.lstrip()
    _insert_paragraph_before(anchor, clause_text, rpr)
    _insert_paragraph_before(anchor, f"{{{{/{role_plural}}}}}", rpr)
    if suffix_raw.strip():
        text = _local_replacements(suffix_raw, suffix_blanks, group_end, lambda b: choices.get(b["id"]))
        _insert_paragraph_before(anchor, text, rpr)
    anchor._p.getparent().remove(anchor._p)


def _apply_inline_group(pars: list[Paragraph], group: dict, blanks_by_id: dict[int, dict], choices: dict[int, str | None]) -> None:
    par = pars[group["paragraph"]]
    text = "".join(r.text for r in par.runs)
    template_blanks = [blanks_by_id[i] for i in group["template_blank_ids"]]
    all_group_blanks = sorted((blanks_by_id[i] for i in group["blank_ids"]), key=lambda b: b["start"])
    template_span = (template_blanks[0]["start"], template_blanks[-1]["end"])
    prefix_end = all_group_blanks[0]["start"]    # începutul PRIMEI clauze — nu neapărat clauza-șablon (vezi mai jos)
    group_end = all_group_blanks[-1]["end"]      # sfârșitul ULTIMEI clauze — clauzele 2..N dispar odată cu ce e între ele
    other_blanks = [b for b in blanks_by_id.values() if b["paragraph"] == group["paragraph"] and b["id"] not in group["blank_ids"]]
    _split_group_paragraph(par, text, template_span, group_end, other_blanks, template_blanks, group["role"], choices, prefix_end)


def _apply_paragraph_group(pars: list[Paragraph], group: dict, blanks_by_id: dict[int, dict], choices: dict[int, str | None]) -> None:
    template_blanks = sorted((blanks_by_id[i] for i in group["template_blank_ids"]), key=lambda b: b["start"])
    first_pi = group["paragraphs"][0]
    first_par = pars[first_pi]
    text = "".join(r.text for r in first_par.runs)
    template_span = (template_blanks[0]["start"], template_blanks[-1]["end"])
    other_blanks = [b for b in blanks_by_id.values() if b["paragraph"] == first_pi and b["id"] not in group["blank_ids"]]
    _split_group_paragraph(first_par, text, template_span, template_span[1], other_blanks, template_blanks, group["role"], choices)
    for pi in group["paragraphs"][1:]:
        p = pars[pi]
        p._p.getparent().remove(p._p)


def apply(docx_bytes: bytes, choices: dict[int, str | None], groups: dict[int, str] | None = None) -> bytes:
    """Înlocuiește locurile libere cu etichetele alese ({id: etichetă}); id-urile lipsă sau None rămân neschimbate.

    `groups` ({group_id: "repeat"|"fixed"}) decide, pentru fiecare grup găsit de `detect_groups`, dacă persoanele
    lui devin un bloc repetitiv (scalează la orice număr) sau rămân poziții fixe (tratate ca locuri libere
    obișnuite, prin `choices`)."""
    doc = Document(io.BytesIO(docx_bytes))
    found = analyze(docx_bytes)
    blanks_by_id = {b["id"]: b for b in found}
    detected = detect_groups(found, docx_bytes)
    accepted = [g for g in detected if (groups or {}).get(g["id"]) == "repeat"]
    grouped_paragraphs = {g["paragraph"] for g in accepted if g["kind"] == "inline"} | \
        {pi for g in accepted if g["kind"] == "paragraph" for pi in g["paragraphs"]}

    by_par: dict[int, list[dict]] = {}
    for f in found:
        if f["paragraph"] in grouped_paragraphs:
            continue     # paragrafele unui grup acceptat sunt tratate integral de _apply_*_group, mai jos
        tag = choices.get(f["id"])
        if tag:
            by_par.setdefault(f["paragraph"], []).append({**f, "tag": tag})
    pars = _paragraphs(doc)
    for pi, items in by_par.items():
        for it in sorted(items, key=lambda x: x["start"], reverse=True):
            _replace_span(pars[pi], it["start"], it["end"], it["tag"])

    for g in accepted:
        if g["kind"] == "inline":
            _apply_inline_group(pars, g, blanks_by_id, choices)
        else:
            _apply_paragraph_group(pars, g, blanks_by_id, choices)

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


_TAG_OK = re.compile(r"^(?:\{\{[A-Z0-9_]+\}\}\s?){1,3}$")


def valid_tag(tag) -> bool:
    """Doar etichete {{CÂMP}} (cel mult trei, ex. nume + prenume); nimic altceva nu ajunge în document."""
    return isinstance(tag, str) and 0 < len(tag) <= 120 and bool(_TAG_OK.match(tag.strip()))
