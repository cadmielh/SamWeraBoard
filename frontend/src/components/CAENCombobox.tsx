import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CAEN_CODES } from '../data/caen'
import { usePositionedDropdown } from '../lib/usePositionedDropdown'

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
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Poziționat cu position:fixed + portal în document.body — altfel dropdown-ul
  // era tăiat de orice ancestor cu overflow:hidden/auto (ex. .card, .modal-body).
  const { open, position, containerRef, openAt, close } = usePositionedDropdown({
    matchTriggerWidth: true, onScroll: 'reposition',
  })

  // Keep display in sync if value changes externally
  useEffect(() => {
    if (!focused) {
      setQuery(value ? `${value} - ${descriere}` : '')
    }
  }, [value, descriere, focused])

  const handleOpen = () => { if (inputRef.current) openAt(inputRef.current) }

  const filtered = query.trim()
    ? CAEN_CODES.filter(c => {
        const q = normalize(query)
        return normalize(c.cod).includes(q) || normalize(c.descriere).includes(q)
      }).slice(0, 50)
    : CAEN_CODES.slice(0, 50)

  const select = (cod: string, desc: string) => {
    onChange(cod, desc)
    setQuery(`${cod} - ${desc}`)
    setFocused(false)
    close()
  }

  const clear = () => {
    onChange('', '')
    setQuery('')
    close()
  }

  const dropdown = open && !disabled && (
    <div className="combo-dropdown" style={{ position: 'fixed', top: position?.top, left: position?.left, width: position?.width, zIndex: 9999 }}>
      {filtered.length === 0 ? (
        <div className="combo-opt" style={{ color: 'var(--s400)', cursor: 'default' }}>Niciun rezultat</div>
      ) : (
        filtered.map(c => (
          <div key={c.cod} className="combo-opt" onMouseDown={e => { e.preventDefault(); select(c.cod, c.descriere) }}>
            <span className="combo-opt-cod">{c.cod}</span>
            {c.descriere}
          </div>
        ))
      )}
    </div>
  )

  return (
    <div ref={containerRef} className="combo-wrap">
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className="field-input"
          placeholder="Caută după cod sau descriere..."
          value={query}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); handleOpen() }}
          onFocus={() => { setFocused(true); handleOpen(); if (value) setQuery('') }}
          onBlur={() => setTimeout(() => {
            setFocused(false)
            setQuery(value ? `${value} - ${descriere}` : '')
          }, 150)}
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
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
