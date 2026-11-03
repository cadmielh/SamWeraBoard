# Plan: configuratorul de formular pentru șabloane

Stare: **plan, neimplementat; toate deciziile sunt luate** (3 noiembrie 2026). Se reia când formularul generic, construit doar din etichete, nu mai e suficient pentru șabloanele pregătite clienților (vezi `docs/plan-sabloane-clienti.md`).

## Scop

Pentru un șablon propriu, super adminul aranjează formularul din interfață, fără cod și fără deploy:

- titlul și textul de ajutor ale fiecărui câmp;
- tipul câmpului: text, text lung, număr, dată, listă, opțiuni sau bifă;
- secțiuni și ordinea câmpurilor;
- câmpuri obligatorii și validări simple;
- **logică condițională:** un câmp sau o secțiune apare doar dacă altă alegere are o anumită valoare, iar paragrafele legate de ea apar în document doar în același caz.

Configurația pleacă odată cu șablonul la livrare. Clientul vede formularul așa cum a fost aranjat.

Nu intră în plan: formulare scrise în cod (ca Anexa 1), editarea textului documentului din aplicație, formule de calcul și condiții în mijlocul unei propoziții.

## Ce există azi

Formularul generic (`TemplateFiller.tsx`, `renderReadiness`) se construiește din etichete:

| Etichetă | Câmp |
|---|---|
| `{{SOCIETATE_…}}`, `{{ASOCIAT_N_…}}` etc. | Nimic de completat: date preluate din fișa clientului |
| `{{CAMP_X}}` | Text cu titlul derivat din nume (`manualLabel`); cu „data”/„valabil” în nume primește calendar (`isDateLabel`) |
| `{{CAMP_NUMAR_X}}` + `{{CAMP_DATA_X}}` | Cele două câmpuri pe un rând (`pairManualDateFields`) |
| `{{ROL_N_CÂMP}}` | Alegerea unei persoane (`CustomPersonField`) |
| `{{#ROLURI}}…{{/ROLURI}}` | Listă de persoane (`CustomPersonGroupField`) |
| `{{#CLAUZE}}` + „Denumire: …” | Articole opționale cu bife (`ClauseSelector`) |

Valorile câmpurilor manuale se țin în `manualValues[tpl.id][tag]` și ajung la server ca înlocuiri obișnuite.

**Mecanismul refolosit pentru condiții:** `doc_filler._expand_repeat_blocks` copiază blocul `{{#TAG}}…{{/TAG}}` o dată pentru fiecare element din `groups[TAG]`. O listă goală elimină blocul, iar `[{}]` îl păstrează o dată. Un bloc condițional e deci un bloc repetitiv cu 0 sau 1 element, fără motor nou pe server.

## Modelul de date

Câmp nou `form` pe documentul `docTemplates/{id}`:

```ts
interface TemplateForm {
  version: 1
  sections: { id: string; title: string; help?: string; showIf?: Condition }[]
  fields: {
    tag: string                    // „{{CAMP_X}}”, doar etichete manuale (CAMP_…)
    label: string
    help?: string
    type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'radio' | 'checkbox'
    options?: { value: string; label: string; docText: string }[]   // docText = ce se scrie în document
    checkedText?: string; uncheckedText?: string                     // pentru bifă (ex. „☒” / „☐”, „da” / „nu”)
    required?: boolean
    validation?: 'cui' | 'iban' | 'cnp' | 'email' | 'telefon' | { min?: number; max?: number }
    section: string
    order: number
    showIf?: Condition
    default?: string
  }[]
  blocks: { tag: string; label: string; showIf: Condition }[]       // „DACA_X” → {{#DACA_X}}…{{/DACA_X}}
}

type Rule =
  | { field: string; op: 'eq' | 'neq'; value: string }
  | { field: string; op: 'in'; values: string[] }
  | { field: string; op: 'checked' | 'unchecked' | 'empty' | 'filled' }
  | { context: 'tipClient'; op: 'eq'; value: 'PF' | 'PJ' }
  | { context: 'nrAsociati'; op: 'eq' | 'gte' | 'lte'; value: number }
type Condition = { all: Rule[] } | { any: Rule[] }
```

**Decizii de design:**
- **Fără limbaj de expresii și fără `eval`.** Condițiile sunt date validate (reguli simple, legate prin „toate” sau „oricare”). Nu există risc de execuție de cod, iar condițiile se pot verifica pe server.
- **Se configurează doar câmpurile manuale** (`CAMP_…`). Datele clientului, persoanele și clauzele își păstrează componentele actuale; configurația le poate doar așeza într-o secțiune.
- **Un șablon fără `form` arată exact ca azi.** Configuratorul e o îmbunătățire opțională, deci nu e nevoie de migrare.
- **Mărime:** cel mult 50 KB, 200 de câmpuri și 30 de blocuri. Documentul are deja până la ~700 KB de fișier, iar limita Firestore e de 1 MiB.

## Logica condițională, cap la cap

1. **În document:** paragrafele condiționale se pun între `{{#DACA_GARANTIE}}` și `{{/DACA_GARANTIE}}`, pe paragrafe separate, ca blocurile repetitive. Condiții în mijlocul unei propoziții nu sunt acceptate. Pentru variații de text într-o frază se folosește o listă cu `docText`, de exemplu „pe durată nedeterminată” față de „pe o durată de {{CAMP_DURATA}} luni”.
2. **În configurator:** blocul `DACA_GARANTIE` primește o condiție, de exemplu „Garanție” e bifat.
3. **În formular:** câmpurile și secțiunile cu `showIf` apar și dispar pe loc. Un câmp ascuns nu e obligatoriu și nu intră în procentul de completare.
4. **La generare:** frontend-ul evaluează condițiile și trimite `groups.DACA_GARANTIE = [{}]` sau `[]`. Valorile câmpurilor ascunse se trimit goale.
5. **Pe server:** `/fill/docx` reevaluează condițiile din `form` cu valorile primite, ca un client modificat să nu poată trimite un bloc care nu ar trebui să apară. Dacă cele două evaluări diferă, câștigă serverul. Frontend-ul și serverul folosesc aceleași teste de cazuri.

**De verificat la implementare:**
- `detectCustomPersonGroups` (`lib/placeholders.ts`) ar trata `DACA_…` ca listă de persoane. Prefixul trebuie exclus acolo și în `list_repeat_groups_in_docx`, cum e deja exclus `CLAUZE`.
- Un bloc condițional într-un tabel funcționează doar dacă marcajele sunt în aceeași celulă (ca blocurile repetitive). Pentru rânduri întregi de tabel se folosește `row_groups`, cu aceeași regulă de 0 sau 1 element.
- O etichetă condiționată care apare și în afara blocului ei ar rămâne ca text `{{…}}` în document. Configuratorul trebuie să o semnaleze (verificarea se face pe server, la salvare).

## Server

**Endpoint nou:** `PUT /templates/<tid>/form`, în `templates_api.py`.
- Autorizare: `require_super_admin()` plus `require_role(principal, wid, "member")` pe cabinetul din `X-Workspace-Id`, ca la livrare. Decis: în prima fază doar super adminul editează formularul, în cabinetul propriu, înainte de livrare. Clientul vede formularul, dar nu îl poate modifica. Dacă mai târziu și adminii de cabinet vor putea edita, se schimbă doar autorizarea.
- Validare strictă cu pydantic: tipuri, lungimi, numai etichete existente în `placeholders`, condiții care trimit doar la câmpuri existente, fără cicluri (A apare dacă B, B apare dacă A), blocuri existente în document.
- `revision` folosit și pentru formular: o salvare peste una mai nouă e refuzată.
- Jurnal: `template.form_update`, fără conținut.

**Reguli Firestore:** `form` se adaugă la câmpurile scrise doar de server (refuzat la `create` și `update` din browser), ca validarea să nu poată fi ocolită.

**Livrare:** `deliver_template` copiază și `form`, după aceeași validare.

**Înlocuirea fișierului:** `replace_template_file` păstrează `form`, dar elimină câmpurile și blocurile ale căror etichete au dispărut din document. Elimină și condițiile care trimiteau la ele; un câmp care depindea de unul eliminat devine mereu vizibil. Decis: curățarea e automată, cu o notă informativă în ecranul de diferențe, înainte de confirmare. De exemplu: „Configurația câmpurilor «Durata în luni» și «Garanție» se va elimina, pentru că etichetele lor nu mai sunt în document. Câmpul «Valoare garanție» nu mai depinde de nicio condiție.” Etichetele noi apar neconfigurate, cu comportamentul de azi. Curățarea se face pe server, în aceeași tranzacție cu înlocuirea, ca formularul și fișierul să nu poată rămâne nepotrivite.

**`/fill/docx`:** primește id-ul șablonului alături de fișier (azi primește doar fișierul), ca să citească `form` din Firestore pentru reevaluarea condițiilor. Pentru șabloanele fără `form` nu se schimbă nimic.

## Interfață

**Editorul** (buton „Formular” pe un șablon .docx propriu):
- coloana stângă: secțiunile, cu câmpurile lor, care se mută prin tragere;
- coloana dreaptă: proprietățile câmpului ales (titlu, ajutor, tip, opțiuni cu `docText`, obligatoriu, validare, condiție);
- editor de condiții prin alegeri, nu text: „Arată dacă [câmp] [este / nu este / este bifat…] [valoare]”, cu „toate” sau „oricare”;
- lista blocurilor `DACA_…` găsite în document, fiecare cu condiția ei;
- **previzualizare** pe loc a formularului, cu valori de test, plus „Generează un document de test”;
- **avertismente:** bloc fără condiție, etichetă condiționată folosită în afara blocului, listă fără opțiuni.

**Formularul pentru utilizator:** `renderReadiness` folosește un `ConfiguredForm` când șablonul are `form`, altfel randarea de azi. Câmpurile cu date din client și persoanele rămân componentele actuale. Câmpurile obligatorii goale blochează generarea, cu mesaj și focus pe câmp.

**Generarea în lot** (mai multe șabloane bifate): un șablon cu câmpuri obligatorii necompletate e exclus din lot, cu mesaj, ca azi pentru tipul de client nepotrivit.

## Etape

| Etapă | Conținut | Efort estimat |
|---|---|---|
| F1 | Model, endpoint, reguli, editor fără condiții (titluri, ajutor, tipuri, secțiuni, ordine, obligatoriu), formular configurat, livrarea și înlocuirea păstrează `form` | Mediu |
| F2 | Logică condițională: condiții pe câmpuri și secțiuni, blocuri `DACA_…`, reevaluare pe server, avertismente | Mediu (aproximativ jumătate din F1) |
| F3 | Condiții după datele clientului (PF/PJ, număr de asociați), validări (CUI, IBAN, CNP), propuneri automate: reguli locale aplicate automat și butonul „Propune cu AI” (vezi Decizii, punctul 3) | Mic–mediu |

F1 e utilă singură. F2 se poate lansa ulterior, fără să schimbe ce s-a configurat în F1.

## Securitate

- Configurația e date validate pe server; nu există cod, expresii sau HTML introdus de utilizator. Titlurile și textele de ajutor se afișează ca text (React), nu ca HTML.
- `docText` ajunge în document ca text simplu, prin aceeași înlocuire ca orice câmp.
- Serverul reevaluează condițiile, deci un client modificat nu poate include în document un bloc care nu trebuia să apară.
- Limite de mărime și de număr pe configurație, ca să nu poată fi folosită pentru a umfla documentul Firestore.
- Jurnalul nu conține titluri sau valori, doar cine, când și pe ce șablon.

## Teste

- **Server:** validarea schemei (tipuri, cicluri, etichete inexistente, mărime), autorizare, conflict de revizie, livrarea copiază `form`, înlocuirea elimină configurația câmpurilor dispărute și condițiile care trimiteau la ele (în aceeași tranzacție), `/fill/docx` elimină sau păstrează blocurile `DACA_…` după condiții, inclusiv când browserul trimite altceva.
- **Reguli:** browserul nu poate scrie `form`; endpoint-ul refuză orice utilizator care nu e super admin.
- **Frontend:** evaluarea condițiilor (aceleași cazuri ca pe server), câmpuri ascunse care nu sunt obligatorii, procentul de completare, editorul (mutare, ștergere, condiții), previzualizarea.
- **Manual:** un contract cu garanție opțională și durată determinată sau nedeterminată, configurat, livrat, completat de client cu fiecare combinație de opțiuni.

## Decizii

1. **Decis:** în prima fază doar super adminul editează formularul.
2. **Decis:** la înlocuirea fișierului, configurația câmpurilor dispărute se elimină automat, cu o notă informativă înainte de confirmare.
3. **Decis:** propunerile automate din F3 folosesc ambele variante.
   - **Reguli locale, aplicate automat** la deschiderea editorului pentru câmpurile neconfigurate: titlu derivat din etichetă, tip dată (`isDateLabel`), tip număr după „lei”, „%”, „luni”, „zile”. Nu trimit nimic în afara aplicației și nu costă nimic.
   - **Gemini, doar la cerere,** cu butonul „Propune cu AI”, pe tot formularul sau pe un câmp. Poate propune titluri cu diacritice, texte de ajutor, liste cu opțiuni și `docText` din variantele găsite în text, secțiuni și paragrafe candidate pentru blocuri `DACA_…`.
   - **Protecțiile de la `/template/blanks/ai-suggest` se păstrează:** context refuzat dacă are un CNP valid, limită `ai_suggest`, ieșire structurată (pydantic). Propunerile apar „de verificat” și nu se aplică fără confirmare. Gemini nu participă la generarea documentelor.
   - **Endpoint:** `POST /templates/<tid>/form/ai-suggest`, doar pentru super admin, în același modul cu `ai_suggest.py`.
