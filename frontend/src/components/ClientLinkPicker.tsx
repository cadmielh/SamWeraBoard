import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Client } from '../types'
import { usePositionedDropdown } from '../lib/usePositionedDropdown'

interface Props {
  clients: Client[]
  loading: boolean
  /** Denumirea afișată — fie a clientului legat, fie textul liber. */
  value: string
  onSelectClient: (client: Client) => void
  onFreeText: (text: string) => void
  disabled?: boolean
}

/**
 * Combobox pentru legarea unei entități (sarcină, dosar) de un client — fie
 * unul existent din registru (onSelectClient), fie o denumire liberă,
 * netastată încă în Clienți (onFreeText, ex. un prospect). Spre deosebire de
 * ClientDocSelector (care cere mereu un client real), aici textul liber e o
 * stare validă în sine, nu doar un query intermediar. Comun între Sarcini și
 * Dosare — nu ține nimic specific unui singur modul.
 */
export default function ClientLinkPicker({ clients, loading, value, onSelectClient, onFreeText, disabled }: Props) {
  const [query, setQuery] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const { open, position, containerRef, openAt, close } = usePositionedDropdown({
    matchTriggerWidth: true, onScroll: 'reposition',
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(value)
  }, [value])

  const filtered = query.trim().length < 1
    ? clients.slice(0, 30)
    : clients.filter(c => c.denumireLower.includes(query.toLowerCase()) || c.codFiscal.includes(query)).slice(0, 30)

  const handleFocus = () => { if (inputRef.current) openAt(inputRef.current) }

  const select = (c: Client) => {
    onSelectClient(c)
    setQuery(c.denumire)
    close()
  }

  const commitFreeText = () => {
    close()
    const trimmed = query.trim()
    if (trimmed && trimmed !== value) onFreeText(trimmed)
    if (!trimmed) onFreeText('')
  }

  const dropdown = open && !disabled && (
    <div className="combo-dropdown" style={{ position: 'fixed', top: position?.top, left: position?.left, width: position?.width, zIndex: 9999, maxHeight: 260 }}>
      {loading && <div className="combo-opt" style={{ cursor: 'default', textAlign: 'center' }}><span className="spin spin-dark" /></div>}
      {!loading && filtered.length === 0 && (
        <div className="combo-opt" style={{ cursor: 'default', color: 'var(--s400)' }}>
          Niciun client găsit — poți folosi „{query.trim() || '...'}" ca denumire liberă
        </div>
      )}
      {!loading && filtered.map(c => (
        <div key={c.id} className="combo-opt" onMouseDown={e => { e.preventDefault(); select(c) }}>
          {c.denumire}
          {c.codFiscal && <span style={{ color: 'var(--s400)', marginLeft: '.5rem', fontSize: '.75rem' }}>CIF: {c.codFiscal}</span>}
        </div>
      ))}
    </div>
  )

  return (
    <div ref={containerRef} className="combo-wrap">
      <input
        ref={inputRef}
        className="field-input"
        placeholder="Client existent sau denumire liberă (ex: prospect)"
        value={query}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); handleFocus() }}
        onFocus={handleFocus}
        onClick={handleFocus}
        onBlur={() => setTimeout(commitFreeText, 150)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commitFreeText() }
          if (e.key === 'Escape') close()
        }}
      />
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
