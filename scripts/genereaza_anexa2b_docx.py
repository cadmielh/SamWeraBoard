"""Generează șablonul DOCX „Anexa 2b - Cerere înregistrare în registrul comerțului (PFA, II, IF)” din formularul oficial ONRC.

Formularul oficial e un PDF (fisiere_template/Șabloane Av Laura Pascu/Anexa 2b …pdf). Documentul de aici îi reproduce
cele 4 pagini, cu aceleași convenții ca Anexa 2a (construcția comună: scripts/onrc_docx_common.py), cu prefixul A2B_:
  {{A2B_B_…}}  casetă ☐/☒
  {{A2B_O_…}}  opțiune rotundă ○/●
  {{A2B_…}}    text (gol = puncte, ca în formularul oficial; vezi frontend/src/lib/anexa2bFiller.ts)

Toate etichetele sunt completate de formularul dedicat (Anexa2bFiller), nu de completarea generică.
Rulare:  venv/bin/python scripts/genereaza_anexa2b_docx.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from onrc_docx_common import (  # noqa: E402
    P, ROOT, _no_split, box, cell_P, document_nou, grid, note, persoana_text, salveaza, semnaturi,
)

OUT = ROOT / "fisiere_template" / "Anexa 2b - Cerere înregistrare în registrul comerțului (PFA, II, IF).docx"
TAGS_OUT = ROOT / "frontend" / "src" / "lib" / "anexa2bFiller.placeholders.json"

# Numărul de rânduri din tabelele formularului (obiect de activitate, opis).
CAEN_RANDURI = {"INREG": 9, "RENUNTARE": 4, "COMPLETARE": 4}
OPIS_TIPARITE = [
    "Documente care atestă pregătire/experiența profesională",
    "Dovadă sediu profesional",
    "Acord de constituire",
    "Declarația pe propria răspundere privind participarea în mod obișnuit a soției/soțului la activitatea desfășurată "
    "de întreprinderea individuală/persoana fizică autorizată",
    "Anexa nr. 1 Declarație pe propria răspundere privind îndeplinirea condițiilor de funcționare/desfășurare a activității",
    "Anexa nr. 2 referitor la înregistrarea fiscală",
    "Împuternicire",
]
OPIS_RANDURI = 11


def firma_block(cell, pre, nrreg=True, indent=0.3):
    """„pentru firma … număr de înregistrare … CUI … EUID …, cu sediul profesional în: …” (punctele 2–5)."""
    reg = (f", număr de înregistrare {{{{{pre}_NRREG}}}}, CUI {{{{{pre}_CUI}}}}, EUID {{{{{pre}_EUID}}}}" if nrreg else "")
    cell_P(cell, f"**pentru firma:** {{{{{pre}_FIRMA}}}}{reg}, cu **sediul profesional** în: localitatea {{{{{pre}_LOC}}}}, "
                 f"str. {{{{{pre}_STR}}}}, nr. {{{{{pre}_NR}}}}, bloc {{{{{pre}_BL}}}}, scara {{{{{pre}_SC}}}}, etaj {{{{{pre}_ET}}}}, "
                 f"ap. {{{{{pre}_AP}}}}, județ/sector {{{{{pre}_JUD}}}}, e-mail {{{{{pre}_EMAIL}}}}, telefon {{{{{pre}_TEL}}}}, "
                 f"pagina de internet (dacă există) {{{{{pre}_WEB}}}}", indent=indent, line=1.35)


def persoana_cu_calitate(pre):
    return (persoana_text(pre, regim=True) +
            f", în calitate de {{{{{pre}_CALITATE}}}}, prin {{{{{pre}_PRIN}}}}, conform {{{{{pre}_CONFORM}}}}")


# ── Pagina 1 ────────────────────────────────────────────────────────────────────────────────────────────────────────

def antet(doc):
    P(doc, "**ANEXA Nr. 2b**", align="r", size=11, after=2)
    t = grid(doc, [4.6, 9.6, 4.2], style="Table Grid")
    c1, c2, c3 = t.rows[0].cells
    cell_P(c1, "**I.**", align="l")
    cell_P(c1, "**MINISTERUL JUSTIȚIEI**", align="c", before=6)
    cell_P(c1, "**OFICIUL NAȚIONAL AL REGISTRULUI COMERȚULUI**", align="c", before=6)
    cell_P(c1, "**OFICIUL REGISTRULUI COMERȚULUI DE PE LÂNGĂ TRIBUNALUL**", align="c", before=6)
    cell_P(c1, "{{A2B_ORC_TRIBUNAL}}", align="c", before=4)

    cell_P(c2, "**II.**", align="l")
    cell_P(c2, "**CERERE**", align="c", size=11)
    cell_P(c2, "**înregistrare în registrul comerțului**", align="c", after=4)
    cell_P(c2, "{{A2B_B_ENT_PFA}} **PFA**   {{A2B_B_ENT_II}} **Întreprindere Individuală**   {{A2B_B_ENT_IF}} **Întreprindere "
               "Familială**", align="c", after=6)
    for tag, label in (("INREGISTRARE", "înregistrare"),
                       ("MENTIUNI", "înscriere mențiuni"),
                       ("OPERATIUNI", "înscriere operațiuni comunicate de autoritatea / instituția publică"),
                       ("RADIERE", "radiere"),
                       ("EROARE", "îndreptare eroare materială"),
                       ("CAEN", "actualizare obiect de activitate conform CAEN Rev. 3")):
        cell_P(c2, f"{{{{A2B_B_TIP_{tag}}}}} {label}", align="l", line=1.1)

    cell_P(c3, "**III.**", align="l")
    cell_P(c3, "..............................", align="c", before=24)
    cell_P(c3, "(Nr. înregistrare)", align="c", size=8)
    cell_P(c3, "......................", align="c", before=24)
    cell_P(c3, "(Data)", align="c", size=8)


def sectiunile_iv_vi(doc):
    c = box(doc)
    cell_P(c, "**IV. Subsemnatul(a)^(1)^**", align="l")
    cell_P(c, persoana_cu_calitate("A2B_SUB"), indent=0.3, line=1.35)

    c = box(doc)
    cell_P(c, "**V. Membri întreprindere familială^(2)^**", align="l")
    cell_P(c, persoana_cu_calitate("A2B_M1"), indent=0.3, line=1.35, after=4)
    cell_P(c, persoana_cu_calitate("A2B_M2"), indent=0.3, line=1.35)

    c = box(doc)
    cell_P(c, "**În temeiul Legii nr. 265/2022 privind registrul comerțului și pentru modificarea și completarea altor acte "
              "normative cu incidență asupra înregistrării în registrul comerțului, solicit:**")

    c = box(doc)
    cell_P(c, "**VI. Obiectul cererii privind înregistrarea în registrul comerțului, prevăzut în^(3)^** {{A2B_ACT_TEMEI}} "
              "**constă în:**", align="l")


def punctul_1(doc):
    c = box(doc)
    cell_P(c, "**1. {{A2B_B_S1}} Înregistrare^(4)^**", align="l", keep=True)
    firma_block(c, "A2B_S1", nrreg=False)


# Punctul 2.1, pe un singur șir de rânduri, ca în formular.
RANDURI_21 = [
    "{{A2B_B_21_DENUMIRE}} denumire   {{A2B_B_21_OBIECT}} obiect de activitate   {{A2B_B_21_ACORD}} acord de constituire   "
    "{{A2B_B_21_PATRIMONIU}} patrimoniu de afectațiune",
    "{{A2B_B_21_SEDII_PL}} sedii secundare (puncte de lucru)   {{A2B_B_21_MEMBRU}} reprezentant / membru întreprindere "
    "familială:  {{A2B_O_21_COOPTARE}} cooptare  {{A2B_O_21_RETRAGERE}} retragere",
    "{{A2B_B_21_REGIM}} schimbare regim juridic din {{A2B_T_21_REGIM_DIN}} în {{A2B_T_21_REGIM_IN}}",
    "{{A2B_B_21_SEDIU}} schimbarea sediului profesional în: localitatea {{A2B_T_21_SEDIU_LOC}}, str. {{A2B_T_21_SEDIU_STR}}, "
    "nr. {{A2B_T_21_SEDIU_NR}}, bloc {{A2B_T_21_SEDIU_BL}}, scara {{A2B_T_21_SEDIU_SC}}, etaj {{A2B_T_21_SEDIU_ET}}, "
    "ap. {{A2B_T_21_SEDIU_AP}}, județ/sector {{A2B_T_21_SEDIU_JUD}}, cod poștal {{A2B_T_21_SEDIU_CP}}, telefon "
    "{{A2B_T_21_SEDIU_TEL}}, e-mail {{A2B_T_21_SEDIU_EMAIL}}, pagina de internet (dacă există) {{A2B_T_21_SEDIU_WEB}}.",
    "{{A2B_B_21_SPATIU}} Sediu profesional   {{A2B_O_21_SPATIU_PRELUNGIRE}} Prelungire valabilitate act de spațiu\n"
    "                                  {{A2B_O_21_SPATIU_MODIFICARE}} Modificare act de spațiu",
    "{{A2B_B_21_SEDII}} Sedii secundare:\n      {{A2B_O_21_SEDII_INF}} Înființare: nr. {{A2B_T_21_SEDII_INF_NR}}\n"
    "      {{A2B_O_21_SEDII_DESF}} Desființare: nr. {{A2B_T_21_SEDII_DESF_NR}}\n"
    "      {{A2B_O_21_SEDII_MOD}} Modificare/prelungire valabilitate: nr. {{A2B_T_21_SEDII_MOD_NR}}",
    "{{A2B_B_21_INTRERUPERE}} întrerupere temporară a activității până la data {{A2B_T_21_INTRERUPERE_DATA}}   "
    "{{A2B_B_21_RELUARE}} reluare activitate cu data de {{A2B_T_21_RELUARE_DATA}}",
    "{{A2B_B_21_SOT_PARTICIPARE}} participarea în mod obișnuit a soției/soțului la activitatea desfășurată de întreprinderea "
    "individuală/persoana fizică autorizată",
    "{{A2B_B_21_SOT_INCETARE}} încetarea activității soției/soțului la activitatea desfășurată de întreprinderea "
    "individuală/persoana fizică autorizată",
    "{{A2B_B_21_CONCORDAT}} Concordat preventiv   {{A2B_B_21_ACORD_RESTR}} Acord de restructurare preventivă   "
    "{{A2B_B_21_INSOLVENTA}} Insolvență   {{A2B_B_21_FALIMENT}} Faliment",
    "{{A2B_B_21_CONDAMNARE}} Condamnare penală",
    "{{A2B_B_21_ALTE}} Alte mențiuni {{A2B_T_21_ALTE}}",
]


def punctul_2(doc):
    c = box(doc)
    cell_P(c, "**2. {{A2B_B_S2}} Înscriere mențiuni**", align="l", keep=True)
    firma_block(c, "A2B_S2")
    cell_P(c, "**2.1. {{A2B_B_21}} Acte și fapte pentru care legea prevede obligația înscrierii**", align="l", before=4, after=3,
           keep=True)

    # ── Pagina 2 ──
    for txt in RANDURI_21:
        cell_P(c, txt, align="l", indent=0.3, line=1.25, after=2, size=9.5)

    c = box(doc)
    cell_P(c, "**2.2. {{A2B_B_22}} Depunere de acte:**", align="l", after=3, keep=True)
    for txt in ("{{A2B_B_22_PLANGERE}} Plângere^(5)^          {{A2B_B_22_RADIERE120}} Cerere radiere conform art. 120 din "
                "Legea nr. 265/2022",
                "{{A2B_B_22_HOT_JUD}} Hotărâre judecătorească^(6)^",
                "{{A2B_B_22_ACT_PROC}} Act procedural care redă dispozitivul hotărârii judecătorești^(6)^",
                "{{A2B_B_22_ART103}} Acte conform art. 103 din Legea 265/2022: {{A2B_T_22_ART103}}",
                "{{A2B_B_22_ALTE}} Alte înscrisuri: {{A2B_T_22_ALTE}}"):
        cell_P(c, txt, align="l", indent=0.3, line=1.25, after=3, size=9.5)

    c = box(doc)
    cell_P(c, "**2.3. {{A2B_B_23}} Declarație pe propria răspundere cu privire la îndeplinirea condițiilor de funcționare^(7)^.**",
           align="l")


def punctele_3_5(doc):
    c = box(doc)
    cell_P(c, "**3. {{A2B_B_S3}} Înscriere operațiuni comunicate de autoritatea/instituția publică** {{A2B_S3_AUTORITATE}}",
           align="l", keep=True)
    firma_block(c, "A2B_S3")

    c = box(doc)
    cell_P(c, "**4. {{A2B_B_S4}} Radiere**", align="l", keep=True)
    firma_block(c, "A2B_S4")
    cell_P(c, "__Motiv__:  {{A2B_B_S4_DECES}} deces   {{A2B_B_S4_CERERE}} la cerere   {{A2B_B_S4_ART120}} art. 120 din Legea "
              "nr. 265/2022", indent=0.3, before=2)

    c = box(doc)
    cell_P(c, "**5. {{A2B_B_S5}} Îndreptare eroare materială**", align="l", keep=True)
    firma_block(c, "A2B_S5")
    cell_P(c, "**referitoare la actul:** {{A2B_S5_ACT}}", indent=0.3, line=1.35)
    cell_P(c, "Pentru cererea/cererile nr./data {{A2B_S5_CERERE}} ({{A2B_B_S5_INREGISTRARE}} înregistrare "
              "{{A2B_B_S5_MENTIUNE}} mențiune {{A2B_B_S5_RADIERE}} radiere),", indent=0.3, line=1.35)
    cell_P(c, "În loc de: {{A2B_S5_IN_LOC_DE}}", indent=0.3, line=1.35)
    cell_P(c, "Se va înregistra: {{A2B_S5_SE_VA}}", indent=0.3, line=1.35)


def sectiunea_vii(doc):
    c = box(doc)
    cell_P(c, "**VII. Obiectul de activitate^(8)^:**  {{A2B_B_VII_INREGISTRARE}} înregistrare   {{A2B_B_VII_MODIFICARE}} "
              "modificare   {{A2B_B_VII_ACTUALIZARE}} actualizare obiect de activitate conform CAEN Rev. 3^(9)^", align="l")

    # ── Pagina 3 ──
    # Un singur tabel, cu titlurile pe rânduri întinse pe toată lățimea: tabelele imbricate într-un chenar sunt
    # restrânse după conținut de unele programe (și trag după ele chenarele următoare).
    blocuri = [("**1. Activitatea principală:**", ["A2B_CAEN_P"])]
    for cheie, label in (("INREG", "înregistrare"), ("RENUNTARE", "renunțare"), ("COMPLETARE", "completare")):
        titlu = f"{{{{A2B_B_CAEN_{cheie}}}}} {label}"
        if cheie == "INREG":
            titlu = "**2. Activități secundare:**\n" + titlu
        blocuri.append((titlu, [f"A2B_CAEN_{cheie}_{n}" for n in range(1, CAEN_RANDURI[cheie] + 1)]))

    P(doc, "", size=2, line=1.0)
    t = grid(doc, [3.0, 15.4], rows=sum(2 + len(r) for _, r in blocuri), style="Table Grid")
    i = 0
    for titlu, randuri in blocuri:
        row = t.rows[i].cells
        row[0].merge(row[1])
        cell_P(t.rows[i].cells[0], titlu, align="l", before=4)
        _no_split(t.rows[i])
        cell_P(t.rows[i + 1].cells[0], "**Clasa CAEN**", align="c")
        cell_P(t.rows[i + 1].cells[1], "**Denumire**", align="c")
        for k, pre in enumerate(randuri, i + 2):
            _no_split(t.rows[k])
            cell_P(t.rows[k].cells[0], f"{{{{{pre}_COD}}}}", align="c")
            cell_P(t.rows[k].cells[1], f"{{{{{pre}_DEN}}}}", align="l")
        i += 2 + len(randuri)


def sectiunile_viii_xi(doc):
    c = box(doc)
    cell_P(c, "**VIII. Sedii secundare (puncte de lucru):**", align="l")
    cell_P(c, "{{A2B_B_VIII_INF}} **înființare:** {{A2B_VIII_INF}}", indent=0.3, line=1.35)
    cell_P(c, "{{A2B_B_VIII_RAD}} **radiere:** {{A2B_VIII_RAD}}", indent=0.3, line=1.35)
    cell_P(c, "(localitate, județ/sector, stradă, număr, bloc, scară, etaj, apartament)", align="r", size=7)

    c = box(doc)
    cell_P(c, "**IX. Solicit:** {{A2B_B_AUDIENTA}} **audiență publică**   {{A2B_B_COPII}} **copii**   "
              "{{A2B_B_COPII_CERT}} **copii certificate de pe documentele** {{A2B_T_COPII_CERT}}", align="l", line=1.3)
    cell_P(c, "{{A2B_B_COMUNICARE}} **comunicarea** documentelor care atestă efectuarea înregistrării în registrul comerțului "
              "într-o singură modalitate**:**", indent=1.2, line=1.3)
    cell_P(c, "{{A2B_O_POSTA}} poștă   {{A2B_O_CURIER}} curier   {{A2B_O_ELECTRONIC}} mijloace electronice", align="c", line=1.3)
    cell_P(c, "{{A2B_O_SEDIU_ORCT}} sediul O.R.C.T. {{A2B_T_SEDIU_ORCT}}   {{A2B_O_PRIMARIE}} biroul de asistență și "
              "reprezentare al Primăriei {{A2B_T_PRIMARIE}}", align="c", line=1.3)

    c = box(doc)
    cell_P(c, "**X. Persoana pentru comunicare:**", align="l")
    cell_P(c, "Nume {{A2B_COM_NUME}} Prenume {{A2B_COM_PRENUME}}, adresa: localitatea {{A2B_COM_LOC}}, str. {{A2B_COM_STR}}, "
              "nr. {{A2B_COM_NR}}, bloc {{A2B_COM_BL}}, scara {{A2B_COM_SC}}, etaj {{A2B_COM_ET}}, ap. {{A2B_COM_AP}}, "
              "județ/sector {{A2B_COM_JUD}}, cod poștal {{A2B_COM_CP}}, telefon {{A2B_COM_TEL}}, e-mail {{A2B_COM_EMAIL}}",
           indent=0.8, line=1.35)

    c = box(doc)
    cell_P(c, "**XI. Date de facturare^(10)^:**", align="l")
    cell_P(c, "Nume și Prenume/ firmă {{A2B_FACT_NUME}}, CNP/CUI {{A2B_FACT_CNP_CUI}}, e-mail {{A2B_FACT_EMAIL}}, "
              "Banca {{A2B_FACT_BANCA}}, CONT IBAN {{A2B_FACT_IBAN}}, Sediul profesional/Adresa {{A2B_FACT_ADRESA}}",
           indent=0.8, line=1.35)


# ── Pagina 4 ────────────────────────────────────────────────────────────────────────────────────────────────────────

def sectiunile_xii_xv(doc):
    P(doc, "", size=2, line=1.0)
    t = grid(doc, [1.2, 8.6, 6.8, 1.8], rows=OPIS_RANDURI + 3, style="Table Grid")
    hdr = t.rows[0].cells
    hdr[0].merge(hdr[3])
    cell_P(t.rows[0].cells[0], "**XII.                                                    OPIS DE DOCUMENTE DEPUSE**", align="l")
    for i, txt in enumerate(("**Nr. crt.**", "**Denumirea actului**", "**Nr. și data actului / Emitent**", "**Nr. file**")):
        cell_P(t.rows[1].cells[i], txt, align="c" if i != 1 else "l")
    for n in range(1, OPIS_RANDURI + 1):
        row = t.rows[n + 1].cells
        _no_split(t.rows[n + 1])
        cell_P(row[0], f"**{n}.**", align="l")
        den = OPIS_TIPARITE[n - 1] if n <= len(OPIS_TIPARITE) else f"{{{{A2B_OPIS_{n}_DEN}}}}"
        cell_P(row[1], den, align="l")
        cell_P(row[2], f"{{{{A2B_OPIS_{n}_NRDATA}}}}", align="l")
        cell_P(row[3], f"{{{{A2B_OPIS_{n}_FILE}}}}", align="c")
    last = t.rows[OPIS_RANDURI + 2].cells
    last[0].merge(last[2])
    cell_P(t.rows[OPIS_RANDURI + 2].cells[0], "**Total file :**", align="r")
    cell_P(t.rows[OPIS_RANDURI + 2].cells[3], "{{A2B_OPIS_TOTAL}}", align="c")

    c = box(doc)
    cell_P(c, "**XIII. Prelucrarea^(11)^ datelor cu caracter personal**", align="l")
    cell_P(c, "Am fost informat cu privire la prelucrarea datelor cu caracter personal efectuată în scopul soluționării "
              "prezentei cereri.", indent=0.5, after=8)
    semnaturi(c, [("{{A2B_XIII_NUME}}", "(Nume și prenume)"), ("{{A2B_XIII_DATA}}", "(Data)"), ("……………………………", "(Semnătura)")])

    c = box(doc)
    cell_P(c, "**XIV. Anexele nr. {{A2B_ANEXE}} fac parte integrantă din prezenta cerere.**", align="l")
    cell_P(c, "**Întocmită într-un exemplar, pe propria răspundere, cunoscând că declarațiile inexacte sunt pedepsite conform "
              "legii.**", indent=0.5, after=8)
    semnaturi(c, [("{{A2B_XIV_DATA}}", "(Data)"), ("", ""), ("……………………………", "(Semnătura^(12)^)")])

    c = box(doc)
    cell_P(c, "**XV. Prezenta cerere de înregistrare și documentele în susținerea acesteia se depun de către^(13)^:**", align="l")
    cell_P(c, "Nume {{A2B_DEP_NUME}} Prenume {{A2B_DEP_PRENUME}}, posesor al actului de identitate {{A2B_DEP_ACT_TIP}} seria "
              "{{A2B_DEP_ACT_SERIA}} nr. {{A2B_DEP_ACT_NR}} CNP {{A2B_DEP_CNP}}, în calitate de {{A2B_DEP_CALITATE}}, conform "
              "{{A2B_DEP_CONFORM}} nr. {{A2B_DEP_CONFORM_NR}}, din {{A2B_DEP_CONFORM_DATA}}", indent=0.8, line=1.35)
    cell_P(c, "**Am fost informat cu privire la prelucrarea datelor cu caracter personal^(11)^ efectuată în scopul soluționării "
              "prezentei cereri.**", indent=0.8, size=9, after=8)
    semnaturi(c, [("{{A2B_DEP_DATA}}", "(Data)"), ("", ""), ("……………………………", "(Semnătura)")])


NOTE = [
    "1.1. Cererea de înregistrare a persoanei fizice autorizate și a întreprinderii individuale se semnează de persoana fizică "
    "care solicită înregistrarea ca persoană fizică autorizată, respectiv de titularul întreprinderii individuale, personal sau "
    "prin împuternicit cu procură specială/generală și autentică, sau de avocat, cu împuternicire avocațială.\n"
    "1.2. Cererea de înregistrare a întreprinderii familiale se semnează de reprezentantul desemnat prin acordul de constituire "
    "sau de împuternicitul acestuia cu procură specială/generală și autentică sau de avocat, cu împuternicire avocațială.\n"
    "1.3. Cererea de înregistrare de mențiuni se semnează de persoana fizică autorizată, titularul întreprinderii individuale, "
    "respectiv de reprezentantul întreprinderii familiale desemnat prin acordul de constituire sau împuternicitul acestora.",
    "In situația în care sunt mai mult de doi membri, se va completa în mod corespunzător o anexă cu datele de identificare ale "
    "acestora, conform Secțiunii V.",
    "Se completează cu denumirea actului (acord de constituire, declarația pe propria răspundere privind participarea în mod "
    "obișnuit a soției/soțului la activitatea desfășurată de întreprinderea individuală/persoana fizică autorizată etc).",
    "Solicitantul trebuie să depună, odată cu cererea de înregistrare, și declarația pe propria răspundere cu privire la "
    "îndeplinirea condițiilor de funcționare/desfășurare a activității pentru sediul profesional și/sau sedii secundare sau, "
    "după caz, la terți.",
    "Împotriva încheierii registratorului se poate formula plângere în temeiul art.112 din Legea nr. 265/2022 .",
    "Hotărârea judecătorească invocată se depune spre a fi menționată în registrul comerțului. În cazul în care prin hotărârea "
    "judecătorească se dispune efectuarea înregistrărilor în registrul comerțului, se va completa Secțiunea VI, Subsecțiunea 2.1.",
    "Dacă se modifică obiectul de activitate ori activitățile autorizate, sediul profesional sau se înființează noi sedii "
    "secundare (puncte de lucru), precum și în situația întreruperii temporare de activitate sau a reluării acesteia, "
    "solicitantul depune la biroul unic din cadrul oficiului registrului comerțului o nouă declarație pentru sediul profesional "
    "și/sau sedii secundare (puncte de lucru), după caz, la terți, corespunzătoare modificărilor intervenite și care să ateste "
    "situația curentă pentru desfășurarea tuturor activităților declarate în obiectul de activitate.",
    "În situația în care sunt mai multe activități, se va completa în mod corespunzător o anexă cu clasele CAEN si denumirile "
    "acestora, conform Secțiunii VI. Subsecțiunea 3.",
    "În cazul în care se realizează exclusiv actualizarea obiectului de activitate potrivit CAEN Rev. 3 fără să se fi modificat "
    "obiectul de activitate, se completează doar rubrica VII (Obiectul de activitate - actualizare) pct. 1 (Activitate principală).",
    "Factura fiscală se emite pentru persoana indicată, iar în cazul în care nu sunt completate datele de facturare, aceasta se "
    "emite pe numele persoanei care efectuează plata.",
    "Potrivit art. 4 punctul 2. din Regulamentul (UE) nr. 679/2016 al Parlamentului European și al Consiliului Uniunii Europene "
    "privind protecția persoanelor fizice în ceea ce privește prelucrarea datelor cu caracter personal și privind libera "
    "circulație a acestor date și de abrogare a Directivei 95/46/CE (Regulamentul general privind protecția datelor), publicat "
    "în Jurnalul Oficial nr. 119L/04.05.2016, prin \"prelucrare\" se înțelege orice operațiune sau set de operațiuni efectuate "
    "asupra datelor cu caracter personal sau asupra seturilor de date cu caracter personal, cu sau fără utilizarea de mijloace "
    "automatizate, cum ar fi colectarea, înregistrarea, organizarea, structurarea, stocarea, adaptarea sau modificarea, "
    "extragerea, consultarea, utilizarea, divulgarea prin transmitere, diseminarea sau punerea la dispoziție în orice alt mod, "
    "alinierea sau combinarea, restricționarea, ștergerea sau distrugerea.",
    "Prin semnarea cererii de înregistrare în registrul comerțului/acordului de constituire, persoanele fizice care solicită "
    "înregistrarea ca persoană fizică autorizată, întreprindere individuală, întreprindere familială își asumă răspunderea că nu "
    "sunt incapabile și că nu li s-a interzis prin hotărâre judecătorească definitivă dreptul de a exercita calitatea de persoană "
    "fizică autorizată, titular al întreprinderii individuale, membru al întreprinderii familiale, ca pedeapsa complementară a "
    "condamnării pentru infracțiuni contra patrimoniului prin nesocotirea încrederii, infracțiuni de corupție, delapidare, "
    "infracțiuni de fals în înscrisuri, evaziune fiscală, infracțiuni prevăzute de Legea nr. 129/2019 pentru prevenirea și "
    "combaterea spălării banilor și finanțării terorismului, precum și pentru modificarea și completarea unor acte normative, "
    "cu modificările și completările ulterioare",
    "Se va completa de către deponent numai dacă este altă persoană decât semnatarul cererii.",
]


def main():
    doc = document_nou()
    antet(doc)
    sectiunile_iv_vi(doc)
    punctul_1(doc)
    punctul_2(doc)
    punctele_3_5(doc)
    sectiunea_vii(doc)
    sectiunile_viii_xi(doc)
    sectiunile_xii_xv(doc)
    note(doc, NOTE)
    salveaza(doc, "Anexa 2b - Cerere înregistrare în registrul comerțului - PFA, II, IF", OUT, TAGS_OUT)


if __name__ == "__main__":
    sys.exit(main())
