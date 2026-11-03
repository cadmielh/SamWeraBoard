# Plan: autentificare cu e-mail și parolă

Stare la 1 noiembrie 2026: **plan revizuit, nimic implementat**. Pașii manuali sunt în [login-parola-manual.md](login-parola-manual.md).

## Rezultat urmărit

- Utilizatorul poate crea cont și se poate autentifica cu orice adresă de e-mail, pe lângă Google.
- Accesul rămâne condiționat de e-mailul verificat, deja impus de server și de regulile Firestore.
- Google Drive rămâne disponibil pentru orice cont, printr-o conectare separată.
- Contul de Super Admin nu devine mai slab din cauza parolei.

Estimare revizuită: **5–6 zile de lucru**, fără MFA, față de cele 2 zile estimate inițial. Diferența vine din conectarea Drive, restricțiile de securitate și testare.

Decizii ale proprietarului (2 noiembrie 2026): `SIGNUP_MODE` rămâne `invite`; MFA se amână și rămâne în [de-facut.md](de-facut.md).

## Decizii

| Subiect | Decizie | Motiv |
|---|---|---|
| Metodă | E-mail + parolă, prin Firebase Auth | Nu stocăm și nu procesăm parole pe serverul nostru |
| Parolă | Minimum 12 caractere, cu literă mare, literă mică, cifră și caracter special; politică impusă de Firebase și afișată în aplicație | Validarea din browser se poate ocoli |
| E-mail neverificat | Ecran dedicat, fără acces la date | Serverul și regulile îl resping deja |
| Drive | Conectare separată prin Google Identity Services, nu prin legarea contului Google de contul Firebase | Nu adaugă o metodă de login nedorită și merge cu orice cont Google |
| Client OAuth | Același client ca la login | Păstrează, cel mai probabil, accesul `drive.file` deja acordat; de confirmat la test |
| Deconectare | Se șterge tokenul Drive local, fără `revoke` | `revoke` poate afecta accesul acordat; comportamentul nu e confirmat |
| Super Admin | Doar sesiune Google, cât timp nu există MFA | Resetarea parolei nu trebuie să ocolească 2FA-ul Google |
| MFA | Amânat. Când se reia: TOTP, nu SMS | Risc acceptat cât timp înregistrarea e pe `invite`; TOTP nu are cost per mesaj și nici risc de SIM swap |
| reCAPTCHA | Neactivat (decizie din 3 noiembrie 2026). Se reia împreună cu MFA, înainte de `SIGNUP_MODE=open` | Cu `invite`, protecția la enumerare și limitele Firebase ajung. La activare: CSP-ul din [firebase.json](../firebase.json) trebuie să permită sursele reCAPTCHA, altfel login-ul cu parolă nu mai merge |
| Schimbarea e-mailului | În afara primei versiuni | Invitațiile și trialul depind de e-mail |
| Lansare | Providerul se activează public abia după etapa 5 | Cu providerul activ, API-ul acceptă conturi chiar dacă interfața e ascunsă |

## Etape

Etapele 1 și 2 aduc beneficii și fără parole și se pot publica separat.

### Etapa 1: întărirea rolurilor (0,5 zile)

Stare la 3 noiembrie 2026: cod și teste scrise, necomise și nepublicate. Testele cu emulator și cele 36 de teste ale regulilor Firestore trec.

1. [authz.py](../authz.py): `Principal` primește providerul din `firebase.sign_in_provider`.
2. `require_super_admin()` refuză sesiunile care nu sunt Google. Același criteriu se aplică la `_is_super_admin` din [workspaces_api.py](../workspaces_api.py).
3. [firestore.rules](../firestore.rules): aceeași condiție în `isSuperAdmin()` și la folosirea unui grant (`hasValidSuperAdminGrant`).
4. [AppLayout.tsx](../frontend/src/AppLayout.tsx): `applyPendingSuperAdminGrant` nu mai rulează pentru sesiuni care nu îndeplinesc condiția.
5. Teste în [firestore.rules.test.js](../tests/rules/firestore.rules.test.js) și [test_e2e_emulators.py](../tests/test_e2e_emulators.py).

### Etapa 2: Drive independent de login (1,5 zile)

Stare la 3 noiembrie 2026: cod scris, necomis și nepublicat. Testele automate trec. Acceptată de proprietar fără test cap-coadă: fereastra Google a dat `origin_mismatch` pe localhost, deci conectarea, salvarea în Drive, șabloanele Google Docs și anularea nu au fost verificate cu Google real. După completarea originilor, proprietarul a confirmat pe 3 noiembrie selecția din Drive pe localhost, inclusiv dintr-un tab nou. Salvarea în Drive și șabloanele Google Docs nu au fost testate manual; proprietarul le reia doar dacă sunt raportate probleme.

1. Modul nou `frontend/src/lib/driveAuth.ts`: `initTokenClient` cu scope `drive.file`, `login_hint` cu e-mailul utilizatorului, token și expirare în `sessionStorage`.
2. În context, lângă `accessToken`, apare `ensureDriveToken()`, apelat la începutul acțiunii declanșate de click. Google cere un gest al utilizatorului, altfel fereastra e blocată.
3. Se adaptează punctele care presupun acum tokenul:
   - [DriveFilePicker.tsx](../frontend/src/components/DriveFilePicker.tsx);
   - [DriveFolderPicker.tsx](../frontend/src/components/DriveFolderPicker.tsx);
   - [TemplateLibrary.tsx](../frontend/src/components/TemplateLibrary.tsx);
   - [TemplateFiller.tsx](../frontend/src/components/TemplateFiller.tsx): `driveTarget()`, `fillDocxFromDriveTemplate`, `fillGdoc`.
4. Mesajele din [drive.ts](../frontend/src/lib/drive.ts) nu mai spun „deconectează-te”, ci „reconectează Google Drive”.
5. Cazuri cu mesaj clar:
   - fereastră blocată sau închisă;
   - cont Google greșit;
   - șablon nepartajat cu acel cont (`not_granted` după `pickAgain`).
6. CSP în ambele blocuri de hosting din [firebase.json](../firebase.json): `https://accounts.google.com/gsi/client` la `script-src`, `https://accounts.google.com` la `connect-src`.
7. Variabilă nouă `VITE_GOOGLE_OAUTH_CLIENT_ID` (valoare publică).

Beneficiu pentru conturile Google: dispare mesajul de expirare după circa o oră și merge și într-un tab nou.

### Etapa 3: conturi cu parolă (2 zile)

Stare la 3 noiembrie 2026: cod scris, necomis și nepublicat, testat automat și de proprietar pe emulatoare (creare cont, confirmare, cabinet, login, resetare, cont neaprobat). Rămân de verificat pe proiectul real e-mailurile și paginile Firebase de confirmare și resetare. Formularul e oprit implicit și pornește doar cu `VITE_PASSWORD_LOGIN=1`, care se setează în `.env.eu.local` la lansare, după activarea providerului.

1. [firebase.ts](../frontend/src/lib/firebase.ts): `signInWithPassword`, `registerWithPassword`, `resetPassword`, `resendVerification`, `auth.languageCode = 'ro'`.
2. La înregistrare: `createUserWithEmailAndPassword`, `updateProfile` cu numele, `sendEmailVerification`. Tokenul se reîmprospătează înainte de primul apel API, altfel serverul scrie e-mailul în loc de nume la membrii cabinetului.
3. Fereastră de autentificare comună, deschisă din cele două butoane din [LandingPage.tsx](../frontend/src/pages/LandingPage.tsx), cu Google, login, creare cont și parolă uitată. Câmpurile folosesc `autocomplete="email"`, `current-password`, `new-password`.
4. Mesaje de eroare generice: niciun text nu confirmă dacă adresa are cont.
5. [AppLayout.tsx](../frontend/src/AppLayout.tsx): `useWorkspace` primește `null` până când e-mailul e verificat, altfel apare eronat „Nu am putut încărca spațiile de lucru”. Ecranul nou permite retrimiterea, verificarea stării (`reload` + `getIdToken(true)`) și deconectarea.
6. `onSignIn` setează direct utilizatorul; trebuie să treacă prin aceeași verificare.
7. Cont creat fără aprobare în modul `invite`: mesaj clar în locul erorii `creation_not_allowed`.

### Etapa 4: administrarea contului (1 zi)

Stare la 3 noiembrie 2026: cod scris și testat automat, necomis și nepublicat. Cardul „Cont” din Setări așteaptă testul proprietarului.

1. Secțiune „Cont” în [SetariPage.tsx](../frontend/src/pages/SetariPage.tsx): schimbarea parolei cu reautentificare și stare Drive.
2. „Deconectează toate dispozitivele”: rută nouă pe server cu `revoke_refresh_tokens`. Serverul respinge imediat sesiunile, iar un ID token existent mai poate citi direct din Firestore până la expirare, maximum o oră.
3. Pe clienți, un 401 de la API încheie sesiunea, în loc să lase ecrane cu erori.

Amânat: MFA cu TOTP (înrolare cu cod QR, pas de cod la login) și obligativitatea lui pentru administratorii cu parolă. **Se reia obligatoriu înainte de trecerea la `SIGNUP_MODE=open`.**

### Etapa 5: texte legale și documentație (0,5 zile)

Stare la 3 noiembrie 2026: texte actualizate, necomise și nepublicate, nerevizuite de avocat. Termenii au noua versiune `2026-11-03`, care trebuie să ajungă în producție împreună cu activarea parolelor: textele descriu login-ul cu parolă, iar schimbarea versiunii cere reacceptarea de către administratori. Dacă lansarea e în altă zi, versiunea se actualizează la acea dată.

1. [LegalPages.tsx](../frontend/src/pages/legal/LegalPages.tsx):
   - accesul „cu un cont Google” (Termeni);
   - datele de cont: fotografia și identificatorul Google devin „după caz”, parola se stochează doar ca hash de Google;
   - autentificarea din pagina Securitate și din Sub-împuterniciți;
   - MFA rămâne la „Planificat”.
2. [LandingPage.tsx](../frontend/src/pages/LandingPage.tsx): întrebările frecvente și nota despre „Autentificare cu Google”.
3. `TOS_VERSION` în [legal_versions.py](../legal_versions.py) și [legal.ts](../frontend/src/lib/legal.ts). `DPA_VERSION` se schimbă doar dacă textul sau anexa DPA se modifică. Orice schimbare de versiune cere reacceptarea de către toți administratorii.
4. [procedura-incident.md](procedura-incident.md): cont compromis cu parolă, inclusiv revocarea sesiunilor. Se actualizează și [google-drive.md](google-drive.md).

### Etapa 6: testare și lansare (1 zi)

Automat: `tests/run_all.sh`, `tsc`, teste pentru `driveAuth`, fluxul de verificare și interzicerea Super Admin cu parolă.

Pe emulator (`npm run dev:emu`): înregistrare, verificare, resetare, invitație acceptată, generare fără Drive.

Pe proiectul real (`npm run dev:google`), pentru ce emulatorul nu poate garanta: politica de parolă, antetele de pe pagina `/__/auth/action`.

Deploy doar la instrucțiunea explicită a proprietarului, cu `npm run build:eu`.

## Revizuire

### Riscuri găsite în cod

| # | Risc | Soluție |
|---|---|---|
| 1 | Resetarea parolei poate adăuga parolă unui cont Google existent, ceea ce ocolește 2FA-ul Google. Afectează și Super Admin | Etapa 1 pentru Super Admin. Pentru administratorii de cabinet riscul rămâne acceptat până la MFA |
| 2 | Grantul de Super Admin se consumă la orice login, indiferent de metodă | Etapa 1 |
| 3 | Contul neverificat lovește regulile Firestore și vede o eroare înșelătoare | Etapa 3, pasul 5 |
| 4 | Fără token, salvarea în Drive eșuează abia după generare (`driveTarget()`) | Tokenul se obține înainte de generare |
| 5 | Mesajele Drive cer deconectare, inutil pentru un cont cu parolă | Etapa 2, pasul 4 |
| 6 | `name` lipsește din tokenul inițial și ajunge greșit în `members` | Etapa 3, pasul 2 |
| 7 | CSP e doar `Report-Only`, iar un formular de parolă crește miza unui XSS | CSP impus înainte de lansarea publică, după verificarea rapoartelor |
| 8 | Limitele din [ratelimit.py](../ratelimit.py) nu acoperă login-ul, care merge direct la Firebase | Protecțiile Firebase și alerte; reCAPTCHA înainte de `open` |
| 9 | Trial: domeniile personalizate și adresele de unică folosință ocolesc parțial `normalize_email` | `SIGNUP_MODE=invite` limitează riscul; cota OCR de trial e de 30/zi per cabinet. Blocarea domeniilor temporare e necesară înainte de `open` |
| 10 | Fișierele Drive sunt legate de contul Google conectat, care poate diferi de e-mailul din Cabinio | `login_hint`, mesaj clar și, dacă se poate, afișarea contului conectat |

### Comportamente Firebase care trebuie confirmate prin test

Documentația consultată nu le lămurește, așa că devin **condiții de lansare**:

1. **Preluare anticipată** (trecut pe Gmail, 3 noiembrie: parola veche e refuzată după login-ul Google): un atacator creează cont cu parolă pe adresa victimei, fără verificare, iar victima intră apoi cu Google. Parola atacatorului nu trebuie să mai funcționeze. Se testează pe o adresă Gmail și pe una Google Workspace. Dacă parola supraviețuiește, lansarea se oprește până la remediere.
2. **Înregistrare pe o adresă existentă:** ce eroare primește utilizatorul și dacă dezvăluie existența contului.
3. **Resetare pe cont exclusiv Google** (trecut, 3 noiembrie: e-mailul vine, iar apoi merg Google și parola): dacă trimite e-mail și ce metode rămân active.
4. **Accesul `drive.file`:** rămâne valabil între login-ul Firebase și clientul GIS? Conectarea merge dintr-un tab nou (3 noiembrie). Accesul la fișiere alese anterior nu a fost verificat explicit.

### Lăsate intenționat pentru mai târziu

- MFA cu TOTP: amânat de proprietar, obligatoriu înainte de `SIGNUP_MODE=open`.
- Verificarea parolelor compromise (HIBP): cere un apel extern.
- Link magic pe e-mail: incomod când e-mailul e pe alt dispozitiv.
- MFA obligatoriu pentru administratorii cu Google: se tratează în restanța existentă din [de-facut.md](de-facut.md).
- Restrângerea `connect-src` din CSP (`*.run.app` la adresa exactă a API-ului): decizie din 3 noiembrie 2026. Un script injectat ar avea oricum alte căi deschise (`*.googleapis.com`, adică un proiect Firebase al atacatorului, sau o redirecționare), iar o adresă greșită ar opri apelurile către API.

### Rollback

Dezactivarea providerului Email/Password oprește înregistrările și login-ul cu parolă, dar blochează și conturile cu parolă existente. Dacă există deja astfel de conturi, soluția de rezervă e conectarea cu Google pe aceeași adresă, unde e posibil, sau reactivarea după remediere. Etapele 1 și 2 nu trebuie anulate.

## Criterii de acceptare

- [ ] Cont nou cu parolă: verificare, invitație acceptată, generare document.
- [ ] Contul neverificat nu citește și nu scrie nimic.
- [ ] Contul cu parolă conectează Drive: alege act, șablon, folder și salvează documentul.
- [ ] Contul Google funcționează ca înainte, plus reconectare Drive fără deconectare.
- [ ] Super Admin cu sesiune de parolă primește 403 pe server și refuz în reguli.
- [ ] Cele 4 comportamente Firebase sunt testate și rezultatele notate aici.
- [ ] Textele legale sunt actualizate, iar `TOS_VERSION` e sincronizat în ambele locuri.

## Surse

- [Politici de parolă](https://docs.cloud.google.com/identity-platform/docs/password-policy)
- [Protecția împotriva enumerării e-mailurilor](https://docs.cloud.google.com/identity-platform/docs/admin/email-enumeration-protection)
- [MFA TOTP](https://docs.cloud.google.com/identity-platform/docs/admin/enabling-totp-mfa)
- [reCAPTCHA Enterprise cu Identity Platform](https://docs.cloud.google.com/identity-platform/docs/recaptcha-enterprise)
- [Google Identity Services, modelul cu token](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
