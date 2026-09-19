# Google Drive în aplicație (permisiunea `drive.file` + Google Picker)

Aplicația cere doar permisiunea **`drive.file`**: acces la fișierele create de aplicație sau alese explicit de utilizator prin fereastra Google (Picker).
Nu poate vedea restul Drive-ului. Consecințe:
- Google nu cere verificarea aplicației pentru această permisiune (nu e „sensibilă”): dispare avertismentul „aplicație neverificată” și plafonul de ~100 de utilizatori.
- **Tokenul Google nu mai ajunge pe serverele noastre.** Descărcarea, încărcarea, copierea și completarea documentelor se fac din browser, direct către Google.
  Serverul primește doar fișierul pe care îl prelucrează (ex. actul pentru OCR) și, pentru jurnalul de acces, un raport cu metadate.

## Ce se poate face din Drive
| Funcție | Cum |
|---|---|
| Act de identitate din Drive pentru OCR | „Alege din Drive” → fereastra Google → fișierul se descarcă în browser și se trimite la OCR ca un fișier încărcat |
| Salvarea documentelor generate în Drive | Se alege folderul prin Picker; fișierul se încarcă din browser |
| Șabloane Google Docs | Se aleg prin Picker la adăugare; la generare, documentul se copiază și se completează din browser |
| Colegii care nu au ales încă un șablon | La prima folosire apare din nou fereastra Google pentru confirmarea accesului (o singură dată per utilizator și fișier) |

## Configurare necesară (o singură dată per proiect Google Cloud)
Picker cere o cheie API și numărul proiectului:
1. Cloud Console → **APIs & Services → Library** → activează **Google Picker API** (și verifică dacă sunt active *Google Drive API* și *Google Docs API*).
2. **APIs & Services → Credentials → Create credentials → API key**. Apoi *Edit API key*:
   - *Application restrictions*: **Websites** → adaugă `https://cabinio.web.app/*`, `https://samwera-board-eu.web.app/*`, `https://samwera-board-eu.firebaseapp.com/*` și, pentru test, `http://localhost:5173/*`;
   - *API restrictions*: **Restrict key** → doar **Google Picker API**.
3. În `frontend/.env.eu.local` (și `.env.google.local` pentru test local) completează:
   - `VITE_GOOGLE_API_KEY=<cheia creată>` (cheia e publică prin natura ei, dar restricția de mai sus o face inutilizabilă în afara aplicației)
   - `VITE_GOOGLE_APP_ID=` numărul proiectului (pentru `samwera-board-eu`: `1000687240483`, deja completat).
4. Reconstruiește (`npm run build:eu`) și redeployează hosting-ul.

Fără cheie, butoanele Drive spun clar că funcția nu e activată, iar restul aplicației (încărcare de pe dispozitiv, descărcare) funcționează normal.

## Cont Google și consimțământ
- La următoarea autentificare, utilizatorii care au acordat vechea permisiune (`drive`, `documents`) vor vedea cererea nouă, mai restrânsă (`drive.file`).
- Ecranul de consimțământ OAuth din Cloud Console poate rămâne „In production”; cu `drive.file` nu e nevoie de verificare Google.

## Ce nu mai funcționează (intenționat)
- Răsfoirea liberă a Drive-ului din aplicație (înlocuită de Picker).
- Lipirea manuală a unui ID Google Docs (acum se alege prin Picker, care acordă accesul).
- Rutele de server pentru Drive (`/drive/files`, `/extract/drive`, `/fill/gdoc`, `/fill/docx/upload-to-drive`) au fost eliminate.
