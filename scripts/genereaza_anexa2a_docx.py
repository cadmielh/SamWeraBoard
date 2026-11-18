"""Generează șablonul DOCX „Anexa 2a - Cerere înregistrare în registrul comerțului (PJ)” din formularul oficial ONRC.

Formularul oficial e un PDF (fisiere_template/Șabloane Av Laura Pascu/Anexa 2a …pdf). Documentul de aici îi reproduce
cele 4 pagini, cu etichete în locul punctelor și al casetelor:
  {{A2A_B_…}}  casetă ☐/☒
  {{A2A_O_…}}  opțiune rotundă ○/●
  {{A2A_…}}    text (gol = puncte, ca în formularul oficial; vezi frontend/src/lib/anexa2aFiller.ts)

Toate etichetele sunt completate de formularul dedicat (Anexa2aFiller), nu de completarea generică.
Rulare:  venv/bin/python scripts/genereaza_anexa2a_docx.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from onrc_docx_common import (  # noqa: E402
    P, ROOT, _no_split, box, cell_P, document_nou, grid, note, persoana_text, salveaza, semnaturi,
)

OUT = ROOT / "fisiere_template" / "Anexa 2a - Cerere înregistrare în registrul comerțului.docx"
# Lista etichetelor din document, pentru testul care verifică că formularul le completează pe toate
# (fisiere_template/ nu e în git, deci testul din frontend nu poate citi documentul).
TAGS_OUT = ROOT / "frontend" / "src" / "lib" / "anexa2aFiller.placeholders.json"

# ── Blocuri repetate în formular ────────────────────────────────────────────────────────────────────────────────────

def firma_block(cell, pre, euid=True, indent=0.3):
    """„pentru firma … număr de înregistrare … CUI … EUID …, cu sediul social în: …” (punctele 4–8)."""
    reg = f"număr de înregistrare {{{{{pre}_NRREG}}}}, CUI {{{{{pre}_CUI}}}}" + (f", EUID {{{{{pre}_EUID}}}}" if euid else "")
    cell_P(cell, f"**pentru firma:** {{{{{pre}_FIRMA}}}}, {reg}, cu **sediul social** în: localitatea {{{{{pre}_LOC}}}}, "
                 f"str. {{{{{pre}_STR}}}}, nr. {{{{{pre}_NR}}}}, bloc {{{{{pre}_BL}}}}, scara {{{{{pre}_SC}}}}, etaj {{{{{pre}_ET}}}}, "
                 f"ap. {{{{{pre}_AP}}}}, județ/sector {{{{{pre}_JUD}}}}, e-mail {{{{{pre}_EMAIL}}}}, telefon {{{{{pre}_TEL}}}}, "
                 f"pagina de internet (dacă există) {{{{{pre}_WEB}}}}", indent=indent, line=1.35)


def sediu_sucursala(cell, pre):
    cell_P(cell, f"**Firma sucursalei:** {{{{{pre}_FIRMA}}}}", indent=0.3, line=1.35)
    cell_P(cell, f"**Sediul sucursalei în:** localitatea {{{{{pre}_LOC}}}}, str. {{{{{pre}_STR}}}}, nr. {{{{{pre}_NR}}}}, "
                 f"bloc {{{{{pre}_BL}}}}, scara {{{{{pre}_SC}}}}, etaj {{{{{pre}_ET}}}}, ap. {{{{{pre}_AP}}}}, "
                 f"județ/sector {{{{{pre}_JUD}}}}, e-mail {{{{{pre}_EMAIL}}}}, telefon {{{{{pre}_TEL}}}}", indent=0.3, line=1.35)


# ── Pagina 1 ────────────────────────────────────────────────────────────────────────────────────────────────────────

def antet(doc):
    P(doc, "**ANEXA Nr. 2a**", align="r", size=11, after=2)
    t = grid(doc, [4.6, 9.6, 4.2], style="Table Grid")
    c1, c2, c3 = t.rows[0].cells
    cell_P(c1, "**I.**", align="l")
    cell_P(c1, "**MINISTERUL JUSTIȚIEI**", align="c", before=6)
    cell_P(c1, "**OFICIUL NAȚIONAL AL REGISTRULUI COMERȚULUI**", align="c", before=6)
    cell_P(c1, "**OFICIUL REGISTRULUI COMERȚULUI DE PE LÂNGĂ TRIBUNALUL**", align="c", before=6)
    cell_P(c1, "{{A2A_ORC_TRIBUNAL}}", align="c", before=4)

    cell_P(c2, "**II.**", align="l")
    cell_P(c2, "**CERERE**", align="c", size=11)
    cell_P(c2, "**înregistrare în registrul comerțului**", align="c")
    cell_P(c2, "**-persoane juridice-**", align="c", after=6)
    for tag, label in (("INMATRICULARE", "înmatriculare"),
                       ("SUCURSALA_RO", "înregistrare sucursală persoană juridică română"),
                       ("SUCURSALA_STRAINA", "înregistrare sucursală persoană juridică străină"),
                       ("MENTIUNI", "înscriere mențiuni"),
                       ("OPERATIUNI", "înscriere operațiuni comunicate de autoritatea / instituția publică"),
                       ("RADIERE", "radiere"),
                       ("EROARE", "îndreptare eroare materială"),
                       ("CAEN", "actualizare obiect de activitate conform CAEN Rev. 3")):
        cell_P(c2, f"{{{{A2A_B_TIP_{tag}}}}} {label}", align="l", line=1.1)

    cell_P(c3, "**III.**", align="l")
    cell_P(c3, "..............................", align="c", before=24)
    cell_P(c3, "(Nr. înregistrare)", align="c", size=8)
    cell_P(c3, "......................", align="c", before=24)
    cell_P(c3, "(Data)", align="c", size=8)


def sectiunea_iv(doc):
    c = box(doc)
    cell_P(c, "**IV. Subsemnatul(a)^(1)^**", align="l")
    cell_P(c, persoana_text("A2A_SUB", regim=True) +
           ", în calitate de {{A2A_SUB_CALITATE}}, prin {{A2A_SUB_PRIN}}, conform {{A2A_SUB_CONFORM}}", indent=0.3, line=1.35)

    c = box(doc)
    cell_P(c, "**În temeiul Legii nr. 265/2022 privind registrul comerțului și pentru modificarea și completarea altor acte "
              "normative cu incidență asupra înregistrării în registrul comerțului, solicit:**")

    c = box(doc)
    cell_P(c, "**V. Obiectul cererii privind înregistrarea în registrul comerțului, prevăzut în^(2)^** {{A2A_ACT_TEMEI}} "
              "**constă în:**", align="l")


def punctul_1(doc):
    c = box(doc)
    cell_P(c, "**1. {{A2A_B_S1}} Înmatriculare^(3)^**", align="l", keep=True)
    cell_P(c, "**pentru firma:** {{A2A_S1_FIRMA}}, **cu sediul social în:** localitatea {{A2A_S1_LOC}}, str. {{A2A_S1_STR}}, "
              "nr. {{A2A_S1_NR}}, bloc {{A2A_S1_BL}}, scara {{A2A_S1_SC}}, etaj {{A2A_S1_ET}}, ap. {{A2A_S1_AP}}, "
              "județ/sector {{A2A_S1_JUD}}, e-mail {{A2A_S1_EMAIL}}, telefon {{A2A_S1_TEL}}, pagina de internet (dacă există) "
              "{{A2A_S1_WEB}}", indent=0.3, line=1.35)


def punctul_2(doc):
    c = box(doc)
    cell_P(c, "**2. {{A2A_B_S2}} Înregistrare sucursală persoană juridică română^(3)^**", align="l", keep=True)
    sediu_sucursala(c, "A2A_S2")
    cell_P(c, "**Reprezentantul persoanei juridice care deschide sucursala:**", indent=0.3, keep=True)
    cell_P(c, persoana_text("A2A_S2_RD"), indent=0.3, line=1.35)
    cell_P(c, "**Reprezentantul persoanei juridice care se ocupă nemijlocit de activitatea sucursalei:**", indent=0.3, keep=True)
    cell_P(c, persoana_text("A2A_S2_RN") + ", cu puteri conferite ce urmează a se exercita, {{A2A_B_S2_IMPREUNA}} împreună sau "
              "{{A2A_B_S2_SEPARAT}} separat, conform actului de înființare.", indent=0.3, line=1.35)
    cell_P(c, "**Persoana juridică ce deschide sucursala** este înregistrată la ORCT {{A2A_S2_PJ_ORCT}}, denumire {{A2A_S2_PJ_DEN}}, "
              "număr de înmatriculare {{A2A_S2_PJ_NRREG}}, CUI {{A2A_S2_PJ_CUI}}", indent=0.3, before=4, line=1.35)


# ── Pagina 2 ────────────────────────────────────────────────────────────────────────────────────────────────────────

def punctul_3(doc):
    c = box(doc)
    cell_P(c, "**3. {{A2A_B_S3}} Înregistrare sucursală persoană juridică străină^(3)^**", align="l", keep=True)
    cell_P(c, "**Firma și forma juridică a persoanei juridice din străinătate** {{A2A_S3_PJS_FIRMA}}, înmatriculată în registrul "
              "din țara {{A2A_S3_PJS_TARA}}, număr de înregistrare {{A2A_S3_PJS_NRREG}}, EUID {{A2A_S3_PJS_EUID}}, reprezentant "
              "persoană juridică din străinătate: Nume {{A2A_S3_RS_NUME}}, Prenume {{A2A_S3_RS_PRENUME}}, act identitate "
              "{{A2A_S3_RS_ACT_TIP}}, seria {{A2A_S3_RS_ACT_SERIA}}, nr. {{A2A_S3_RS_ACT_NR}}, emis(ă) de {{A2A_S3_RS_ACT_EMIS}}, "
              "la data {{A2A_S3_RS_ACT_DATA}}, valabil până la data {{A2A_S3_RS_ACT_VALABIL}}, în calitate de {{A2A_S3_RS_CALITATE}}",
           indent=0.3, line=1.35)
    sediu_sucursala(c, "A2A_S3")
    cell_P(c, "**Reprezentanții persoanei juridice care se ocupă nemijlocit de activitatea sucursalei:**", indent=0.3, keep=True)
    cell_P(c, persoana_text("A2A_S3_RN") + ", cu puteri ce urmează a fi exercitate {{A2A_B_S3_IMPREUNA}} împreună sau "
              "{{A2A_B_S3_SEPARAT}} separat, conform actului constitutiv.", indent=0.3, line=1.35)
    cell_P(c, "**Legea națională aplicabilă persoanei juridice (în cazul sucursalelor persoanelor juridice din state care nu sunt "
              "state membre ale Uniunii Europene sau state participante la Spațiul Economic European)** {{A2A_S3_LEGE}}",
           indent=0.3, line=1.35)


# Punctul 4.1, pe două coloane, ca în formular. Fiecare rând: textul cu etichetele lui.
COL_41_STANGA = [
    "{{A2A_B_41_DENUMIRE}} Modificare denumire firmă",
    "{{A2A_B_41_FORMA}} Schimbare formă juridică",
    "{{A2A_B_41_SEDIU}} Schimbare sediu social în: județ {{A2A_T_41_SEDIU_JUDET}}",
    "{{A2A_B_41_SPATIU}} Sediu social   {{A2A_O_41_SPATIU_PRELUNGIRE}} Prelungire valabilitate act de spațiu\n"
    "                          {{A2A_O_41_SPATIU_MODIFICARE}} Modificare act de spațiu",
    "{{A2A_B_41_SEDII}} Sedii secundare:\n      {{A2A_O_41_SEDII_INF}} Înființare: nr. {{A2A_T_41_SEDII_INF_NR}}\n"
    "      {{A2A_O_41_SEDII_DESF}} Desființare: nr. {{A2A_T_41_SEDII_DESF_NR}}\n"
    "      {{A2A_O_41_SEDII_MOD}} Modificare/prelungire valabilitate: nr. {{A2A_T_41_SEDII_MOD_NR}}",
    "{{A2A_B_41_DURATA}} Durată funcționare:  {{A2A_O_41_DURATA_PREL}} Prelungire  {{A2A_O_41_DURATA_RED}} Reducere",
    "{{A2A_B_41_SUSPENDARE}} Suspendare activitate / {{A2A_B_41_RELUARE}} Reluare activitate",
    "{{A2A_B_41_OBIECT}} Modificare obiect de activitate",
    "{{A2A_B_41_TRANSMITERE}} Transmitere părți sociale/acțiuni/părți de interes:\n      __nr. {{A2A_T_41_TRANSMITERE_NR}} "
    "asociat/acționar/membru care intră în societate__",
    "{{A2A_B_41_BENEFICII}} Participare la beneficii și pierderi",
    "{{A2A_B_41_ORGANE}} Schimbare membri organe de conducere/administrare/control:\n      __nr. persoane {{A2A_T_41_ORGANE_NR}} "
    "numite administrator, director, membru consiliu de supraveghere/membru al directoratului, împuternicite să reprezinte "
    "sucursala, cenzor etc.__",
    "{{A2A_B_41_ASOCIAT}} Asociat/Acționar:  {{A2A_O_41_EXCLUDERE}} Excludere  {{A2A_O_41_RETRAGERE}} Retragere",
    "{{A2A_B_41_CAPITAL}} Capital social:  {{A2A_O_41_MAJORARE}} Majorare  {{A2A_O_41_REDUCERE}} Reducere",
    "{{A2A_B_41_DATE_ID}} Modificare date de identificare ale profesionistului",
    "{{A2A_B_41_REGIM}} Modificare regim matrimonial",
]
COL_41_DREAPTA = [
    "{{A2A_B_41_RENUNTARE}} Renunțare mandat:  {{A2A_O_41_REN_ADMIN}} Administratori\n"
    "      {{A2A_O_41_REN_IMPUTERNICITI}} Persoane împuternicite  {{A2A_O_41_REN_CENZORI}} Cenzori",
    "{{A2A_B_41_GIE}} Modificări acte constitutive GIE/GEIE",
    "{{A2A_B_41_SE}} Transformare societate pe acțiuni în SE",
    "{{A2A_B_41_SE_SEDIU}} Transfer sediu social SE într-un alt stat membru",
    "{{A2A_B_41_DIVIZARE}} Divizare / {{A2A_B_41_FUZIUNE}} Fuziune: nr. profesioniști participanți {{A2A_T_41_FUZIUNE_NR}}",
    "{{A2A_B_41_CERT}} Certificat prealabil în operațiune transfrontalieră\n      {{A2A_O_41_CERT_FUZIUNE}} Fuziune/ "
    "{{A2A_O_41_CERT_DIVIZARE}} divizare/ {{A2A_O_41_CERT_TRANSFORMARE}} transformare",
    "{{A2A_B_41_TF_FUZIUNE}} Fuziune / {{A2A_B_41_TF_DIVIZARE}} divizare / {{A2A_B_41_TF_TRANSFORMARE}} transformare "
    "transfrontalieră",
    "{{A2A_B_41_DIZOLVARE}} Dizolvare",
    "{{A2A_B_41_LICHIDATOR}} Numire lichidator",
    "{{A2A_B_41_CONSTATARE}} Constatare dizolvare, art. 237^2^ din Legea nr. 31/1990",
    "{{A2A_B_41_PRESCHIMBARE}} Preschimbare certificat de înregistrare",
    "{{A2A_B_41_ASIGURATORII}} Înființare:  {{A2A_O_41_SECHESTRU}} sechestru asigurător  {{A2A_O_41_POPRIRE}} poprire\n      "
    "{{A2A_O_41_ALTE_ASIG}} alte măsuri asigurătorii",
    "{{A2A_B_41_MASURI}} Măsuri:  {{A2A_O_41_PREVENTIVE}} preventive  {{A2A_O_41_COMPLEMENTARE}} complementare",
    "{{A2A_B_41_CONDAMNARE}} Condamnare penală definitivă",
    "{{A2A_B_41_CONCORDAT}} Concordat preventiv:\n      {{A2A_O_41_CONC_DESCH}} deschidere  {{A2A_O_41_CONC_INCH}} închidere  "
    "{{A2A_O_41_CONC_ALTE}} alte mențiuni {{A2A_T_41_CONC_ALTE}}",
    "{{A2A_B_41_ACORD}} Confirmare acord de restructurare preventivă",
    "{{A2A_B_41_INSOLVENTA}} Insolvență  {{A2A_B_41_REORGANIZARE}} Reorganizare judiciară  {{A2A_B_41_FALIMENT}} Faliment\n"
    "      {{A2A_O_41_INS_DESCH}} deschidere  {{A2A_O_41_INS_INCH}} închidere  {{A2A_O_41_INS_ALTE}} alte mențiuni {{A2A_T_41_INS_ALTE}}",
    "{{A2A_B_41_EXTRAS}} Extras din registrul acționarilor^(4)^",
    "{{A2A_B_41_AC_ACTUALIZAT}} Depunere act constitutiv actualizat",
]

COL_42_STANGA = [
    "{{A2A_B_42_VARSAMANT}} Dovadă vărsământ capital social",
    "{{A2A_B_42_PROSPECT}} Prospect de emisiune acțiuni prin subscripție publică:\n      {{A2A_O_42_PROSPECT_CONST}} constituire  "
    "{{A2A_O_42_PROSPECT_MAJ}} majorare capital S.A.",
    "{{A2A_B_42_HOTARARE}} Hotărâre AGA/ Decizie C.A. /Decizie directorat privind:\n      {{A2A_O_42_H_MAJ}} majorare capital   {{A2A_O_42_H_RED}} reducere capital\n"
    "      {{A2A_O_42_H_DURATA}} durata de funcționare  {{A2A_O_42_H_DIZ}} dizolvare\n"
    "      {{A2A_O_42_H_ALTE}} altele {{A2A_T_42_H_ALTE}}",
    "{{A2A_B_42_PROIECT_FUZ}} Proiect de fuziune, nr. profesioniști participanți {{A2A_T_42_PROIECT_FUZ_NR}}",
    "{{A2A_B_42_PROIECT_DIV}} Proiect de divizare, nr. profesioniști participanți {{A2A_T_42_PROIECT_DIV_NR}}",
    "{{A2A_B_42_EXPERT}} Numire expert",
]
COL_42_DREAPTA = [
    "{{A2A_B_42_SIT_FIN}} Situații financiare:  {{A2A_O_42_SF_ANUALE}} anuale  {{A2A_O_42_SF_CONSOLIDATE}} consolidate\n"
    "      {{A2A_O_42_SF_DECLARATIE}} declarație pe propria răspundere",
    "{{A2A_B_42_SF_LICHIDARE}} Situații financiare finale de lichidare și repartizare",
    "{{A2A_B_42_REGISTRE}} Registre și acte ale persoanei juridice radiate",
    "{{A2A_B_42_OPOZITIE}} Opoziție",
    "{{A2A_B_42_PLANGERE}} Plângere^(5)^",
    "{{A2A_B_42_RADIERE120}} Radiere conform art. 120 din Legea nr. 265/2022",
    "{{A2A_B_42_HOT_JUD}} Hotărâre judecătorească^(6)^",
    "{{A2A_B_42_DARE_SEAMA}} Dare de seamă asupra gestiunii administratorilor/ membrilor directoratului",
    "{{A2A_B_42_ACT_PROC}} Act procedural care redă dispozitivul hotărârii judecătorești^(6)^",
]


def doua_coloane(cell, stanga, dreapta):
    t = grid(cell, [9.0, 9.0])
    left, right = t.rows[0].cells
    for txt in stanga:
        cell_P(left, txt, align="l", line=1.15, after=3, size=9.5)
    for txt in dreapta:
        cell_P(right, txt, align="l", line=1.15, after=3, size=9.5)


def punctul_4(doc):
    c = box(doc)
    cell_P(c, "**4. {{A2A_B_S4}} Înscriere mențiuni**", align="l", keep=True)
    firma_block(c, "A2A_S4")

    c = box(doc)
    cell_P(c, "**4.1. {{A2A_B_41}} Acte și fapte pentru care legea prevede obligația înscrierii**", align="l", after=3, keep=True)
    doua_coloane(c, COL_41_STANGA, COL_41_DREAPTA)
    cell_P(c, "{{A2A_B_41_ALTE}} Alte mențiuni {{A2A_T_41_ALTE}}", align="l", before=2)

    # ── Pagina 3 ──
    c = box(doc)
    cell_P(c, "**4.2. {{A2A_B_42}} Depunere de acte**", align="l", after=3, keep=True)
    doua_coloane(c, COL_42_STANGA, COL_42_DREAPTA)
    cell_P(c, "{{A2A_B_42_ART103}} Acte conform art. 103 din Legea 265/2022: {{A2A_T_42_ART103}}", align="l", size=9.5)
    cell_P(c, "{{A2A_B_42_ALTE}} Alte înscrisuri: {{A2A_T_42_ALTE}}", align="l", size=9.5)

    c = box(doc)
    cell_P(c, "**4.3. {{A2A_B_43}} Declarație pe propria răspundere cu privire la îndeplinirea condițiilor de funcționare^(7)^.**",
           align="l")


def punctele_5_8(doc):
    c = box(doc)
    cell_P(c, "**5. {{A2A_B_S5}} Înscriere operațiuni comunicate de autoritatea/instituția publică** {{A2A_S5_AUTORITATE}}",
           align="l", keep=True)
    firma_block(c, "A2A_S5")

    c = box(doc)
    cell_P(c, "**6. {{A2A_B_S6}} Radiere**", align="l", keep=True)
    firma_block(c, "A2A_S6")
    cell_P(c, "{{A2A_B_S6_PJ}} persoană juridică   {{A2A_B_S6_SUC_RO}} sucursală persoană juridică română   "
              "{{A2A_B_S6_SUC_STR}} sucursală persoană juridică străină", indent=0.8, before=3)
    cell_P(c, "__Motiv__: {{A2A_B_S6_VOINTA}} voința profesionistului   {{A2A_B_S6_HOTARARE}} hotărâre judecătorească   "
              "{{A2A_B_S6_INCETARE}} încetare activitate sucursală", indent=0.3)
    cell_P(c, "{{A2A_B_S6_ALTELE}} altele {{A2A_T_S6_ALTELE}}", indent=1.3)
    cell_P(c, "{{A2A_B_S6_RAPORT}} Menționare depunere raport repartizare activ rămas în urma lichidării.", indent=0.3)

    c = box(doc)
    cell_P(c, "**7. {{A2A_B_S7}} Îndreptare eroare materială**", align="l", keep=True)
    firma_block(c, "A2A_S7")
    cell_P(c, "**referitoare la actul:** {{A2A_S7_ACT}}", indent=0.3, line=1.35)
    cell_P(c, "Pentru cererea/cererile nr./data {{A2A_S7_CERERE}} ({{A2A_B_S7_INMATRICULARE}} înmatriculare "
              "{{A2A_B_S7_MENTIUNE}} mențiune {{A2A_B_S7_RADIERE}} radiere),", indent=0.3, line=1.35)
    cell_P(c, "În loc de: {{A2A_S7_IN_LOC_DE}}", indent=0.3, line=1.35)
    cell_P(c, "Se va înregistra: {{A2A_S7_SE_VA}}", indent=0.3, line=1.35)

    c = box(doc)
    cell_P(c, "**8. {{A2A_B_S8}} Actualizare obiect de activitate conform CAEN Rev. 3^(8)^**", align="l", keep=True)
    cell_P(c, "în temeiul HG nr. 656/1997 privind aprobarea Clasificării activităților din economia națională – CAEN şi al "
              "Ordinului INS nr. 377/2024 privind actualizarea Clasificării activităților din economia națională – CAEN,",
           indent=0.3)
    firma_block(c, "A2A_S8")
    cell_P(c, "**obiect de activitate principal** (clasa+denumire) {{A2A_S8_OBIECT}}", indent=0.3, line=1.35)


def sectiunile_vi_vii(doc):
    c = box(doc)
    cell_P(c, "**VI. Solicit:** {{A2A_B_AUDIENTA}} **audiență publică**   {{A2A_B_COPII}} **copii**   "
              "{{A2A_B_COPII_CERT}} **copii certificate de pe documentele** {{A2A_T_COPII_CERT}}", align="l", line=1.3)
    cell_P(c, "{{A2A_B_COMUNICARE}} **comunicarea** documentelor care atestă efectuarea înregistrării în registrul comerțului "
              "într-o singură modalitate**:**", indent=1.2, line=1.3)
    cell_P(c, "{{A2A_O_POSTA}} poștă   {{A2A_O_CURIER}} curier   {{A2A_O_ELECTRONIC}} mijloace electronice   "
              "{{A2A_O_SEDIU_ORCT}} sediul O.R.C.T. {{A2A_T_SEDIU_ORCT}}", align="c", line=1.3)

    c = box(doc)
    cell_P(c, "**VII. Persoana pentru comunicare:**", align="l")
    cell_P(c, "Nume {{A2A_COM_NUME}} Prenume {{A2A_COM_PRENUME}}, adresa: localitatea {{A2A_COM_LOC}}, str. {{A2A_COM_STR}}, "
              "nr. {{A2A_COM_NR}}, bloc {{A2A_COM_BL}}, scara {{A2A_COM_SC}}, etaj {{A2A_COM_ET}}, ap. {{A2A_COM_AP}}, "
              "județ/sector {{A2A_COM_JUD}}, cod poștal {{A2A_COM_CP}}, telefon {{A2A_COM_TEL}}, e-mail {{A2A_COM_EMAIL}}",
           indent=0.8, line=1.35)


# ── Pagina 4 ────────────────────────────────────────────────────────────────────────────────────────────────────────

def sectiunile_viii_xii(doc):
    c = box(doc)
    cell_P(c, "**VIII. Date de facturare^(9)^:**", align="l")
    cell_P(c, "Nume și Prenume/ firmă {{A2A_FACT_NUME}}, CNP/CUI {{A2A_FACT_CNP_CUI}}, e-mail {{A2A_FACT_EMAIL}}, "
              "Banca {{A2A_FACT_BANCA}}, CONT IBAN {{A2A_FACT_IBAN}}, Sediul social/Adresa {{A2A_FACT_ADRESA}}",
           indent=0.8, line=1.35)

    P(doc, "", size=2, line=1.0)
    t = grid(doc, [1.2, 8.6, 6.8, 1.8], rows=10, style="Table Grid")
    hdr = t.rows[0].cells
    hdr[0].merge(hdr[3])
    cell_P(t.rows[0].cells[0], "**IX.                                                    OPIS DE DOCUMENTE DEPUSE**", align="l")
    for i, txt in enumerate(("**Nr. crt.**", "**Denumirea actului**", "**Nr. și data actului / Emitent**", "**Nr. file**")):
        cell_P(t.rows[1].cells[i], txt, align="c" if i != 1 else "l")
    for n in range(1, 8):
        row = t.rows[n + 1].cells
        _no_split(t.rows[n + 1])
        cell_P(row[0], f"**{n}.**", align="l")
        if n == 1:
            cell_P(row[1], "Hotărâre adunare generală / Directorat / Decizie CA", align="l")
            cell_P(row[1], "(Actul pentru publicare în Monitorul Oficial al României conține {{A2A_OPIS_CARACTERE}} caractere, "
                           "respectiv un nr de {{A2A_OPIS_PAGINI}} pagini manuscris)^(10)^", align="l", size=8.5)
            cell_P(row[1], "{{A2A_OPIS_1_DEN}}", align="l")
        else:
            cell_P(row[1], f"{{{{A2A_OPIS_{n}_DEN}}}}", align="l")
        cell_P(row[2], f"{{{{A2A_OPIS_{n}_NRDATA}}}}", align="l")
        cell_P(row[3], f"{{{{A2A_OPIS_{n}_FILE}}}}", align="c")
    last = t.rows[9].cells
    last[0].merge(last[2])
    cell_P(t.rows[9].cells[0], "**Total file :**", align="r")
    cell_P(t.rows[9].cells[3], "{{A2A_OPIS_TOTAL}}", align="c")

    c = box(doc)
    cell_P(c, "**X. Prelucrarea^(11)^ datelor cu caracter personal:**", align="l")
    cell_P(c, "Am fost informat cu privire la prelucrarea datelor cu caracter personal efectuată în scopul soluționării "
              "prezentei cereri.", indent=0.5, after=8)
    semnaturi(c, [("{{A2A_X_NUME}}", "(Nume și prenume)"), ("{{A2A_X_DATA}}", "(Data)"), ("……………………………", "(Semnătura)")])

    c = box(doc)
    cell_P(c, "**XI. Anexele nr. {{A2A_ANEXE}} fac parte integrantă din prezenta cerere.**", align="l")
    cell_P(c, "**Întocmită într-un exemplar, pe propria răspundere, cunoscând că declarațiile inexacte sunt pedepsite conform "
              "legii.**", indent=0.5, after=8)
    semnaturi(c, [("{{A2A_XI_DATA}}", "(Data)"), ("", ""), ("……………………………", "(Semnătura)")])

    c = box(doc)
    cell_P(c, "**XII. Prezenta cerere de înregistrare și documentele în susținerea acesteia se depun de către^(12)^:**", align="l")
    cell_P(c, "Nume {{A2A_DEP_NUME}} Prenume {{A2A_DEP_PRENUME}}, posesor al actului de identitate {{A2A_DEP_ACT_TIP}} seria "
              "{{A2A_DEP_ACT_SERIA}} nr. {{A2A_DEP_ACT_NR}} CNP {{A2A_DEP_CNP}}, în calitate de {{A2A_DEP_CALITATE}}, conform "
              "{{A2A_DEP_CONFORM}} nr. {{A2A_DEP_CONFORM_NR}} din {{A2A_DEP_CONFORM_DATA}}", indent=0.8, line=1.35)
    cell_P(c, "**Am fost informat cu privire la prelucrarea datelor cu caracter personal^(10)^ efectuată în scopul soluționării "
              "prezentei cereri.**", indent=0.8, size=9, after=8)
    semnaturi(c, [("{{A2A_DEP_DATA}}", "(Data)"), ("", ""), ("……………………………", "(Semnătura)")])


NOTE = [
    "Reprezentantul legal al persoanei juridice sau împuternicitul acestuia cu procură specială sau generală autentică sau "
    "avocatul, în baza unei împuterniciri avocațiale, ori oricare asociat, acționar sau membru.",
    "Se completează cu denumirea actului (act constitutiv, modificator: hotărâre AGA, decizie CA, act înființare, decizia "
    "asociatului unic etc.).",
    "Solicitantul trebuie să depună, odată cu cererea de înregistrare, și declarația pe propria răspundere cu privire la "
    "îndeplinirea condițiilor de funcționare/desfășurare a activității pentru sediul social și/sau sedii secundare sau, după caz, "
    "la terți.",
    "Certificat de administratorul societății sau de registrul independent privat, ce va conține structura completă a "
    "acționarilor persoane fizice și persoane juridice.",
    "Împotriva încheierii registratorului se poate formula plângere în temeiul art.112 din Legea nr. 265/2022 .",
    "Hotărârea judecătorească invocată se depune spre a fi menționată în registrul comerțului. În cazul în care prin hotărârea "
    "judecătorească se dispune efectuarea înregistrărilor în registrul comerțului, se va completa Secțiunea V., "
    "Subsecțiunea.4.1.",
    "Dacă se modifică obiectul de activitate ori activitățile autorizate, sediul social sau se înființează noi sedii secundare, "
    "precum și în situația întreruperii temporare de activitate a societăților care au desfășurat activitate de la înființare "
    "sau a reluării acesteia, solicitantul depune la biroul unic din cadrul oficiului registrului comerțului o nouă declarație "
    "pentru sediul social și/sau sedii secundare, după caz, la terți, corespunzătoare modificărilor intervenite și care să "
    "ateste situația curentă pentru desfășurarea tuturor activităților declarate în obiectul de activitate.",
    "Se completează doar această rubrică în cazul în care se realizează exclusiv actualizarea obiectului de activitate potrivit "
    "CAEN Rev. 3 fără să se fi modificat obiectul de activitate, astfel cum este prevăzut în actul constitutiv, caz în care nu "
    "este necesară depunerea actului constitutiv actualizat.",
    "Factura fiscală se emite pentru persoana indicată, iar în cazul în care nu sunt completate datele de facturare, aceasta se "
    "emite pe numele persoanei care efectuează plata.",
    "Pagina de manuscris a actelor înaintate spre publicare în Monitorul Oficial al României reprezintă 2.000 de semne, inclusiv "
    "spațiile. Actele înaintate spre publicare în Monitorul Oficial al României vor avea un conținut lizibil, tehnoredactat la "
    "un rând și jumătate, cu corp 12 Times New Roman, fără ștersături sau adăugări nedactilografiate, ce fac de neînțeles "
    "textul acestora.",
    "Potrivit art. 4 punctul 2. din Regulamentul (UE) nr. 679/2016 al Parlamentului European și al Consiliului Uniunii Europene "
    "privind protecția persoanelor fizice în ceea ce privește prelucrarea datelor cu caracter personal și privind libera "
    "circulație a acestor date și de abrogare a Directivei 95/46/CE (Regulamentul general privind protecția datelor), publicat "
    "în Jurnalul Oficial nr. 119L/04.05.2016, prin \"prelucrare\" se înțelege orice operațiune sau set de operațiuni efectuate "
    "asupra datelor cu caracter personal sau asupra seturilor de date cu caracter personal, cu sau fără utilizarea de mijloace "
    "automatizate, cum ar fi colectarea, înregistrarea, organizarea, structurarea, stocarea, adaptarea sau modificarea, "
    "extragerea, consultarea, utilizarea, divulgarea prin transmitere, diseminarea sau punerea la dispoziție în orice alt mod, "
    "alinierea sau combinarea, restricționarea, ștergerea sau distrugerea. Informarea privind prelucrarea datelor cu caracter "
    "personal se consultă pe pagina de internet www.onrc.ro la Secțiunea „Date cu caracter personal”.",
    "Se va completa de către deponent numai dacă este altă persoană decât semnatarul cererii.",
]


def main():
    doc = document_nou()
    antet(doc)
    sectiunea_iv(doc)
    punctul_1(doc)
    punctul_2(doc)
    punctul_3(doc)
    punctul_4(doc)
    punctele_5_8(doc)
    sectiunile_vi_vii(doc)
    sectiunile_viii_xii(doc)
    note(doc, NOTE)
    salveaza(doc, "Anexa 2a - Cerere înregistrare în registrul comerțului - PJ", OUT, TAGS_OUT)


if __name__ == "__main__":
    sys.exit(main())
