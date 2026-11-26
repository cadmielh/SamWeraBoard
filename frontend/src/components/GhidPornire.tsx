import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { useIsMobile } from '../lib/useIsMobile'
import { withViewTransition } from '../lib/viewTransition'
import { pasiObligatorii, type DefinitiePas } from '../lib/ghidPornire'
import { progresGhid, useClientDemo, useGhidVizibil } from '../lib/useGhid'
import BtnLabel from './BtnLabel'
import IndiciuEvidentiat from './IndiciuEvidentiat'
import { deleteClientOnServer } from '../lib/pii'
import '../styles/ghid.css'

function IconBifa() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6.2 5 8.5l4.5-5" />
    </svg>
  )
}

/** Cât așteaptă anunțul unui pas făcut (rezultatul pasului apare întâi) și cât de des reverifică. */
const PAUZA_ANUNT_MS = 1200

/** Lista „Primii pași”: plutește în colțul din dreapta-jos (pe telefon, ca foaie de jos). */
export function GhidPanou() {
  const ghid = useGhidVizibil()
  const { toast } = useApp()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const demo = useClientDemo()

  // Un pas tocmai făcut: un anunț discret cu pasul următor și „Arată-mi”, în loc să redeschidem panoul peste lucru
  // (ex. peste datele abia extrase). Așteptăm să se închidă fereastra în care s-a făcut pasul și indiciile lui.
  const pasFacut = ghid?.pasFacut ?? null
  const ghidRef = useRef(ghid)
  useEffect(() => { ghidRef.current = ghid })
  useEffect(() => {
    if (!pasFacut) return
    const t = setInterval(() => {
      if (document.querySelector('.modal-backdrop, .ghid-indiciu')) return
      clearInterval(t)
      const g = ghidRef.current
      if (!g) return
      g.confirmaPasFacut()
      if (!g.activ || g.ascuns) return
      const facut = g.pasi.find(p => p.key === pasFacut)
      // Pasul următor nefăcut de după cel tocmai făcut (înainte, nu înapoi la ce a sărit); apoi cel mai vechi rămas.
      const obligatorii = pasiObligatorii(g.pasi)
      const dupa = obligatorii.slice(obligatorii.findIndex(p => p.key === pasFacut) + 1)
      const urmator = dupa.find(p => !g.facuti.has(p.key)) ?? obligatorii.find(p => !g.facuti.has(p.key))
      const inceput = pasFacut === 'generare' ? 'Primul tău document e gata. Bravo!' : `Gata: ${facut?.titlu ?? 'pasul'}.`
      if (!urmator) { toast(`${inceput} Ai parcurs primii pași. Spor la lucru!`, 'ok'); return }
      // După scanare utilizatorul e la jumătatea fluxului (verificare → generare): nu-l trimitem în altă parte.
      if (pasFacut === 'scan') { toast(`${inceput} Verifică datele extrase și continuă până la document.`, 'ok'); return }
      toast(`${inceput} Urmează: ${urmator.titlu}.`, 'ok', {
        action: { label: 'Arată-mi', onClick: () => { g.arata(urmator); withViewTransition(() => navigate(urmator.ruta)) } },
      })
    }, PAUZA_ANUNT_MS)
    return () => clearInterval(t)
  }, [pasFacut, toast, navigate])

  useEffect(() => {
    if (!ghid?.deschis) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') ghid.inchide() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ghid])

  if (!ghid?.deschis) return null
  const { facuti, total } = progresGhid(ghid)
  const gata = facuti === total

  const arata = (pas: DefinitiePas) => {
    ghid.arata(pas)
    withViewTransition(() => navigate(pas.ruta))
  }

  return (
    <>
      {isMobile && <div className="ghid-backdrop" onClick={ghid.inchide} />}
      <section className="ghid-panou" role="dialog" aria-label="Primii pași">
        <header className="ghid-cap">
          <div>
            <h2>Primii pași</h2>
            <p>{gata ? 'Ai parcurs tot. Spor la lucru!' : `${facuti} din ${total} · se bifează singuri când îi faci`}</p>
          </div>
          <button type="button" className="ghid-x" onClick={ghid.inchide} aria-label="Închide">×</button>
        </header>
        <div className="ghid-bara" aria-hidden><span style={{ width: `${(facuti / total) * 100}%` }} /></div>

        <ol className="ghid-pasi">
          {ghid.pasi.map(pas => {
            const facut = ghid.facuti.has(pas.key)
            return (
              <li key={pas.key} className={`ghid-pas${facut ? ' ghid-pas--facut' : ''}`}>
                <span className="ghid-bifa" aria-label={facut ? 'Făcut' : 'De făcut'}>{facut && <IconBifa />}</span>
                <div className="ghid-pas-text">
                  <div className="ghid-pas-titlu">
                    {pas.titlu}
                    {pas.recomandat && !facut && <span className="ghid-eticheta">Recomandat</span>}
                    {pas.optional && <span className="ghid-eticheta ghid-eticheta--admin">Opțional</span>}
                    {pas.doarAdmin && <span className="ghid-eticheta ghid-eticheta--admin">Admin</span>}
                  </div>
                  {!facut && <div className="ghid-pas-desc">{pas.descriere}</div>}
                  {pas.key === 'generare' && !facut && (
                    <div className="ghid-demo">
                      <span>N-ai încă un client sau vrei să încerci fără date reale?</span>
                      <button type="button" className="btn btn-outline-primary btn-xs" onClick={() => void demo.creeaza()} disabled={demo.busy}>
                        <BtnLabel busy={demo.busy} dark>Folosește un client demo</BtnLabel>
                      </button>
                    </div>
                  )}
                </div>
                {!facut && (
                  <button type="button" className="btn btn-ghost btn-xs ghid-arata" onClick={() => arata(pas)}>Arată-mi</button>
                )}
              </li>
            )
          })}
        </ol>

        <footer className="ghid-subsol">
          <button type="button" className="btn btn-ghost btn-xs" onClick={ghid.ascunde}>
            {gata ? 'Închide ghidul' : 'Ascunde ghidul'}
          </button>
          <span>Îl găsești oricând în Setări › Cont.</span>
        </footer>
      </section>
    </>
  )
}

/** Intrarea din bara laterală: progresul și deschiderea panoului. Doar cât ghidul e activ (probă, membru recent). */
export function GhidIntrare() {
  const ghid = useGhidVizibil()
  if (!ghid?.activ) return null
  const { facuti, total } = progresGhid(ghid)
  // Ascuns sau terminat, rămâne o intrare discretă, ca ghidul să poată fi redeschis oricând.
  if (ghid.ascuns) {
    return (
      <button type="button" className="sidebar-plan ghid-intrare ghid-intrare--discret" onClick={ghid.deschide} title="Ghid de pornire">
        <span className="ghid-inel" style={{ '--p': facuti / total } as React.CSSProperties} aria-hidden />
        <span className="sidebar-plan-text"><span>Ghid de pornire</span></span>
      </button>
    )
  }
  return (
    <button type="button" className="sidebar-plan ghid-intrare" onClick={ghid.deschis ? ghid.inchide : ghid.deschide}
      title={`Primii pași · ${facuti} din ${total}`} aria-expanded={ghid.deschis}>
      <span className="ghid-inel" style={{ '--p': facuti / total } as React.CSSProperties} aria-hidden />
      <span className="sidebar-plan-text">
        <strong>Primii pași</strong>
        <span>{facuti === total ? 'Gata!' : `${facuti} din ${total} făcuți`}</span>
      </span>
    </button>
  )
}

/** La finalul ghidului, dacă a rămas clientul demo: îl ștergem? (Doar clientul demo; un client real nu e atins.) */
export function GhidStergeDemo() {
  const ghid = useGhidVizibil()
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  // Puțin după ultimul pas, ca rezultatul lui (ex. documentul generat) să apară întâi.
  const [vizibil, setVizibil] = useState(false)
  const id = ghid?.demoDeSters ?? null
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVizibil(false)
    if (!id) return
    const t = setTimeout(() => setVizibil(true), 1500)
    return () => clearTimeout(t)
  }, [id])

  if (!ghid || !id || !vizibil) return null
  const sterge = async () => {
    setBusy(true)
    try {
      await deleteClientOnServer(id, 'sterge')       // documentele de probă nu merită păstrate în Arhivă
      toast('Clientul demo a fost șters. Acum poți lucra cu clienții tăi.', 'ok')
      ghid.raspundeDemo(false)
    } catch (e) {
      toast((e as Error).message || 'Clientul demo nu a putut fi șters', 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ghid-indiciu ghid-indiciu--liber" role="dialog" aria-label="Ștergi clientul demo?">
      <div className="ghid-indiciu-pas">Ai terminat ghidul</div>
      <p>Clientul demo și-a făcut treaba. Îl ștergem acum, împreună cu istoricul lui de documente? Documentele deja descărcate rămân la tine.</p>
      <div className="ghid-indiciu-act">
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => ghid.raspundeDemo(true)} disabled={busy}>Îl mai păstrez</button>
        <button type="button" className="btn btn-primary btn-xs" onClick={() => void sterge()} disabled={busy}>
          <BtnLabel busy={busy}>Șterge clientul demo</BtnLabel>
        </button>
      </div>
    </div>
  )
}

/** Indiciul „Arată-mi” al ghidului: componenta comună (IndiciuEvidentiat), cu pasul activ al ghidului. */
export function GhidIndiciu() {
  const ghid = useGhidVizibil()
  const indiciu = ghid?.indiciu ?? null
  if (!ghid || !indiciu) return null
  // Indiciile doar de citit (ex. coloanele board-ului) nu cer un clic pe țintă: „Următorul” trece mai departe.
  const areUrmator = indiciu.index + 1 < indiciu.pas.indicii.length
  return (
    <IndiciuEvidentiat
      titlu={indiciu.pas.titlu} indicii={indiciu.pas.indicii} index={indiciu.index} ruta={indiciu.pas.ruta}
      onUrmator={ghid.urmatorulIndiciu} onOpreste={ghid.opresteIndiciul} incheieLaUltimulClic
      actiuni={<>
        <button type="button" className="btn btn-ghost btn-xs" onClick={ghid.deschide}>Toți pașii</button>
        <button type="button" className="btn btn-primary btn-xs" onClick={areUrmator ? ghid.urmatorulIndiciu : ghid.opresteIndiciul}>
          {areUrmator ? 'Următorul' : 'Am înțeles'}
        </button>
      </>}
    />
  )
}
