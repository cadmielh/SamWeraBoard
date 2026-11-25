# Plan: documente pe client (stocare) și cereri de documente (portal)

Stare: **fazele 1–2 și finisarea lansate în producție pe 24 noiembrie 2026** (funcții, inclusiv `documente`, reguli, hosting;
bucket `samwera-board-eu-fisiere`, europe-west3). Testat pe un cabinet cu flag-ul `documente`; **din 25 noiembrie 2026
pornit pentru toate cabinetele** (flag-ul a fost scos din cod: nici serverul, nici aplicația nu-l mai verifică). Termenii
și DPA-ul `2026-11-24` cer reacceptarea de către fiecare cabinet. Anunțul „Ce e nou” (cu tur) apare tuturor conturilor
create înainte de 24 noiembrie (`lib/noutati.ts`). Spațiul ocupat de fiecare cabinet se vede în Super admin (cifră
totală, semnal „Spațiu N%” peste 80% din limită, detaliu în panoul cabinetului), din `GET /admin/fisiere/spatiu`.

Implementare faza 1: `fisiere.py` (tip după conținut, nume, stocare), `fisiere_api.py` (rute), `vault.py` (`encrypt_file`/`decrypt_file`),
`pii_api.py` (ștergerea clientului cu `?fisiere=`), `workspace_deletion.py` (ștergerea din stocare la purjare), `ratelimit.py`,
`firestore.rules`, `scripts/setup_fisiere_bucket.sh`; frontend: `lib/fisiere.ts`, `components/documente/*`, `StergeClientModal.tsx`,
`styles/documente.css`, Setări › Documente. Teste: `tests/test_fisiere.py`,
`tests/test_fisiere_api.py`, `tests/test_billing_gates.py`, `tests/rules/firestore.rules.test.js`, `lib/fisiere.test.ts`.

## Lansare (faza 1)

1. **Texte legale: actualizate** (24 nov 2026): landing (FAQ, cardul de securitate), Termeni (1, 5), Confidențialitate, DPA (1, 2, 3),
   Sub-împuterniciți (Cloud Storage în rândul Google Cloud, Frankfurt), Securitate. Versiunile TOS/DPA sunt `2026-11-24`
   (`legal_versions.py`, `lib/legal.ts`): **la deploy, fiecare cabinet reacceptă**, iar ecranul arată „Ce s-a schimbat”
   (`SCHIMBARI_LEGALE`). Dacă deploy-ul are loc altă zi, versiunile și `LEGAL_UPDATED` se pot muta la data reală.
   Cloud Storage e un serviciu al aceluiași sub-împuternicit (Google Cloud), deci nu unul nou. Dacă vrei totuși preavizul de 30 de zile
   din DPA, punctul 4, anunță cabinetele înainte.
2. `PROJECT_ID=samwera-board-eu ./scripts/setup_fisiere_bucket.sh` (bucket UE, acces public interzis, doar contul funcției).
3. `FISIERE_BUCKET=…` în `.env.samwera-board-eu`, apoi deploy **în ordinea**: funcții (inclusiv funcția nouă `documente`),
   reguli Firestore, hosting (`npm run build:eu`). Hosting-ul trimite transferurile la `VITE_FILES_BASE`
   (`…cloudfunctions.net/documente`, deja în `frontend/.env.eu.local`), deci funcția trebuie să existe înainte.
4. Flag-ul `documente` pornit întâi la un cabinet de test (Super admin › funcții), apoi scos cu totul (25 nov 2026).

## Interfață (ajustată pe 24 nov 2026)

- **Fișa pe ecran lat** (lățimea fișei ≥ 1100px): documentele stau într-o **coloană în dreapta, implicit 1/4**. Mânerul dintre coloane
  se trage (sau se mută cu săgețile; dublu clic/Enter = 1/4). Limitele: coloana are cel puțin 280px, iar datele clientului cel puțin 480px.
  Coloana se **restrânge** la o bandă (număr de documente, încărcare, se pot trage fișiere pe ea și atunci se redeschide). Lățimea și
  starea se rețin pe dispozitivul utilizatorului (`localStorage`). Pe fișe mai înguste și pe telefon, documentele stau în fluxul fișei.
  Coloana îngustă trece pe varianta compactă (container queries): butoane doar cu iconiță, detaliile pe un rând.
- **Foldere implicite automate**: lista cabinetului (Setări › Documente, doar admin, maximum 10, implicit cele 3) se creează la client
  prima dată când un membru îi deschide documentele (`POST /clients/<cid>/documente/init`, cu marcajul
  `documenteClienti/{cid}`). Folderele șterse nu reapar, iar o listă nouă nu schimbă clienții deja pregătiți. Faza 2 („Documente generate”)
  va lăsa cabinetul să aleagă folderul pentru documentele generate, pentru că numele implicite pot fi schimbate.
- **Previzualizare PDF cu pdf.js** (`pdfjs-dist` 4.10.38, `PdfViewer.tsx`), încărcat doar la prima previzualizare (bucăți separate,
  ~330 KB + worker). Fără `eval`, fără XFA și fără strat de adnotări, deci linkurile și scripturile din PDF nu rulează. CSP-ul nu s-a schimbat.

## Faza 2: copia documentelor generate (implementată 24 nov 2026, necomisă)

- În fereastra „Unde salvezi documentul?” apare bifa **„Păstrează o copie în documentele clientului”**: nebifată implicit,
  doar pentru un client salvat, cu funcția `documente` activă și drept de scriere. Merge cu ambele destinații (calculator sau
  Drive): fișierul .docx generat rămâne în browser și se încarcă și în documentele clientului (`destinatie=generate`).
- Folderul copiilor îl alege cabinetul în Setări › Documente („Documente generate” implicit; `setari/documente.folderGenerate`).
  Serverul îl găsește în rădăcina clientului (fără deosebire de majuscule) sau îl creează. Înainte, pregătește clientul cu
  folderele implicite, dacă nu fusese pregătit (altfel o copie ca primă operație ar fi lăsat clientul fără ele).
- Copiile sunt marcate `sursa: "generat"` (în listă: „generat”; în jurnal: „copie document generat”) și nu trec prin verificarea
  de duplicat: fiecare generare e o versiune nouă („… (2).docx”).
- O copie eșuată nu oprește generarea: utilizatorul primește documentul și un mesaj că, de data asta, copia nu s-a păstrat.
- Nu se aplică șabloanelor Google Docs (nu produc un .docx în browser) și generărilor fără client salvat; fereastra spune asta.

## Finisare fazele 1–2 (24 nov 2026, necomisă)

- **Ștergere cu „Anulează”**: documentele și folderele dispar imediat, cererea pleacă la expirarea notificării. Folderele cu
  conținut cer în continuare confirmare.
- **Tragere**: fișiere din calculator peste un folder din listă intră în el; documente și foldere trase peste un folder sau peste
  o treaptă din firul de navigare se mută acolo (inclusiv toată selecția). Pe ecran tactil rămâne „Mută în…”.
- **Lipire (Ctrl+V)**: o captură sau un fișier copiat intră în folderul deschis; capturile primesc un nume cu data și ora.
- **Căutare** în documentele clientului (de la 8 elemente; fără diacritice; inclusiv în subfoldere, cu calea afișată).
- **Selecție multiplă**: căsuțe pe rânduri, bară cu Descarcă (până la 10), Mută în…, Șterge; Escape golește selecția fără să
  închidă fișa.
- **Previzualizare Word, text și XML**: `docx-preview` 0.3.7 (încărcat la nevoie, fără fonturi externe și linkuri active),
  text cu UTF-8 sau Windows-1250.
- **Extrage datele în fișă**: OCR pe un act păstrat (`POST /fisiere/<fid>/extract`, în funcția `api`, aceleași cote ca scanarea),
  verificare în fereastra obișnuită, apoi persoana propusă automat (după nume sau ultimele cifre ale CNP-ului) sau una nouă;
  persoana se actualizează în toate rolurile ei, prin vault.
- **„Vezi”** în notificarea copiei generate: deschide fișa clientului la documente. (Butonul „Istoric” din pagina de generare
  arată scanările OCR, nu generările, deci legătura stă în notificare.)

## Audit (24 nov 2026), corectat

- Transferurile au funcție proprie (`documente`, `fisiere_app.py`: 2 GiB, 16 cereri pe instanță), ca o coadă de fișiere să nu
  blocheze funcția `api` (o cerere pe instanță, OCR). Operațiile mici (foldere, redenumire, ștergere) rămân pe `api`, prin Hosting.
- Coada trimite fiecare fișier cu cabinetul în care a fost pus, nu cu cel activ; o anulare din timpul obținerii tokenului nu mai trimite fișierul.
- O încărcare care se termină în timpul ștergerii clientului nu mai lasă fișiere orfane: tranzacție cu fișa clientului, plus o a doua trecere după ștergere.
- PDF-ul se recunoaște doar după semnătura de la început (un „%PDF-” în interiorul unei arhive sau al unui executabil nu mai trece).
- Ștergerea din stocare la purjarea cabinetului se face în loturi de 100.
- Jurnalul de acces are etichete și detalii pentru toate acțiunile documentelor (un test verifică fiecare acțiune din `fisiere_api.py`).
- Previzualizarea nu mai rămâne blocată la navigarea rapidă ←/→ și nu mai descarcă de două ori.
- Ștergerea unui folder care a primit conținut între timp cere din nou confirmarea, cu numărul actualizat.
- În afara ramurii (lipsă dinainte): acțiunile `billing.*`, `workspace.deletion_*`, `member.account_deleted` n-au etichete în jurnal.

## Decizii luate la implementare

- **Previzualizare fără iframe**: un iframe cu blob ar cere relaxarea CSP-ului (`frame-src blob:`, iar `object-src 'none'` poate
  bloca vizualizatorul din Chrome) și pe iPhone arată doar prima pagină. Imaginile se afișează direct, iar PDF-urile cu pdf.js (vezi mai sus).
- **Fără „categorie” pe fișier**: folderele o înlocuiesc.
- **Duplicate**: același conținut (SHA-256) la același client → întrebare „Încarcă oricum / Nu mai încărca”. Nume ocupat în folder →
  „act (2).pdf”, ca exploratorul de fișiere.
- **Tipuri acceptate de la cabinet**: PDF, JPG/PNG/WEBP/GIF/TIFF/HEIC, DOCX/DOC/ODT, XLSX/XLS/ODS, PPTX/PPT, XML, TXT/CSV,
  P7S/P7M (semnate), MSG. Refuzate: arhive, executabile, Office cu macro-uri. Tipul e cel detectat din conținut; extensia se corectează.
- **Încărcările** merg direct la funcție (ca OCR-ul), câte 3 în paralel, cu progres; continuă dacă utilizatorul deschide alt client.
  Un 429 (multe fișiere odată) se reia singur după `Retry-After`.
- **Fără abonament valabil**: documentele se pot vedea, descărca și șterge, nu și încărca sau reorganiza (ca restul aplicației).
- **Clientul demo** din ghidul „Primii pași” se șterge cu tot cu documente (nu ajung în Arhivă).

## Scop

1. Fiecare client are un spațiu de documente: acte încărcate de cabinet (buletine, dovezi de sediu etc.) și, la cerere, documentele generate.
2. Documentele se pot organiza în foldere, în cadrul clientului.
3. Cabinetul poate trimite clientului final un link prin care acesta încarcă singur actele cerute. Fișierele apar în aplicație, la client, după verificare.
4. Șabloanele `.docx` se mută din Firestore (base64, limită 500 KB) în același sistem de stocare (punctul 2 din `PROIECTE_VIITOARE.md`).

Google Drive rămâne ca alternativă, neschimbat.

## Decizii

| Subiect | Decizie |
|---|---|
| Criptare | **Toate** fișierele se criptează pe server cu cheia cabinetului (DEK-ul din `vault.py`, învelit cu KMS). Ștergerea cheii la ștergerea cabinetului face ilizibile și fișierele |
| Atașare | La **client**, cu foldere (imbricate) în cadrul clientului |
| Documente generate | Se salvează **doar când utilizatorul bifează** „Salvează în documentele clientului”, în format **.docx** |
| Roluri | Toți membrii (inclusiv cei cu drept de citire) pot vedea și descărca. Încărcarea, mutarea și ștergerea sunt doar pentru admin/member |
| Cost pentru cabinet | **Inclus** în abonament. Se măsoară totuși spațiul ocupat per cabinet, cu o limită de utilizare rezonabilă (10 GB), nefacturată |
| Ștergerea clientului | Utilizatorul e **întrebat** dacă se șterg și fișierele. Dacă nu, ele trec în **Arhiva** cabinetului, cu numele clientului păstrat pe fișier |
| Portal | Deocamdată **link per cerere**, cu expirare. Modelul de date permite mai târziu un portal permanent (revenire, istoric, documente de semnat) |
| Mărime maximă | **15 MB** per fișier |
| Antivirus | **Nu**, deocamdată (nu există variantă gratuită potrivită). Protecții gratuite în schimb, vezi „Securitate”. Starea `de_verificat` permite adăugarea ulterioară |

## Cost estimat (infrastructură)

Bucket Cloud Storage în `europe-west3` (prețuri de listă, aproximative): stocare ~0,023 $/GB/lună, trafic de descărcare ~0,10–0,12 $/GB.
Un cabinet cu 200 de clienți ≈ 2–4 GB → sub 0,10 $/lună. 100 de cabinete ≈ 10–15 $/lună în total. Nu există nivel gratuit pentru bucket-uri UE (proiectul e deja pe Blaze).

## Arhitectură

### Stocare
- Bucket dedicat, regiune `europe-west3`, fără acces public, fără reguli pentru browser: **tot accesul trece prin API**, ca vault-ul și șabloanele.
- Calea fișierului nu depinde de folder: `workspaces/{wid}/fisiere/{fid}`. Mutarea între foldere modifică doar metadatele.
- Conținutul e criptat (AES-GCM cu DEK-ul cabinetului; AAD = `wid` + `fid`) înainte de scriere. Descărcarea se decriptează în funcție. Limita de 32 MB per cerere a funcțiilor acoperă plafonul de 15 MB.

### Firestore
- `workspaces/{wid}/fisiere/{fid}`: `clientId` (sau `null` în Arhivă), `clientNume` (păstrat pentru Arhivă), `folderId`, `nume`, `mime`, `marime`, `sha256`, `categorie` (act_identitate / dovada_sediu / generat / altele), `sursa` (incarcat / generat / portal), `stare` (`acceptat` / `de_verificat`), `cerereId`, `docGenerationId`, `createdBy`, `createdAt`. Citire pentru membri; scriere **doar prin API**.
- `workspaces/{wid}/foldere/{folderId}`: `clientId`, `parentId`, `nume`. Folderele implicite propuse la prima folosire: „Acte identitate”, „Documente generate”, „Primite de la client”.
- `workspaces/{wid}/cereriDocumente/{cerereId}`: `clientId`, lista de acte cerute (`[{id, eticheta, persoana?, primit}]`), `tokenHash`, `expiraLa`, `stare` (deschisă / completă / expirată / anulată), `creataDe`, mesaj opțional. Gândit generic, ca un viitor acces permanent la portal să reutilizeze aceleași cereri ca istoric.
- Contor `spatiuOcupat` per cabinet, actualizat tranzacțional la încărcare și ștergere.

### Portal (link per cerere)
- Linkul conține un token aleator (≥ 128 biți). În Firestore se păstrează doar hash-ul lui. Expirare implicită de 14 zile, cu anulare manuală.
- Pagina publică (de exemplu `/p/<token>`) arată numele și logo-ul cabinetului, lista de acte cerute și butoane de încărcare sau fotografiere de pe telefon. Nu arată nimic altceva din cabinet sau de la client.
- Fișierele intră cu `stare: de_verificat` în folderul „Primite de la client”. Utilizatorul primește o alertă prin sistemul existent de notificări (tip nou, de exemplu `documente_primite`), apoi acceptă sau respinge fișierele și, opțional, rulează OCR.
- Pe pagină apare informarea GDPR în numele cabinetului (Operator). Cabinio apare ca persoană împuternicită.

### Securitate
- Tipul fișierului se verifică după conținut, nu după extensie. Prin portal se acceptă doar PDF, JPG, PNG și HEIC.
- Imaginile primite prin portal se re-salvează ca JPEG pe server: dispare orice conținut ascuns, iar HEIC devine compatibil.
- PDF-urile care conțin `/JavaScript`, `/Launch`, `/EmbeddedFile` sau sunt protejate cu parolă se resping.
- Limită de cereri pe token și pe IP (`ratelimit.py`), plus limita de 15 MB.
- Fiecare descărcare, încărcare și ștergere intră în `auditLog`.

### Ciclu de viață
- **Ștergerea clientului:** dialogul întreabă „Șterg și documentele?”. Dacă da, se șterg fișierele și folderele. Dacă nu, fișierele primesc `clientId = null` și ajung în Arhivă.
- **Ștergerea cabinetului:** urmează amânarea existentă (`workspace_deletion.py`). La purjare se șterge prefixul din bucket și se distruge DEK-ul.

## Faze

1. **Fundația:** bucket, API (încărcare, listare, descărcare, redenumire, mutare, ștergere), criptare, foldere, audit, contor de spațiu, tabul „Documente” în fișa clientului, Arhiva și dialogul de la ștergerea clientului. Teste pe emulatoare.
2. **Documente generate:** bifa „Salvează în documentele clientului” la generare (.docx), cu legătură la `docGenerations`.
3. **Migrarea șabloanelor** din base64 în Storage, inclusiv script de migrare. Dispare limita de 500 KB.
4. **Portal:** cereri de documente, pagina publică, starea „De verificat”, alerta `documente_primite`. Detaliat în „Faza 4: portalul, plan detaliat”.
5. **Mai târziu:** portal permanent pentru clientul final (revenire, istoric, documente de semnat), OCR direct din fișierele stocate, antivirus (ClamAV pe Cloud Run) dacă devine necesar, limită de spațiu afișată în Setări.

## Faza 4: portalul, plan detaliat (25 nov 2026)

Arhitectura de mai sus (token, hash, expirare, verificarea fișierelor, `de_verificat`, alerta) rămâne. Aici e experiența,
pe care o decide dacă portalul chiar e folosit.

### Decizii (25 nov 2026)
| Subiect | Decizie |
|---|---|
| Trimiterea linkului | **Din telefonul/mailul cabinetului**: „Copiază linkul”, WhatsApp, E-mail (`mailto:` cu mesajul gata scris) și cod QR pentru clientul aflat la birou. Cabinio nu trimite e-mailuri (fără furnizor nou, fără sub-împuternicit nou). Trimiterea automată, cu amintiri, rămâne pentru mai târziu |
| Ce vede clientul după încărcare | **Doar numele și mărimea fișierelor** trimise, cu posibilitatea de a le șterge cât timp cabinetul nu le-a acceptat. Fără previzualizări: un link ajuns la altcineva nu expune actele |
| Respingerea unui act | **Același link se redeschide** pentru actul respins, cu motivul scris de cabinet („poza e neclară, refă-o la lumină”); cabinetul retrimite linkul |
| Lista de acte cerute | **Propuneri din fișa clientului + șabloane de cerere salvate de cabinet + acte libere** |

### Cabinetul
- **Crearea cererii** din fișa clientului („Cere documente”). Actele propuse automat din datele clientului: CI pentru fiecare
  asociat/administrator (PJ) sau titular/membri (PF/II/IF), actele care expiră (aceleași reguli ca alertele), dovada de sediu.
  Cabinetul bifează, adaugă acte libere, alege un șablon salvat („Înființare SRL”, „Schimbare sediu”) și poate scrie un mesaj.
- **Șabloanele de cerere**: listă de acte cu nume, salvată per cabinet (Setări › Documente), editabilă de admin.
- **Trimiterea**: după creare, ecranul cu linkul, butoanele de mai sus și mesajul propus („Bună ziua, vă rugăm să încărcați
  actele cerute aici: … Linkul e valabil până pe …”).
- **Urmărirea**, pe fiecare act: de trimis, primit, acceptat, respins. Pe cerere: deschisă de client (prima accesare),
  completă, expirată, anulată. Acțiuni: prelungește, anulează, retrimite (copiază din nou linkul).
- **„Documente primite”**: un loc central (pagina Clienți sau clopoțelul) cu tot ce așteaptă verificare, la toți clienții;
  în fișa clientului, un semn „De verificat”. Alerta `documente_primite` prin sistemul existent.
- **Verificarea**: previzualizare, Acceptă / Respinge (cu motiv). La acceptare, fișierul trece în folderul potrivit actului
  (CI → „Acte identitate”, restul → „Primite de la client”) și primește un nume clar („CI – Popescu Ion.jpg”); pentru buletine
  se propune „Extrage datele în fișă”.

### Clientul (pagina publică)
- Gândită întâi pentru telefon: numele și logo-ul cabinetului, mesajul, lista actelor cu starea fiecăruia.
- Fotografiere direct din cameră, cu indicații pe tipul actului („față și verso”, „toată pagina în cadru”); mai multe poze
  pot forma un act. Pozele se micșorează pe telefon înainte de trimitere (date mobile), serverul le re-salvează oricum ca JPEG.
- Clientul revine pe același link până la expirare: vede ce a trimis (doar nume și mărime) și ce mai lipsește; actele
  respinse apar din nou, cu motivul.
- Ecran de final: „Gata, Cabinetul X a primit documentele.” Informarea GDPR în numele cabinetului.
- Linkuri expirate, anulate sau ale unui cabinet în mod citire: un mesaj politicos („Linkul nu mai e activ; contactați
  cabinetul”), fără alte detalii.

### Reguli
- În mod citire: linkurile active se opresc, iar cereri noi nu se pot crea.
- Limite pe cerere: număr maxim de fișiere (de exemplu 30) și 15 MB per fișier; ce vine prin portal intră în spațiul de 10 GB.
- Datele noi: pe fiecare act din `cereriDocumente`: `stare` (de_trimis / primit / acceptat / respins), `motivRespingere`,
  fișierele primite; pe cerere: `deschisaLa`, `mesaj`. Șabloanele: `workspaces/{wid}/setari/cereriSabloane`.
- La lansare: anunț în „Ce e nou” (`necesita: ['client', 'acces']`, cu tur) și un pas opțional în „Primii pași”.

### Etape
- **4a. Cabinetul:** cererea (propuneri, acte libere), trimiterea (link, WhatsApp, e-mail, QR), urmărirea, „Documente
  primite”, verificarea cu acceptare/respingere, alerta.
- **4b. Pagina publică:** încărcare și fotografiere, revenire pe link, ecran de final, linkuri inactive.
- **4c. Finisare:** șabloane de cerere, numele automate la acceptare, anunțul și pasul din ghid.

## Detalii tranșate
- Linkul din portal expiră implicit după **14 zile**.
- Limita de utilizare a spațiului: **10 GB** per cabinet.
- Pagina portalului afișează **numele și logo-ul** cabinetului.
