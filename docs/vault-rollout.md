# Vault CNP — punere în producție

Ce face vault-ul și cum e construit: vezi `vault.py`, `pii_api.py`, `frontend/src/lib/pii.ts`.
Documentul de față e lista de pași pentru activare, în ordinea în care trebuie făcuți.

> Fără cheie KMS configurată, serverul răspunde `503` la salvarea unui client cu CNP/serie CI.
> Deci pașii 1–2 vin **înainte** de orice deploy al acestei versiuni.

## 0. Înainte de orice
- Toate testele trec: `tests/run_all.sh` (pytest + reguli + E2E cu Auth reală + vitest). Necesită Java pentru emulator.
- Proiectul țintă are Firestore și funcțiile în regiune UE (vezi planul de conformitate, F0). Nu activați vault-ul într-un proiect în afara UE.
- Baza de date UE are deja **recuperare la un moment anterior (PITR, 7 zile)** și **protecție la ștergere** activate (`firebase firestore:databases:get "(default)" --project samwera-board-eu`).
  Pentru migrarea în cloud nu e nevoie de un export separat: baza țintă e goală, iar sursa nu se modifică.
- **Copie de siguranță înainte de orice operațiune care modifică date existente într-o bază cu date** (cale de întoarcere):
  `gcloud firestore export gs://<bucket-UE>/pre-vault-$(date +%F) --project <proiect>`

## 0b. Test local cu emulatoare (recomandat înainte de deploy)
Rulează aplicația complet local (Auth + Firestore emulate, vault pe cheia locală), fără să atingă cloudul:
```bash
./scripts/dev_local.sh emulators     # terminal 1 — interfață Firestore/Auth: http://127.0.0.1:4000
./scripts/dev_local.sh api           # terminal 2 — API pe :5001 (pe macOS, :5000 e ocupat de AirPlay)
cd frontend && npm run dev:emu       # terminal 3 — aplicația: http://localhost:5173
```
La login apare fereastra „Sign in with Google" a emulatorului: alegi *Add new account* → *Auto-generate user information*.
Cu al doilea/al treilea cont (ferestre anonime) parcurgi tabelul de la secțiunea 4; în interfața emulatorului (4000 → Firestore)
verifici că `cnp` e gol în `clienti/{id}`. Nu funcționează în modul local: funcțiile Google Drive/Docs (token fals).
Datele locale se păstrează în `.emulator-data/` (ignorat de git).

## 1. Cheia KMS (o dată per proiect)
```bash
PROJECT_ID=<proiect> ./scripts/setup_kms.sh
```
Scriptul creează inelul și cheia în UE (rotație la 90 de zile), un **cont de serviciu dedicat** pentru funcție (`api-runtime`, cu drepturi minime:
`datastore.user`, `firebaseauth.viewer`, `logging.logWriter`), îi acordă **doar** `cryptoKeyEncrypterDecrypter` pe cheie și activează TTL pe `expireAt`.
Contul implicit Compute nu se folosește (are rol de Editor și, în proiecte noi, poate lipsi).
Numele din script (`samwera` / `vault-kek`, `europe-west3`) corespund deja valorii din
[.env.samwera-board-eu](../.env.samwera-board-eu) (`VAULT_KMS_KEY`), deci nu mai ai nimic de copiat dacă le păstrezi.
Funcția rulează cu acest cont prin `RUNTIME_SERVICE_ACCOUNT` din [.env.samwera-board-eu](../.env.samwera-board-eu) (citit în `main.py`).

> **Atenție:** variabilele de mediu ale funcției vin din fișiere `.env` (`.env` și `.env.<id-proiect>`),
> **nu** din `firebase.json` (cheia `environmentVariables` de acolo nu există în schema Firebase și e ignorată).
> Fișierul `.env.local` nu se încarcă la deploy — acolo stau doar valorile de dezvoltare (`VAULT_LOCAL_KEK`, localhost).

## 1b. Ce se încarcă la deploy-ul funcțiilor — verifică ÎNAINTE
Firebase CLI **ignoră `.firebaseignore`** pentru funcții. Singura protecție este `functions[0].ignore` din [firebase.json](../firebase.json)
(fără el, arhiva ar include `.venv`, cheile și fișierele `.env` locale — s-a întâmplat la primul deploy, 740 MB).
```bash
node scripts/list_deploy_package.js      # trebuie: ~28 de fișiere, ~1,3 MB, fără .env / .venv / chei / date
```
La deploy, linia `functions: packaged … (NNN KB)` trebuie să arate sub 1–2 MB. Dacă arată sute de MB, oprește-l imediat (`Ctrl+C`).
Testul `tests/test_deploy_hygiene.py` păstrează excluderile obligatorii.

## 2. Deploy — în această ordine (proiect `samwera-board-eu`)
1. `firebase deploy --only functions --project samwera-board-eu`
   (citește `.env` + `.env.samwera-board-eu`; secretul `AZURE_DOCUMENT_INTELLIGENCE_KEY` trebuie setat înainte:
   `firebase functions:secrets:set AZURE_DOCUMENT_INTELLIGENCE_KEY --project samwera-board-eu`)
2. `firebase deploy --only firestore:rules,firestore:indexes --project samwera-board-eu`
3. **Înainte de build:** pentru funcțiile Google Drive completează `VITE_GOOGLE_API_KEY` în `frontend/.env.eu.local` (vezi [docs/google-drive.md](google-drive.md): cheie API pentru Picker, restricționată). Fără ea, butoanele Drive spun că funcția nu e activată; restul aplicației merge.
   `cd frontend && npm run build:eu` (**nu** `npm run build`: ar folosi configurarea proiectului vechi din `.env.local`), apoi
   `firebase deploy --only hosting --project samwera-board-eu`
4. După primul deploy, completați `VITE_OCR_BASE` în `frontend/.env.eu.local` cu adresa funcției (`https://api-…a.run.app`),
   rulați din nou `npm run build:eu` și `firebase deploy --only hosting --project samwera-board-eu`.

Ordinea contează: regulile noi interzic scrierile pe care le făcea vechiul frontend (membri, invitații,
ștergerea clienților), iar noul frontend are nevoie de noile rute API.

## 3. Migrarea datelor existente
Rulați de pe un calculator cu credențiale pe proiect și cu **aceeași** `VAULT_KMS_KEY` în mediu:
```bash
python scripts/migrate_pii.py --all --dry-run          # cât ar migra
python scripts/migrate_pii.py --all                    # migrarea propriu-zisă (idempotentă)
python scripts/migrate_pii.py --all --verify           # trebuie să iasă cu 0 (cod 0)
python scripts/migrate_pii.py --purge-extractions      # curăță istoricul vechi de extrageri
```
Nu lăsați pe nimeni să editeze clienți între deploy și migrare cu un frontend vechi în cache
(reîncărcare forțată). Dacă `--verify` mai găsește CNP în clar, rerulați migrarea.

## 4. Verificare manuală în browser (nu se poate automatiza complet)
Cu două conturi (A = admin, B = membru „doar citire") pe același workspace și un cont C străin:

| # | Pas | Rezultat așteptat |
|---|-----|-------------------|
| 1 | A scanează un buletin și salvează clientul | Salvare reușită; în Firestore (`clienti/{id}`) `cnp` e gol, `cnpMasked` are ultimele 4 cifre; în consola Firestore NU apare CNP-ul nicăieri |
| 2 | A deschide fișa clientului | CNP mascat + buton „Arată CNP și serie"; după click apar valorile |
| 3 | A editează clientul (poarta de încărcare) și schimbă adresa | Formularul afișează CNP-ul real; după salvare nimic nu se pierde (re-deschidere: CNP identic) |
| 4 | A golește CNP-ul unei persoane și salvează | Persoana rămâne fără CNP (mască goală); vault-ul nu mai are intrarea |
| 5 | A generează un document (PF și PJ) | Documentul conține CNP și serie corecte |
| 6 | A scoate un asociat din fișă și salvează | Persoana dispare și din vault (`--verify` rămâne 0) |
| 7 | B (doar citire) deschide fișa și apasă „Arată" | Funcționează; B nu poate edita/salva clienți |
| 8 | C încearcă cereri către clientul lui A (alt workspace) | 403 pe API; niciun acces în Firestore |
| 9 | A șterge clientul | Dispare fișa, vault-ul și istoricul generărilor |
| 10 | Jurnal (Setări → jurnal, sau `GET /workspaces/{id}/audit`) | Apar `pii.write`, `pii.reveal` (cu scop și număr de persoane, fără valori), `client.delete` |
| 11 | Oprire temporară a KMS (simulare: `VAULT_KMS_KEY` greșit) | Editarea unui client cu CNP e oprită cu mesaj de eroare; nu se suprascrie nimic |
| 12 | Istoric extrageri (buton „Istoric") | Doar nume sursă și dată; niciun nume/CNP |

## 5. Paginile legale (generice, pentru toate cabinetele)
Textele din `frontend/src/pages/legal/` se aplică identic oricărui cabinet (acesta apare ca „Operator”), fără nume de completat per cabinet.
Singurul loc de completat, **o singură dată**, este identitatea Furnizorului în `frontend/src/lib/legalConfig.ts`
(`legalName`, `registration`, `address`, `contactEmail`, opțional `securityEmail`). Câmpurile necompletate sunt omise din pagini;
legea cere însă identificarea furnizorului și un contact pentru cererile persoanelor vizate, deci completați cel puțin acestea înainte de lansarea către cabinete.

Paginile afirmă că **sunt în vigoare** lucruri care devin adevărate abia la deploy. Înainte să le lăsați publice, confirmați:
- [ ] funcția, baza de date și cheia KMS sunt în `europe-west3` (`firebase functions:list`, consola Firestore, `gcloud kms keys list`);
- [ ] `VAULT_KMS_KEY` e setat în `.env.samwera-board-eu` și `--verify` iese cu 0;
- [ ] resursa Azure e în Sweden Central și secretul din Secret Manager e valid;
- [ ] TTL activ pe `expireAt` (istoric extrageri, jurnal de audit, **rateLimits**): `gcloud firestore fields ttls list`
      (pentru `rateLimits`: `gcloud firestore fields ttls update expireAt --collection-group=rateLimits --enable-ttl`);
- [x] procedura scrisă de incident există: [procedura-incident.md](procedura-incident.md) (parcurgeți secțiunea 4 „Pregătire”: alerte Monitoring, Data Access audit logs, exercițiu);
- [ ] TTL activ și pe `rateLimits` (vezi mai sus), altfel contoarele de limitare nu se șterg singure.
La schimbarea textelor, actualizați versiunea în `frontend/src/lib/legal.ts` și `legal_versions.py` (toate spațiile vor cere reacceptarea).

## 6. După activare
- Programați `--verify` periodic (ex. săptămânal) și după orice deploy de frontend.
- Notați în registrul de prelucrări/DPIA măsura (criptare per workspace, KMS UE, acces auditat).

## 7. Încetarea contractului cu un cabinet (DPA: ștergere în cel mult 30 de zile)
Din Cloud Shell, cu credențialele tale (întâi, dacă cabinetul cere, exportă-i jurnalul: `scripts/incident_tools.py audit`):
```bash
python scripts/delete_workspace.py --project samwera-board-eu --workspace <ID> --dry-run          # arată ce se șterge
python scripts/delete_workspace.py --project samwera-board-eu --workspace <ID> --confirm <ID>     # ștergere definitivă
```
Blochează accesul, distruge cheia de date (valorile din vault devin ilizibile chiar și în copiile de siguranță), șterge tot ce ține de workspace
și lasă în `deletionLog/<ID>` o dovadă fără date personale. Copiile PITR (7 zile) expiră singure. Notează ștergerea în registrul de prelucrări.

## Limitări cunoscute (declarate, nu ascunse)
- Ștergerea cheii unui workspace (`vault.destroy_workspace_key`) nu face backup-urile ilizibile imediat:
  copiile de backup păstrează cheia învelită până expiră retenția lor. Crypto-shredding complet cere KEK per workspace.
- CNP-ul ajunge în browser când se editează/generează și în documentele generate (inclusiv în Drive-ul utilizatorului).
- Generarea documentelor primește încă datele de la frontend (nu le citește singur serverul din vault).
- Regulile Firestore nu pot interzice scrierea CNP în clar în câmpurile de tip listă; se acoperă prin `--verify`.
