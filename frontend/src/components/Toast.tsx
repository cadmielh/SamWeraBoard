import type { ToastItem } from '../types'

export default function Toast({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null
  return (
    <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '.375rem', pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div
          key={t.id}
          className={`inline-status show ${t.type}`}
          style={{ margin: 0, minWidth: 240, maxWidth: 360, animation: 'fadeIn .2s var(--ease)', pointerEvents: 'auto' }}
        >
          {t.type === 'ok' && <span>✓</span>}
          {t.type === 'err' && <span>✕</span>}
          {t.type === 'info' && <span>ℹ</span>}
          {t.message}
        </div>
      ))}
    </div>
  )
}
