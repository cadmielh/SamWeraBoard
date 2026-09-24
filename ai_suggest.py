"""Sugestii AI (opționale, doar la cererea explicită a utilizatorului) pentru locurile libere pe care
motorul determinist din blanks.py nu le recunoaște cu încredere ("manual" sau confidence != "high").

Rulează O SINGURĂ DATĂ per șablon, la import (nu la generarea documentului cu date reale de client — acolo
nu se atinge nimic, `doc_filler.fill_docx` rămâne 100% determinist, fără nicio implicare AI). Nu generează
și nu rescrie niciodată textul actului: doar CLASIFICĂ un loc liber deja delimitat de `blanks.analyze()`,
exact ca motorul determinist — rezultatul trece prin ACELEAȘI funcții de construire a etichetei
(`person_tag`/`manual_tag`/`valid_tag`) și prin ACELAȘI ecran de confirmare din interfață; nimic nu se
aplică automat în șablon.

Furnizor: Gemini prin Vertex AI, pe același proiect GCP deja folosit pentru Firestore/Auth — se
autentifică cu aceleași credențiale implicite (ADC), fără nicio cheie nouă. Modelul și regiunea sunt
CONFIGURABILE explicit din mediu (GEMINI_MODEL / GEMINI_LOCATION), fără nicio valoare implicită în cod —
seria de modele Gemini se schimbă des (Gemini 2.5, de exemplu, e deja anunțată spre dezactivare), deci
alegerea trebuie făcută conștient la deploy, nu îngropată într-un „implicit sigur" care poate expira.
"""
from __future__ import annotations

import os
import re
from typing import Literal

from pydantic import BaseModel

import blanks

_MODEL_ENV = "GEMINI_MODEL"
_LOCATION_ENV = "GEMINI_LOCATION"
_PROJECT_ENV_CANDIDATES = ("GEMINI_PROJECT", "GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT")

# Apărare împotriva unui șablon aberant de mare — mărginește costul/timpul unui singur apel, indiferent
# câte locuri libere „de verificat" ar avea un document neobișnuit de complex.
_MAX_BLANKS_PER_CALL = 40


class AiSuggestUnavailable(RuntimeError):
    """Config lipsă (model/regiune/proiect), context suspect (posibil CNP real) sau apelul Gemini a eșuat
    ori a întors ceva nevalid — chemătorul (ruta din app.py) arată o eroare clară; fluxul de import al
    șablonului rămâne perfect funcțional fără AI, exact ca înainte de acest modul."""


# ── Schema răspunsului — impusă modelului (Gemini nu poate ieși din ea) ────────────────────────────────

class _AiBlankSuggestion(BaseModel):
    id: int
    scope: Literal["company", "person", "manual", "keep"]
    field: str | None = None
    role: str | None = None
    label: str = ""


class _AiSuggestResponse(BaseModel):
    suggestions: list[_AiBlankSuggestion]


# ── Plasă de siguranță: nu trimitem context care conține un CNP real ───────────────────────────────────
# Reprodusă minimal (nu importăm local_extractor — modul greu, cu OCR — doar pentru asta); aceeași logică
# (cifră de control + dată calendaristică validă) ca local_extractor._validate_cnp.
_CNP_WEIGHTS = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9]


def _contains_real_cnp(text: str) -> bool:
    compressed = re.sub(r"(\d)\s+(\d)", r"\1\2", text)
    for m in re.finditer(r"\b([1-9]\d{12})\b", compressed):
        cnp = m.group(1)
        total = sum(int(cnp[i]) * _CNP_WEIGHTS[i] for i in range(12))
        check = total % 11
        if check == 10:
            check = 1
        if check == int(cnp[12]):
            return True
    return False


def eligible_blanks(found: list[dict], ids: set[int] | None = None) -> list[dict]:
    """Sub-mulțimea din blanks.analyze() pe care AI-ul o poate ajuta — exact „De verificat" din interfață
    (confidence != "high"); cele deja recunoscute sigur nu se trimit — cost/timp mai mic, și oricum n-au
    nevoie de ajutor. `ids`, dacă e dat (vezi ruta din app.py — utilizatorul cere sugestii DOAR pentru un
    anumit loc/anumite locuri, nu pentru toate cele needeslușite deodată — mai puțini tokeni, mai ieftin),
    restrânge suplimentar la acele id-uri — server-ul tot re-verifică `confidence` (nu are încredere orbește
    în ce trimite clientul ca „needeslușit"). Mărginită oricum la _MAX_BLANKS_PER_CALL."""
    targets = [b for b in found if b.get("confidence") != "high"]
    if ids is not None:
        targets = [b for b in targets if b["id"] in ids]
    return targets[:_MAX_BLANKS_PER_CALL]


def _prompt_for(targets: list[dict]) -> str:
    company_fields = ", ".join(blanks.COMPANY_FIELDS)
    person_fields = ", ".join(blanks.PERSON_FIELDS)
    lines = [
        "Ești un asistent care clasifică locurile libere dintr-un șablon DEJA ANONIMIZAT de act juridic "
        "românesc (act constitutiv, contract, declarație etc.) — nu conține date reale de persoane, doar "
        "un exemplu needitat sau marcaje „……” (elipsă). Nu genera și nu completa text — doar clasifică fiecare loc "
        "liber de mai jos (marcat cu 【……】 în context), alegând EXACT una din categoriile:",
        f'- "company": un câmp al firmei — field una din: {company_fields}',
        f'- "person": un câmp al unei persoane — field una din: {person_fields}; '
        'role = calitatea juridică reală a persoanei din context, ÎN MAJUSCULE, cuvinte unite prin '
        '„_" (ex. ASOCIAT, ADMINISTRATOR, COMODANT, COMODATAR, REPREZENTANT_LEGAL, CHIRIAS — sau orice '
        'altă calitate scrisă clar în text, chiar dacă nu e în această listă)',
        '- "manual": nu se poate deduce din context (ex. un număr de pagini, un termen specific '
        'documentului) — label = o etichetă scurtă și clară, în română',
        '- "keep": contextul e prea ambiguu ca să riști o clasificare greșită — mai bine needitat',
        "",
        "Răspunde STRICT pentru id-urile date, câte o intrare per id, fără alte comentarii.",
        "",
        "Locuri libere:",
    ]
    for b in targets:
        before = (b.get("before") or "")[-160:]
        after = (b.get("after") or "")[:100]
        lines.append(f'id={b["id"]}: "…{before}【……】{after}…"')
    return "\n".join(lines)


def _role_word(role: str) -> str:
    if role == "ADMINISTRATOR":
        return "administrator"
    if role == "ASOCIAT":
        return "asociat"
    return role.replace("_", " ").lower()


def _label_for(scope: str, field: str | None, role: str | None, person: int, ai_label: str) -> str | None:
    """Eticheta afișată — pentru „company”/„person” construită la fel ca motorul determinist (consistență
    în interfață, indiferent de sursă), nu preluată din textul liber al modelului; doar „manual” folosește
    eticheta dată de model (exact ca indiciul din paranteză „(Nume Asociat)” azi — vezi blanks._explicit_role)."""
    if scope == "manual":
        label = ai_label.strip()
        return label or None
    if scope == "company":
        return blanks.COMPANY_FIELDS.get(field or "")
    if scope == "person":
        pf = blanks.PERSON_FIELDS.get(field or "")
        if not pf or not role:
            return None
        return f"{pf} ({_role_word(role)} {person})"
    return None


def _build_tag(scope: str, field: str | None, role: str | None, person: int, label: str) -> str | None:
    """Etichetă finală — prin ACELEAȘI funcții pe care le folosește motorul determinist (blanks.py); modelul
    AI nu produce niciodată direct un tag — doar clasificarea (scope/field/role), din câmpurile deja
    cunoscute de aplicație. Nicio combinație imposibilă (field necunoscut, rol lipsă la „person”) nu produce tag."""
    if scope == "manual":
        return blanks.manual_tag(label)
    if scope == "company":
        return "{{" + field + "}}" if field in blanks.COMPANY_FIELDS else None
    if scope == "person":
        if field not in blanks.PERSON_FIELDS or not role:
            return None
        return blanks.person_tag(role, person, field)
    return None


def _to_suggestion(ai: _AiBlankSuggestion, original: dict) -> dict | None:
    """O sugestie AI validă (id cunoscut + combinație scope/field/role validă), în forma pe care frontend-ul
    o așteaptă deja de la blanks.analyze() — poziția persoanei (`person`) se moștenește din ce a calculat
    DEJA motorul determinist (numărătoarea secvențială rămâne a lui — AI-ul corectează rolul/câmpul, nu
    renumerotează), la fel `paragraph`/`start`/`end` (locul exact în document nu se schimbă, doar ce
    reprezintă). None dacă modelul a ales „keep” sau a propus ceva ce nu se poate transforma într-un tag valid."""
    if ai.scope == "keep":
        return None
    role = None
    if ai.scope == "person":
        if not ai.role:
            return None
        # ca la manual_tag din blanks.py — orice șir de caractere nepotrivite (inclusiv spații între cuvinte,
        # ex. „mandatar judiciar") devine UN „_”, nu dispare pur și simplu (ar lipi „mandatar”+„judiciar”).
        role = re.sub(r"[^A-Z0-9]+", "_", ai.role.upper()).strip("_")
        if not role:
            return None
    person = original.get("person") or 1
    label = _label_for(ai.scope, ai.field, role, person, ai.label)
    if label is None:
        return None
    tag = _build_tag(ai.scope, ai.field, role, person, label)
    if tag is None or not blanks.valid_tag(tag):
        return None
    return {
        **original,
        "scope": ai.scope, "field": ai.field, "role": role, "person": person if ai.scope == "person" else None,
        "label": label, "confidence": "medium", "tag": tag, "source": "ai",
    }


def _resolve_config() -> tuple[str, str, str]:
    model = os.getenv(_MODEL_ENV)
    location = os.getenv(_LOCATION_ENV)
    project = next((os.getenv(k) for k in _PROJECT_ENV_CANDIDATES if os.getenv(k)), None)
    missing = [name for name, val in ((_MODEL_ENV, model), (_LOCATION_ENV, location), ("proiect GCP", project)) if not val]
    if missing:
        raise AiSuggestUnavailable(f"Config Gemini lipsă: {', '.join(missing)} — sugestiile AI sunt dezactivate.")
    return model, location, project  # type: ignore[return-value]


def suggest(found: list[dict], *, client=None, ids: set[int] | None = None) -> list[dict]:
    """Sugestii AI pentru blank-urile needeslușite din `found` (rezultatul blanks.analyze()) — [] dacă nu e
    nimic de îmbunătățit. `client`, dat de teste, înlocuiește clientul Gemini real (vezi tests/test_ai_suggest.py).
    `ids` — vezi eligible_blanks: restrânge la un subset anume, cerut explicit de utilizator (per câmp, nu
    toate deodată)."""
    targets = eligible_blanks(found, ids)
    if not targets:
        return []

    prompt = _prompt_for(targets)
    if _contains_real_cnp(prompt):
        raise AiSuggestUnavailable("Contextul conține un tipar de CNP real — nu se trimite nimic către AI.")

    model, location, project = _resolve_config()

    if client is None:
        from google import genai
        client = genai.Client(vertexai=True, project=project, location=location)

    from google.genai import types
    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_AiSuggestResponse,
                temperature=0,
            ),
        )
        parsed = response.parsed
    except Exception as e:
        raise AiSuggestUnavailable("Apelul către Gemini a eșuat") from e

    if not isinstance(parsed, _AiSuggestResponse):
        raise AiSuggestUnavailable("Răspunsul Gemini nu respectă formatul așteptat")

    by_id = {b["id"]: b for b in targets}
    out = []
    for ai in parsed.suggestions:
        original = by_id.get(ai.id)
        if original is None:
            continue   # id necunoscut — ignorat, nu inventăm o poziție
        suggestion = _to_suggestion(ai, original)
        if suggestion is not None:
            out.append(suggestion)
    return out
