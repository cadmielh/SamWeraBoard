# Procedura de răspuns la incidente de securitate

**Furnizor / împuternicit:** HOLHOȘ CADMIEL-GEORGEL PFA (CUI 53465872) · **Contact incidente:** hcadmiel@gmail.com
**Versiune:** 1 (2026-09-19) · Se revizuiește anual și după fiecare incident. Ține legătura cu [DPA](../frontend/src/pages/legal/LegalPages.tsx)
(notificare în cel mult 48 de ore) și cu pagina publică „Securitate și conformitate”.

## 1. Scop și termeni-cheie
Descrie ce facem când datele cabinetelor sau ale clienților lor sunt (sau ar putea fi) compromise, astfel încât termenele legale să fie respectate.

- **Incident de securitate**: orice eveniment care afectează sau ar putea afecta confidențialitatea, integritatea ori disponibilitatea aplicației sau a datelor.
- **Încălcare a securității datelor cu caracter personal** (GDPR art. 4 pct. 12): distrugere, pierdere, modificare, divulgare sau acces neautorizat la date personale.
  Aici intră, de exemplu, citirea CNP-urilor de către cine nu avea dreptul, sau un document trimis persoanei greșite.
- **Ceasul se pornește la „luarea la cunoștință”**: momentul în care avem o certitudine rezonabilă că a existat o încălcare, nu momentul producerii ei.

## 2. Roluri
| Rol | Cine | Ce face |
|---|---|---|
| Responsabil de incident | Furnizorul (HOLHOȘ CADMIEL-GEORGEL PFA) | Conduce răspunsul, decide conținerea, notifică cabinetele, ține registrul |
| Operatori | Cabinetele afectate (administratorii spațiilor de lucru) | Decid dacă notifică ANSPDCP (72 h) și persoanele vizate; primesc de la noi toate informațiile |
| Sub-împuterniciți | Google Cloud/Firebase, Microsoft Azure | Ne notifică ei; îi întrebăm dacă incidentul îi implică |
| Autoritate | ANSPDCP (www.dataprotection.ro) | Primește notificarea de la operator, în 72 h, dacă există risc |

## 3. Termene
| Moment | Termen | Responsabil |
|---|---|---|
| Înregistrare în registru + conținere inițială | imediat | Furnizor |
| Evaluare inițială (a fost o încălcare a datelor personale? ce spații sunt afectate?) | în cel mult **24 de ore** de la luarea la cunoștință | Furnizor |
| Notificarea cabinetelor afectate | fără întârziere nejustificată, în principiu în cel mult **48 de ore** (DPA, pct. 3) | Furnizor |
| Notificarea ANSPDCP | în cel mult **72 de ore** de la luarea la cunoștință a *operatorului* (GDPR art. 33) | Cabinetul (operatorul) |
| Comunicare către persoanele vizate | fără întârziere, dacă riscul este ridicat (GDPR art. 34) | Cabinetul (operatorul) |

Dacă informațiile nu sunt complete, notificăm în etape (GDPR art. 33 alin. 4): întâi ce știm, apoi actualizări.

## 4. Pregătire (o singură dată; ce trebuie să existe *înainte* de un incident)
- [ ] Adresa de contact pentru incidente e publică (pagina „Securitate”) și verificată zilnic.
- [ ] **Alerte în Google Cloud Monitoring** (proiectul `samwera-board-eu`): rată mare de erori 5xx, creștere de răspunsuri 401/403, creștere de 429 (`rate_limited`), cost neobișnuit Azure.
- [ ] **Jurnale de acces la date (Data Access audit logs)** activate pentru Firestore și Cloud KMS, ca să putem reconstitui accesul tehnic.
- [ ] Copii de siguranță: recuperare la un moment anterior (PITR, 7 zile) activă și confirmată.
- [ ] Lista de contact a administratorilor de cabinet, generabilă oricând: `python scripts/incident_tools.py contacts --project samwera-board-eu --all`.
- [ ] Acces la Firebase Console, Google Cloud Console, portalul Azure și un dispozitiv de încredere pentru a interveni.
- [ ] Un exercițiu „pe hârtie” (tabletop) pe an: alegem un scenariu din secțiunea 7 și parcurgem pașii cu ceasul pornit.

## 5. Fluxul de răspuns

### A. Detectare și înregistrare (minutele 0–15)
1. Notează **ora luării la cunoștință** și sursa (raport de la un utilizator/cercetător, alertă, jurnalul de acces, notificare de la Google/Microsoft).
2. Deschide o intrare în [registrul de incidente](registru-incidente.md), chiar dacă nu e sigur că e o încălcare (GDPR art. 33 alin. 5).
3. Nu șterge nimic ca să „curățăm”: dovezile (jurnale, documente) se păstrează.

### B. Conținere (prima oră)
Alege minimul necesar care oprește răspândirea, fără să distrugi dovezi:
| Situație | Acțiune |
|---|---|
| Cont de utilizator compromis | Firebase Console → Authentication → utilizator → **Disable account** (sesiunile lui nu mai sunt acceptate); scoate-l din workspace (Utilizatori) și cere-i să-și schimbe parola Google |
| Secret compromis (cheia Azure) | Portal Azure → *Regenerate key*; apoi `firebase functions:secrets:set AZURE_DOCUMENT_INTELLIGENCE_KEY --project samwera-board-eu` și redeploy funcția |
| Cheie de service account expusă | Cloud Console → IAM → Service Accounts → *Delete key*; verifică activitatea cheii în jurnale |
| Bug de autorizare (acces între spații) | Oprește accesul la API: Cloud Console → Cloud Run → serviciul `api` → *Permissions* → elimină `allUsers` din rolul *Cloud Run Invoker* (aplicația nu mai poate apela API-ul, dar datele rămân intacte); sau deployează o versiune care refuză ruta afectată. Reactivezi după corecție |
| Acces neautorizat la vault | Ultima soluție: *Disable* versiunea cheii KMS (datele devin nedecriptabile până reactivezi); cere aprobare explicită, pentru că oprește aplicația |
| Reguli Firestore greșite | Deploy imediat al regulilor precedente (`git` sau din consolă), verifică cu testele de reguli |

### C. Investigare (primele 24 de ore)
1. **Jurnalul de acces al spațiului** (Setări → Jurnal de acces → *Exportă CSV*) sau, dacă adminul nu poate: `python scripts/incident_tools.py audit --project samwera-board-eu --workspace <ID> --since <data> --out incident.csv`.
   Caută: `pii.reveal` în volum neobișnuit, `ocr.extract`/`document.generate` din conturi sau adrese IP neobișnuite, schimbări de rol/membri, ștergeri.
2. **Cloud Logging** (erori, autentificări) și **Data Access audit logs** pentru accesul tehnic direct la Firestore/KMS.
3. **PITR** (7 zile): comparăm starea bazei de date cu cea de dinainte de incident, dacă s-au modificat sau șters date.
4. Stabilește: **ce date** (categorii: CNP, serie CI, adresă…), **câte persoane vizate** și **câte înregistrări**, **ce spații de lucru**, **cât timp**, **dacă datele au fost exfiltrate sau doar accesibile**.
5. Întreabă sub-împuterniciții relevanți dacă incidentul îi implică (Google Cloud, Azure).

### D. Evaluarea riscului (în cel mult 24 de ore)
| Întrebare | Indicii |
|---|---|
| Sunt date personale? | Dacă da, e o încălcare a datelor personale → notificăm operatorii |
| Riscul pentru persoane | **CNP + date din act de identitate = risc ridicat implicit** (furt de identitate). Datele criptate în vault, dacă cheia nu a fost expusă, reduc riscul (dar nu-l elimină dacă atacatorul a folosit aplicația în numele unui utilizator) |
| Datele erau protejate? | Criptate în vault și cheia nu a fost compromisă → risc mai mic. Date în clar accesate → risc mai mare |
| Sunt afectați cei mai vulnerabili? | Nu se prelucrează categorii speciale; dacă totuși apar, risc mai mare |
Decizia finală privind notificarea ANSPDCP și a persoanelor aparține **operatorului**; noi îi dăm o evaluare motivată și toate informațiile.

### E. Notificarea cabinetelor (în cel mult 48 de ore)
Trimite către administratorii spațiilor afectate, pe e-mail, cu **confirmare de primire**. Conținut minim (GDPR art. 33 alin. 3):
natura încălcării, categoriile și numărul aproximativ de persoane și de înregistrări, persoana de contact, consecințele probabile, măsurile luate și propuse.
Șablonul este în anexa 1. Dacă informațiile nu sunt complete, notifică inițial ce știi și promite o actualizare cu dată.

### F. Remediere și recuperare
- Aplică corecția (cod, configurare, rotație de chei/secrete), redeploy, verifică cu `tests/run_all.sh` și, unde e cazul, `python scripts/migrate_pii.py --all --verify`.
- Forțează reautentificarea dacă tokenurile ar putea fi compromise (revocare sesiuni).
- Restaurează date din PITR doar cu acordul cabinetelor afectate și după ce conținerea e sigură.
- Confirmă cabinetelor că serviciul e stabil.

### G. Închidere și învățăminte (în 14 zile)
Raport scurt în registru: cronologie, cauza rădăcină, impact, ce a mers și ce nu, acțiuni corective cu termen. Actualizează măsurile, testele, documentele legale și
registrul de prelucrări. Informează cabinetele despre concluzii.

## 6. Comunicare
- **Ton**: factual, fără speculații; spui ce știi, ce nu știi încă și când revii.
- **Nu** trimite date personale în notificări (nici CNP, nici nume): doar numere și categorii.
- Păstrează o copie a fiecărei comunicări în registru.

## 7. Scenarii tipice (playbook scurt)
1. **Cont Google al unui utilizator compromis** — dezactivează contul, exportă jurnalul spațiului pentru perioada suspectă, identifică ce a văzut/generat contul (`pii.reveal`, `ocr.extract`, `document.generate`), notifică cabinetul.
2. **Acces între spații de lucru (bug de autorizare)** — conținere imediată (secțiunea B), identifică toate cererile afectate din jurnale, notifică *toate* cabinetele posibil afectate, corectează și adaugă un test care reproduce bug-ul.
3. **Secret/cheie scurse** (Azure, service account) — rotație imediată, verifică utilizarea abuzivă în jurnalele furnizorului, evaluează dacă datele personale au fost accesibile.
4. **Ștergere sau criptare a datelor (ransomware/eroare de operare)** — oprește scrierile, restaurează din PITR (7 zile) pe o copie, verifică, apoi comută; notifică cabinetele (disponibilitate/integritate).
5. **Vulnerabilitate raportată de un terț** — confirmă primirea în 2 zile lucrătoare, reproduce, corectează, mulțumește; dacă a fost exploatată, tratează ca incident.
6. **Incident la un sub-împuternicit** (Google/Microsoft) — obține detaliile de la ei, evaluează dacă datele noastre sunt implicate, notifică cabinetele în termenul de 48 h de la luarea la cunoștință.
7. **Document trimis greșit** (eroare umană a unui utilizator al cabinetului) — este incidentul *operatorului*; îl ajutăm cu jurnalul de acces și cu informațiile cerute.

## Anexa 1 — Șablon de notificare către cabinet
> **Subiect:** Notificare de securitate — Cabinio (ref. INC-AAAA-NN)
>
> Bună ziua,
> Vă informăm că, la data de [data, ora], am luat cunoștință de un incident care [ar putea afecta / a afectat] datele din spațiul de lucru „[nume spațiu]”.
> **Ce s-a întâmplat:** [descriere factuală, în 2–3 propoziții].
> **Ce date sunt implicate:** [categorii, ex. CNP și serie CI criptate / nume și adrese] · aproximativ [număr] persoane vizate și [număr] înregistrări.
> **Consecințe probabile:** [ex. risc de acces neautorizat la datele clienților dumneavoastră].
> **Ce am făcut deja:** [conținere, remediere].
> **Ce vă recomandăm:** [acțiuni; ex. evaluați dacă este necesară notificarea ANSPDCP în 72 de ore de la momentul în care ați luat cunoștință și informarea persoanelor vizate].
> Vă putem pune la dispoziție jurnalul de acces al spațiului dumneavoastră pentru perioada relevantă.
> **Contact:** hcadmiel@gmail.com. Revenim cu o actualizare până la [data, ora].
>
> HOLHOȘ CADMIEL-GEORGEL PFA

## Anexa 2 — Ce oferim operatorului pentru notificarea ANSPDCP
Formularul se completează online la www.dataprotection.ro (secțiunea de notificare a încălcărilor). Îi punem la dispoziție: natura incidentului, categoriile și numărul aproximativ
de persoane și de înregistrări, datele de contact, consecințele probabile, măsurile luate și propuse, jurnalul de acces exportat.

## Anexa 3 — Unelte
- `python scripts/incident_tools.py contacts --project samwera-board-eu --all` — administratorii spațiilor (pentru notificare).
- `python scripts/incident_tools.py audit --project samwera-board-eu --workspace <ID> [--since 2026-09-01] --out incident.csv` — exportul jurnalului unui spațiu.
- Se rulează din Cloud Shell (credențiale ale contului tău), nu pe un laptop nesigur.
