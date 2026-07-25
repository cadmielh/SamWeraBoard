import { useEffect, useRef } from 'react'
import type { ToastItem } from '../types'

const AUTO_DISMISS_MS = 4000

interface ToastRowProps {
  t: ToastItem
  onDismiss: (id: string) => void
}

function ToastRow({ t, onDismiss }: ToastRowProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const start = () => {
    timerRef.current = setTimeout(() => onDismiss(t.id), AUTO_DISMISS_MS)
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
      className={`inline-status show ${t.type}`}
      style={{ margin: 0, minWidth: 240, maxWidth: 360, animation: 'fadeIn .2s var(--ease)', pointerEvents: 'auto' }}
      onMouseEnter={stop}
      onMouseLeave={start}
    >
      {t.type === 'ok' && <span>✓</span>}
      {t.type === 'err' && <span>✕</span>}
      {t.type === 'info' && <span>ℹ</span>}
      <span style={{ flex: 1 }}>{t.message}</span>
      <button
        onClick={() => onDismiss(t.id)}
        aria-label="Închide notificarea"
        style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
          opacity: .6, fontSize: '1rem', lineHeight: 1, padding: '.1rem', marginLeft: '.25rem', flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}

export default function Toast({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '.375rem', pointerEvents: 'none' }}
    >
      {toasts.map(t => <ToastRow key={t.id} t={t} onDismiss={onDismiss} />)}
    </div>
  )
}
