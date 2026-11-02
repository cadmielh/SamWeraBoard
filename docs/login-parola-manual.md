# Login cu parolă: ce ai de făcut manual

Planul complet e în [login-parola.md](login-parola.md). Restul lucrărilor le fac eu. Ordinea de mai jos contează.

Decizii luate: `SIGNUP_MODE` rămâne `invite`, iar MFA e amânat. Un cont nou are nevoie de aprobarea ta ca să creeze cabinet.

## Înainte de testele pe proiectul real

Toate în proiectul `samwera-board-eu`.

### Firebase Console → Authentication

- [ ] **Settings → User actions:** verifică să fie activă protecția împotriva enumerării e-mailurilor.
- [ ] **Settings → Password policy:** minimum 12 caractere, mod **Require**, fără forțarea actualizării la login. Dacă opțiunea cere upgrade la Identity Platform, verifică prețul și pragul gratuit înainte să confirmi.
- [ ] **Settings → User account linking:** verifică să fie „un cont per adresă de e-mail”.
- [ ] **Sign-in method → Email/Password:** îl activezi doar când îți spun, pentru teste. Nu activa „Email link”.

### E-mailuri

- [ ] **Authentication → Templates:** adaugă domeniul `cabinio.ro` la expeditor și pune înregistrările DNS afișate de consolă la furnizorul domeniului.
- [ ] Setează limba română și numele expeditorului „Cabinio”.
- [ ] La **Action URL**, pune `https://cabinio.ro/__/auth/action`.
- [ ] Verifică în consolă limita zilnică de e-mailuri.
- [ ] Trimite un test către Gmail și Yahoo și spune-mi dacă ajung în Spam.

### Google Cloud Console

- [ ] **Obligatoriu înainte de deploy-ul etapei 2:** la clientul OAuth folosit și pentru login, completează **Authorized JavaScript origins**: `https://cabinio.ro`, `https://cabinio.web.app`, `http://localhost:5173`. `localhost` lipsește sigur (test din 3 noiembrie: `origin_mismatch`). Fără `cabinio.ro`, conectarea la Drive într-un tab nou va da aceeași eroare în producție. După completare, reluăm testul Drive.
- [ ] Pentru protecția anti-boți, activează **reCAPTCHA Enterprise API**. Verifică pragul gratuit. Configurarea (întâi „audit”, apoi „enforce”) o pregătesc eu ca o comandă pentru Cloud Shell.

## Înainte de lansarea publică

- [ ] **2FA pe contul Google de Super Admin.** Rămâne necesar și cu MFA-ul din aplicație amânat: după etapa 1, acest cont nu poate folosi decât login-ul Google, deci 2FA-ul lui Google e singura protecție suplimentară.
- [ ] **Teste cu conturi reale.** Îți dau o listă scurtă: o adresă Gmail, o adresă pe Google Workspace și una non-Google, plus două conturi Google pentru Drive.
- [ ] **Alerte de monitorizare și de buget** (restanța 5 din `de-facut.md`): eu pregătesc comenzile, tu le rulezi în Cloud Shell.
- [ ] **Revizie avocat** pentru textele legale modificate. Se suprapune cu revizia juridică amânată.
- [ ] **Spune „fă deploy”** după ce testezi pe localhost.
- [ ] **Activează Email/Password definitiv**, după deploy, la semnalul meu.

## După lansare

- [ ] Administratorii vor fi rugați să reaccepte Termenii, din cauza noii versiuni. Anunță-i dinainte.
- [ ] Urmărește în primele zile rata de autentificări eșuate, e-mailurile ajunse în Spam și solicitările de suport.
