"""Plasă de siguranță pentru șabloane: fiecare șablon de bază (plus șabloanele clienților din
fisiere_template/SabloaneAvocatTavi/anonimizate) se completează cu datele unor clienți ficționali — exact cele
trimise de aplicație, fixate în tests/golden/payloads.json de frontend/src/lib/golden.test.ts — cu toate clauzele
bifate, iar textul rezultat se compară cu o versiune salvată. Orice schimbare de cod care atinge un document
existent (variante „numit/ă”, etichete, clauze, liste) apare aici ca diferență, înainte de deploy.

Versiunile salvate stau lângă șabloane, în fisiere_template/.golden/ — ignorate de git, ca și șabloanele. Fără
șabloane (ex. alt calculator), testele se sar. Prima rulare pentru un șablon nou își scrie versiunea salvată.

Schimbare intenționată: `GOLDEN_UPDATE=1 .venv/bin/python -m pytest tests/test_golden_templates.py`, apoi
verifică diferențele (git nu le vede — ex. `diff` pe o copie a folderului .golden).
"""
import difflib
import io
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

import pytest
from docx import Document

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import doc_filler as df  # noqa: E402

TEMPLATE_DIR = ROOT / "fisiere_template"
# Șabloanele pregătite pentru clienți (avocatul; Dorothea — Actus Consult), fiecare cu prefixul lui în numele fișierelor salvate
CUSTOM_DIRS = {"client": TEMPLATE_DIR / "SabloaneAvocatTavi" / "anonimizate",
               "dorothea": TEMPLATE_DIR / "Șabloane Dorothea - Actus Consult"}
GOLDEN_DIR = TEMPLATE_DIR / ".golden"
PAYLOADS = json.loads((ROOT / "tests" / "golden" / "payloads.json").read_text(encoding="utf-8"))
UPDATE = os.environ.get("GOLDEN_UPDATE") == "1"

# Valori pentru câmpurile clauzelor (în aplicație vin din formularele lor) — câte una pentru fiecare etichetă
# cunoscută; o etichetă de clauză nelistată rămâne {{X}} în text, tot deterministic.
CLAUSE_FIELDS = {
    "SEDIU_NOU": "Mun. Cluj-Napoca, Str. Nouă nr. 9", "TIP_CONTRACT_SEDIU": "contract de comodat",
    "CONTRACT_SEDIU_NR": "12", "CONTRACT_SEDIU_DATA": "01.03.2026",
    "PUNCT_LUCRU_NOU_ADRESA": "Mun. Turda, Str. Morii nr. 3", "TIP_CONTRACT_PUNCT_LUCRU": "contract de închiriere",
    "CONTRACT_PUNCT_LUCRU_NR": "7", "CONTRACT_PUNCT_LUCRU_DATA": "02.03.2026",
    "PUNCT_LUCRU_INCHIS_ADRESA": "Mun. Dej, Str. Veche nr. 1",
    "CEDENT_NUME": "POPA ANA", "CESIONAR_NUME": "VASILE DAN", "NR_PARTI_CEDATE": "10", "VALOARE_NOMINALA": "10",
    "DATA_CONTRACT_CESIUNE": "03.03.2026",
    "ASOCIAT_APORT_NUME": "POPA ANA", "ASOCIAT_APORT_COTA_PARTICIPARE": "100", "CAPITAL_SOCIAL_NOU": "400",
    "PARTI_SOCIALE_NOI": "40",
    "CAEN_PRINCIPAL_NOU": "6202 - Activități de consultanță în tehnologia informației",
    "ADMINISTRATOR_VECHI_NUME": "POPA ANA", "ADMINISTRATOR_NOU_NUME": "VASILE DAN", "DURATA_MANDAT_ANI": "4",
    "ASOCIAT_MODIFICAT_NUME": "POPA", "ASOCIAT_MODIFICAT_PRENUME": "ANA", "ASOCIAT_MODIFICAT_SERIE_NUMAR": "XB 999999",
    "ASOCIATI_ACTUALIZATI_ROL": "asociatului", "ASOCIATI_ACTUALIZATI": "POPA ANA",
    "ADMINISTRATORI_ACTUALIZATI_ROL": "administratorului", "ADMINISTRATORI_ACTUALIZATI": "POPA ANA",
    "DURATA_SOCIETATE": "nelimitată", "DURATA_MANDAT": "de 4 ani",
}
CLAUSE_GROUPS = {
    "COD_CAEN_NOU": [{"CAEN": "7311 - Activități ale agențiilor de publicitate"}],
    "APORTURI": [{"NUME": "POPA ANA", "APORT": "200", "PARTI_APORT": "20", "COTA_PARTICIPARE": "100"}],
    "STRUCTURA_REZULTATA": [{"NUME": "VASILE DAN", "CAPITAL_SOCIAL": "200", "PARTI_SOCIALE": "20", "COTA_PARTICIPARE": "100%"}],
    "LICHIDARE_ASOCIATI": [{"NUME": "POPA ANA", "COTA_PARTICIPARE": "100%"}],
}


def _slug(name: str) -> str:
    """Nume de fișier ASCII („Hotărâre AGA:Asociat Unic” → „hotarare_aga_asociat_unic”)."""
    ascii_ = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", ascii_.lower()).strip("_")


def _templates() -> list[tuple[str, Path, str]]:
    """(id, cale, tip client: PJ/PF/universal) — șabloanele .docx din registru, apoi cele ale clienților (PJ)."""
    if not (TEMPLATE_DIR / "registry.json").is_file():
        return []
    out = []
    for e in json.loads((TEMPLATE_DIR / "registry.json").read_text(encoding="utf-8")):
        if e.get("type") == "docx":
            path = next((p for p in TEMPLATE_DIR.glob("*.docx")
                         if unicodedata.normalize("NFC", p.name) == unicodedata.normalize("NFC", e["filename"])), None)
            if path:
                out.append((e["key"], path, e.get("tipTemplate") or "universal"))
    for prefix, folder in CUSTOM_DIRS.items():
        # „~$…” = fișierul temporar al Word-ului pentru un document deschis, nu un șablon
        for p in sorted(x for x in folder.glob("*.docx") if not x.name.startswith("~$")) if folder.is_dir() else []:
            out.append((f"{prefix}_" + _slug(p.stem), p, "PJ"))
    return out


def _cases():
    for tpl_id, path, tip in _templates():
        for client_id, payload in PAYLOADS.items():
            if tip in ("universal", payload["tip"]):
                yield pytest.param(path, payload, id=f"{tpl_id}--{client_id}")


def _text(docx_bytes: bytes) -> str:
    doc = Document(io.BytesIO(docx_bytes))
    lines = [p.text for p in doc.paragraphs]
    for t in df._iter_all_tables(doc):
        for row in t.rows:
            lines.append(" | ".join(c.text.replace("\n", " / ") for c in row.cells))
    for part in df._header_footer_parts(doc):
        lines.extend(p.text for p in part.paragraphs)
    return "\n".join(lines).rstrip() + "\n"


def _fill(template: bytes, payload: dict) -> str:
    replacements = {k: v for k, v in payload["replacements"].items() if v}   # ca app.py: doar valori completate
    clauses = df.list_clauses_in_docx(template)
    for c in clauses:
        for ph in c["placeholders"]:
            key = ph.strip("{}")
            if key in CLAUSE_FIELDS and ph not in replacements:
                replacements[ph] = CLAUSE_FIELDS[key]
    groups = {**payload["groups"], **CLAUSE_GROUPS}
    # Listele de persoane cu rol propriu (ex. COMODANTI): asociații clientului, ca alegere fixă
    for tag in df.list_repeat_groups_in_docx(template):
        groups.setdefault(tag, payload["groups"].get("ASOCIATI", []))
    warnings: set = set()
    filled = df.fill_docx(template, replacements, groups, [c["tag"] for c in clauses] or None, None,
                          payload["ctx"], warnings, set())
    return _text(filled) + "".join(f"[avertisment variantă] {w}\n" for w in sorted(map(str, warnings)))


CASES = list(_cases())


@pytest.mark.skipif(not CASES, reason="șabloanele (fisiere_template/, ignorat de git) lipsesc pe acest calculator")
@pytest.mark.parametrize("path,payload", CASES)
def test_documentul_generat_ramane_neschimbat(path: Path, payload: dict, request):
    actual = _fill(path.read_bytes(), payload)
    golden = GOLDEN_DIR / f"{request.node.callspec.id}.txt"
    if UPDATE or not golden.is_file():
        golden.parent.mkdir(exist_ok=True)
        golden.write_text(actual, encoding="utf-8")
        return
    expected = golden.read_text(encoding="utf-8")
    if actual != expected:
        diff = "".join(list(difflib.unified_diff(expected.splitlines(True), actual.splitlines(True),
                                                 "salvat", "acum"))[:80])
        pytest.fail(f"{golden.name}: textul generat s-a schimbat.\n{diff}\n"
                    "Intenționat? GOLDEN_UPDATE=1 .venv/bin/python -m pytest tests/test_golden_templates.py", pytrace=False)
