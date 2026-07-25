# Proiecte viitoare — SamWeraBoard

Document de urmărire pentru inițiative mari, amânate deliberat din runda curentă de îmbunătățiri (2026-07-23) ca să nu blocheze fixurile de securitate/corectitudine și funcționalitățile fiscale de bază. De revizitat individual, ca proiecte separate, când e momentul potrivit.

## 1. Modul de facturare onorarii cabinet
Contract per client (onorariu recurent, servicii incluse, dată semnare, valabilitate), generare facturi către clienți, eventual time-tracking simplu per client/dosar. Transformă aplicația din „CRM de date client" în „ERP de cabinet" — efort mare, recomandat ca proiect de sine stătător cu plan propriu.

## 2. Migrarea șabloanelor de documente la Firebase Storage
Azi șabloanele `.docx` sunt stocate ca `base64` direct în Firestore (`TemplateLibrary.tsx`, câmp `fileBase64`), limitate artificial la 500KB din cauza limitei de 1MB/document Firestore. Migrare la Firebase Storage sau Google Drive (deja integrat), cu doar un URL/ID reținut în Firestore.

## 3. Job periodic de re-verificare status ANAF
Verificarea statutului ANAF (`/anaf/company`) e azi doar manuală, la click. Un cron/Cloud Scheduler care re-verifică lunar tot portofoliul și alertează la schimbări (ex. client devenit inactiv sau radiat) ar aduce valoare proactivă unui cabinet.

## 4. Suport mobil complet
Aplicația e azi utilizabilă doar pe desktop (sidebar-ul dispare sub 768px fără înlocuitor, tabelul virtual de clienți are lățimi fixe px). Proiect separat: drawer de navigare mobil + tabel responsive/touch-friendly.

## 5. GDPR complet pe date CNP
Dincolo de mascarea CNP-ului în logs (rezolvată în runda curentă), rămâne de construit: jurnal de acces la datele cu CNP, politică de retenție/anonimizare pentru clienți radiați de mult timp, temei legal de prelucrare documentat explicit în aplicație.

## 6. Teste automate + CI/CD
Zero teste automate azi (nici pytest, nici vitest/jest) și zero workflow CI (`.github/workflows` lipsă). Amânat explicit — nerelevant în faza actuală a proiectului — dar de introdus pe măsură ce suprafața de cod crește: pytest pe `local_extractor._validate_cnp` și pe rutele critice din `app.py`, vitest pe hook-urile `lib/*.ts`, workflow GitHub Actions cu lint+test+build.

## 7. Upgrade complet integrare ANAF (v9, e-Factura, SPV)
Runda curentă adaugă doar parsarea câmpului TVA la încasare din răspunsul ANAF existent. Rămâne: migrare completă la endpoint-ul ANAF v9 (azi se combină POST v8 cu GET v7), verificarea înregistrării în Registrul RO e-Factura, integrare cu Spațiul Privat Virtual (SPV) pentru notificări/mesaje.

## 8. Șabloane suplimentare de documente
Sistemul de șabloane `.docx` cu placeholder-e e generic și extensibil, dar vin predefinite doar „Act Constitutiv" și „Decizia Asociatului unic". De adăugat (dacă nu apucă în runda curentă): contract de prestări servicii de contabilitate, împuternicire SPV, notificări standard de termene fiscale către clienți.
