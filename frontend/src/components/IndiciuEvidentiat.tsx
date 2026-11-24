import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { IndiciuGhid } from '../lib/ghidPornire'
import '../styles/ghid.css'

const PAUZA_FARA_TINTA_MS = 6000
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

interface Props {
  /** Eticheta de deasupra textului (ex. titlul pasului din ghid sau al noutății). */
  titlu: string
  indicii: IndiciuGhid[]
  index: number
  /** Pagina pe care are sens indiciul: plecat de pe ea (după ce a ajuns), indiciul se oprește. */
  ruta: string | null
  onUrmator: () => void
  onOpreste: () => void
  /** Butoanele din bulă (ex. „Toți pașii” + „Am înțeles” la ghid, „Următorul” la turul unei noutăți). */
  actiuni: ReactNode
  /** Clicul pe ținta ultimului indiciu încheie (utilizatorul a făcut ce i s-a arătat), ca la turul unei noutăți. */
  incheieLaUltimulClic?: boolean
}

/**
 * Indiciul „Arată-mi”: un chenar peste elementul [data-ghid=țintă] și un text lângă el. Nu acoperă pagina:
 * utilizatorul face chiar acțiunea, iar clicul pe țintă trece la indiciul următor (ex. formularul deschis).
 * Dacă ținta nu apare (ex. ești la alt pas), textul rămâne afișat jos, fără chenar. Folosit de ghidul „Primii pași”
 * și de turul „Arată-mi cum” al unei noutăți, ca cele două să arate și să se poarte la fel.
 */
export default function IndiciuEvidentiat({ titlu, indicii, index, ruta, onUrmator, onOpreste, actiuni, incheieLaUltimulClic }: Props) {
  const curent = indicii[index] ?? null
  const areUrmator = index + 1 < indicii.length
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [faraTinta, setFaraTinta] = useState(false)
  // O fereastră deschisă (previzualizare, confirmare): indiciul nu se desenează peste ea; reapare după închidere.
  const [subFereastra, setSubFereastra] = useState(false)
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
      setSubFereastra(!!document.querySelector('.modal-backdrop'))
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
  useEffect(() => { ajunsRef.current = false }, [indicii])
  useEffect(() => {
    if (!ruta) return
    const peRuta = ruta === '/' ? pathname === '/' : pathname === ruta || pathname.startsWith(`${ruta}/`)
    if (peRuta) ajunsRef.current = true
    else if (ajunsRef.current) onOpreste()
  }, [pathname, ruta, onOpreste])

  // Clicul pe țintă: utilizatorul a făcut ce i-am arătat, trecem mai departe.
  useEffect(() => {
    if (!curent) return
    const onClick = (e: MouseEvent) => {
      if (!tintaRef.current?.contains(e.target as Node)) return
      if (areUrmator) onUrmator()
      else if (incheieLaUltimulClic) onOpreste()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpreste() }
    document.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('keydown', onKey) }
  }, [curent, areUrmator, onUrmator, onOpreste, incheieLaUltimulClic])

  if (!curent || subFereastra || (!rect && !faraTinta)) return null

  const pozitie = rect ? pozitioneaza(rect) : null
  return (
    <>
      {rect && (
        <div className="ghid-chenar" aria-hidden
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />
      )}
      <div className={`ghid-indiciu${rect ? '' : ' ghid-indiciu--liber'}`} role="status" style={pozitie ?? undefined}>
        <div className="ghid-indiciu-pas">{titlu}{indicii.length > 1 && ` · ${index + 1}/${indicii.length}`}</div>
        <p>{curent.text}</p>
        <div className="ghid-indiciu-act">{actiuni}</div>
      </div>
    </>
  )
}
