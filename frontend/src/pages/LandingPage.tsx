import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PROVIDER, providerName, contactEmail } from '../lib/legalConfig'
import { Icon, type IconName } from './landingIcons'
import ThemeToggleSwitch from '../components/ThemeToggleSwitch'
import './landing.css'

const FAQ: [string, string][] = [
  ['Cine are acces la datele clienților mei?',
    'Utilizatorii cabinetului dumneavoastră, după rol. Aplicația nu oferă furnizorului acces la fișele clienților, la CNP-uri sau la jurnalul de acces. Accesul excepțional (de exemplu pentru depanare) are loc doar la cererea scrisă a cabinetului și se consemnează.'],
  ['Unde sunt stocate datele?',
    'Baza de date, serverul, cheile de criptare și jurnalele tehnice sunt în Frankfurt. Citirea actelor rulează în Suedia. Autentificarea Google și rețeaua care livrează fișierele aplicației sunt servicii globale ale Google, declarate în pagina Sub-împuterniciți.'],
  ['Se păstrează imaginile buletinelor scanate?',
    'Nu. Imaginea este trimisă la citire, iar procesatorul o șterge imediat după analiză. În fișa clientului rămân doar datele extrase, CNP-ul fiind criptat separat.'],
  ['Ce se întâmplă dacă vreau să plec?',
    'Datele se exportă la cerere, iar cabinetul se șterge integral în 30 de zile, conform acordului de prelucrare (DPA).'],
  ['La ce documente accesează aplicația din Google Drive?',
    'Doar la fișierul sau folderul pe care îl alegeți dumneavoastră prin selectorul Google. Nu are acces la restul Drive-ului.'],
  ['Cum primesc acces?',
    'În perioada de pilot, cabinetele noi sunt aprobate individual. Scrieți-ne și vă răspundem cu pașii de creare a contului.'],
]

type Card = { icon: IconName; title: string; text: string }

const STEPS: Card[] = [
  { icon: 'scan', title: 'Scanați actul', text: 'Încărcați actul de identitate sau alegeți-l din Google Drive. Datele sunt extrase automat.' },
  { icon: 'search', title: 'Completați firma', text: 'Datele firmei vin din registrele ANAF, după CUI. Verificați și corectați ce e nevoie.' },
  { icon: 'filePlus', title: 'Generați documentele', text: 'Documentele se completează din șabloane și se salvează în Drive sau se descarcă.' },
  { icon: 'briefcase', title: 'Urmăriți dosarul', text: 'Stadiul, responsabilul, termenele și sarcinile rămân la un loc, până la eliberare.' },
]

const MORE: Card[] = [
  { icon: 'users', title: 'Echipă și roluri', text: 'Administrator, membru sau doar citire, cu invitații trimise pe e-mail.' },
  { icon: 'folder', title: 'Google Drive', text: 'Documentele se salvează unde le țineți deja; aplicația vede doar fișierul ales.' },
  { icon: 'history', title: 'Istoric al documentelor', text: 'Vedeți ce s-a generat, pentru cine și când.' },
  { icon: 'sliders', title: 'Tabele pe măsura voastră', text: 'Alegeți coloanele, ordinea și lățimea, apoi filtrați și sortați.' },
  { icon: 'calendar', title: 'Termene la vedere', text: 'Data planificării dosarului apare direct în sarcini.' },
  { icon: 'pen', title: 'Șabloane proprii', text: 'Încărcați un document Word cu câmpuri, iar aplicația îl completează.' },
]

const SECURITY: Card[] = [
  { icon: 'globe', title: 'Date în UE', text: 'Baza de date, serverul, cheile de criptare și jurnalele tehnice sunt în Frankfurt. Citirea actelor rulează în Suedia.' },
  { icon: 'lock', title: 'CNP și serie criptate separat', text: 'Fiecare cabinet are propria cheie de criptare. În aplicație datele apar mascate; afișarea completă se face la cerere.' },
  { icon: 'layers', title: 'Izolare între cabinete', text: 'Un cabinet nu poate accesa datele altuia. Regulile de acces sunt testate automat.' },
  { icon: 'log', title: 'Jurnal de acces', text: 'Administratorul vede cine a afișat un CNP, a scanat un act, a generat un document sau a șters un client.' },
  { icon: 'fileX', title: 'Imaginea actului nu se păstrează', text: 'Procesatorul șterge imaginea imediat după citire; rămân doar datele extrase.' },
  { icon: 'trash', title: 'Ștergere reală', text: 'Un client se șterge complet, iar la încetarea contractului cabinetul se șterge în 30 de zile.' },
]

/** Atribute pentru apariția la scroll: `--d` decalează cardurile dintr-un rând. */
type Anim = 'up' | 'left' | 'right' | 'zoom'
const reveal = (i = 0, anim: Anim = 'up') => ({
  className: 'lp-reveal',
  'data-anim': anim,
  style: { '--d': `${Math.min(i, 5) * 70}ms` } as React.CSSProperties,
})

function CardGrid({ items, className = 'lp-grid', anim = 'zoom' }: { items: Card[]; className?: string; anim?: Anim | 'alternate' }) {
  return (
    <div className={className}>
      {items.map((c, i) => (
        <div key={c.title} className="lp-item lp-reveal" data-anim={anim === 'alternate' ? (i % 2 ? 'right' : 'left') : anim}
          style={{ '--d': `${Math.min(i, 5) * 90}ms` } as React.CSSProperties}>
          <span className="lp-ico"><Icon name={c.icon} /></span>
          <h3>{c.title}</h3>
          <p>{c.text}</p>
        </div>
      ))}
    </div>
  )
}

/* Ilustrații animate ale funcțiilor. Se rulează cât timp sunt în ecran (clasa lp-in) și sunt decorative. */
const rowVars = (i: number) => ({ '--i': i } as React.CSSProperties)

function MockClients() {
  const rows: [string, string, string][] = [
    ['Exemplu Consulting SRL', 'PJ', 'Activ'],
    ['Ion Popescu PFA', 'PFA', 'Activ'],
    ['Maria Ionescu', 'PF', ''],
    ['Alfa Proiect SRL', 'PJ', 'Activ'],
  ]
  return (
    <div className="lp-mock lp-reveal" data-anim="zoom" aria-hidden="true">
      <div className="lp-mock-head"><Icon name="clients" size={16} /> Clienți <span className="lp-mock-chip">PF · PFA · PJ</span></div>
      {rows.map(([n, t, a], i) => (
        <div className="lp-mrow" style={rowVars(i)} key={n}>
          <span className="lp-mname">{n}</span>
          <span className="lp-mtag">{t}</span>
          {a ? <span className="lp-mok"><Icon name="check" size={13} />ANAF</span> : <span className="lp-mnone">—</span>}
        </div>
      ))}
    </div>
  )
}

function MockDosare() {
  const rows: [string, string, number, string][] = [
    ['Modificare sediu social', 'În lucru', 35, 'blue'],
    ['Cesiune părți sociale', 'Depus, în soluționare', 65, 'amber'],
    ['Înființare SRL', 'Dosar spre eliberare', 88, 'orange'],
    ['Schimbare administrator', 'Dosar eliberat', 100, 'green'],
  ]
  return (
    <div className="lp-mock lp-reveal" data-anim="zoom" aria-hidden="true">
      <div className="lp-mock-head"><Icon name="briefcase" size={16} /> Dosare <span className="lp-mock-chip">stadiu · responsabil</span></div>
      {rows.map(([n, st, w, c], i) => (
        <div className="lp-mrow lp-mdos" style={rowVars(i)} key={n}>
          <span className="lp-mname">{n}</span>
          <span className={`lp-stage lp-stage-${c}`}>{st}</span>
          <span className="lp-bar"><i style={{ '--w': `${w}%` } as React.CSSProperties} /></span>
        </div>
      ))}
    </div>
  )
}

function MockKanban() {
  return (
    <div className="lp-mock lp-reveal" data-anim="zoom" aria-hidden="true">
      <div className="lp-mock-head"><Icon name="kanban" size={16} /> Sarcini <span className="lp-mock-chip">glisați între coloane</span></div>
      <div className="lp-kan">
        <div className="lp-kcol"><b>Deschis</b>
          <div className="lp-kcard lp-kmove"><i className="p-urgent" />Depune actele</div>
          <div className="lp-kcard"><i className="p-medie" />Cere semnătura</div>
        </div>
        <div className="lp-kcol"><b>În lucru</b>
          <div className="lp-kcard"><i className="p-ridicata" />Verifică CUI</div>
        </div>
        <div className="lp-kcol"><b>Finalizat</b>
          <div className="lp-kcard lp-kdone"><i className="p-scazuta" />Predă documente</div>
        </div>
      </div>
    </div>
  )
}

function MockDoc() {
  const rows: [string, string][] = [['Asociat', 'Ion Popescu'], ['CNP', '1••••••••••23'], ['Capital social', '200 lei'], ['Sediu', 'Timișoara, Str. Exemplu 1']]
  return (
    <div className="lp-mock lp-reveal" data-anim="zoom" aria-hidden="true">
      <div className="lp-mock-head"><Icon name="file" size={16} /> Act constitutiv <span className="lp-mock-chip">Word · Google Docs</span></div>
      {rows.map(([k, v], i) => (
        <div className="lp-mrow lp-mfield" style={rowVars(i)} key={k}>
          <span className="lp-mkey">{k}</span><b className="lp-type">{v}</b>
        </div>
      ))}
      <div className="lp-mdone"><Icon name="check" size={15} /> Document generat, salvat în Drive</div>
    </div>
  )
}

type ShowcaseProps = {
  id: string; icon: IconName; eyebrow: string; title: string; text: string; bullets: string[]; mock: ReactNode; flip?: boolean
}

function Showcase({ id, icon, eyebrow, title, text, bullets, mock, flip }: ShowcaseProps) {
  return (
    <section className={`lp-sec lp-show${flip ? ' lp-flip' : ''}`} id={id}>
      <div className="lp-show-text lp-reveal" data-anim={flip ? 'right' : 'left'}>
        <span className="lp-eyebrow"><span className="lp-ico"><Icon name={icon} size={18} /></span>{eyebrow}</span>
        <h2>{title}</h2>
        <p className="lp-sub">{text}</p>
        <ul className="lp-checks">
          {bullets.map(b => <li key={b}><Icon name="check" size={16} />{b}</li>)}
        </ul>
      </div>
      {mock}
    </section>
  )
}

/** Ilustrație animată: actul este scanat, datele apar, iar documentul se completează. Date fictive. */
function HeroVisual() {
  return (
    <div className="lp-visual" aria-hidden="true">
      <div className="lp-vcard lp-vid">
        <div className="lp-vscan" />
        <div className="lp-vphoto" />
        <div className="lp-vlines"><i /><i /><i /><i /></div>
      </div>
      <div className="lp-varrow"><Icon name="scan" size={20} /></div>
      <div className="lp-vcard lp-vdoc">
        <div className="lp-vdoc-head"><Icon name="file" size={16} /> Cerere de înregistrare</div>
        <div className="lp-vrow"><span>Nume</span><b className="f1">Ion Popescu</b></div>
        <div className="lp-vrow"><span>CNP</span><b className="f2">1••••••••••23</b></div>
        <div className="lp-vrow"><span>Adresă</span><b className="f3">Timișoara, Str. Exemplu 1</b></div>
        <div className="lp-vrow"><span>Firmă</span><b className="f4">Exemplu SRL</b></div>
        <div className="lp-vok"><Icon name="check" size={16} /> Document generat</div>
      </div>
      <div className="lp-vtag">Exemplu ilustrativ, cu date fictive</div>
    </div>
  )
}

export default function LandingPage({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [signing, setSigning] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const handle = async () => {
    setSigning(true)
    try { await onSignIn() } finally { setSigning(false) }
  }
  const mail = `mailto:${contactEmail()}?subject=${encodeURIComponent('Solicitare acces pilot Cabinio')}`

  // Animații la scroll: apariție, bară de progres, bară de navigare cu umbră și ușor parallax pe ilustrație.
  // Fără JS sau cu „reduce motion” totul rămâne vizibil (vezi landing.css).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    root.classList.add('lp-anim')

    // Reversibil: elementul apare când intră în ecran și se retrage când iese complet, deci animația
    // se reia la fiecare trecere (în jos și în sus). Pragul dublu evită pâlpâirea la margine.
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.intersectionRatio >= 0.12) e.target.classList.add('lp-in')
        else if (!e.isIntersecting) e.target.classList.remove('lp-in')
      }
    }, { threshold: [0, 0.12], rootMargin: '0px 0px -6% 0px' })
    root.querySelectorAll('.lp-reveal').forEach(el => io.observe(el))

    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const y = window.scrollY
        const max = document.documentElement.scrollHeight - window.innerHeight
        root.style.setProperty('--sy', String(Math.min(y, 600)))
        root.style.setProperty('--progress', max > 0 ? String(y / max) : '0')
        root.classList.toggle('lp-scrolled', y > 8)
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      io.disconnect()
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="lp" ref={rootRef}>
      <div className="lp-progress" aria-hidden="true" />
      <div className="lp-navbar">
        <div className="lp-wrap lp-nav">
          <div className="lp-logo">Cabin<span>io</span></div>
          <nav className="lp-links" aria-label="Secțiuni">
            <a href="#clienti">Clienți</a><a href="#documente">Documente</a><a href="#securitate">Securitate</a><a href="#pret">Preț</a>
          </nav>
          <div className="lp-nav-actions">
            <ThemeToggleSwitch />
            <button className="btn btn-sm lp-outline" onClick={handle} disabled={signing}>
              {signing ? <><span className="spin spin-dark" />Se conectează...</> : 'Autentificare'}
            </button>
          </div>
        </div>
      </div>

      <div className="lp-wrap lp-wrap-rel">
        <div className="lp-blob" aria-hidden="true" />
        <header className="lp-hero">
          <div className="lp-hero-text">
            <h1>Clienții, dosarele și documentele cabinetului, într-un singur loc.</h1>
            <p>
              Cabinio ține evidența clienților și a dosarelor ONRC, citește actele de identitate și completează documentele fără
              copiat de mână, cu datele clienților protejate în Uniunea Europeană.
            </p>
            <div className="lp-cta">
              <button className="btn btn-primary lp-btn" onClick={handle} disabled={signing}>
                {signing ? <><span className="spin" />Se conectează...</> : 'Autentificare cu Google'}
              </button>
              <a className="btn lp-btn lp-outline" href={mail}><Icon name="mail" size={18} />Solicită acces pilot</a>
            </div>
            <div className="lp-note">
              Aveți deja cont sau ați fost invitat de un coleg? Vă autentificați direct. Accesul pe invitație se aplică
              doar cabinetelor noi, în perioada de pilot. Pentru avocați, contabili și consultanți.
            </div>
            <ul className="lp-badges">
              <li><Icon name="globe" size={16} />Date în UE</li>
              <li><Icon name="lock" size={16} />CNP criptat</li>
              <li><Icon name="shield" size={16} />Acord de prelucrare (DPA)</li>
            </ul>
          </div>
          <HeroVisual />
        </header>

        <section className="lp-sec">
          <h2 {...reveal()}>De la act la dosar depus, fără copiat de mână</h2>
          <p className="lp-sub lp-reveal">
            Aceleași date ale unui client ajung în mai multe documente: nume, CNP, serie, adresă, date despre firmă. Cabinio le
            citește o singură dată și le folosește în toate.
          </p>
          <CardGrid items={STEPS} className="lp-steps" anim="up" />
        </section>

        <Showcase
          id="clienti" icon="clients" eyebrow="Gestiunea clienților"
          title="Toți clienții cabinetului, cu datele la îndemână"
          text="O fișă pentru fiecare client, completată din act și din registrele ANAF, la care echipa ajunge în câteva secunde."
          bullets={['Persoane fizice, PFA, II, IF și persoane juridice', 'Asociați și administratori legați de firmă', 'Date firmă preluate din ANAF, după CUI', 'Căutare, filtre și coloane alese de dumneavoastră']}
          mock={<MockClients />}
        />

        <Showcase
          id="dosare" flip icon="briefcase" eyebrow="Dosare"
          title="Vedeți unde se află fiecare dosar"
          text="Fiecare dosar are stadiu, responsabil, termene și tarif, iar statisticile se actualizează pe măsură ce lucrați."
          bullets={['Stadii de la „În lucru” la „Documente predate clientului”', 'Responsabil și dată de planificare', 'Tarife aplicate clienților și sumar lunar', 'Dosarele finalizate se arhivează, nu se pierd']}
          mock={<MockDosare />}
        />

        <Showcase
          id="sarcini" icon="kanban" eyebrow="Sarcini"
          title="Ce e de făcut azi, pentru toată echipa"
          text="Sarcinile stau pe un tablou cu coloane, legate de dosare, cu priorități și termene."
          bullets={['Glisați cardurile între Deschis, În lucru și Finalizat', 'Priorități de la scăzută la urgentă', 'Sarcini legate direct de dosarul lor', 'Adăugare rapidă, fără ferestre în plus']}
          mock={<MockKanban />}
        />

        <Showcase
          id="documente" flip icon="filePlus" eyebrow="Documente"
          title="Documentele se completează singure"
          text="Alegeți clientul și documentul; datele din fișă ajung în locul potrivit, iar rezultatul se salvează unde doriți."
          bullets={['Șabloane pentru acte constitutive, decizii și hotărâri AGA', 'Clauze pentru cesiuni, majorări de capital, schimbări de administrator și de CAEN', 'Propriile șabloane Word, cu câmpuri', 'Word sau Google Docs, cu istoric al generărilor']}
          mock={<MockDoc />}
        />

        <section className="lp-sec" id="functii">
          <h2 {...reveal()}>Și tot ce e în jurul lor</h2>
          <p className="lp-sub lp-reveal">Lucrul în echipă, cu roluri clare pentru fiecare utilizator.</p>
          <CardGrid items={MORE} />
        </section>

        <section className="lp-sec" id="securitate">
          <h2 {...reveal()}>Datele clienților, protejate și verificabile</h2>
          <p className="lp-sub lp-reveal">
            Cabinetul dumneavoastră este operator al datelor clienților, iar noi suntem împuternicit (art. 28 GDPR). Acordul de
            prelucrare și documentele legale sunt publice, iar administratorul cabinetului le acceptă la prima conectare.
          </p>
          <CardGrid items={SECURITY} anim="alternate" />
          <p className="lp-note lp-reveal" style={{ marginTop: '1rem' }}>
            Detaliile complete, inclusiv serviciile globale ale Google, sunt în{' '}
            <Link to="/sub-imputerniciti">Sub-împuterniciți</Link>, <Link to="/securitate">Securitate</Link> și{' '}
            <Link to="/dpa">Acordul de prelucrare (DPA)</Link>.
          </p>
        </section>

        <section className="lp-sec" id="pret">
          <h2 {...reveal()}>Preț</h2>
          <p className="lp-sub lp-reveal">Simplu în perioada de pilot; după aceea, în funcție de cât folosește cabinetul aplicația.</p>
          <div className="lp-price">
            <div className="lp-item main lp-reveal" data-anim="left">
              <h3>Abonament de pilot</h3>
              <div className="lp-amount">de la 200 RON <small>/ lună / cabinet</small></div>
              <ul>
                <li>Fără taxă de înființare: crearea cabinetului, importul de date și instruirea sunt incluse</li>
                <li>Prețul rămâne 200 RON/lună până la 31 decembrie 2026</li>
                <li>Se poate rezilia lunar</li>
              </ul>
            </div>
            <div className="lp-item lp-reveal" data-anim="right" style={{ '--d': '120ms' } as React.CSSProperties}>
              <h3>De la 1 ianuarie 2027</h3>
              <p>Prețul ține cont de numărul de dosare, de scanări și de documente generate. Grila se comunică în scris cu cel puțin 30 de zile înainte.</p>
              <ul>
                <li>Funcționalități și șabloane la cerere, cu estimare scrisă</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="lp-sec">
          <h2 {...reveal()}>Întrebări frecvente</h2>
          <div style={{ marginTop: '1rem' }}>
            {FAQ.map(([q, a], i) => (
              <details key={q} {...reveal(i, i % 2 ? 'right' : 'left')}><summary>{q}</summary><p>{a}</p></details>
            ))}
          </div>
        </section>

        <section className="lp-sec">
         <div className="lp-band lp-reveal" data-anim="zoom">
          <h2>Solicitați acces pilot</h2>
          <p className="lp-sub">Scrieți-ne câteva rânduri despre cabinet și despre volumul de dosare, iar noi revenim cu pașii următori.</p>
          <div className="lp-cta">
            <a className="btn btn-primary lp-btn" href={mail}><Icon name="mail" size={18} />Scrie-ne</a>
            <button className="btn lp-btn lp-outline" onClick={handle} disabled={signing}>Am deja cont: Autentificare</button>
          </div>
         </div>
        </section>

        <footer className="lp-foot">
          <nav>
            <Link to="/termeni">Termeni și condiții</Link>
            <Link to="/confidentialitate">Confidențialitate</Link>
            <Link to="/dpa">Acord de prelucrare (DPA)</Link>
            <Link to="/sub-imputerniciti">Sub-împuterniciți</Link>
            <Link to="/securitate">Securitate</Link>
          </nav>
          <div>
            <strong>{providerName()}</strong>
            {PROVIDER.registration ? ` · ${PROVIDER.registration}` : ''}
            {PROVIDER.address ? ` · ${PROVIDER.address}` : ''}
          </div>
          <div>Contact: {contactEmail()}. Nu folosim cookie-uri de urmărire.</div>
        </footer>
      </div>
    </div>
  )
}
