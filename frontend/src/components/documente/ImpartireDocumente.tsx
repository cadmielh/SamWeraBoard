import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Client } from '../../types'
import ClientDocumente from './ClientDocumente'

const CHEIE = 'cabinio:documente-coloana'
const IMPLICIT = 0.25          // un sfert din lățimea fișei
const MIN_PX = 280             // sub atât, numele fișierelor nu mai încap
const MIN_STANGA_PX = 480      // datele clientului rămân lizibile
const PAS = 0.02               // un pas de tastatură (săgeți)

interface Preferinte { latime: number; restrans: boolean }

// Lățimea și starea restrânsă se rețin pe dispozitivul utilizatorului; fără stocare locală, se folosesc implicitele.
function citeste(): Preferinte {
  try {
    const p = JSON.parse(localStorage.getItem(CHEIE) ?? '{}') as Partial<Preferinte>
    return {
      latime: typeof p.latime === 'number' && p.latime > 0 && p.latime < 1 ? p.latime : IMPLICIT,
      restrans: p.restrans === true,
    }
  } catch {
    return { latime: IMPLICIT, restrans: false }
  }
}

function salveaza(p: Preferinte) {
  try { localStorage.setItem(CHEIE, JSON.stringify(p)) } catch { /* stocare indisponibilă: doar pentru sesiunea curentă */ }
}

/** Fișa clientului pe ecran lat: datele în stânga (`children`), documentele într-o coloană în dreapta. Mânerul dintre
 * ele se trage cu mouse-ul sau se mută cu săgețile; dublu clic revine la un sfert. Coloana se poate restrânge la o bandă. */
export default function ImpartireDocumente({ client, children }: { client: Client; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pref, setPref] = useState<Preferinte>(citeste)
  const [trage, setTrage] = useState(false)

  const actualizeaza = useCallback((p: Partial<Preferinte>) => {
    setPref(prev => {
      const next = { ...prev, ...p }
      salveaza(next)
      return next
    })
  }, [])

  // Limitele depind de lățimea curentă a fișei: fracția se încadrează între MIN_PX și „stânga rămâne MIN_STANGA_PX”.
  const limiteaza = useCallback((f: number) => {
    const w = rootRef.current?.getBoundingClientRect().width ?? 0
    if (!w) return f
    const min = MIN_PX / w
    const max = Math.max(min, (w - MIN_STANGA_PX) / w)
    return Math.min(max, Math.max(min, f))
  }, [])

  const laMiscare = useCallback((clientX: number) => {
    const r = rootRef.current?.getBoundingClientRect()
    if (!r?.width) return
    actualizeaza({ latime: limiteaza((r.right - clientX) / r.width) })
  }, [actualizeaza, limiteaza])

  // În timpul tragerii: cursorul de redimensionare pe toată pagina și fără selectarea textului.
  useEffect(() => {
    if (!trage) return
    document.body.classList.add('doc-redimensionare')
    return () => document.body.classList.remove('doc-redimensionare')
  }, [trage])

  // Limitele în pixeli le aplică CSS-ul (clamp în .doc-split-aside), deci randarea nu citește dimensiuni din DOM.
  const latime = `${(pref.latime * 100).toFixed(2)}%`

  return (
    <div ref={rootRef} className={`doc-split${pref.restrans ? ' is-restrans' : ''}`} style={{ ['--doc-latime' as string]: latime }}>
      <div className="doc-split-main">{children}</div>
      {!pref.restrans && (
        <div
          className={`doc-splitter${trage ? ' is-active' : ''}`}
          role="separator" aria-orientation="vertical" aria-label="Lățimea coloanei de documente" tabIndex={0}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pref.latime * 100)}
          title="Trage pentru a redimensiona · dublu clic: lățimea implicită"
          onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setTrage(true) }}
          onPointerMove={e => { if (trage) laMiscare(e.clientX) }}
          onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); setTrage(false) }}
          onPointerCancel={() => setTrage(false)}
          onDoubleClick={() => actualizeaza({ latime: IMPLICIT })}
          onKeyDown={e => {
            const f = limiteaza(pref.latime)
            if (e.key === 'ArrowLeft') { e.preventDefault(); actualizeaza({ latime: limiteaza(f + PAS) }) }
            else if (e.key === 'ArrowRight') { e.preventDefault(); actualizeaza({ latime: limiteaza(f - PAS) }) }
            else if (e.key === 'Home') { e.preventDefault(); actualizeaza({ latime: limiteaza(1) }) }
            else if (e.key === 'End') { e.preventDefault(); actualizeaza({ latime: limiteaza(0) }) }
            else if (e.key === 'Enter') { e.preventDefault(); actualizeaza({ latime: IMPLICIT }) }
          }}
        />
      )}
      <aside className="doc-split-aside" aria-label="Documentele clientului">
        <ClientDocumente client={client} layout="coloana" restrans={pref.restrans} onRestrans={r => actualizeaza({ restrans: r })} />
      </aside>
    </div>
  )
}
