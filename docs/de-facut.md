# De făcut (amânate deliberat)

Actualizat: 20 septembrie 2026. Le reiau împreună cu proprietarul în perioada următoare.

| # | Ce | De ce contează | Cine face |
|---|---|---|---|
| 1 | **Backup pe termen lung** al Firestore (backup-uri programate, retenție definită) | Acum există doar recuperare la orice moment din ultimele 7 zile | Eu (comenzi Cloud Shell), tu rulezi |
| 2 | **Autentificare în doi pași (MFA)** pentru adminii cabinetelor și pentru contul de Super Admin | Contul de Super Admin dă acces la lista tuturor cabinetelor | Eu (cod + politică), tu în consolă |
| 3 | **Revizia juridică** a Termenilor, DPA, Confidențialității, Sub-împuterniciților + verificarea mărcii „Cabinio” la OSIM/EUIPO (clasele 9 și 42) și a domeniului | Documentele sunt scrise atent, dar nevalidate de un avocat | Tu (avocat, OSIM) |
| 4 | **Decomisionarea proiectului vechi** `samwera-board` (peste 1–2 săptămâni fără probleme): revocă cheia `firebase-service-account.json`, rotește cheia Azure veche, șterge datele vechi (inclusiv 34 de documente cu extrageri în clar) | Datele personale nu trebuie să stea în două locuri, iar cheile vechi rămân un risc | Împreună |
| 5 | **Alerte de monitorizare și de buget** (erori 5xx, autentificări respinse, cost) | Acum nu există nicio alertă | Eu (comenzi), tu rulezi |
| 6 | **Redirecționarea aplicației vechi** către `cabinio.web.app` (pregătită, nepublicată) | Ca nimeni să nu mai intre din greșeală în aplicația veche | Eu, după ce confirmi autentificarea pe adresa nouă |

Alte idei, fără termen: jurnalele de acces la date (cine a citit efectiv în Firestore / a folosit cheia KMS), export și ștergere din aplicație (acum la cerere), test de penetrare, CI/CD, capturi reale în landing, domeniu propriu.
