import { useState, useRef, useEffect } from 'react'

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
 */
export default function Combobox({ value, options, onChange, placeholder, disabled }: Props) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(prev => {
          if (prev.trim() !== value) onChange(prev.trim())
          return prev
        })
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [value, onChange])

  const filtered = query.trim()
    ? options.filter(o => normalize(o).includes(normalize(query))).slice(0, 50)
    : options.slice(0, 50)

  const select = (opt: string) => {
    onChange(opt)
    setQuery(opt)
    setOpen(false)
  }

  const commitTyped = () => {
    setOpen(false)
    if (query.trim() !== value) onChange(query.trim())
  }

  return (
    <div ref={wrapRef} className="combo-wrap">
      <input
        className="field-input"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commitTyped() }
          if (e.key === 'Escape') { setOpen(false) }
        }}
      />
      {open && !disabled && filtered.length > 0 && (
        <div className="combo-dropdown">
          {filtered.map(o => (
            <div key={o} className="combo-opt" onMouseDown={() => select(o)}>{o}</div>
          ))}
        </div>
      )}
    </div>
  )
}
