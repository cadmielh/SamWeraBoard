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

15. **[Tu]** Primești codul de TVA art. 317.
16. **[Tu]** Contabilul confirmă declarațiile 301/390 și modul de înregistrare a comisioanelor Stripe.
17. **[Tu]** Juristul confirmă:
    - secțiunea 7 din Termeni;
    - dreptul de retragere de 14 zile pentru persoane fizice și acordul pentru începerea imediată a serviciului;
    - obligațiile ANPC/SAL/SOL de pe site.
18. **[Tu]** Decizi cum emiți facturile:
    - **manual în SmartBill**, pentru fiecare plată, în termenul e-Factura confirmat de contabil; sau
    - **automat:** îmi dai acces la un cont SmartBill de test și setezi tokenul ca secret. Scriu integrarea după un test real, inclusiv pentru persoane fizice.
19. **[Tu]** Rezolvi backup-ul de date înainte să existe date de facturare reale (vezi `docs/de-facut.md`).

## Partea 4: pornirea plăților

20. **[Tu]** Îmi scrii „pornește plățile”.
21. **[Claude]** Adaug ID-urile de preț, rulez testele și fac deploy la funcții.
22. **[Tu]** Creezi în Stripe un cod promo de 190 RON, cu o singură utilizare. Pe cabinetul tău, plătești abonamentul lunar cu cardul real: 10 RON. Accesul tău gratuit nu încurcă testul.
23. **[Claude]** Verific webhook-ul și starea abonamentului.
24. **[Tu]** Emiți factura pentru acea plată și, din portal, anulezi abonamentul de test dacă nu vrei să continue.
25. **[Tu]** Îți reglezi cabinetele din pilot din Super-admin: fiecare cabinet are acces gratuit până pe 31.12.2026 și intră în modul citire după această dată, dacă nu se abonează și nu îi prelungești gratuitatea.

## Partea 5: lansarea publică

26. **[Tu]** Îmi spui data lansării.
27. **[Claude]** Pun `SIGNUP_MODE=open`, actualizez `tests/test_deploy_hygiene.py` și fac deploy.

Până atunci, un cabinet nou nu poate plăti. Înainte să-i expire proba, îi dai „Gratuit până la” din Super-admin.

## Când apar situații speciale

- **Alertă pe email de la Google Cloud:** a apărut o rambursare, o dispută, un abonament duplicat, un preț necunoscut sau un webhook eșuat. Verifici în Stripe Dashboard și îmi trimiți mesajul. Alertele sunt limitate la cel mult una pe oră.
- **Abonament duplicat:** se anulează automat, dar rambursarea o faci tu din Stripe.
- **Rambursare:** storno-ul facturii se face manual.
- **Schimbare de preț:** prețurile afișate sunt în cod, deci spune-mi înainte să le schimbi în Stripe.

## Restanțe mai vechi (detalii în `docs/de-facut.md`)

- MFA pentru conturile de admin și Super Admin.
- Închiderea proiectului vechi `samwera-board`: revocarea `firebase-service-account.json`, rotirea cheii Azure, ștergerea datelor vechi.
- Alertă de buget în Google Cloud.
- Verificarea mărcii Cabinio la OSIM/EUIPO.
