import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../AppContext'
import { areUrgente, contorNoi, useNotificari, usePreferinteAlerte, type ContextFiltru } from '../lib/alerte'
import NotificariPanel from './NotificariPanel'
import '../styles/notificari.css'

function IconBell() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 8.2a5 5 0 0 1 10 0c0 4.3 1.8 5.6 1.8 5.6H3.2S5 12.5 5 8.2Z" />
      <path d="M8.3 16.6a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  )
}

/** Ceasul pentru amânări: o alertă amânată revine singură când trece momentul ales. */
function useAcum(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/** Clopoțelul din antetul fiecărei pagini (ultimul în dreapta, după butoanele paginii): contorul alertelor noi și, la
 * click, panoul lor, deschis sub buton. Vizibil doar la cabinetele cu flag-ul `alerte`. */
export default function NotificariBell() {
  const { user, activeWorkspace, userRole, hasFeature } = useApp()
  const activ = !!activeWorkspace && hasFeature('alerte')
  const workspaceId = activ ? activeWorkspace.id : null
  const uid = activ ? user.uid : null

  const { notificari } = useNotificari(workspaceId, uid)
  const { prefs, actualizeaza } = usePreferinteAlerte(workspaceId, uid, userRole)
  const now = useAcum()
  const ctx: ContextFiltru = useMemo(() => ({ now }), [now])

  const [open, setOpen] = useState(false)
  // Colțul din dreapta-jos al butonului, de care se agață panoul (vezi .notif-panel în notificari.css).
  const [ancora, setAncora] = useState<{ top: number; right: number } | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) btnRef.current?.focus()
  }, [])

  // Click în afara panoului și a butonului îl închide.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Panoul rămâne lipit de buton la redimensionare sau derulare.
  useEffect(() => {
    if (!open) return
    const masoara = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setAncora({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    masoara()
    window.addEventListener('resize', masoara)
    window.addEventListener('scroll', masoara, true)
    return () => {
      window.removeEventListener('resize', masoara)
      window.removeEventListener('scroll', masoara, true)
    }
  }, [open])

  // La schimbarea cabinetului, panoul se închide.
  const [wsPrecedent, setWsPrecedent] = useState(workspaceId)
  if (wsPrecedent !== workspaceId) {
    setWsPrecedent(workspaceId)
    setOpen(false)
  }

  if (!activ || !workspaceId) return null

  const nr = contorNoi(notificari, prefs, ctx)
  const urgent = areUrgente(notificari, prefs, ctx)
  const ariaLabel = nr ? `Notificări: ${nr} ${nr === 1 ? 'nouă' : 'noi'}` : 'Notificări'

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`page-bell${open ? ' page-bell--open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        title="Notificări"
      >
        <IconBell />
        {nr > 0 && (
          <span className={`notif-count${urgent ? ' notif-count--urgent' : ''}`} aria-hidden="true">{nr > 99 ? '99+' : nr}</span>
        )}
      </button>

      {open && createPortal(
        <>
          <div className="notif-backdrop" onClick={() => close(false)} aria-hidden="true" />
          <NotificariPanel
            workspaceId={workspaceId}
            notificari={notificari}
            prefs={prefs}
            ctx={ctx}
            role={userRole}
            actualizeazaPrefs={actualizeaza}
            onClose={close}
            panelRef={panelRef}
            ancora={ancora}
          />
        </>,
        document.body,
      )}
    </>
  )
}
