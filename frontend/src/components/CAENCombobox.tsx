import { useState, useRef, useEffect } from 'react'
import { CAEN_CODES } from '../data/caen'

interface Props {
  value: string
  descriere: string
  onChange: (cod: string, descriere: string) => void
  disabled?: boolean
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
}

export default function CAENCombobox({ value, descriere, onChange, disabled }: Props) {
  const [query, setQuery] = useState(value ? `${value} - ${descriere}` : '')
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Keep display in sync if value changes externally
  useEffect(() => {
    if (!focused) {
      setQuery(value ? `${value} - ${descriere}` : '')
    }
  }, [value, descriere, focused])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setFocused(false)
        // Reset display to current value if user typed but didn't select
        setQuery(value ? `${value} - ${descriere}` : '')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [value, descriere])

  const filtered = query.trim()
    ? CAEN_CODES.filter(c => {
        const q = normalize(query)
        return normalize(c.cod).includes(q) || normalize(c.descriere).includes(q)
      }).slice(0, 50)
    : CAEN_CODES.slice(0, 50)

  const select = (cod: string, desc: string) => {
    onChange(cod, desc)
    setQuery(`${cod} - ${desc}`)
    setOpen(false)
    setFocused(false)
  }

  const clear = () => {
    onChange('', '')
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className="combo-wrap">
      <div style={{ position: 'relative' }}>
        <input
          className="field-input"
          placeholder="Caută după cod sau descriere..."
          value={query}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setFocused(true); setOpen(true); if (value) setQuery('') }}
        />
        {value && !focused && (
          <button
            type="button"
            onClick={clear}
            style={{ position: 'absolute', right: '.5rem', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: '.15rem' }}
            tabIndex={-1}
          >×</button>
        )}
      </div>
      {open && !disabled && (
        <div className="combo-dropdown">
          {filtered.length === 0 ? (
            <div className="combo-opt" style={{ color: 'var(--s400)', cursor: 'default' }}>Niciun rezultat</div>
          ) : (
            filtered.map(c => (
              <div key={c.cod} className="combo-opt" onMouseDown={() => select(c.cod, c.descriere)}>
                <span className="combo-opt-cod">{c.cod}</span>
                {c.descriere}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
