# Login cu parolă: ce ai de făcut manual

Planul complet e în [login-parola.md](login-parola.md). Fă pașii în ordine. Unde scrie **Eu**, îmi spui „gata” și continui eu.

Deciziile sunt luate: `SIGNUP_MODE` rămâne `invite`, iar MFA e amânat. Toate setările sunt în proiectul `samwera-board-eu`. Numele din consolă pot diferi puțin de cele de aici; dacă nu găsești o opțiune, spune-mi ce vezi.

## Pasul 0: citești textele legale (5 minute)

1. Citește modificările din `frontend/src/pages/legal/LegalPages.tsx`.
2. Spune-mi „comite textele” sau ce vrei schimbat.

## Pasul 1: clientul OAuth (5 minute)

Repară conectarea la Drive. Fără acest pas, Drive dă `origin_mismatch` și în producție.

1. Deschide [clientul OAuth](https://console.cloud.google.com/auth/clients/1000687240483-vcgv0dbm9l80st0p39lvlb1qvtiojr9i.apps.googleusercontent.com?project=samwera-board-eu).
2. La **Authorized JavaScript origins**, verifică să existe aceste trei rânduri și adaugă-le pe cele lipsă:
   - `https://cabinio.ro`
   - `https://cabinio.web.app`
   - `http://localhost:5173`
3. Apasă **Save** și așteaptă câteva minute.

**Rezultat:** fără erori la salvare. Fără `/` la finalul adreselor.

## Pasul 2: testul Drive pe localhost (10 minute)

Pe `http://localhost:5173`, autentificat cu Google:

1. Deschide `/extragere` într-un **tab nou** și alege „Alege din Drive”. Trebuie să apară fereastra Google, apoi selectorul.
2. Reține dacă Google îți cere iar acordul pentru Drive.
3. Generează un document cu destinația Drive și un folder ales. Trebuie să apară în acel folder.
4. Dacă ai un șablon Google Docs, generează un document din el, fără să-l alegi din nou.
5. Într-un alt tab nou, alege Drive și închide fereastra Google. Trebuie să apară „Conectarea la Google Drive a fost anulată.”.

Trimite-mi ce a mers și ce nu, inclusiv răspunsul de la punctul 2.

## Pasul 3: setările Firebase Authentication (10 minute)

Deschide [setările Authentication](https://console.firebase.google.com/project/samwera-board-eu/authentication/settings).

1. **User actions:** verifică să fie activă **Email enumeration protection**. Dacă nu e, activeaz-o.
2. **User account linking:** verifică să fie **Link accounts that use the same email** (un cont per adresă).
3. **Password policy:**
   - lungime minimă: `12`;
   - cerințe: literă mare, literă mică, caracter special, cifră (setate pe 3 noiembrie);
   - mod de aplicare: **Require**;
   - forțarea actualizării la login: **dezactivată**, altfel poți bloca utilizatori.
   - Dacă opțiunea cere upgrade la Identity Platform, oprește-te și spune-mi prețul și pragul gratuit afișate.
4. Apasă **Save**.

## Pasul 4: e-mailurile de pe `cabinio.ro` (20 de minute, plus așteptarea DNS)

Deschide [șabloanele de e-mail](https://console.firebase.google.com/project/samwera-board-eu/authentication/emails).

1. Selectează **Email address verification** și apasă pe creion.
2. La **From**, alege **Customize domain**, scrie `cabinio.ro` și continuă.
3. Consola afișează câteva înregistrări DNS. Adaugă-le exact așa la furnizorul domeniului, fără să modifici înregistrările existente.
4. Revino în consolă și apasă **Verify**. Propagarea poate dura până la 48 de ore, de obicei mai puțin.
5. După verificare, setează:
   - **Sender name:** `Cabinio`;
   - **From:** `noreply@cabinio.ro`;
   - **Reply to:** adresa ta de contact;
   - limba șabloanelor: **română**.
6. **Action URL rămâne implicită.** Firebase refuză schimbarea pe acest proiect, cu `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED` (3 noiembrie), iar cauza nu e documentată. Linkurile din e-mailuri deschid o adresă `firebaseapp.com`.
7. Repetă numele expeditorului și limba pentru **Password reset**.
8. Notează limita zilnică de e-mailuri, dacă e afișată, și spune-mi-o.

## Pasul 5: activezi parola pentru test

**Eu:** înainte, pornesc aplicația locală cu formularul de parolă activ.

1. Deschide [metodele de autentificare](https://console.firebase.google.com/project/samwera-board-eu/authentication/providers).
2. Apasă **Add new provider → Email/Password**.
3. Activează **Email/Password** și lasă **Email link** dezactivat.
4. Apasă **Save**.

Cât timp e activă, oricine poate crea un cont prin API. Riscul e mic, pentru că un cont fără aprobare nu poate crea cabinet, dar pasul 7 o dezactivează din nou.

## Pasul 6: testele pe proiectul real (30 de minute)

Stare la 3 noiembrie 2026: A, D și E sunt trecute. **B e trecut pe Gmail**: login-ul Google intră direct, fără mesaj, iar parola veche e refuzată după aceea. Nu există o adresă Google Workspace pentru test, deci B se încheie aici. **C e trecut**: un cont doar Google primește e-mailul de resetare, iar după setarea parolei merg ambele metode. Pentru ele, reactivează Email/Password ca la pasul 5, apoi dezactivează-l la loc.

Ai nevoie de:
- o adresă Gmail pe care o poți folosi pentru test și pe care **nu** ai cont în Cabinio;
- o adresă de pe Google Workspace, tot fără cont, dacă ai una;
- o adresă non-Google, de exemplu Yahoo;
- pentru testul C, o adresă cu cont Google existent în Cabinio, care nu e Super Admin. Testul îi adaugă o parolă.

**A. E-mailuri, cu adresa non-Google**
1. Creează un cont. E-mailul de confirmare trebuie să ajungă, de pe `cabinio.ro`, în română. Notează dacă e în Spam.
2. Deschide linkul și revino la aplicație. Trebuie să poți continua.
3. Fă o resetare de parolă. Pagina se deschide pe `samwera-board-eu.firebaseapp.com`, iar parola nouă trebuie să se salveze.
4. Pe pagina de resetare, încearcă o parolă fără caracter special. Trebuie refuzată.
5. `Parola-Buna-2026` a fost acceptată de Firebase pe pagina de resetare (3 noiembrie), deci aplicația acceptă acum `-` și celelalte semne de punctuație.

**B. Cont creat pe adresa altcuiva (blocant)**. Repetă pentru Gmail și pentru Google Workspace:
1. Creează un cont cu parolă, de exemplu `Test!parola-veche2026`, și **nu** deschide linkul de confirmare.
2. Deconectează-te.
3. Autentifică-te cu **Google** pe aceeași adresă. Notează ce se întâmplă și mesajul exact.
4. Deconectează-te și încearcă `Test!parola-veche2026`. **Trebuie să fie refuzată.**

Dacă parola veche încă merge, oprește testele și spune-mi: lansarea e blocată până la remediere.

**C. Resetare pe cont exclusiv Google**
1. Cere resetarea parolei pentru o adresă cu cont Google.
2. Notează dacă ajunge e-mailul. Setează o parolă și verifică dacă merg ambele metode.

**D. Adresă deja folosită**
1. Încearcă să creezi un cont cu adresa din testul A.
2. Trimite-mi mesajul afișat.

**E. Rolul de Super Admin**
1. Autentificat cu Google pe contul tău, deschide `/super-admin`. Trebuie să meargă.

**Eu:** notez rezultatele în plan și remediez ce e nevoie.

## Pasul 7: dezactivezi parola până la lansare

1. În [metodele de autentificare](https://console.firebase.google.com/project/samwera-board-eu/authentication/providers), dezactivează **Email/Password**.
2. La [Users](https://console.firebase.google.com/project/samwera-board-eu/authentication/users), șterge conturile create doar pentru test.

Nu șterge contul tău de Super Admin. Dacă ai folosit la testul C un cont real, trimite-mi adresa și verificăm ce metode i-au rămas.

## Pasul 8: securitatea contului de Super Admin

Făcut (3 noiembrie): contul Google de Super Admin are verificarea în doi pași activă.

## Pasul 9: analiza textelor legale

Făcută fără avocat (3 noiembrie). DPA rămâne la versiunea `2026-09-18`, fără reacceptare:
- hash-ul parolei e dată de cont, unde Furnizorul e operator conform Politicii de confidențialitate, iar punctul 2 din DPA acoperă doar datele clienților Operatorului;
- Firebase Authentication e deja sub-împuternicit, deci nu apare o verigă nouă și nu se aplică preavizul de 30 de zile din punctul 4 din DPA.

Revizia juridică generală rămâne în `de-facut.md`. Analiza nu înlocuiește un consult juridic.

## Pasul 10: alerte (10 minute, opțional, dar recomandat)

**Eu:** pregătesc comenzile pentru alerte la erori 5xx, autentificări respinse și cost.

1. Deschide [Cloud Shell](https://console.cloud.google.com/?cloudshell=true&project=samwera-board-eu).
2. Rulează comenzile primite și trimite-mi eventualele erori.

## Pasul 11: lansarea

0. Testul B e trecut pe Gmail (3 noiembrie). Google Workspace nu a putut fi testat; dacă apare un utilizator pe un astfel de domeniu, testul se repetă.
1. **Anunță administratorii** cu o zi înainte: la următoarea intrare vor fi rugați să reaccepte Termenii.
2. Spune-mi data lansării.
3. **Eu:** actualizez versiunea Termenilor la acea dată, setez `VITE_PASSWORD_LOGIN=1`, rulez testele și fac build cu `npm run build:eu`.
4. Activează **Email/Password**, ca la pasul 5.
5. Scrie „fă deploy”. **Eu:** public regulile, funcțiile și hosting-ul.
6. Dă push pe ramura `feat/login-parola`, sau spune-mi să o unesc în `main` și să dau eu push.

## Pasul 12: verificarea după lansare (15 minute)

CSP e acum impus (nu doar raportat). Dacă ceva nu se încarcă (login, Drive, Stripe), în consola browserului apare „Content Security Policy”. Atunci: **Eu** schimb antetul înapoi în `Content-Security-Policy-Report-Only` și republic doar hosting-ul.


1. În incognito, pe `https://cabinio.ro`, autentifică-te cu Google. Deschide `/super-admin`.
2. Creează un cont cu parolă, confirmă-l și autentifică-te.
3. Într-un tab nou, alege un fișier din Drive.
   Generează un document salvat în Drive și deschide pagina de abonament (Stripe), ca să verifici că CSP nu blochează nimic.
4. Acceptă noii Termeni, ca administrator.
5. În primele zile, urmărește autentificările eșuate, e-mailurile ajunse în Spam și solicitările de suport.
