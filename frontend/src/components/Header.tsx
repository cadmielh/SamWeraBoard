import type { User } from 'firebase/auth'

interface Props {
  user: User | null
  step: number
  ocrMode: string
  historyOpen: boolean
  onSignIn: () => void
  onSignOut: () => void
  onHistoryToggle: () => void
}

const STEPS = ['Upload', 'Review Fields', 'Fill Template']

export default function Header({ user, step, ocrMode, historyOpen, onSignIn, onSignOut, onHistoryToggle }: Props) {
  return (
    <header style={{
      background: '#fff', borderBottom: '1px solid var(--s200)',
      boxShadow: 'var(--sh-sm)', position: 'sticky', top: 0, zIndex: 100,
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '.625rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Logo */}
        <span style={{ fontWeight: 800, fontSize: '1.0625rem', color: 'var(--s900)', letterSpacing: '-.025em', flexShrink: 0 }}>
          SamWera<span style={{ color: 'var(--p500)' }}>Board</span>
        </span>

        {/* Step trail */}
        {user && (
          <nav style={{ display: 'flex', alignItems: 'center', gap: '.375rem', flex: 1, justifyContent: 'center' }}>
            {STEPS.map((label, i) => {
              const s = i + 1
              const active = step === s
              const done = step > s
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '.375rem' }}>
                  {i > 0 && <div style={{ width: 24, height: 1, background: done ? 'var(--p200)' : 'var(--s200)' }} />}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', opacity: done || active ? 1 : 0.4 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      background: done ? 'var(--p500)' : active ? 'var(--p100)' : 'transparent',
                      color: done ? '#fff' : active ? 'var(--p600)' : 'var(--s400)',
                      border: done || active ? 'none' : '1.5px solid var(--s300)',
                      fontSize: '.65rem', fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {done ? '✓' : s}
                    </span>
                    <span style={{ fontSize: '.78rem', fontWeight: active ? 600 : 400, color: active ? 'var(--s800)' : 'var(--s400)', whiteSpace: 'nowrap' }}>
                      {label}
                    </span>
                  </div>
                </div>
              )
            })}
          </nav>
        )}

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginLeft: user ? undefined : 'auto', flexShrink: 0 }}>
          <span className={`chip ${ocrMode === 'claude' ? 'chip-primary' : 'chip-muted'}`}>
            {ocrMode === 'claude' ? '✦ Claude' : '⚙ Local OCR'}
          </span>
          {user ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={onHistoryToggle}>
                {historyOpen ? 'Close' : 'History'}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                {user.photoURL && (
                  <img src={user.photoURL} alt="" width={26} height={26} style={{ borderRadius: '50%', border: '1.5px solid var(--s200)' }} />
                )}
                <span style={{ fontSize: '.78rem', color: 'var(--s500)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.displayName ?? user.email}
                </span>
                <button className="btn btn-ghost btn-xs" onClick={onSignOut}>Sign out</button>
              </div>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={onSignIn}>Sign in with Google</button>
          )}
        </div>
      </div>
    </header>
  )
}
