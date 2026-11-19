# Lansare abonamente: ce rămâne de făcut

Stare la 31 octombrie 2026: aplicația rulează pe cabinio.ro cu **plățile oprite**. Plățile pornesc abia când ID-urile de preț live ajung în `.env.samwera-board-eu`. Până atunci nimeni nu poate plăti și Stripe nu percepe comisioane.

Secretele Stripe din Firebase au acum valoarea provizorie `pending`.

Legendă: **[Tu]** faci tu, **[Claude]** spune-mi și fac eu.

## Partea 1: verificări în producție (acum)

1. **[Tu]** Pe cabinio.ro, logat cu contul tău:
   - accepți noii Termeni;
   - verifici în Super-admin că apare accesul gratuit până pe 31.12.2026;
   - scanezi un act și generezi un document;
   - adaugi sau modifici un client;
   - pe Abonament, alegi un plan, completezi datele de facturare și apeși „Continuă spre plată”. Trebuie să apară „Plățile sunt temporar indisponibile”.
2. **[Făcut]** Ștergerea automată (TTL) pentru `stripeEvents.expireAt` e setată prin API. Se vede în [Google Cloud Console](https://console.cloud.google.com/firestore/databases/-default-/ttl?project=samwera-board-eu), nu în Firebase Console.
3. **[Tu]** Anunți colegii din pilot că vor fi rugați să accepte din nou Termenii.

## Partea 2: pregătire Stripe live (se poate face acum)

Toți pașii se fac în Stripe Dashboard, cu modul **test oprit**.

4. **[Tu]** Contul:
   - completezi datele PFA-ului și IBAN-ul în RON;
   - setezi descrierea de pe extras: `CABINIO`;
   - activezi 2FA.
5. **[Tu]** La Settings → Business → **Public details**, setezi:
   - Terms of service: `https://cabinio.ro/termeni`;
   - Privacy policy: `https://cabinio.ro/confidentialitate`.

   **Obligatoriu:** Checkout cere acum bifa de acceptare a Termenilor. Fără URL, Stripe poate refuza pagina de plată.
6. **[Tu]** Mergi pe produsul „Cabinio Standard” în modul test și folosești **Copy to live mode**. În live, verifici prețurile de 200 RON/lună și 2000 RON/an și notezi cele două ID-uri `price_…`.
7. **[Tu]** La Settings → Billing → **Customer portal**:
   - anulare doar la sfârșitul perioadei;
   - schimbare lunar/anual între cele două prețuri, fără proration;
   - editarea adresei și a datelor fiscale oprită;
   - istoricul facturilor Stripe oprit.
8. **[Tu]** La Settings → Billing → **Revenue recovery**: reîncercări timp de o săptămână, apoi **Cancel subscription**.
9. **[Tu]** La setările de emailuri către clienți:
   - pornite: chitanțe, plată eșuată, card expirat;
   - oprit: „finalized invoices”.
10. **[Tu]** La setările de notificări ale contului tău, pornești emailurile pentru dispute și rambursări.
11. **[Tu]** Developers → API keys → **Create restricted key**, cu numele `cabinio-prod`:
    - Write: Customers, Checkout Sessions, Subscriptions, Customer portal;
    - Read: Prices;
    - restul: None.

    Din folderul proiectului rulezi comanda de mai jos și lipești cheia `rk_live_…`:
    ```
    firebase functions:secrets:set STRIPE_SECRET_KEY --project samwera-board-eu
    ```
12. **[Tu]** Developers → Webhooks → **Add endpoint**:
    - URL: `https://europe-west3-samwera-board-eu.cloudfunctions.net/billing_webhook`
    - versiunea API: `2026-08-26.dahlia`, sau `2026-04-22.dahlia` dacă prima nu apare în listă;
    - evenimente: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`.

    Copiezi Signing secret (`whsec_…`) și rulezi comanda de mai jos, unde îl lipești:
    ```
    firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project samwera-board-eu
    ```
13. **[Tu]** Îmi scrii „gata Stripe” și îmi trimiți cele două ID-uri `price_…`. Nu sunt secrete. Nu trimite cheile în chat.
14. **[Claude]** Fac redeploy la funcții și la frontend, ca să preia secretele noi, bifa de Termeni și avertizarea de CUI. Plățile rămân oprite. Verific că webhook-ul răspunde. Dacă ai modificări necomise în `frontend/` (acum: `index.html`, `favicon.svg`, `Sidebar.tsx`), spune-mi dacă intră sau nu.

## Partea 3: condiții înainte de pornirea plăților

15. **[Făcut]** Codul de TVA art. 317 a fost primit pe 19 noiembrie 2026. Îl folosești doar la furnizorii din UE (Stripe, Google Cloud etc.), ca să primești facturi cu taxare inversă. Pe facturile către clienți rămâne CUI-ul fără „RO” și mențiunea de neplătitor de TVA.
    - **[Tu]** În Stripe, la Settings → Business → **Tax details**, adaugi codul ca VAT ID. Așa facturile de comision Stripe vin cu taxare inversă.
    - **[Tu]** Adaugi codul și în profilul de facturare Google Cloud și la ceilalți furnizori din UE pe care îi plătești.
16. **[Tu]** Contabilul confirmă declarațiile 301/390 și modul de înregistrare a comisioanelor Stripe.
17. **[Tu]** Juristul confirmă:
    - secțiunea 7 din Termeni;
    - dreptul de retragere de 14 zile pentru persoane fizice și acordul pentru începerea imediată a serviciului;
    - obligațiile ANPC/SAL/SOL de pe site.
18. **[Decis]** La început facturile se emit **manual în SmartBill**. Trecem pe integrarea automată când volumul o cere (pașii sunt descriși mai jos, la „Facturare automată”).
    - **[Tu]** În Stripe, la Settings → **Communication preferences**, pornești emailul „Successful payments”, ca să afli de fiecare plată.
    - **[Tu]** Pentru fiecare plată: Stripe → Payments → plata → Customer. Acolo găsești numele, emailul, adresa, iar la **Metadata** tipul (PJ/PF), CUI-ul și Nr. Reg. Com. Emiți factura în SmartBill în termenul pentru e-Factura confirmat de contabil: fără TVA, încasată cu cardul, cu perioada abonamentului pe linie.
    - Pentru persoanele fizice, contabilul îți confirmă ce pui în loc de CNP pe e-Factura.
    - Metadatele apar la clienții creați sau actualizați după deploy-ul de la „pornește plățile”.
19. **[Făcut]** **Backup Firestore** (programările create pe 19 noiembrie 2026, vizibile în Google Cloud Console → Firestore → Disaster recovery): există deja recuperare la orice moment din ultimele 7 zile și protecție la ștergere. Plus backup zilnic (păstrat 7 zile) și săptămânal, duminica (păstrat 14 săptămâni). Cheia KMS nu se șterge niciodată, altfel backup-urile nu mai pot fi citite.

## Partea 4: pornirea plăților

### Înainte: prețuri noi și credite în Stripe

Codul pentru credite și pentru prețurile din 2027 e gata și testat (ramura `feat/credite`, necomisă). Îl testăm întâi local, apoi intră în același deploy cu pornirea plăților.

20. **[Tu]** În Stripe, **întâi în modul test**, apoi la fel în **live**:
    - în produsul „Cabinio Standard”, adaugi două prețuri recurente: **250 RON/lună** și **2500 RON/an**. Prețurile de 200/2000 rămân active, fiindcă le folosesc cei care se abonează până pe 31.12.2026;
    - creezi produsul nou **„Cabinio Credite”**, cu șase prețuri **unice** (One-off): prețurile de lansare **300**, **750** și **1000 RON** (pachetele de 10, 30 și 50 de credite, valabile până la 31.12.2026) și grila din 2027, **350**, **900** și **1250 RON**;
    - îmi trimiți cele 8 ID-uri `price_…` din test și, separat, cele 8 din live, cu mențiunea care e care. Nu sunt secrete.
21. **[Claude]** Pun ID-urile de test în `.env.local` și testăm local, cu Stripe CLI: cumpărarea unui pachet, consumul pe două firme, regenerarea fără consum, soldul 0 și creditele date din Super-admin.
22. **[Tu]** La Settings → Billing → **Customer portal** nu schimbi nimic acum. Până pe 31.12, schimbarea lunar↔anual rămâne între prețurile de 200/2000. **Pe 1 ianuarie 2027** înlocuiești în portal prețurile cu cele de 250/2500. Un abonat cu prețul vechi care schimbă intervalul după această dată trece la prețul nou.
23. **[Tu]** Juristul verifică noul text din §8 al Termenilor (credite, valabilitate, nerambursare, păstrarea prețului). Contabilul confirmă că încasarea creditelor e venit la încasare (PFA, sistem real). Termenii au versiune nouă (19 noiembrie 2026), deci fiecare cabinet îi va accepta din nou.

### Pornirea

24. **[Tu]** Îmi scrii „pornește plățile”.
25. **[Claude]** Adaug în `.env.samwera-board-eu` cele 10 ID-uri de preț live (200/2000, 250/2500 și cele șase prețuri de pachete), rulez toate testele, fac commit și deploy la funcții și la hosting.
26. **[Tu]** Testul de abonament: creezi în Stripe live un cupon de 190 RON reducere, „Once”, doar pentru prețul de 200 RON/lună, și din el un cod promo cu o singură utilizare. Creezi în aplicație un **cabinet nou de test**. Cabinetele cu acces gratuit amână prima plată până la sfârșitul gratuității, iar cabinetul nou plătește imediat, fiindcă ai avut deja o probă. Pe el plătești abonamentul lunar cu cardul real: 10 RON. Apoi îl anulezi din portal.
27. **[Tu]** Testul de credite: după ce abonamentul de test s-a încheiat (sau dintr-un alt cabinet nou de test), creezi un cupon de 290 RON, „Once”, doar pentru prețul de 300 RON, cu un cod promo de o singură utilizare. Cumperi pachetul de 10 credite: plătești 10 RON. Generezi un document pentru un client salvat și vezi „S-a consumat 1 credit”.
28. **[Claude]** Verific webhook-ul, starea abonamentului, creditele și jurnalul lor.
29. **[Tu]** Emiți facturile pentru cele două plăți și îți reglezi cabinetele din pilot din Super-admin: fiecare are acces gratuit până pe 31.12.2026. Dacă se abonează înainte, păstrează 200 RON/lună, iar prima plată vine după 31.12.

## Partea 5: lansarea publică

30. **[Tu]** Îmi spui data lansării.
31. **[Claude]** Pun `SIGNUP_MODE=open`, actualizez `tests/test_deploy_hygiene.py` și fac deploy.

Până atunci, un cabinet nou nu poate plăti. Înainte să-i expire proba, îi dai „Gratuit până la” din Super-admin.

## Facturare automată (când devine necesară)

- **[Tu]** Verifici că abonamentul SmartBill include API; setezi tokenul cu `firebase functions:secrets:set SMARTBILL_TOKEN --project samwera-board-eu`; îmi spui emailul contului și seria; pornești în SmartBill trimiterea automată în e-Factura.
- **[Claude]** Test real cu ciorne sau cu o serie de test (PJ și PF), apoi integrarea pe `invoice.paid`: o factură pe plată, alertă și „Reîncearcă factura” în Super-admin, lista facturilor în pagina Abonament. Storno rămâne manual.

## Când apar situații speciale

- **Alertă pe email de la Google Cloud:** a apărut o rambursare, o dispută, un abonament duplicat, un preț necunoscut sau un webhook eșuat. Verifici în Stripe Dashboard și îmi trimiți mesajul. Alertele sunt limitate la cel mult una pe oră.
- **Abonament duplicat:** se anulează automat, dar rambursarea o faci tu din Stripe.
- **Rambursare:** storno-ul facturii se face manual. La un pachet de credite rambursat, scazi creditele din Super-admin („Scade credite”, cu un număr negativ și motivul).
- **Schimbare de preț:** prețurile afișate sunt în cod, deci spune-mi înainte să le schimbi în Stripe.

- **Coduri promoționale:** la fiecare cupon din Stripe alegi „Applies to specific products” (Cabinio Standard sau Cabinio Credite), altfel un cod de abonament merge și la credite.
- **Metode de plată:** în Stripe lași doar cardul și portofelele instant (Apple Pay, Google Pay). Plățile cu confirmare întârziată nu sunt tratate.
- **ID-urile de preț:** în `.env.samwera-board-eu` sunt fie toate 10, fie niciunul (verificat de `tests/test_deploy_hygiene.py`). Cele de 200/2000 RON nu se șterg niciodată: de ele depind abonații la prețul de ofertă.

## După lansare (amânate în auditul din 20 noiembrie 2026)

- Semnal în Super-admin când CUI-ul sau denumirea din formularul de generare diferă de clientul ales (refolosirea unui credit pentru altă firmă).
- Verificarea creditelor fără tranzacție la cabinetele cu abonament (economie mică de citiri Firestore).
- „Scade credite” să poată scădea cât a rămas, după o rambursare parțial consumată.

## Restanțe mai vechi (detalii în `docs/de-facut.md`)

- MFA pentru conturile de admin și Super Admin.
- Închiderea proiectului vechi `samwera-board`: revocarea `firebase-service-account.json`, rotirea cheii Azure, ștergerea datelor vechi.
- Alertă de buget în Google Cloud.
- Verificarea mărcii Cabinio la OSIM/EUIPO.
