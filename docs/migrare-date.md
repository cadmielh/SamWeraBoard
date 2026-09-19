# Migrarea datelor: `samwera-board` (vechi) → `samwera-board-eu`

Scop: la prima autentificare în aplicația nouă, utilizatorii găsesc totul ca înainte (aceleași workspace-uri,
clienți, dosare, sarcini, șabloane, roluri, super admin). CNP-urile trec în vault-ul criptat.

Conținutul proiectului vechi la data pregătirii: 3 workspace-uri, 53 clienți (120 persoane cu CNP/serie),
54 dosare, 50 sarcini, 2 șabloane, 4 conturi Google, 34 înregistrări de istoric de extracții.

## Ce se migrează și ce nu
| Se migrează (identic) | Se transformă | Nu se copiază |
|---|---|---|
| workspace-uri (nume, membri, owner, facturare, feature flags), dosare, sarcini, șabloane, istoricul generărilor, `users` (workspace activ, **super admin**), id-uri și marcaje de timp | CNP + serie CI → vault criptat (în fișă rămân mascate); istoricul de extracții → doar sursă/dată (expiră la 30 de zile); invitațiile în așteptare → format nou (14 zile) | `fields` din istoricul de extracții (CNP, adresă în clar); invitațiile deja folosite |

Workspace-urile migrate **nu au acceptat termenii/DPA**: adminul vede un ecran de acceptare la primul login, iar
până atunci serverul refuză OCR-ul și vault-ul (`consent_required`). Datele nu se schimbă prin acceptare.

## Pași (în ordine)
### 1. Conturile de autentificare (UID-urile se păstrează) — făcut
```bash
firebase auth:export conturi.json --format=json --project samwera-board
firebase auth:import conturi.json --project samwera-board-eu
```
Un cont deja existent în proiectul nou cu aceeași identitate Google (creat la un test de login) trebuie șters din
Firebase Console → Authentication → Users **înainte** de import, altfel apar două conturi cu același e-mail.
Verificare: `firebase auth:export` din proiectul nou trebuie să arate aceleași `localId` ca în cel vechi.

### 2. Datele — din Cloud Shell (ai acolo acces la ambele proiecte și la cheia KMS)
Pe laptop:
```bash
zip migrare.zip scripts/migrate_project.py scripts/migrate_pii.py vault.py authz.py legal_versions.py
```
În Cloud Shell (deschis pe proiectul `samwera-board-eu`): încarci `migrare.zip` (meniul ⋮ → Upload), apoi:
```bash
unzip -o migrare.zip && mkdir -p scripts && \
pip install --user flask firebase-admin google-cloud-firestore google-cloud-kms cryptography
export VAULT_KMS_KEY=projects/samwera-board-eu/locations/europe-west3/keyRings/samwera/cryptoKeys/vault-kek
python3 scripts/migrate_project.py --source samwera-board --target samwera-board-eu --dry-run   # doar numără
python3 scripts/migrate_project.py --source samwera-board --target samwera-board-eu             # migrarea
python3 scripts/migrate_project.py --source samwera-board --target samwera-board-eu --verify-only
```
(Dacă `unzip` pune fișierele altfel, rulați scriptul din folderul care conține `scripts/`, `vault.py`, `authz.py`.)
Rezultatul trebuie să fie: numărul de documente coincide, niciun CNP în clar. Scriptul afișează doar numere.
Se poate rula de mai multe ori (idempotent: aceleași id-uri, aceleași `pid`-uri în vault).

Repetiția locală (deja făcută cu datele reale, în emulator): 120/120 intrări din vault identice cu sursa,
0 CNP în clar, 53/53 fișe cu câmpurile ne-sensibile identice.

### 3. Trecerea utilizatorilor (cutover)
1. Anunță cei 4 utilizatori: nu mai lucrează în aplicația veche de la un moment stabilit.
2. Rulează pasul 2 (datele nu se mai schimbă în sursă).
3. Le trimiți adresa nouă. Se loghează cu Google (o dată: ecranul „aplicație neverificată" → *Advanced*), își găsesc
   workspace-urile; adminul acceptă termenii/DPA.
4. Preferințele de interfață (temă, fonturi, coloane afișate) stau în browser și nu se mută: se refac în 1 minut.

### 4. Curățenie în proiectul vechi (după ce totul e confirmat)
Datele personale din proiectul vechi (inclusiv cele 34 de înregistrări de istoric cu CNP în clar) trebuie eliminate:
șterge datele/proiectul vechi sau măcar rulează `python scripts/migrate_pii.py --purge-extractions` și oprește accesul.
Regiunea proiectului vechi nu e specificată în consolă, deci nu poate fi garantat că e în UE.
Atenție: și deploy-urile din proiectul vechi au încărcat, fără `functions.ignore`, cheia de service account și fișierele `.env` locale (în bucket-urile
`gcf-sources`/`gcf-v2-sources` ale proiectului vechi). Ștergerea proiectului vechi le elimină; înainte de asta, revocă cheia `firebase-service-account.json`
(Cloud Console → IAM → Service Accounts → Keys) și rotește cheia Azure.
