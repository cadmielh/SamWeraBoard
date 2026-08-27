import { useEffect, useRef, useState } from 'react'
import type { ToastItem } from '../types'

const AUTO_DISMISS_MS = 4000
// Toast-urile cu acțiune (ex. "Anulează" la o ștergere amânată) stau mai mult
// pe ecran — fereastra de decizie nu poate fi la fel de scurtă ca un simplu
// "am înțeles, mesajul dispare".
const AUTO_DISMISS_ACTION_MS = 6000

interface ToastRowProps {
  t: ToastItem
  onDismiss: (id: string) => void
}

function ToastRow({ t, onDismiss }: ToastRowProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [leaving, setLeaving] = useState(false)
  const duration = t.action ? AUTO_DISMISS_ACTION_MS : AUTO_DISMISS_MS

  // Expiră normal (timeout sau ×) — comite acțiunea amânată, dacă există.
  const expire = () => {
    t.onExpire?.()
    setLeaving(true)
    setTimeout(() => onDismiss(t.id), 200)
  }

  // Buton explicit ("Anulează") — anulează acțiunea amânată, NU o comite.
  const cancel = () => {
    t.action?.onClick()
    setLeaving(true)
    setTimeout(() => onDismiss(t.id), 200)
  }

  const start = () => {
    timerRef.current = setTimeout(expire, duration)
  }
  const stop = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  useEffect(() => {
    start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id])

  return (
    <div
      className={`toast-item toast-item--${t.type}${leaving ? ' toast-item--leaving' : ''}`}
      onMouseEnter={stop}
      onMouseLeave={start}
    >
      <span className={`toast-icon toast-icon--${t.type}`}>
        {t.type === 'ok' && '✓'}
        {t.type === 'err' && '✕'}
        {t.type === 'info' && 'ℹ'}
      </span>
      <span className="toast-message">{t.message}</span>
      {t.action && (
        <button className="toast-action" onClick={cancel}>{t.action.label}</button>
      )}
      <button className="toast-close" onClick={expire} aria-label="Închide notificarea">×</button>
      <span className="toast-progress" style={{ animationDuration: `${duration}ms` }} />
    </div>
  )
}

export default function Toast({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null
  return (
    <div aria-live="polite" aria-atomic="false" className="toast-stack">
      {toasts.map(t => <ToastRow key={t.id} t={t} onDismiss={onDismiss} />)}
    </div>
  )
}
