import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Dosar } from '../types'
import { STADIU_DOSAR_LABELS, obiecteCereriiText } from '../types'
import { usePositionedDropdown } from '../lib/usePositionedDropdown'

interface Props {
  dosare: Dosar[]
  loading: boolean
  /** Eticheta afișată — nr. dosar sau obiectul cererii, când e legat. */
  value: string
  onSelect: (dosar: Dosar) => void
  disabled?: boolean
}

/**
 * Combobox pentru legarea unei sarcini de un dosar existent — spre deosebire
 * de ClientLinkPicker, nu are variantă "text liber" (un dosar fără fișă în
 * registru nu are sens, dosarul chiar trebuie să existe).
 */
export default function DosarLinkPicker({ dosare, loading, value, onSelect, disabled }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { open, position, containerRef, openAt, close } = usePositionedDropdown({
    matchTriggerWidth: true, onScroll: 'reposition',
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('')
  }, [value])

  const q = query.trim().toLowerCase()
  const filtered = !q ? dosare.slice(0, 30) : dosare.filter(d =>
    (d.clientDenumire || d.clientDenumireLibera || '').toLowerCase().includes(q) ||
    d.nrInregistrareDosar.toLowerCase().includes(q) ||
    obiecteCereriiText(d.obiecteCererii).toLowerCase().includes(q)
  ).slice(0, 30)

  const handleFocus = () => { if (inputRef.current) openAt(inputRef.current) }

  const select = (d: Dosar) => {
    onSelect(d)
    setQuery('')
    close()
  }

  const dropdown = open && !disabled && (
    <div className="combo-dropdown" style={{ position: 'fixed', top: position?.top, left: position?.left, width: position?.width, zIndex: 9999, maxHeight: 280 }}>
      {loading && <div className="combo-opt" style={{ cursor: 'default', textAlign: 'center' }}><span className="spin spin-dark" /></div>}
      {!loading && filtered.length === 0 && (
        <div className="combo-opt" style={{ cursor: 'default', color: 'var(--s400)' }}>Niciun dosar găsit</div>
      )}
      {!loading && filtered.map(d => (
        <div key={d.id} className="combo-opt" onMouseDown={e => { e.preventDefault(); select(d) }}>
          <div style={{ fontWeight: 600 }}>{d.clientDenumire || d.clientDenumireLibera}</div>
          <div style={{ fontSize: '.72rem', color: 'var(--s400)' }}>
            {STADIU_DOSAR_LABELS[d.stadiu]}{d.nrInregistrareDosar ? ` · ${d.nrInregistrareDosar}` : ''} · {obiecteCereriiText(d.obiecteCererii)}
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div ref={containerRef} className="combo-wrap">
      <input
        ref={inputRef}
        className="field-input"
        placeholder="Caută dosar după client, nr. sau obiect..."
        value={query || value}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); handleFocus() }}
        onFocus={handleFocus}
        onClick={handleFocus}
        onKeyDown={e => { if (e.key === 'Escape') close() }}
      />
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
