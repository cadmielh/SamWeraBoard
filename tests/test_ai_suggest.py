"""Sugestii AI pentru locurile libere needeslușite de motorul determinist (blanks.py) — vezi ai_suggest.py.
Niciun test de-aici nu atinge Gemini/Vertex AI real: clientul e simulat, ca suita să rămână rapidă și gratuită."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ai_suggest  # noqa: E402


def blank(id, confidence="low", scope="manual", field=None, role=None, person=None,
          before="context dinainte ", after=" context după", tag="{{CAMP_X}}", label="") -> dict:
    return {
        "id": id, "scope": scope, "field": field, "role": role, "person": person, "confidence": confidence,
        "before": before, "after": after, "label": label, "tag": tag, "paragraph": 0, "start": 0, "end": 2,
    }


class FakeResponse:
    def __init__(self, parsed):
        self.parsed = parsed


class FakeModels:
    def __init__(self, parsed=None, exc=None):
        self._parsed = parsed
        self._exc = exc
        self.calls: list[dict] = []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self._exc:
            raise self._exc
        return FakeResponse(self._parsed)


class FakeClient:
    def __init__(self, parsed=None, exc=None):
        self.models = FakeModels(parsed, exc)


@pytest.fixture(autouse=True)
def gemini_env(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-test-flash")
    monkeypatch.setenv("GEMINI_LOCATION", "europe-west4")
    monkeypatch.setenv("GCLOUD_PROJECT", "samwera-board-eu")


def test_eligible_blanks_ia_doar_ce_nu_e_recunoscut_sigur():
    found = [blank(0, confidence="high"), blank(1, confidence="medium"), blank(2, confidence="low")]
    assert [b["id"] for b in ai_suggest.eligible_blanks(found)] == [1, 2]


def test_eligible_blanks_marginit_la_maximul_per_apel():
    found = [blank(i, confidence="low") for i in range(ai_suggest._MAX_BLANKS_PER_CALL + 10)]
    assert len(ai_suggest.eligible_blanks(found)) == ai_suggest._MAX_BLANKS_PER_CALL


def test_eligible_blanks_cu_ids_cere_doar_pentru_campurile_alese():
    """Cerință utilizator: sugestii AI per câmp, nu obligatoriu pentru toate cele needeslușite deodată — mai
    puțini tokeni trimiși când doar unul-două câmpuri chiar au nevoie de ajutor."""
    found = [blank(0, confidence="medium"), blank(1, confidence="low"), blank(2, confidence="low")]
    assert [b["id"] for b in ai_suggest.eligible_blanks(found, ids={2})] == [2]
    # server-ul tot re-verifică confidence — un id „high” cerut explicit nu se trimite oricum
    found2 = [blank(0, confidence="high"), blank(1, confidence="low")]
    assert ai_suggest.eligible_blanks(found2, ids={0, 1}) == [found2[1]]


def test_nimic_de_verificat_nu_declanseaza_niciun_apel():
    found = [blank(0, confidence="high")]
    client = FakeClient()
    assert ai_suggest.suggest(found, client=client) == []
    assert client.models.calls == []


def test_fara_config_gemini_ridica_eroare_clara(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    found = [blank(0)]
    with pytest.raises(ai_suggest.AiSuggestUnavailable):
        ai_suggest.suggest(found, client=FakeClient())


def test_context_cu_cnp_real_blocheaza_apelul_fara_sa_trimita_nimic():
    # CNP valid (cifră de control corectă) — nu trebuie să ajungă niciodată la model.
    found = [blank(0, before="……, CNP 1900101123457, ")]
    client = FakeClient()
    with pytest.raises(ai_suggest.AiSuggestUnavailable):
        ai_suggest.suggest(found, client=client)
    assert client.models.calls == []


def test_esecul_apelului_gemini_ridica_eroare_clara_nu_se_propaga_brut():
    found = [blank(0)]
    client = FakeClient(exc=TimeoutError("network"))
    with pytest.raises(ai_suggest.AiSuggestUnavailable):
        ai_suggest.suggest(found, client=client)


def test_raspuns_neconform_schemei_ridica_eroare_clara():
    found = [blank(0)]
    client = FakeClient(parsed=None)   # modelul n-a respectat schema JSON impusă
    with pytest.raises(ai_suggest.AiSuggestUnavailable):
        ai_suggest.suggest(found, client=client)


def test_sugestie_company_valida():
    found = [blank(0, scope="manual")]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[
        ai_suggest._AiBlankSuggestion(id=0, scope="company", field="SOCIETATE_SEDIU"),
    ])
    out = ai_suggest.suggest(found, client=FakeClient(parsed=parsed))
    assert len(out) == 1
    assert out[0]["tag"] == "{{SOCIETATE_SEDIU}}"
    assert out[0]["confidence"] == "medium" and out[0]["source"] == "ai"


def test_sugestie_person_cu_rol_nou_necunoscut_dinainte():
    """Exact cazul care lipsea din motorul determinist — un rol pe care nicio regulă nu-l anticipase."""
    found = [blank(0, scope="manual", person=None)]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[
        ai_suggest._AiBlankSuggestion(id=0, scope="person", field="NUME_COMPLET", role="mandatar judiciar"),
    ])
    out = ai_suggest.suggest(found, client=FakeClient(parsed=parsed))
    assert out[0]["tag"] == "{{MANDATAR_JUDICIAR_1_NUME}} {{MANDATAR_JUDICIAR_1_PRENUME}}"
    assert out[0]["role"] == "MANDATAR_JUDICIAR"
    assert "mandatar judiciar" in out[0]["label"]


def test_pozitia_persoanei_se_mosteneste_din_motorul_determinist_nu_e_renumerotata():
    """Poziția (person=2) era deja calculată de blanks.analyze() — AI-ul corectează rolul, nu numărătoarea."""
    found = [blank(0, scope="person", field="NUME_COMPLET", role="ASOCIAT", person=2)]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[
        ai_suggest._AiBlankSuggestion(id=0, scope="person", field="NUME_COMPLET", role="ADMINISTRATOR"),
    ])
    out = ai_suggest.suggest(found, client=FakeClient(parsed=parsed))
    assert out[0]["tag"] == "{{ADMINISTRATOR_2_NUME}} {{ADMINISTRATOR_2_PRENUME}}"


def test_id_necunoscut_de_la_model_e_ignorat():
    found = [blank(0)]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[
        ai_suggest._AiBlankSuggestion(id=999, scope="manual", label="inventat"),
    ])
    assert ai_suggest.suggest(found, client=FakeClient(parsed=parsed)) == []


def test_camp_necunoscut_aplicatiei_e_ignorat_nu_produce_tag_invalid():
    found = [blank(0)]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[
        ai_suggest._AiBlankSuggestion(id=0, scope="company", field="CAMP_INVENTAT_DE_MODEL"),
    ])
    assert ai_suggest.suggest(found, client=FakeClient(parsed=parsed)) == []


def test_person_fara_rol_e_ignorat():
    found = [blank(0)]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[
        ai_suggest._AiBlankSuggestion(id=0, scope="person", field="NUME_COMPLET", role=None),
    ])
    assert ai_suggest.suggest(found, client=FakeClient(parsed=parsed)) == []


def test_keep_nu_produce_nicio_sugestie():
    found = [blank(0)]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[
        ai_suggest._AiBlankSuggestion(id=0, scope="keep"),
    ])
    assert ai_suggest.suggest(found, client=FakeClient(parsed=parsed)) == []


def test_manual_foloseste_eticheta_data_de_model():
    found = [blank(0)]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[
        ai_suggest._AiBlankSuggestion(id=0, scope="manual", label="Număr de exemplare"),
    ])
    out = ai_suggest.suggest(found, client=FakeClient(parsed=parsed))
    assert out[0]["label"] == "Număr de exemplare"
    assert out[0]["tag"] == "{{CAMP_NUMAR_DE_EXEMPLARE}}"


def test_un_singur_apel_grupat_nu_unul_per_loc_liber():
    found = [blank(0), blank(1), blank(2)]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[])
    client = FakeClient(parsed=parsed)
    ai_suggest.suggest(found, client=client)
    assert len(client.models.calls) == 1
    assert "id=0" in client.models.calls[0]["contents"]
    assert "id=1" in client.models.calls[0]["contents"]
    assert "id=2" in client.models.calls[0]["contents"]


def test_cerere_per_camp_trimite_doar_id_ul_cerut_catre_gemini():
    """Cererea per câmp (ids={...}) ajunge chiar în prompt-ul trimis modelului — nu doar filtrată local,
    ca celelalte locuri needeslușite chiar să nu coste tokeni suplimentari."""
    found = [blank(0), blank(1), blank(2)]
    parsed = ai_suggest._AiSuggestResponse(suggestions=[])
    client = FakeClient(parsed=parsed)
    ai_suggest.suggest(found, client=client, ids={1})
    assert len(client.models.calls) == 1
    prompt = client.models.calls[0]["contents"]
    assert "id=1" in prompt and "id=0" not in prompt and "id=2" not in prompt
