# Plan: alerte și notificări

Stare: **implementat și testat local, nelansat** (14 noiembrie 2026). Toate testele trec cu emulatoarele (`tests/run_all.sh`), inclusiv regulile Firestore; interfața a fost verificată în browser (Playwright) pe date de test, ca admin și ca membru, pe desktop și telefon, în ambele teme. Înainte de pornirea flag-ului: `scripts/backfill_stadiu_din.py` (vezi „Lansare”).

Implementare: `alerte_catalog.json`, `alerte.py`, `main.py` (triggere + `alerte_zilnice`), `firestore.rules`, `lib/alerteCatalog.ts`, `lib/alerte.ts`, `lib/alerteConfig.ts`, `NotificariBell.tsx`, `NotificariPanel.tsx`, `NotificariCard.tsx`, `styles/notificari.css`, deep link-uri în `ClientiPage`/`ClientView`/`DosarePage`/`SarciniPage`, `stadiuDin` în `lib/dosare.ts`. Teste: `tests/test_alerte.py`, `tests/fixtures/termene.json` (paritate cu `durata.test.ts`), `lib/alerte.test.ts`, `lib/alerteConfig.test.ts`, `tests/rules/firestore.rules.test.js`. Deciziile de implementare din secțiunea „Arhitectura finală” au prioritate față de restul textului.

## Scop

1. Un clopoțel în aplicație care arată ce cere atenție: termene juridice ale clienților, dosare, sarcini, abonament.
2. Fiecare alertă ajunge doar la cine trebuie: adminul cabinetului, iar pentru dosare și responsabilul dosarului.
3. Totul se poate personaliza din Setări, printr-un ecran simplu: adminul stabilește regulile cabinetului, iar fiecare utilizator alege ce primește el.

Nu intră în plan: e-mail, push în browser, scadențe fiscale (D300, D394, bilanț), verificarea periodică la ANAF, calendar .ics. Sunt trecute la „Mai târziu”.

## Ce am găsit în cod

| Constatare | Unde | Consecință |
|---|---|---|
| Starea mandatului și a duratei societății se calculează deja (`stareMandat`, `stareDurataSocietate`, prag de 90 de zile) | `lib/durata.ts`, `TermenBadge.tsx` | Regulile există, dar doar în TypeScript. Motorul de pe server trebuie să dea aceleași rezultate |
| `valabila_pana_la` (CI) e în Firestore, nu în vault | `types.ts:110`, `lib/pii.ts` | Alerta de CI nu are nevoie de vault și nu atinge CNP-ul sau seria |
| Clienții și dosarele se încarcă paginat | `lib/clienti.ts:224`, `lib/dosare.ts:50` | Calculul alertelor nu se poate face în browser pe tot portofoliul, deci se face pe server |
| Avem deja un job zilnic în `europe-west3` | `main.py:74` (`purge_deletions`) | Adăugăm un al doilea job după același model |
| Dosarul nu reține de când e în stadiul curent | `Dosar` în `types.ts` | Pentru alerta „dosar blocat” trebuie un câmp nou, `stadiuDin` |
| Responsabilul dosarului poate fi un nume liber, fără cont (`responsabilUid` lipsă) | `types.ts`, `Dosar` | În acest caz alerta ajunge doar la admin |
| Sarcina are doar persoana asignată (`assigneeUid`), nu și un responsabil | `Sarcina` | Destinatarii sarcinii sunt persoana asignată și, opțional, adminul |
| Starea abonamentului e scrisă doar de server | `WorkspaceBilling`, `billing.py` | Alertele de abonament se calculează din `trialEndsAt`, `status`, `accessUntil` |
| Avem feature flags pe cabinet | `lib/features.ts` | Lansarea se face întâi la un cabinet de test |

## Catalogul de alerte

Fiecare tip are un cod stabil, praguri implicite și destinatari impliciți. Adminul le poate schimba pe toate (vezi Setări).

### A. Termene juridice ale clientului

| Cod | Când apare | Praguri implicite | Destinatari impliciți |
|---|---|---|---|
| `mandat_expira` | Expiră mandatul unui administrator | 90, 30, 7 zile, apoi „expirat” | Administratori |
| `mandat_fara_data` | Mandat „din prezent” fără dată de numire, deși firma nu mai e în înființare | imediat | Administratori |
| `durata_expira` | Expiră durata societății (art. 227 alin. 2: consultarea asociaților cu 3 luni înainte) | 90, 30 zile, apoi „expirat” | Administratori |
| `ci_expira` | Expiră actul de identitate al unui asociat, administrator, titular sau membru IF | 60, 30 zile, apoi „expirat” | Administratori |

Textul alertei de CI conține doar numele persoanei și al clientului, de exemplu „CI expiră în 30 de zile: Ion Popescu (Alfa SRL)”. Nu conține serie, număr sau CNP.

### C. Dosare și sarcini

| Cod | Când apare | Praguri implicite | Destinatari impliciți |
|---|---|---|---|
| `dosar_asignat` | Ai devenit responsabil pe un dosar | la eveniment | Responsabil |
| `dosar_planificare` | Se apropie data de planificare | 3 zile, 1 zi, azi | Responsabil + Administratori |
| `dosar_blocat` | Dosarul stă de prea mult în același stadiu, până la predarea documentelor (inclusiv eliberat, dar nepredat; fostul `dosar_nepredat`, unificat pe 14 nov 2026) | 14 zile | Responsabil + Administratori |
| `dosar_nefacturat` | Documentele sunt predate, dar dosarul nu e facturat | 7 zile | Administratori |
| `sarcina_asignata` | Ți s-a asignat o sarcină | la eveniment | Persoana asignată |
| `sarcina_termen` | Termenul sarcinii se apropie, e azi sau a trecut | 3 zile, 1 zi, azi, apoi „depășit” | Persoana asignată + Administratori |

**Cum funcționează la sarcini** (la fel la `dosar_planificare`):
- Se iau în calcul doar sarcinile nefinalizate, cu `termenLimita` completat.
- Alerta apare la primul prag (3 zile înainte) și se actualizează pe loc la pragurile următoare: „în 3 zile” → „mâine” → „azi” → „depășit de N zile”. Rămâne **o singură alertă pe sarcină**, care urcă în severitate, nu câte una pe fiecare prag.
- Dacă alerta a fost văzută, trecerea la un prag nou o face din nou „nouă”, ca să apară iar în contorul clopoțelului.
- Când sarcina e depășită, alerta rămâne în clopoțel până se rezolvă cauza. Se poate amâna, dar după amânare revine cât timp sarcina e tot depășită.
- Alerta dispare singură când sarcina e marcată „Finalizat”, când termenul e mutat după ultimul prag, când se șterge termenul sau când se șterge sarcina.
- Sarcină fără persoană asignată: alerta ajunge doar la administratori.

### D. Cont și abonament

| Cod | Când apare | Praguri implicite | Destinatari impliciți |
|---|---|---|---|
| `trial_expira` | Se termină perioada de probă | 7, 3, 1 zile | Administratori |
| `plata_esuata` | Abonament `past_due` | imediat | Administratori |
| `acces_citire` | Cabinetul a trecut în citire și export | imediat | Toți membrii |
| `membru_nou` | Cineva a acceptat o invitație | la eveniment | Administratori |
| `stergere_programata` | Cabinetul are ștergere programată | imediat | Toți membrii |

Alertele din D nu pot fi oprite la nivel de cabinet, ci doar ascunse de fiecare utilizator. Ele țin de accesul la date.

### Severitate

- **Informare** (gri): evenimente (`*_asignat`, `membru_nou`) și primul prag.
- **Atenție** (galben, ⏳): pragurile intermediare.
- **Urgent** (roșu, ⚠): ultimul prag, termen depășit sau expirat, `plata_esuata`, `acces_citire`, `stergere_programata`.

Culorile refolosesc `badge-termen-curand` și `badge-termen-expirat`.

## Destinatari

Pentru fiecare tip de alertă, adminul alege una sau mai multe dintre aceste opțiuni:

- **Administratorii cabinetului** (toți membrii cu rol `admin`);
- **Responsabilul dosarului** (doar pentru tipurile `dosar_*`; dacă responsabilul e un nume fără cont, opțiunea e ignorată);
- **Persoana asignată** (doar pentru tipurile `sarcina_*`);
- **Toți membrii**;
- **Membri anume** (listă de persoane).

Cum se filtrează mai departe:
- **Adminul, pentru el însuși:** la alertele de dosar și de sarcină alege „de la cine” le primește: toate dosarele, doar ale mele, sau doar ale anumitor responsabili. Așa, un admin poate urmări doar colegii noi, de exemplu.
- **Utilizatorul obișnuit:** poate opri orice tip pe care îl primește, dar nu poate porni un tip pentru care adminul nu l-a trecut la destinatari.
- **Membrii cu rol `viewer`** primesc doar prin „Toți membrii” sau „Membri anume”.

Rezultatul final: o alertă ajunge la un utilizator dacă (1) tipul e activ în cabinet, (2) utilizatorul e printre destinatari, (3) filtrul lui personal o lasă să treacă.

## Model de date

### Regulile cabinetului

Câmp nou pe documentul cabinetului, scris de admin:

```ts
workspaces/{wid}.alerteConfig: {
  [cod: string]: {
    activ: boolean
    praguri: number[]            // zile înainte; [] pentru cele la eveniment sau imediate
    destinatari: {
      admini: boolean
      responsabil: boolean       // doar dosar_*
      asignat: boolean           // doar sarcina_*
      totiMembrii: boolean
      membri: string[]           // uid-uri
    }
  }
}
```

Un cod lipsă din `alerteConfig` înseamnă „valorile implicite din catalog”. Implicitele stau într-un singur loc, `alerte_catalog.json`, citit atât de server cât și de frontend.

Regula din `firestore.rules`: `alerteConfig` se adaugă la lista `hasOnly` a adminului, plus limite (cel mult 30 de chei, cel mult 5 praguri pe tip, fiecare prag între 0 și 365, cel mult 50 de membri pe tip).

### Preferințele utilizatorului

```ts
workspaces/{wid}/preferinteAlerte/{uid}: {
  oprite: string[]                    // coduri pe care nu le mai vrea
  sursaDosare: 'toate' | 'ale_mele' | 'responsabili'   // doar pentru admini
  responsabili: string[]              // uid-uri, când sursaDosare = 'responsabili'
}
```

Regula: citire și scriere doar pentru `request.auth.uid == uid` și doar dacă e membru.

### Alertele

Câte un document pentru fiecare destinatar, ca regulile și interogările să rămână simple:

```ts
workspaces/{wid}/notificari/{uid}__{cheie}: {
  uid: string
  cheie: string            // ex. "mandat_expira:clientId:pid:2027-03-01". Fără date personale
  cod: string
  severitate: 'info' | 'atentie' | 'urgent'
  titlu: string            // ex. "Mandat expiră în 30 de zile"
  detaliu: string          // ex. "Ion Popescu, Alfa SRL"
  link: string             // ex. "/clienti/abc", "/dosare/xyz"
  clientId?: string; dosarId?: string; sarcinaId?: string
  termen: string | null    // ISO, pentru sortare
  prag: string             // ex. "3", "1", "azi", "depasit"; schimbarea lui face alerta din nou „nouă”
  creatLa: Timestamp
  vazut: boolean
  amanatPana: Timestamp | null
  rezolvat: boolean        // cauza a dispărut (pus de server)
  rezolvatLa: Timestamp | null
}
```

Cheia include data termenului: dacă mandatul se prelungește, apare o cheie nouă, iar cea veche se marchează rezolvată.

Reguli:
- `read`: doar dacă `resource.data.uid == request.auth.uid`;
- `update`: doar câmpurile `vazut`, `amanatPana`, de către destinatar;
- `create`/`delete`: doar serverul.

Ignorarea unei alerte pentru un client („nu mă mai anunța pentru acest client”) se face prin `preferinteAlerte.ignorate: string[]`, o listă de prefixe de cheie, de exemplu `ci_expira:clientId`.

### Câmp nou pe dosar

`stadiuDin` (timestamp), setat în `lib/dosare.ts` la fiecare schimbare de stadiu, alături de `documentePredateAt`. La dosarele existente lipsește, așa că alerta `dosar_blocat` se calculează pentru ele de la `createdAt`. Se poate și popula o singură dată, printr-un script.

## Motorul de calcul (server)

Modul nou `alerte.py`, cu funcții pure, ușor de testat:

- `alerte_client(client, azi) -> list[Alerta]`: mandate, durata societății, CI;
- `alerte_dosar(dosar, azi)`, `alerte_sarcina(sarcina, azi)`, `alerte_billing(ws, azi)`;
- `destinatari(alerta, ws, config) -> list[uid]`, care aplică regulile cabinetului;
- `filtreaza(uid, alerta, preferinte) -> bool`, care aplică filtrele personale;
- `sincronizeaza(db, wid, sursa, alerte)`: creează ce lipsește și marchează rezolvat ce a dispărut. La o alertă existentă actualizează textul și severitatea. `vazut` și `amanatPana` rămân neatinse, cu o excepție: când alerta trece la un prag nou (câmpul `prag` se schimbă), `vazut` revine la `false`, iar `amanatPana` se golește dacă ajunge pe „depășit”/„expirat”.

Logica de termene din `lib/durata.ts` se rescrie în Python. Ca să nu ajungă cele două variante să dea rezultate diferite, folosim fixture-uri comune (`tests/fixtures/termene.json`), rulate atât de `durata.test.ts`, cât și de `tests/test_alerte.py`.

**Când rulează:**
1. **Job zilnic** `alerte_zilnice`, la 06:00 Europe/Bucharest, în `main.py`, după modelul lui `purge_deletions`. Recalculează tot ce depinde de trecerea timpului, pentru toate cabinetele active. Cabinetele în `pendingDeletion` sunt sărite.
2. **Triggere Firestore** (`on_document_written`) pe `clienti/{id}`, `dosare/{id}`, `sarcini/{id}`: recalculează doar entitatea modificată. Așa, alerta dispare imediat după ce se corectează mandatul, iar `dosar_asignat`/`sarcina_asignata` apar pe loc.
3. **La schimbarea regulilor sau a preferințelor** (endpoint `POST /alerte/recalculeaza`, doar pentru membri, limitat la o cerere pe minut): se recalculează cabinetul, ca să se vadă efectul imediat în Setări.

Costul: jobul zilnic citește toți clienții, dosarele active și sarcinile active ale fiecărui cabinet. La volumul de azi, costul e neglijabil. Dacă crește, se poate limita la entitățile cu un termen în următoarele 365 de zile, printr-un câmp `urmatorulTermen` denormalizat.

## Interfața

### Clopoțelul

În antetul fiecărei pagini, ultimul în dreapta, după butoanele paginii (cu un spațiu între ele), ca un buton rotund. Fără bară separată și fără loc în meniul lateral. Panoul se deschide sub clopoțel, aliniat la dreapta, iar pe telefon de jos, pe toată lățimea. Arată un contor cu numărul de alerte nevăzute, nerezolvate și neamânate (roșu dacă există urgente).

```
┌─ Notificări ─────────────────── ✓ Toate văzute ┐
│ [Noi 4]  [Toate]  [Amânate 1]                  │
├────────────────────────────────────────────────┤
│ ⚠ Mandat expirat                        azi    │
│   Ion Popescu · Alfa SRL                       │
│   [Deschide]  [Amână ▾]  [⋯]                    │
│ ⏳ CI expiră în 30 de zile           12 dec.   │
│   Maria Ionescu · Beta SRL                     │
│ ⏳ Dosar 1234 blocat de 16 zile       în lucru │
│   Responsabil: Andrei                          │
│ ·  Ți s-a asignat sarcina „Depunere ONRC”      │
├────────────────────────────────────────────────┤
│                        Setări notificări →     │
└────────────────────────────────────────────────┘
```

- Datele se citesc cu `onSnapshot` pe `notificari` (`uid == eu`, `rezolvat == false`), sortate pe severitate, apoi pe termen.
- **Click pe alertă sau „Deschide”**: deschide direct fișa clientului, dosarul sau sarcina, ca filă sau fereastră, exact ca un click din listă, și marchează alerta văzută (vezi „Navigarea din alertă”).
- **Amână**: 1 zi, 1 săptămână, până la o dată aleasă.
- **⋯**: „Nu mă mai anunța pentru acest client/dosar”, „Nu mai vreau acest tip de alertă” (trimite la Setări cu tipul selectat).
- Alertele rezolvate dispar singure. Serverul le șterge după 30 de zile.

### Navigarea din alertă

Folosim mecanismul `?open=<id>`, care există deja la dosare și sarcini (`ClientDosareSarcini.tsx` îl folosește). La clienți trebuie adăugat.

| Tip | Link | Ce există azi | Ce trebuie făcut |
|---|---|---|---|
| Dosar | `/dosare?open=<id>` | Deschide fila dosarului (`DosarePage.tsx:155`) | De verificat că merge și pentru un dosar care nu e pe prima pagină a listei |
| Sarcină | `/sarcini?open=<id>` | Deschide fereastra sarcinii și comută filtrul pe „toate” dacă e a altcuiva (`SarciniPage.tsx:63`) | Nimic. Sarcinile active se încarcă toate, iar alertele sunt doar pentru sarcini active |
| Client | `/?open=<id>&sectiune=<...>` | **Nu există**. Fișa se deschide doar din listă, iar lista e paginată | `ClientiPage` citește `open`. Dacă clientul nu e în pagina încărcată, îl aduce cu un `getDoc` și îl deschide ca filă |
| Abonament | `/abonament` | Există | Nimic |
| Membru nou | `/utilizatori` | Există | Nimic |

Pentru alertele de client, parametrul `sectiune` (`administratori`, `asociati`, `durata`) derulează fișa la secțiunea respectivă și evidențiază scurt persoana în cauză (după `pid`). Așa, la „CI expiră: Ion Popescu” ajungi direct la rândul lui Ion Popescu.

Dacă entitatea nu mai există (de exemplu, a fost ștearsă între timp), pagina afișează un toast „Nu mai există” și alerta se marchează rezolvată.

### Setări → Notificări

Un card nou în `SetariPage.tsx`, cu două secțiuni.

**„Ce primesc eu”** (toți utilizatorii). Arată doar tipurile pentru care utilizatorul e destinatar, grupate pe categorii, cu un comutator per tip.

```
Ce primesc eu
  Clienți
    [●] Mandat administrator expiră        90, 30, 7 zile
    [●] Durata societății expiră           90, 30 zile
    [○] Act de identitate expiră           60, 30 zile
  Dosare                       De la: (•) toate  ( ) ale mele  ( ) anumiți responsabili [▾]
    [●] Dosar blocat                       după 14 zile
    ...
  Ignorate: Alfa SRL – CI (Ion Popescu)  [Reactivează]
```

Selectorul „De la” apare doar la admini.

**„Reguli pentru cabinet”** (doar admin). Un rând pe tip, editat pe loc:

```
Reguli pentru cabinet                                   [Revino la implicite]
┌──────────────────────────┬────────┬──────────────────┬─────────────────────────────┐
│ Alertă                   │ Activă │ Când             │ Cine primește               │
├──────────────────────────┼────────┼──────────────────┼─────────────────────────────┤
│ Mandat expiră            │  [●]   │ [90] [30] [7] [+]│ [Administratori ✕] [+ ▾]    │
│ Dosar blocat             │  [●]   │ după [14] zile   │ [Responsabil ✕] [Admini ✕]  │
│ Sarcină cu termen        │  [●]   │ azi, depășit     │ [Persoana asignată ✕] [+ ▾] │
│ Perioadă de probă expiră │  🔒    │ [7] [3] [1]      │ Administratori              │
└──────────────────────────┴────────┴──────────────────┴─────────────────────────────┘
```

- „+ ▾” deschide lista: Administratori, Responsabil, Persoana asignată, Toți membrii, apoi fiecare membru după nume (refolosește `ResponsabilCombobox`).
- Pragurile sunt chips editabile (număr de zile), cel mult 5.
- Pe telefon, tabelul devine o listă de carduri, câte unul pe tip.
- Fiecare modificare se salvează imediat (ca restul setărilor) și declanșează recalcularea.

## Etape

### Etapa 0: fundația
- `alerte_catalog.json` (coduri, etichete, categorii, praguri și destinatari impliciți, dacă tipul poate fi oprit).
- `alerte.py` cu funcțiile pure și `tests/test_alerte.py`.
- Fixture-urile comune pentru termene și testarea lor în `durata.test.ts`.
- Regulile pentru `alerteConfig`, `preferinteAlerte`, `notificari` și testele în `tests/rules/firestore.rules.test.js`.
- Feature flag `alerte` în `lib/features.ts`.

### Etapa 1: calculul pe server
- `stadiuDin` pe dosar (`lib/dosare.ts`).
- Jobul zilnic `alerte_zilnice` și triggerele pe clienți, dosare, sarcini în `main.py`.
- Endpointul `POST /alerte/recalculeaza`.
- Alertele de abonament: calculate în jobul zilnic și la scrierea `billing` (în `billing.py`, după actualizarea stării).
- `membru_nou`: scris la acceptarea invitației (`workspaces_api.py`).

### Etapa 2: clopoțelul
- `lib/alerte.ts` (`useNotificari`, `marcheazaVazut`, `amana`, `ignora`).
- `NotificariBell.tsx` și panoul, integrate în `Sidebar.tsx`.
- `?open=<id>&sectiune=` în `ClientiPage.tsx` (cu încărcare după id dacă clientul nu e în pagină), derularea la secțiune în `ClientView.tsx` și verificarea `?open` la dosare care nu sunt pe prima pagină.

### Etapa 3: setările
- `NotificariCard.tsx` în `SetariPage.tsx`, cu cele două secțiuni.
- `lib/alerteConfig.ts`: combinarea implicitelor din catalog cu `alerteConfig` și cu preferințele.

### Etapa 4: curățenie și lansare
- Ștergerea în cascadă: la ștergerea unui client (`DELETE /clients/<id>`), a unui dosar sau a unei sarcini, se șterg alertele legate; la `remove_member`, se șterg notificările și preferințele membrului; `workspace_deletion.run` include `notificari` și `preferinteAlerte`.
- Retenție: în jobul zilnic se șterg alertele rezolvate de peste 30 de zile.
- Pagina „Confidențialitate”: o frază despre notificări (numele clienților și al persoanelor apar în alerte, vizibile doar destinatarilor). Nu apare niciun sub-împuternicit nou.
- Activare la un cabinet de test, verificare o săptămână, apoi pentru toți.

## Mai târziu

- Pagina „Termene”, cu toate scadențele portofoliului într-o listă filtrabilă și export în Excel.
- Rezumat zilnic sau săptămânal pe e-mail (necesită un furnizor din UE și actualizarea listei de sub-împuterniciți).
- Scadențe fiscale (refolosește `lib/scadente.ts`, azi nefolosit).
- Verificare periodică la ANAF și alerte la schimbări de stare.
- Export în calendar (.ics / Google Calendar).

## Decizii confirmate (13 noiembrie 2026)

1. Pragurile implicite din catalog rămân cum sunt.
2. `sarcina_termen` ajunge la persoana asignată și la administratori, inclusiv înainte de termen (3 zile, 1 zi, azi).
3. `acces_citire` și `stergere_programata` ajung la toți membrii.

## Arhitectura finală (decizii de implementare, 13 noiembrie 2026)

Aceste decizii înlocuiesc textul de mai sus acolo unde diferă.

1. **Catalogul** e `alerte_catalog.json`, la rădăcina repo-ului (deploy-ul funcțiilor ignoră `frontend/`). Frontendul îl importă prin `lib/alerteCatalog.ts`, care conține și tipurile comune (`Notificare`, `PreferinteAlerte`, `AlerteConfig`).
2. **`stergere_programata` iese din catalog**: un cabinet în `pendingDeletion` e blocat complet de reguli, deci nimeni nu ar putea citi alerta.
3. **Serverul aplică doar regulile cabinetului** (tip activ, destinatari). **Preferințele personale** (`oprite`, `sursaDosare`, `ignorate`) se aplică în browser, la afișare și la contor. Schimbarea lor are efect instant, fără recalculare. Pentru filtrul „de la cine”, fiecare alertă de dosar sau sarcină poartă `responsabilUid`.
4. **Fără endpoint `/alerte/recalculeaza`.** Recalcularea pornește din triggere Firestore:
   - `clienti/{id}`, `dosare/{id}`, `sarcini/{id}` (cu autorul scrierii, ca să nu-ți trimită „ți s-a asignat” când te asignezi singur): recalculează doar entitatea. La ștergerea entității, alertele ei se șterg, deci nu mai e nevoie de ștergere în cascadă în API.
   - `workspaces/{wid}`, doar când se schimbă `members`, `billing`, `status`, `alerteConfig` sau `features`: recalculează tot cabinetul. Acolo se detectează și `membru_nou`, iar la eliminarea unui membru i se șterg alertele și preferințele.
   - Jobul zilnic `alerte_zilnice` (06:00) recalculează toate cabinetele cu flag-ul `alerte`, rezolvă evenimentele mai vechi de 14 zile și șterge alertele rezolvate de peste 30 de zile.
5. **Feature flag `alerte`**: serverul calculează și clopoțelul apare doar pentru cabinetele cu flag-ul pornit.
6. **Cheile** (fără date personale): `cod:sursa[:subId][:termen]`, unde `sursa` e `client:<id>`, `dosar:<id>`, `sarcina:<id>` sau `cabinet`. `cheieBaza` e cheia fără termen. Id-ul documentului e `{uid}__{cheie}`.
7. **Linkuri**: client `/?open=<id>&sectiune=<administratori|asociati|durata|titular|membriIF>&pid=<pid>`; dosar `/dosare?open=<id>`; sarcină `/sarcini?open=<id>`; abonament `/abonament`; membru nou `/utilizatori`.
8. **Severitate la tipurile „termen”**: depășit sau azi → urgent; cel mai mic prag, dacă e de cel mult 7 zile → urgent; cel mai mare prag (când sunt mai multe) → informare; restul → atenție. La tipurile „vechime”: atenție, iar de la dublul pragului → urgent. Evenimentele sunt informare.
9. **`stadiuDin`** se scrie din `lib/dosare.ts` la creare și la fiecare schimbare de stadiu.
10. **Filtrul personal „Vreau alerte de la”** (dosare și sarcini: toate / doar ale mele / doar ale anumitor colegi) apare și se aplică doar pentru un admin care mai are în cabinet cel puțin un coleg cu cont care poate fi responsabil (`areFiltruDeLaCine` în `lib/alerte.ts`). Altfel o alegere veche ar ascunde alerte pe nevăzute.

### Revizuire 14 noiembrie 2026: setări doar personale

Înlocuiește tot ce e mai sus despre „Setările cabinetului”, `alerteConfig`, destinatari aleși de admin și filtrarea personală în browser.

1. **Fără reguli de cabinet.** Nu mai există `workspaces/{wid}.alerteConfig` și nici fila „Setările cabinetului”. Fiecare utilizator își alege singur ce primește, cu ce praguri și de la ce dosare/sarcini.
2. **Implicite pe rol** în `alerte_catalog.json` (`roluri`, `implicit`, `obligatoriu`; la categoriile dosare/sarcini `sursaImplicita`):
   - admin: tot, dosare și sarcini de la toți;
   - membru: dosarele și sarcinile lui (asignat, planificare, blocat, termen), plus „acces doar în citire”; clienții îi poate porni singur;
   - vizualizator: doar „acces doar în citire”;
   - perioada de probă și plata eșuată: doar adminii, obligatorii; „acces doar în citire”: toți, obligatoriu.
3. **Preferințe** `workspaces/{wid}/preferinteAlerte/{uid}`: `tipuri: {cod: {activ?, praguri?}}`, `surse: {dosare?|sarcini?: {sursa, responsabili}}`, `ignorate: []`, `actualizatLa`. Se salvează doar diferențele față de implicitele rolului.
4. **Serverul aplică preferințele** (tip pornit, pragurile fiecăruia, „de la”), deci fiecare destinatar își primește alertele cu pragurile lui. Browserul aplică doar `ignorate` și amânarea. Un trigger pe `preferinteAlerte/{uid}` recalculează alertele acelui utilizator.
5. **Evenimentele** „dosar/sarcină asignată” ajung doar la persoana asignată (dacă tipul e pornit la ea), nu și altora.
6. **„Vreau alerte de la”** se arată și se aplică doar dacă utilizatorul are colegi care pot fi responsabili (`areFiltruDeLaCine` / `are_colegi`); altfel contează „toate”.

## Lansare (pași de deploy)

1. **[Eu]** Deploy-ul funcțiilor adaugă șase funcții noi: `alerte_client`, `alerte_dosar`, `alerte_sarcina`, `alerte_cabinet`, `alerte_preferinte` (triggere Firestore) și `alerte_zilnice` (job la 06:00).
2. **[Tu]** La primul deploy, Firebase CLI cere activarea API-ului Eventarc (dacă nu e activ); confirmi.
3. **[Tu]** Contul de serviciu dedicat (`RUNTIME_SERVICE_ACCOUNT`) are nevoie de rolul `Eventarc Event Receiver` (`roles/eventarc.eventReceiver`) ca să primească evenimentele. Comanda o pregătesc eu.
4. **[Eu]** Triggerele trebuie să ruleze în regiunea bazei de date Firestore. Implicit e `europe-west3`; dacă baza e în altă locație (ex. `eur3`), se setează `ALERTE_TRIGGER_REGION` în `.env.samwera-board-eu`. Deploy-ul eșuează explicit dacă regiunea nu se potrivește.
5. **[Eu]** Regulile Firestore se publică împreună cu frontendul (`npm run build:eu`).
6. **[Eu]** `python scripts/backfill_stadiu_din.py --project samwera-board-eu --dry-run`, apoi fără `--dry-run`: dosarele existente primesc `stadiuDin` = momentul rulării, ca „Dosar blocat” să nu pornească deodată pentru toate dosarele vechi. Se rulează înainte de flag.
7. **[Tu]** Din pagina de super admin pornești flag-ul „Alerte și notificări” doar pentru cabinetul de test. Triggerul pe cabinet calculează imediat toate alertele.
8. După o săptămână fără probleme, flag-ul se pornește pentru toți.
