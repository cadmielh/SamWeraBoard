# Plan: șabloane pregătite pentru clienți

Stare: **etapele 0–4 implementate și testate, nelansate** (3 noiembrie 2026). Etapa 4: textele din Termeni (punctul 4), DPA, Sub-împuterniciți (Vertex AI), Confidențialitate și Securitate sunt scrise, cu Termeni și DPA în versiunea `2026-11-03`, iar procedura de incident are scenariul 8. Verificarea în doi pași a contului de Super Admin e confirmată. Textele trebuie încă revăzute de avocat înainte de lansare.

Implementare: `template_safety.py`, `templates_api.py`, `firestore.rules`, `TemplateLibrary.tsx`, `TemplateFiller.tsx`, `TemplateDeliveryModal.tsx`, `DeliveredTemplatesPanel.tsx`, `lib/templateChanges.ts`. Teste: `tests/test_template_safety.py`, `tests/test_templates_api.py`, `tests/rules/firestore.rules.test.js`, `frontend/src/lib/templateChanges.test.ts`.

## Scop

1. Clientul își modifică singur șablonul în Word și îl reîncarcă, fără să piardă formularul.
2. Adminul cabinetului alege ce șabloane de bază apar la generare.
3. Super adminul livrează un șablon pregătit într-un cabinet anume.

Nu intră în plan: catalog central, șabloane de bază cu listă de acces, coadă de cereri, istoric de versiuni, widget-uri noi pentru clauze.

## Ce am găsit în cod

| Constatare | Unde | Consecință |
|---|---|---|
| Nu există editare, doar adăugare și ștergere | `lib/templates.ts` | Reîncărcarea manuală pierde `sourceKey`, deci formularul dedicat |
| Regula permite orice `update` pe șablon, dar aplicația nu o folosește | `firestore.rules:132` | O putem restrânge fără să stricăm nimic |
| Limita de 500 KB există doar în browser | `TemplateLibrary.tsx:20` | Trebuie impusă și în reguli și pe server |
| `/template/placeholders` nu verifică extensia, mărimea sau erorile de citire și nu are limită de cereri | `app.py:454` | Trebuie întărită |
| O eroare de detectare e ignorată, iar șablonul se salvează cu zero etichete | `TemplateLibrary.tsx:140` | Trebuie afișată, altfel validarea nouă ar crea șabloane goale în tăcere |
| Lista de șabloane folosește `orderBy('createdAt')` | `lib/templates.ts:24` | Un document scris de server fără `createdAt` nu apare în listă |
| Scrierile cu Admin SDK ocolesc regulile | `authz.py` | Fiecare endpoint nou își face singur autorizarea |
| Jurnalul afișează „Utilizator eliminat” pentru cine nu e membru | `AuditLogCard.tsx:25` | Livrarea ta ar apărea greșit la client |
| Jurnalul nu conține nume de fișiere | `app.py:140` | Noile intrări respectă aceeași regulă |
| Șabloanele Google Docs sunt doar referințe la Drive-ul cuiva | `DocTemplate.docId` | Nu se pot livra; livrarea e doar pentru .docx stocat în aplicație |
| Declarația primește „-” la câmpurile goale, Anexa 1 și Beneficiarii nu | `TemplateFiller.tsx:375`, `:537` | O etichetă nouă pusă de client într-un formular dedicat nu e cerută nicăieri |
| Declarația e recunoscută și după etichete, nu doar după `sourceKey` | `declaratieActivitateFiller.ts:210` | Ștergerea etichetelor poate schimba formularul folosit |
| `defaultActiveKey` alege primul șablon de bază | `TemplateFiller.tsx:282` | Trebuie să lucreze doar cu cele vizibile |
| Gemini/Vertex nu apare în `LegalPages.tsx` | `ai_suggest.py` | Vezi Etapa 4: e o lipsă existentă, nu una introdusă de plan |

## Etapa 0: validare comună a fișierelor

Modul nou `template_safety.py`, folosit de etapele 1 și 3 și de `/template/placeholders`. Întoarce un cod de eroare, nu o excepție brută.

**`validate_docx(data)` respinge:**
- fișier gol, peste 500 KB sau care nu e arhivă ZIP validă;
- peste 500 de intrări sau peste 50 MB necomprimat (arhivă-bombă), verificat înainte de deschiderea cu python-docx;
- tip principal diferit de document Word, inclusiv variantele cu macro-uri sau `.dotx`;
- `word/vbaProject.bin`, `word/activeX/`, `word/embeddings/`;
- relații `TargetMode="External"`, cu excepția hyperlinkurilor (șablon atașat de la distanță);
- `<!DOCTYPE` în părțile XML.

**Modificări:**
- `/template/placeholders` primește `limit="fill"` și `validate_docx`, iar la eroare întoarce 400 cu cod clar.
- `handleDocxFileSelect` afișează eroarea și nu mai permite salvarea.
- Regula de `create` limitează `fileBase64` la 700.000 de caractere și interzice câmpurile `delivery`, `revision`, `updatedAt`, `updatedBy`.

Regula nu poate valida conținutul unui .docx. Adăugarea din browser rămâne verificată doar de `/template/placeholders`, ceea ce e acceptabil: fișierul ajunge doar în cabinetul care l-a încărcat.

## Etapa 1: „Înlocuiește fișierul”

**Regula pentru `update` din browser:** doar `name`, `description`, `outputNameTemplate`, `tipTemplate`. Fișierul se schimbă exclusiv prin server.

**Endpoint** într-un blueprint nou, `templates_api.py`, înregistrat în `app.py` cu limiter propriu: `POST /templates/<tid>/file`, multipart cu `template` și `baseRevision`.

1. Autorizare: `require_from_header("member", consent=True, limit="fill", billing=True)`.
2. `tid` validat cu regex. Calea se construiește din workspace-ul autorizat, ca să nu se poată atinge șablonul altui cabinet.
3. `validate_docx`, apoi recalcularea pe server a `placeholders`, `clauses`, `repeatGroups`. Nu se acceptă valori trimise de browser.
4. În tranzacție: șablonul există, e `.docx` cu `fileBase64` (altfel 409), iar `revision` e egal cu `baseRevision` (altfel 409: „un coleg l-a modificat între timp”).
5. Se actualizează fișierul, numele fișierului curățat, `revision + 1`, `updatedAt`, `updatedBy`. `sourceKey`, `sourceVersion`, `delivery` și `createdAt` rămân neschimbate.
6. Jurnal: `template.replace`, cu id-ul șablonului și numărul de etichete, fără nume.

**Interfață în `TemplateLibrary`:**
- buton vizibil doar cu `canEdit` și doar pe șabloane .docx din aplicație;
- la alegerea fișierului se apelează `/template/placeholders` și se arată diferența față de versiunea curentă;
- ecranul de confirmare are „Descarcă versiunea curentă”, fiindcă nu există istoric;
- avertismente: etichete șterse, clauze dispărute, iar la formularele dedicate etichete noi pe care formularul nu le cere (comparate cu lista șablonului de bază);
- o eroare 409 cere reîncărcarea, fără suprascriere.

**În `TemplateFiller`:** dacă șablonul activ își schimbă `revision`, apare un mesaj „Șablonul a fost actualizat, verifică formularul”. Altfel, un coleg ar putea genera cu fișierul nou dintr-un formular început pe cel vechi.

## Etapa 2: vizibilitatea șabloanelor de bază

Câmp nou `workspaces/{wid}.hiddenBuiltins: string[]`. Lipsa lui înseamnă că toate sunt vizibile, deci nu e nevoie de migrare.

- **Regulă:** se adaugă `hiddenBuiltins` la `hasOnly` de la `firestore.rules:105`, cu verificarea că e listă de cel mult 50 de elemente.
- **Scriere:** `arrayUnion` și `arrayRemove`, ca doi admini să nu își suprascrie modificările.
- **Bibliotecă:** comutator „Vizibil la generare”, doar pentru `userRole === 'admin'`. Șabloanele ascunse rămân în listă, estompate, și pot fi duplicate.
- **Generare:** `TemplateFiller` calculează `visibleBuiltins` și îl folosește la listă, la `defaultActiveKey` și la `renderDetail`. Dacă șablonul activ devine ascuns, `activeKey` se resetează.
- **Lista completă** rămâne în bibliotecă, ca avertismentul „versiune mai nouă” de la linia 391 să funcționeze în continuare.
- **Toate ascunse:** dacă nu există nici șabloane proprii, mesajul trimite la bibliotecă, nu la o listă goală fără explicații.

Asta e o preferință de afișare, nu control de acces: endpoint-urile de șabloane de bază rămân disponibile. Șabloanele de bază sunt aceleași pentru toți, deci nu e o problemă.

Modificarea e permisă și în modul citire, pentru că nu creează date. Nu se scrie în jurnal.

## Etapa 3: livrarea către un cabinet

**Flux:** pregătești șablonul în cabinetul tău, apeși „Trimite către alt cabinet”, rezolvi verificările, confirmi, apoi ștergi copia ta.

**`POST /admin/workspaces/<target>/templates`**, cu `X-Workspace-Id` = cabinetul sursă și corp `{sourceTemplateId, confirmName, sourceKey?, dryRun, asNewCopy?}`.

Ordinea verificărilor:
1. `require_super_admin()`, deci doar sesiune Google și `isSuperAdmin` citit din bază.
2. `require_role(principal, source, "member")`. Sursa trebuie să fie un cabinet al tău, ca rolul de super admin să nu poată muta șabloane între cabinete străine.
3. `ratelimit` cu acțiune nouă `template_delivery`: 30 pe oră per utilizator.
4. Ținta: `valid_wid`, există, nu e `pendingDeletion`, are DPA acceptat (`consent_ok`), diferă de sursă. Răspunsul e 404 generic dacă nu există. Ținta trebuie să aibă și abonament: funcție nouă `billing.has_paid_access(ws)`, adevărată pentru `hasSubscription` sau `compUntil` în viitor. Altfel, 409 `subscription_required`. Probele fără abonament sunt refuzate. `quota_tier` nu se poate refolosi, pentru că întoarce `standard` și pentru un cabinet expirat.
5. `confirmName` e identic cu numele cabinetului țintă, verificat pe server.
6. Sursa e .docx cu `fileBase64`. Google Docs și Drive sunt respinse.
7. `sourceKey`, dacă e trimis, trebuie să existe în `registry.json`. Blueprintul nou citește cheile direct din fișier, ca să evite importul circular cu `app.py`.
8. `validate_docx` și verificări de conținut (mai jos).

**Blochează livrarea:**
- CNP valid în corp, tabele, antete, subsoluri sau note (se refolosește `_contains_real_cnp`, mutat într-un loc comun);
- comentarii, modificări urmărite sau proprietăți personalizate.

**Avertismente:** etichete pe care formularul dedicat ales nu le cere, șablon fără etichete.

**La scriere:**
- metadatele din `docProps/core.xml` sunt golite (autor, ultimul modificator, titlu, comentarii), iar etichetele sunt comparate înainte și după curățare;
- doar câmpurile dintr-o listă permisă sunt copiate, iar etichetele sunt recalculate;
- `createdAt` e `SERVER_TIMESTAMP`, altfel șablonul nu apare în listă;
- `sourceVersion` nu se setează, ca să nu apară avertismentul „versiune mai nouă”;
- `delivery: {at, by, sourceTemplateId}` și `revision: 0`;
- id determinist `dlv_<sourceTemplateId>`, creat cu `create()`: un dublu-click nu dublează, iar o relivrare nu suprascrie modificările clientului. 409 dacă există; `asNewCopy` creează o copie nouă, pe care clientul o păstrează sau o șterge.

Endpoint-ul nu întoarce conținut din cabinetul țintă, doar id-ul, numele cabinetului deja cunoscut și rezultatul verificărilor.

**Retragere, pentru o livrare greșită:**
- `GET /admin/workspaces/<wid>/delivered-templates`, cu proiecție fără `fileBase64`, doar pentru șabloanele cu `delivery`;
- `DELETE /admin/workspaces/<wid>/templates/<tid>`, care refuză orice șablon fără `delivery` și avertizează dacă `revision > 0`.

**Jurnal, în cabinetul țintă:** `template.deliver` și `template.delivery_revoke`, cu `meta.byProvider: true`. `AuditLogCard` afișează „Echipa Cabinio” când acest câmp există. Etichetele se adaugă în `ACTIONS` din `lib/audit.ts`, categoria `documente`.

**Interfață:** buton doar pentru `isSuperAdmin`, pe .docx. Fereastra afișează cabinetul, id-ul scurt și e-mailul proprietarului, cere retastarea numelui și rulează `dryRun` înainte de a activa trimiterea. Selectorul `sourceKey` are implicit „fără formular dedicat”. Retragerea stă în `SuperAdminPage`.

Clientul vede pe șablon eticheta „Pregătit de Cabinio”. După prima înlocuire a fișierului (`revision > 0`), eticheta devine „Pregătit de Cabinio · modificat de {nume}, {dată}”, din `updatedBy` și `updatedAt`. Numele se ia din membrii cabinetului; dacă persoana nu mai e membră, apare „modificat de cabinet”. Schimbarea numelui sau a descrierii nu contează ca modificare, doar înlocuirea fișierului. În rest, șablonul se comportă ca unul propriu: îl poate modifica, înlocui sau șterge.

Dacă abonamentul se încheie, șabloanele livrate rămân în cabinet. Cabinetul intră în modul citire, ca pentru orice alte date, iar la reabonare totul funcționează din nou.

## Etapa 4: partea juridică și operațională

Acestea nu sunt cod și **cer o decizie sau un avocat**.

1. **Primirea actelor.** Decis: clienții trimit actele goale sau deja anonimizate, cu câmpurile marcate clar. Regula se trece în Termeni, iar verificarea CNP din Etapa 3 rămâne ca plasă de siguranță. Pregătirea se face la instrucțiunea scrisă a clientului (DPA, punctul despre instrucțiuni documentate).
2. **AI pe documentele clienților.** Gemini/Vertex nu apare în `LegalPages.tsx`, deși butonul de sugestii trimite context din document. Până la completarea listei de subîmputerniciți, nu folosi sugestiile AI pe acte primite de la clienți. Lipsa există deja, indiferent de acest plan.
3. **Termeni.** Decis: pregătirea șabloanelor e o facilitate pentru abonați, fără cost separat. Trebuie precizat că e un serviciu tehnic, că nu vine cu termen garantat sau număr nelimitat de documente, dacă asta dorești, și că clientul răspunde de conținutul juridic și de actualizarea lui. Schimbarea `TOS_VERSION` cere reacceptare de la toți, deci se grupează cu revizia juridică amânată. Până atunci, acordul se ia în scris de la fiecare client.
4. **Incidente.** Livrarea către cabinetul greșit se adaugă în `docs/procedura-incident.md`: retragere imediată, evaluare, notificare dacă documentul conținea date personale.
5. **Fișiere primite.** Deschide-le pe calculatorul tău în Protected View, fără a activa conținutul.
6. **Contul de Super Admin.** Confirmă că are verificare în doi pași activă în Google. Etapa 3 extinde ce poate face acest cont, iar MFA în aplicație e încă amânat (`docs/de-facut.md`).

## Teste

**`tests/test_template_safety.py`:** fișier non-ZIP, arhivă-bombă, macro, `.dotm` redenumit, OLE, șablon extern, DOCTYPE, hyperlink permis, un .docx de bază valid.

**`tests/test_templates_api.py`, înlocuire:** viewer respins, cabinet expirat 402, alt cabinet nu poate atinge șablonul, Google Docs 409, revizie veche 409, `sourceKey` păstrat, etichete recalculate, jurnal fără nume de fișier.

**`tests/test_templates_api.py`, livrare:**
- membru obișnuit 403, sesiune cu parolă 403;
- super admin care nu e membru al sursei 403;
- `confirmName` greșit, țintă `pendingDeletion`, fără DPA, sursă egală cu ținta;
- țintă în probă sau expirată refuzată, iar țintă cu abonament sau cu `compUntil` valabil acceptată;
- CNP în antet, comentariu, modificări urmărite, `sourceKey` necunoscut;
- `dryRun` nu scrie nimic;
- `createdAt` există și șablonul apare în lista ordonată;
- metadatele sunt golite;
- relivrarea nu suprascrie, iar `asNewCopy` creează o copie;
- retragerea refuză un șablon propriu al clientului;
- nicio rută nu întoarce `fileBase64` din cabinetul țintă.

**`tests/rules/firestore.rules.test.js`:**
- browserul nu poate schimba `fileBase64`, `sourceKey`, `delivery`, `revision`, `createdAt`;
- browserul nu poate crea șablon cu `delivery` sau peste limită;
- doar adminul schimbă `hiddenBuiltins`, iar tipul e verificat;
- testul existent cu cabinet expirat continuă să treacă.

**`tests/test_deploy_hygiene.py`:** `templates_api.py` și `template_safety.py` adăugate la `MUST_SHIP`.

**Frontend:** diferența de etichete, `visibleBuiltins`, resetarea `activeKey`, `defaultActiveKey` cu toate ascunse, eticheta din jurnal, eticheta „modificat de” (membru actual și membru eliminat).

**E2E manual, în emulatoare:**
1. Duplică Anexa 1, modifică textul, înlocuiește fișierul; formularul dedicat rămâne.
2. Ascunde Actul Constitutiv; dispare la generare și revine la reactivare.
3. Pregătește un act din `SabloaneAvocatTavi/anonimizate`, livrează-l, generează din contul clientului, modifică, retrage într-un test separat.

Toate testele rulează cu `tests/run_all.sh`.

## Ordinea de lansare

Se livrează pe etape, fiecare deployabilă separat: 0, 1, 2, 3.

1. Backend: endpoint-urile trebuie să existe înaintea interfeței.
2. Reguli Firestore: se rulează testele de reguli înainte.
3. Frontend: **`npm run build:eu`, niciodată `npm run build`.**

Regulile noi nu afectează documentele existente, iar `revision` lipsă se tratează ca 0. Etapa 3 se activează doar după punctele 1–4 din Etapa 4.

## Riscuri acceptate

- Fără istoric de versiuni: un fișier înlocuit greșit se recuperează doar din descărcarea făcută înainte.
- Toți membrii încarcă toate șabloanele prin `onSnapshot`, cu fișierele incluse. La câțiva clienți nu contează; la zeci de șabloane mari, fișierele trebuie mutate în Cloud Storage.
- Limita de 500 KB rămâne: un act cu imagini grele trebuie comprimat.
- Clientul poate strica etichetele. Avertismentele reduc riscul, dar nu îl blochează, pentru că modificarea e dreptul lui.
- Actualizările juridice ale șabloanelor livrate rămân manuale.
- Doar `.docx`: actele `.doc` se convertesc înainte.

## Decizii luate

1. Actele se primesc goale sau anonimizate, cu câmpuri clare.
2. Pregătirea e o facilitate pentru abonați: livrarea e blocată pe server pentru probe și cabinete expirate. Cabinetele cu acces gratuit acordat de tine sunt incluse.
3. Șablonul afișează „Pregătit de Cabinio · modificat de {nume}, {dată}” după ce clientul înlocuiește fișierul.
