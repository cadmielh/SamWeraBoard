import { Link } from 'react-router-dom'
import LegalLayout, { H, P, UL } from './LegalLayout'
import { providerName, contactEmail, securityEmail } from '../../lib/legalConfig'

// Textele se aplică identic oricărui cabinet: cabinetul apare ca „Operator”, iar cel care oferă serviciul
// ca „Furnizor”. Datele Furnizorului (nume, sediu, contact) se completează o singură dată, în
// lib/legalConfig.ts; câmpurile necompletate sunt omise, nu apar paranteze sau texte de completat.

function viaContact(email: string): string {
  return email ? `la adresa ${email}` : 'folosind datele de contact de la finalul acestei pagini'
}

export function TermeniPage() {
  return (
    <LegalLayout title="Termeni și condiții">
      <H>1. Serviciul și părțile</H>
      <P>Cabinio („Serviciul”) este o aplicație web pentru cabinete de contabilitate, avocatură și consultanță: gestionarea
        clienților și a dosarelor, extragerea datelor din acte de identitate și generarea de documente (inclusiv pentru ONRC).
        Serviciul este furnizat de {providerName()} („Furnizorul”). Cabinetul care își creează un spațiu de lucru și folosește Serviciul
        („Operatorul” sau „Cabinetul”) acceptă acești termeni prin bifarea acceptării din aplicație, prin administratorul spațiului.</P>
      <H>2. Conturi și spații de lucru</H>
      <UL>
        <li>Accesul se face cu un cont Google cu adresă de e-mail verificată.</li>
        <li>Persoana care creează sau acceptă termenii pentru un spațiu de lucru declară că are dreptul să angajeze Cabinetul.</li>
        <li>Administratorii răspund de persoanele pe care le invită, de rolurile acordate și de păstrarea confidențialității accesului.</li>
        <li>Fiecare spațiu de lucru este izolat: membrii unui spațiu nu văd datele altuia.</li>
      </UL>
      <H>3. Documentele generate</H>
      <P>Documentele sunt generate automat pe baza datelor introduse și a șabloanelor disponibile. Cabinetul are obligația să le verifice
        integral înainte de semnare sau depunere. Serviciul nu oferă consultanță juridică, contabilă sau fiscală, iar formularele și cerințele
        autorităților se pot schimba fără ca Furnizorul să poată garanta actualizarea imediată a șabloanelor.</P>
      <P>Dacă folosiți funcțiile Google Drive (alegerea unui act sau a unui șablon, salvarea documentelor generate), fișierele alese sau create rămân în contul Google al utilizatorului și sunt supuse termenilor Google. Furnizorul are acces doar la fișierul pe care îl alegeți pentru prelucrare, nu la restul Drive-ului.</P>
      <H>4. Datele clienților Cabinetului</H>
      <P>Pentru datele personale ale clienților introduse în aplicație (inclusiv CNP și date din acte de identitate), Cabinetul este operator, iar
        Furnizorul este împuternicit, potrivit <Link to="/dpa">Acordului de prelucrare a datelor (DPA)</Link>. Cabinetul răspunde de temeiul legal al prelucrării,
        de informarea persoanelor vizate și de acuratețea datelor. Nu introduceți categorii speciale de date (ex. date privind sănătatea) în aplicație.</P>
      <H>5. Utilizare acceptabilă</H>
      <P>Este interzisă utilizarea Serviciului pentru activități ilegale, accesarea datelor altor spații de lucru, ocolirea măsurilor de securitate,
        automatizarea abuzivă a cererilor sau suprasolicitarea infrastructurii. Furnizorul poate suspenda accesul în caz de abuz sau risc de securitate.</P>
      <H>6. Disponibilitate</H>
      <P>Furnizorul depune eforturi rezonabile pentru ca Serviciul să fie disponibil, fără a garanta funcționarea neîntreruptă: pot exista întreruperi pentru
        mentenanță sau din cauza unor servicii terțe (ex. Google, Microsoft, ANAF). Întreruperile programate importante se anunță în prealabil, când este posibil.</P>
      <H>7. Tarife</H>
      <P>Serviciul poate fi oferit gratuit sau contra cost. Orice tarif se comunică înainte de aplicare și se aplică doar pentru perioade viitoare;
        modificările de preț se anunță cu cel puțin 30 de zile înainte.</P>
      <H>8. Răspundere</H>
      <P>În măsura permisă de lege, răspunderea Furnizorului față de Cabinet pentru orice prejudiciu legat de Serviciu este limitată la sumele plătite pentru
        Serviciu în ultimele 12 luni. Limitarea nu se aplică în cazurile în care legea nu permite limitarea răspunderii (de exemplu dol sau culpă gravă). Furnizorul
        nu răspunde pentru documente depuse fără verificare, pentru date introduse greșit de utilizatori sau pentru nefuncționarea serviciilor terțe.</P>
      <H>9. Modificarea termenilor</H>
      <P>Termenii pot fi actualizați. Versiunea în vigoare este afișată în capul paginii. La o modificare importantă, administratorii spațiilor de lucru vor fi
        rugați să accepte din nou noua versiune înainte de a continua să prelucreze date personale.</P>
      <H>10. Încetare</H>
      <P>Cabinetul poate înceta utilizarea oricând. La încetare, datele se elimină conform Acordului de prelucrare (DPA), în termenul prevăzut acolo.</P>
      <H>11. Legea aplicabilă</H>
      <P>Legea română. Neînțelegerile se soluționează pe cale amiabilă, iar în lipsa unei înțelegeri, de instanțele române competente.</P>
    </LegalLayout>
  )
}

export function ConfidentialitatePage() {
  return (
    <LegalLayout title="Politica de confidențialitate">
      <P>Această politică descrie datele pe care {providerName()} („Furnizorul”) le prelucrează <strong>în calitate de operator</strong>, adică datele
        conturilor utilizatorilor. Datele personale ale clienților cabinetelor sunt prelucrate ca împuternicit, în numele cabinetului — vezi{' '}
        <Link to="/dpa">Acordul de prelucrare a datelor (DPA)</Link>.</P>
      <H>Ce date prelucrăm, de ce și cât timp</H>
      <UL>
        <li><strong>Date de cont</strong> (nume, e-mail, fotografie de profil și identificator din contul Google): autentificare și acces — executarea contractului.
          Cât timp contul este activ.</li>
        <li><strong>Apartenența la spații de lucru și rolurile</strong>: aplicarea drepturilor de acces — executarea contractului. Cât timp persoana este membră.</li>
        <li><strong>Jurnal de activitate</strong> (acțiune, moment, adresă IP, tip de browser): securitatea Serviciului și demonstrarea conformității — interes legitim
          și obligații legale. Aproximativ 13 luni.</li>
        <li><strong>Jurnale tehnice ale infrastructurii</strong> (adresă IP, moment, ruta apelată, cod de răspuns): funcționarea și securitatea Serviciului — interes legitim. Le păstrează Google Cloud Logging, 30 de zile, într-un spațiu de stocare din UE (Frankfurt). Doar jurnalele de administrare ale contului cloud al furnizorului (acțiunile furnizorului ca administrator, nu ale utilizatorilor Serviciului) sunt înregistrate de Google în locația „global”. Nu conțin valori ale datelor personale ale clienților.</li>
        <li><strong>Contoare de limitare a cererilor</strong> (identificatori tehnici pseudonimizați și un număr de cereri): protecția împotriva abuzului — interes legitim. Se șterg automat după câteva zile.</li>
        <li><strong>Dovada acceptării termenilor și a DPA</strong> (versiune, moment, adresă IP): demonstrarea consimțământului contractual (art. 5 alin. 2 GDPR).
          Pe durata contului și, ulterior, cât impune legea (de regulă până la 3 ani, termenul general de prescripție).</li>
      </UL>
      <H>Destinatari</H>
      <P>Furnizorii de infrastructură ai Serviciului, listați la <Link to="/sub-imputerniciti">Sub-împuterniciți</Link>. Nu vindem date și nu folosim cookie-uri de
        urmărire sau de publicitate; folosim doar stocare locală strict necesară funcționării (preferințe de interfață și sesiunea de autentificare). Când folosiți autentificarea Google sau fereastra Google de alegere a fișierelor din Drive, Google poate seta propriile cookie-uri, potrivit politicilor sale.</P>
      <H>Drepturile dumneavoastră</H>
      <P>Aveți dreptul de acces, rectificare, ștergere, restricționare, portabilitate și opoziție. Le puteți exercita scriind {viaContact(contactEmail())}. Dacă
        sunteți client al unui cabinet, cererile privind datele dumneavoastră se adresează cabinetului, care este operatorul acestora. Aveți dreptul să depuneți
        plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP).</P>
      <H>Unde sunt prelucrate datele</H>
      <P>Datele clienților cabinetelor (baza de date, serverele aplicației, cheile de criptare, recunoașterea textului din acte) sunt prelucrate în Spațiul Economic
        European. Autentificarea (Firebase Authentication, Google) poate implica transferuri în afara SEE, pe baza clauzelor contractuale standard și/sau a Cadrului
        UE–SUA privind protecția datelor. Jurnalele tehnice ale serverului (erori, timpi de răspuns) nu conțin date personale ale clienților: valorile cum este CNP-ul
        nu sunt scrise în ele. Detalii despre măsuri: <Link to="/securitate">Securitate</Link>.</P>
    </LegalLayout>
  )
}

export function DpaPage() {
  return (
    <LegalLayout title="Acord de prelucrare a datelor (DPA)">
      <P>Încheiat, în temeiul art. 28 din Regulamentul (UE) 2016/679 (GDPR), între cabinetul care creează spațiul de lucru („<strong>Operatorul</strong>”) și{' '}
        {providerName()} („<strong>Împuternicitul</strong>”). Acordul se încheie prin acceptarea în aplicație, de către administratorul spațiului de lucru, în numele
        Operatorului, și completează <Link to="/termeni">Termenii și condițiile</Link>.</P>
      <H>1. Obiect, natură, scop, durată</H>
      <P>Împuternicitul prelucrează date personale în numele Operatorului exclusiv pentru furnizarea aplicației: stocarea fișelor de clienți, extragerea datelor din acte de
        identitate, generarea documentelor și evidența dosarelor. Durata: cât timp spațiul de lucru este activ, plus perioada de ștergere de la punctul 3.</P>
      <H>2. Categorii de date și persoane vizate</H>
      <P>Persoane vizate: clienții Operatorului, asociați, administratori și reprezentanți ai acestora. Date: nume, CNP, serie și număr act de identitate, data și locul nașterii,
        adresă, cetățenie, date de contact, date ale societăților și ale dosarelor.</P>
      <H>3. Obligațiile Împuternicitului</H>
      <UL>
        <li>Prelucrează datele numai pe baza instrucțiunilor documentate ale Operatorului (inclusiv prin utilizarea funcțiilor aplicației) și îl informează dacă o instrucțiune
          încalcă legea.</li>
        <li>Asigură confidențialitatea persoanelor autorizate să acceseze datele.</li>
        <li>Aplică măsuri tehnice și organizatorice adecvate, descrise pe pagina <Link to="/securitate">Securitate</Link>, inclusiv criptarea la nivel de câmp a CNP și a seriei
          actului de identitate, cu chei separate pentru fiecare spațiu de lucru.</li>
        <li>Notifică Operatorul fără întârziere nejustificată, în principiu în cel mult 48 de ore de la luarea la cunoștință, despre orice încălcare a securității datelor.</li>
        <li>Sprijină Operatorul în îndeplinirea cererilor persoanelor vizate (acces, rectificare, ștergere, portabilitate) și în evaluările de impact, prin funcțiile aplicației și, la cerere,
          prin informațiile necesare.</li>
        <li>La încetarea acordului sau la cererea Operatorului, șterge datele din aplicație în cel mult 30 de zile, cu excepția celor pe care legea îi impune să le păstreze;
          datele șterse pot rămâne recuperabile în mecanismul de recuperare a bazei de date (7 zile) și în eventualele copii de siguranță, care expiră automat în cel mult 35 de zile de la ștergere.</li>
        <li>Pune la dispoziția Operatorului informațiile necesare pentru a demonstra respectarea acordului și permite audituri rezonabile, cu preaviz și în timpul programului normal de lucru.</li>
      </UL>
      <H>4. Sub-împuterniciți</H>
      <P>Operatorul autorizează în general apelarea la sub-împuterniciții din <Link to="/sub-imputerniciti">lista publică</Link>. Împuternicitul impune fiecăruia obligații echivalente celor din acest acord.
        Orice adăugare sau înlocuire se anunță cu cel puțin 30 de zile înainte, iar Operatorul se poate opune, motivat; dacă nu se ajunge la o soluție, Operatorul poate înceta utilizarea Serviciului.</P>
      <H>5. Transferuri internaționale</H>
      <P>Datele clienților Operatorului sunt prelucrate în Spațiul Economic European. Excepție: autentificarea (Firebase Authentication, Google) poate implica transferuri în afara SEE, pe baza clauzelor
        contractuale standard și/sau a Cadrului UE–SUA privind protecția datelor. Fără o bază legală adecvată, Împuternicitul nu transferă datele în afara SEE.</P>
      <H>6. Obligațiile Operatorului</H>
      <P>Operatorul răspunde de temeiul legal al prelucrării, de informarea persoanelor vizate, de acuratețea datelor introduse și de gestionarea accesului utilizatorilor săi. Nu introduce categorii speciale
        de date în aplicație.</P>
      <H>7. Răspundere</H>
      <P>Răspunderea părților este cea prevăzută de lege și de Termenii și condițiile Serviciului, fără a fi afectate drepturile persoanelor vizate potrivit GDPR.</P>
    </LegalLayout>
  )
}

export function SubImputernicitiPage() {
  const rows: [string, string, string, string][] = [
    ['Google Cloud / Firebase (Firestore, Cloud Functions, Cloud KMS)', 'Găzduirea aplicației, baza de date, serverele aplicației și cheile de criptare', 'Toate datele din aplicație (datele sensibile, criptate)', 'UE — Frankfurt (europe-west3)'],
    ['Firebase Hosting (rețeaua de distribuție Google)', 'Livrarea fișierelor statice ale aplicației (cod, fonturi, imagini); nu conțin date din aplicație', 'Adresa IP a vizitatorului (jurnale tehnice ale rețelei)', 'Rețea globală de distribuție'],
    ['Google Cloud Logging (jurnale tehnice)', 'Jurnalele de funcționare ale serverului (erori, timpi de răspuns), fără valori ale datelor clienților; păstrare 30 de zile', 'Adresa IP, momentul și ruta apelată; nu CNP, nume sau alte date din fișele clienților', 'UE (Frankfurt, europe-west3); doar jurnalele de administrare ale furnizorului rămân în locația „global”'],
    ['Firebase Authentication (Google)', 'Autentificarea utilizatorilor', 'Date de cont (nume, e-mail, identificator)', 'Global; clauze contractuale standard / Cadrul UE–SUA'],
    ['Microsoft Azure (Document Intelligence)', 'Recunoaștere text (OCR) pe imaginea actului de identitate. Aplicația nu o stochează; Azure păstrează temporar fișierul și rezultatul, cel mult 24 de ore (aplicația cere ștergerea imediată după procesare) și nu le folosește pentru antrenarea modelelor', 'Imaginea actului de identitate încărcat', 'UE — Suedia (Sweden Central)'],
    ['Google Drive / Docs (contul utilizatorului)', 'Alegerea opțională a actelor și a șabloanelor și salvarea documentelor generate. Aplicația accesează doar fișierele create de ea sau alese explicit de utilizator (permisiunea „drive.file”); tokenul Google rămâne în browser și nu ajunge pe serverele Furnizorului', 'Fișierele alese sau create de utilizator, la alegerea lui', 'Conform contului Google al utilizatorului'],
  ]
  return (
    <LegalLayout title="Sub-împuterniciți">
      <P>Furnizorii care prelucrează date în numele nostru. Modificările se anunță conform <Link to="/dpa">DPA</Link>, cu cel puțin 30 de zile înainte.</P>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
          <thead>
            <tr>{['Furnizor', 'Scop', 'Date', 'Locație'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '.5rem', borderBottom: '1px solid var(--s200)' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r[0]}>{r.map((c, i) => <td key={i} style={{ padding: '.5rem', borderBottom: '1px solid var(--s100)', verticalAlign: 'top' }}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>&nbsp;</P>
      <P>La completarea automată a datelor unei societăți (statut fiscal, administratori, sediu) se transmite doar codul de identificare fiscală (CIF), identificator public, către:</P>
      <UL>
        <li><strong>ANAF</strong> (Agenția Națională de Administrare Fiscală) — autoritate publică, nu sub-împuternicit;</li>
        <li><strong>cuiscan.ro</strong> — serviciu terț de consultare a datelor publice ale societăților, care primește doar CIF-ul și returnează date publice. Nu îi sunt trimise date personale ale clienților sau ale utilizatorilor; nu prelucrează date în numele nostru și nu are acces la spațiile de lucru.</li>
      </UL>
    </LegalLayout>
  )
}

const CADRU_LEGAL: [string, string][] = [
  ['Regulamentul (UE) 2016/679 (GDPR), art. 28 — împuternicit', 'Acord de prelucrare (DPA) acceptat în aplicație de administratorul fiecărui spațiu de lucru, versionat, cu dovada acceptării (moment, versiune, adresă IP). Fără acceptare, serverul refuză scanarea actelor și accesul la CNP.'],
  ['GDPR, art. 32 — securitatea prelucrării', 'Criptare la nivel de câmp pentru CNP și serie CI, izolare între spații de lucru, acces pe roluri, jurnal de activitate, chei în KMS, teste automate ale regulilor de acces (secțiunea „În vigoare”).'],
  ['GDPR, art. 5 — minimizare și limitarea stocării', 'Imaginile actelor nu se stochează; istoricul extragerilor păstrează doar sursa și data, 30 de zile; jurnalul de activitate ~13 luni; ștergerea unui client elimină în cascadă și datele sensibile.'],
  ['Legea nr. 190/2018, art. 4 — număr național de identificare (CNP)', 'Garanții tehnice și organizatorice specifice: CNP criptat separat de restul fișei, citire doar prin server și înregistrată, perioade de stocare definite, fără CNP în jurnalele tehnice.'],
  ['GDPR, cap. V — transferuri în afara SEE', 'Datele clienților rămân în SEE (baza de date și serverele: Frankfurt; recunoașterea textului: Suedia). Singura excepție declarată este autentificarea Google (clauze contractuale standard / Cadrul UE–SUA).'],
  ['GDPR, art. 33 — încălcări ale securității datelor', 'Furnizorul notifică Operatorul fără întârziere nejustificată, în principiu în 48 de ore; Operatorul are, potrivit GDPR, 72 de ore pentru notificarea ANSPDCP.'],
]

export function SecuritatePage() {
  return (
    <LegalLayout title="Securitate și conformitate">
      <P>Datele cabinetelor și ale clienților lor sunt protejate prin măsurile de mai jos. Separăm ce este în vigoare de ce este planificat, ca să nu promitem mai mult decât livrăm.
        Ne bazăm pe infrastructura Google Cloud și Microsoft Azure, care dețin certificări proprii (de exemplu ISO/IEC 27001 și SOC 2); Furnizorul nu deține, la această dată, certificări independente proprii.</P>

      <H>Unde sunt datele</H>
      <UL>
        <li><strong>Baza de date, serverele aplicației și cheile de criptare</strong>: Uniunea Europeană — Google Cloud, regiunea Frankfurt (europe-west3).</li>
        <li><strong>Recunoașterea textului din acte</strong> (OCR): Microsoft Azure, regiunea Suedia (Sweden Central), UE. Aplicația nu stochează imaginea. Azure păstrează temporar, criptate și în aceeași regiune, fișierul trimis și rezultatul analizei, cel mult 24 de ore, apoi le șterge automat; <strong>aplicația cere ștergerea lor imediat după procesare</strong>. Azure nu le folosește pentru antrenarea modelelor.</li>
        <li><strong>Fișierele statice ale aplicației</strong> (cod, fonturi, imagini, fără date personale) sunt distribuite prin rețeaua Google, iar <strong>autentificarea</strong> (Google) este procesată de Google, cu clauze contractuale standard / Cadrul UE–SUA. <strong>Jurnalele tehnice ale infrastructurii</strong> (adresă IP, moment, ruta apelată; fără valori ale datelor clienților) sunt stocate în UE (Frankfurt) — vezi <Link to="/sub-imputerniciti">Sub-împuterniciți</Link> și <Link to="/confidentialitate">Confidențialitate</Link>.</li>
      </UL>

      <H>Cadrul legal și cum îl respectăm</H>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
          <thead>
            <tr>{['Cerință', 'Ce facem'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '.5rem', borderBottom: '1px solid var(--s200)' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {CADRU_LEGAL.map(([req, what]) => (
              <tr key={req}>
                <td style={{ padding: '.5rem', borderBottom: '1px solid var(--s100)', verticalAlign: 'top', width: '34%', fontWeight: 600, color: 'var(--s800)' }}>{req}</td>
                <td style={{ padding: '.5rem', borderBottom: '1px solid var(--s100)', verticalAlign: 'top' }}>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H>În vigoare</H>
      <UL>
        <li><strong>Criptarea CNP și a seriei actului de identitate</strong> la nivel de câmp (AES-256-GCM), cu o cheie separată pentru fiecare spațiu de lucru, învelită de o cheie din Google Cloud KMS (UE) cu rotație periodică.
          Valorile în clar se citesc doar prin server, iar fiecare acces (cine, când, în ce scop, câte persoane) este înregistrat, fără a scrie valorile în jurnal.</li>
        <li><strong>Criptare în tranzit și la stocare</strong>: conexiuni HTTPS cu HSTS; datele din baza de date sunt criptate la stocare de furnizorul de infrastructură.</li>
        <li><strong>Izolare între spații de lucru</strong>: accesul este verificat pe server și în regulile bazei de date; fiecare cerere e legată de un spațiu și de un rol (administrator, membru, doar citire). Regulile sunt verificate prin teste automate.</li>
        <li><strong>Acces minim la Google Drive</strong>: aplicația vede doar fișierele create de ea sau alese explicit de utilizator prin fereastra Google (permisiunea „drive.file”), nu tot Drive-ul; tokenul Google rămâne în browser și nu ajunge pe serverele Furnizorului.</li>
        <li><strong>Imaginile actelor de identitate nu sunt stocate de aplicație</strong>: se procesează în memorie, iar după extragere cerem la Azure ștergerea imediată a fișierului trimis și a rezultatului (ștergerea automată, în cel mult 24 de ore, rămâne plasa de siguranță).</li>
        <li><strong>Invitații cu acceptare explicită</strong>: nimeni nu este adăugat automat într-un spațiu; invitațiile expiră după 14 zile.</li>
        <li><strong>Jurnal de activitate</strong> scris exclusiv de server (nu poate fi modificat din aplicație), vizibil administratorilor, păstrat aproximativ 13 luni.</li>
        <li><strong>Autentificare</strong> prin conturi Google cu e-mail verificat; sesiunile revocate sunt respinse.</li>
        <li><strong>Fără date personale în jurnalele tehnice</strong> și mesaje de eroare generice către utilizatori.</li>
        <li><strong>Recuperare la un moment anterior</strong> a bazei de date (ultimele 7 zile) și protecție împotriva ștergerii accidentale a bazei de date.</li>
        <li><strong>Procedură scrisă de răspuns la incidente</strong>, cu responsabilități și termene: evaluare în 24 de ore, notificarea cabinetelor în principiu în 48 de ore, registru al incidentelor și exercițiu anual.</li>
        <li><strong>Ștergerea unui client</strong> elimină în cascadă fișa, datele sensibile din vault și istoricul generărilor.</li>
        <li><strong>Protecții de aplicație</strong>: antete de securitate (HSTS, protecție împotriva încadrării în alte pagini, politică de referrer), CORS restrictiv, limitarea cererilor pe utilizator și pe spațiu de lucru (protejează costul de procesare și încetinește un acces abuziv), validarea intrărilor, secrete păstrate în Google Secret Manager, fonturi și resurse găzduite local (fără urmărire de terți).</li>
      </UL>

      <H>Planificat</H>
      <UL>
        <li>Autentificare în doi pași obligatorie pentru administratori.</li>
        <li>Export al datelor și ștergere a întregului spațiu de lucru direct din aplicație, retenție configurabilă.</li>
        <li>Copii de siguranță programate cu retenție mai lungă și teste de penetrare periodice.</li>
      </UL>

      <H>Incidente și vulnerabilități</H>
      <P>Raportați o vulnerabilitate sau un incident {viaContact(securityEmail())}. Vă răspundem cu prioritate și notificăm fără întârziere nejustificată, conform <Link to="/dpa">DPA</Link>.</P>
    </LegalLayout>
  )
}
