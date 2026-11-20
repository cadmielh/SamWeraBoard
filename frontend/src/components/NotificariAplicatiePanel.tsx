import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CategorieAplicatie, NotificareAplicatie } from '../lib/notificariAplicatie'
import { dataScurta } from '../lib/alerte'

const CATEGORII: { id: CategorieAplicatie | 'toate'; label: string }[] = [
  { id: 'toate', label: 'Toate' }, { id: 'bani', label: 'Bani' }, { id: 'cabinete', label: 'Cabinete' },
  { id: 'conversie', label: 'Conversie' }, { id: 'facturare', label: 'Facturare' },
]
const ICON: Record<CategorieAplicatie, string> = { bani: '💳', cabinete: '🏛️', conversie: '📈', facturare: '🧾' }

/** Fila „Aplicație” a clopoțelului, doar pentru super admini: evenimentele din toată aplicația (plăți, cabinete noi,
 *  probe care se încheie, încasări nefacturate). Folosește aceleași stiluri ca panoul cabinetului (NotificariPanel). */
export default function NotificariAplicatiePanel({ notificari, esteNoua, marcheazaCitite, comutator, onClose, panelRef, ancora }: {
  notificari: NotificareAplicatie[]
  esteNoua: (n: NotificareAplicatie) => boolean
  marcheazaCitite: () => Promise<void>
  /** Comutatorul Cabinet / Aplicație, când super adminul are și alertele cabinetului. */
  comutator?: ReactNode
  onClose: (restoreFocus: boolean) => void
  panelRef: React.RefObject<HTMLDivElement | null>
  ancora: { top: number; right: number } | null
}) {
  const navigate = useNavigate()
  const [cat, setCat] = useState<CategorieAplicatie | 'toate'>('toate')
  const titluRef = useRef<HTMLHeadingElement>(null)
  const [now] = useState(() => new Date())
  const lista = useMemo(() => notificari.filter(n => cat === 'toate' || n.categorie === cat), [notificari, cat])
  const nrNoi = notificari.filter(esteNoua).length

  useEffect(() => { titluRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(true) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const deschide = (n: NotificareAplicatie) => {
    onClose(false)
    navigate(n.link)
  }

  return (
    <div ref={panelRef} className="notif-panel" role="dialog" aria-modal="false" aria-labelledby="notif-app-titlu"
      style={ancora ? { '--notif-top': `${ancora.top}px`, '--notif-right': `${ancora.right}px` } as React.CSSProperties : undefined}>
      <div className="notif-panel-head">
        <h2 id="notif-app-titlu" className="notif-panel-title" tabIndex={-1} ref={titluRef}>
          Notificări{nrNoi > 0 && <span className="notif-tab-nr" style={{ marginLeft: '.4rem' }}>{nrNoi} {nrNoi === 1 ? 'nouă' : 'noi'}</span>}
        </h2>
        <div className="notif-panel-head-actions">
          {nrNoi > 0 && <button type="button" className="btn btn-ghost btn-xs" onClick={() => void marcheazaCitite()}>✓ Toate văzute</button>}
          <button type="button" className="modal-close" onClick={() => onClose(true)} aria-label="Închide notificările">×</button>
        </div>
      </div>
      {comutator}
      <div className="notif-tabs" role="tablist" aria-label="Categorie" style={{ flexWrap: 'wrap' }}>
        {CATEGORII.map(c => {
          const nr = c.id === 'toate' ? 0 : notificari.filter(n => n.categorie === c.id && esteNoua(n)).length
          return (
            <button key={c.id} type="button" role="tab" aria-selected={cat === c.id}
              className={`notif-tab${cat === c.id ? ' notif-tab--active' : ''}`} onClick={() => setCat(c.id)}>
              {c.label}{nr ? <span className="notif-tab-nr">{nr}</span> : null}
            </button>
          )
        })}
      </div>
      <div className="notif-list" role="tabpanel">
        {lista.length === 0 ? (
          <div className="notif-empty">
            <div className="notif-empty-icon" aria-hidden="true">✓</div>
            <p>Nimic de semnalat aici.</p>
          </div>
        ) : (
          <ul className="notif-items">
            {lista.map(n => {
              const noua = esteNoua(n)
              return (
                <li key={n.id} className={`notif-item${noua ? ' notif-item--nou' : ''}`}>
                  <button type="button" className="notif-item-main" onClick={() => deschide(n)}>
                    <span className={`notif-sev notif-sev--${n.severitate}`} aria-hidden="true">{ICON[n.categorie] ?? '•'}</span>
                    <span className="notif-item-text">
                      <span className="notif-item-titlu">
                        {noua && <span className="notif-dot" aria-label="nouă" role="img" />}
                        {n.titlu}
                      </span>
                      {n.text && <span className="notif-item-detaliu">{n.text}</span>}
                    </span>
                    {n.creatLa && <span className="notif-item-data">{dataScurta(n.creatLa, now)}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="notif-panel-foot">
        <button type="button" className="notif-foot-link" onClick={() => { onClose(false); navigate('/super-admin') }}>Super admin →</button>
      </div>
    </div>
  )
}
