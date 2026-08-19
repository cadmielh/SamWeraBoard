import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { usePositionedDropdown } from '../lib/usePositionedDropdown'

interface Props {
  value: string
  options: string[]
  onChange: (val: string) => void
  placeholder?: string
  disabled?: boolean
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
}

/**
 * Combobox editabil cu sugestii: păstrează valoarea precompletată ca text,
 * dar permite scrierea liberă — la ieșire, textul tastat devine valoarea,
 * chiar dacă nu se potrivește exact cu o opțiune din listă.
 *
 * Dropdown-ul e poziționat cu position:fixed + portal în document.body —
 * altfel era tăiat de orice ancestor cu overflow:hidden/auto (ex. .card,
 * .modal-body).
 */
export default function Combobox({ value, options, onChange, placeholder, disabled }: Props) {
  const [query, setQuery] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const { open, position, containerRef, openAt, close } = usePositionedDropdown({
    matchTriggerWidth: true, onScroll: 'reposition',
  })

  useEffect(() => {
    setQuery(value)
  }, [value])

  const handleOpen = () => { if (inputRef.current) openAt(inputRef.current) }

  const filtered = query.trim()
    ? options.filter(o => normalize(o).includes(normalize(query))).slice(0, 50)
    : options.slice(0, 50)

  const select = (opt: string) => {
    onChange(opt)
    setQuery(opt)
    close()
  }

  const commitTyped = () => {
    close()
    if (query.trim() !== value) onChange(query.trim())
  }

  const dropdown = open && !disabled && filtered.length > 0 && (
    <div className="combo-dropdown" style={{ position: 'fixed', top: position?.top, left: position?.left, width: position?.width, zIndex: 9999 }}>
      {filtered.map(o => (
        <div key={o} className="combo-opt" onMouseDown={e => { e.preventDefault(); select(o) }}>{o}</div>
      ))}
    </div>
  )

  return (
    <div ref={containerRef} className="combo-wrap">
      <input
        ref={inputRef}
        className="field-input"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); handleOpen() }}
        onFocus={handleOpen}
        onBlur={() => setTimeout(commitTyped, 150)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commitTyped() }
          if (e.key === 'Escape') { close() }
        }}
      />
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
