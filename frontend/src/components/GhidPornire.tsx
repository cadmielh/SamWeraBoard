import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { useIsMobile } from '../lib/useIsMobile'
import { withViewTransition } from '../lib/viewTransition'
import type { DefinitiePas } from '../lib/ghidPornire'
import { progresGhid, useClientDemo, useGhidVizibil } from '../lib/useGhid'
import BtnLabel from './BtnLabel'
import { deleteClientOnServer } from '../lib/pii'
import '../styles/ghid.css'

function IconBifa() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6.2 5 8.5l4.5-5" />
    </svg>
  )
}

/** Lista „Primii pași”: plutește în colțul din dreapta-jos (pe telefon, ca foaie de jos). */
export function GhidPanou() {
  const ghid = useGhidVizibil()
  const { toast } = useApp()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const demo = useClientDemo()

  // Primul document generat e momentul în care aplicația își arată rostul: îl marcăm.
  const generatAnterior = useRef<boolean | null>(null)
  const generat = !!ghid?.facuti.has('generare')
  useEffect(() => {
    if (!ghid) return
    if (generatAnterior.current === false && generat) toast('Primul tău document e gata. Bravo!', 'ok')
    generatAnterior.current = generat
  }, [ghid, generat, toast])

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
                </div>
                {!facut && (
                  <button type="button" className="btn btn-ghost btn-xs ghid-arata" onClick={() => arata(pas)}>Arată-mi</button>
                )}
              </li>
            )
          })}
        </ol>

        {!generat && (
          <div className="ghid-demo">
            <span>Vrei să încerci fără date reale?</span>
            <button type="button" className="btn btn-outline-primary btn-xs" onClick={() => void demo.creeaza()} disabled={demo.busy}>
              <BtnLabel busy={demo.busy} dark>Folosește un client demo</BtnLabel>
            </button>
          </div>
        )}

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
      await deleteClientOnServer(id)
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

const PAUZA_FARA_TINTA_MS = 6000

/**
 * Indiciul „Arată-mi”: un chenar peste elementul [data-ghid=țintă] și un text lângă el. Nu acoperă pagina:
 * utilizatorul face chiar acțiunea, iar clicul pe țintă trece la indiciul următor (ex. formularul deschis).
 * Dacă ținta nu apare (ex. ești la alt pas al generării), textul rămâne afișat jos, fără chenar.
 */
export function GhidIndiciu() {
  const ghid = useGhidVizibil()
  const indiciu = ghid?.indiciu ?? null
  const curent = indiciu ? indiciu.pas.indicii[indiciu.index] : null
  const areUrmator = !!indiciu && indiciu.index + 1 < indiciu.pas.indicii.length
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [faraTinta, setFaraTinta] = useState(false)
  const tintaRef = useRef<Element | null>(null)
  const { pathname } = useLocation()

  // Caută ținta și îi urmărește poziția (derulare, redimensionare, animații) cât timp indiciul e activ.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRect(null); setFaraTinta(false); tintaRef.current = null
    if (!curent) return
    const start = Date.now()
    let derulat = false
    let raf = 0
    const tick = () => {
      const el = [...document.querySelectorAll(`[data-ghid="${curent.tinta}"]`)]
        .find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }) ?? null
      tintaRef.current = el
      if (el) {
        if (!derulat) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); derulat = true }
        const r = el.getBoundingClientRect()
        setRect(prev => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : r))
        setFaraTinta(false)
      } else {
        setRect(null)
        if (Date.now() - start > PAUZA_FARA_TINTA_MS) setFaraTinta(true)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [curent, pathname])

  // Plecat de pe pagina indicată (după ce a ajuns pe ea): indiciul nu mai are sens.
  const ajunsRef = useRef(false)
  const ruta = indiciu?.pas.ruta ?? null
  useEffect(() => { ajunsRef.current = false }, [indiciu?.pas])
  useEffect(() => {
    if (!ruta || !ghid) return
    const peRuta = ruta === '/' ? pathname === '/' : pathname === ruta || pathname.startsWith(`${ruta}/`)
    if (peRuta) ajunsRef.current = true
    else if (ajunsRef.current) ghid.opresteIndiciul()
  }, [pathname, ruta, ghid])

  // Clicul pe țintă: utilizatorul a făcut ce i-am arătat, trecem mai departe.
  useEffect(() => {
    if (!curent || !ghid) return
    const onClick = (e: MouseEvent) => {
      if (areUrmator && tintaRef.current?.contains(e.target as Node)) ghid.urmatorulIndiciu()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') ghid.opresteIndiciul() }
    document.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('keydown', onKey) }
  }, [curent, areUrmator, ghid])

  if (!ghid || !indiciu || !curent || (!rect && !faraTinta)) return null

  const pozitie = rect ? pozitioneaza(rect) : null
  return (
    <>
      {rect && (
        <div className="ghid-chenar" aria-hidden
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />
      )}
      <div className={`ghid-indiciu${rect ? '' : ' ghid-indiciu--liber'}`} role="status"
        style={pozitie ?? undefined}>
        <div className="ghid-indiciu-pas">{indiciu.pas.titlu}{indiciu.pas.indicii.length > 1 && ` · ${indiciu.index + 1}/${indiciu.pas.indicii.length}`}</div>
        <p>{curent.text}</p>
        <div className="ghid-indiciu-act">
          <button type="button" className="btn btn-ghost btn-xs" onClick={ghid.deschide}>Toți pașii</button>
          <button type="button" className="btn btn-primary btn-xs" onClick={ghid.opresteIndiciul}>Am înțeles</button>
        </div>
      </div>
    </>
  )
}

const LATIME_INDICIU = 300
const MARGINE = 12

/** Textul stă sub țintă dacă încape, altfel deasupra; pe orizontală rămâne în ecran. */
function pozitioneaza(r: DOMRect): React.CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const latime = Math.min(LATIME_INDICIU, vw - 2 * MARGINE)
  const left = Math.max(MARGINE, Math.min(r.left + r.width / 2 - latime / 2, vw - latime - MARGINE))
  const sub = vh - r.bottom > 180 || r.top < 180
  return sub
    ? { top: Math.min(r.bottom + 14, vh - 160), left, width: latime }
    : { bottom: vh - r.top + 14, left, width: latime }
}
