import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface OptiuneMeniu {
  label: string
  onSelect: () => void
  danger?: boolean
  icon?: ReactNode
}

/** Meniul „⋯” al unui rând: se deschide sub buton, se închide la Escape sau clic în afară; săgețile mută focusul. */
export default function MeniuRand({ optiuni, eticheta }: { optiuni: OptiuneMeniu[]; eticheta: string }) {
  const [deschis, setDeschis] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!deschis) return
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const laClic = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setDeschis(false) }
    document.addEventListener('mousedown', laClic)
    return () => document.removeEventListener('mousedown', laClic)
  }, [deschis])

  if (!optiuni.length) return null

  const laTasta = (e: React.KeyboardEvent) => {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') { e.stopPropagation(); setDeschis(false); btnRef.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Tab') setDeschis(false)
  }

  return (
    <div className="doc-menu" ref={rootRef} onKeyDown={deschis ? laTasta : undefined}>
      <button
        ref={btnRef} type="button" className="doc-icon-btn" aria-label={eticheta} title={eticheta}
        aria-haspopup="menu" aria-expanded={deschis} aria-controls={deschis ? id : undefined}
        onClick={() => setDeschis(d => !d)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="3" cy="8" r="1.5" fill="currentColor" /><circle cx="8" cy="8" r="1.5" fill="currentColor" /><circle cx="13" cy="8" r="1.5" fill="currentColor" /></svg>
      </button>
      {deschis && (
        <div className="doc-menu-pop" role="menu" id={id}>
          {optiuni.map(o => (
            <button key={o.label} type="button" role="menuitem" className={`doc-menu-item${o.danger ? ' doc-menu-item--danger' : ''}`}
              onClick={() => { setDeschis(false); o.onSelect() }}>
              {o.icon}{o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
