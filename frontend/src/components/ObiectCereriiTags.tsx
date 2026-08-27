import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ObiectCerereItem } from '../types'
import { OBIECT_CERERE_OPTIONS, findClauseTag } from '../data/dosarObiecte'
import { usePositionedDropdown } from '../lib/usePositionedDropdown'

interface Props {
  value: ObiectCerereItem[]
  onChange: (items: ObiectCerereItem[]) => void
  disabled?: boolean
}

function normalize(s: string) { return s.trim().toLowerCase() }

/**
 * Etichete (chips) pentru "Obiectul cererii" — un dosar poate combina mai
 * multe tipuri de cerere (ex. "Cesiune" + "Adăugare cod CAEN"). Alegi din
 * sugestii SAU scrii orice text și apeși Enter — o etichetă liberă, fără
 * clauseTag, e la fel de validă ca una din listă (nu orice tip de cerere
 * ONRC are o clauză de document corespunzătoare). Fiecare etichetă cu
 * clauseTag activează propriul buton "Generează documente" în DosarView.
 */
export default function ObiectCereriiTags({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { open, position, containerRef, openAt, close } = usePositionedDropdown({
    matchTriggerWidth: true, onScroll: 'reposition',
  })

  const usedLabels = new Set(value.map(v => normalize(v.label)))
  const filtered = OBIECT_CERERE_OPTIONS
    .filter(o => !usedLabels.has(normalize(o.label)))
    .filter(o => !query.trim() || o.label.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 30)

  const addItem = (label: string, clauseTag?: string) => {
    const trimmed = label.trim()
    setQuery('')
    if (!trimmed || usedLabels.has(normalize(trimmed))) return
    const tag = clauseTag ?? findClauseTag(trimmed)
    // Firestore respinge `undefined` oriunde în document, inclusiv imbricat
    // într-un array (stripping-ul de undefined din dosare.ts/sarcini.ts se
    // aplică doar câmpurilor de nivel 1) — clauseTag e omis complet din obiect
    // când nu există o potrivire, nu setat explicit la `undefined`.
    const item: ObiectCerereItem = tag ? { label: trimmed, clauseTag: tag } : { label: trimmed }
    onChange([...value, item])
  }

  const removeItem = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  const handleFocus = () => { if (inputRef.current) openAt(inputRef.current) }

  const dropdown = open && !disabled && (
    <div className="combo-dropdown" style={{ position: 'fixed', top: position?.top, left: position?.left, width: position?.width, zIndex: 9999 }}>
      {filtered.length === 0 && (
        <div className="combo-opt" style={{ cursor: 'default', color: 'var(--s400)' }}>
          {query.trim() ? `Apasă Enter pentru „${query.trim()}" (text liber)` : 'Toate sugestiile sunt deja adăugate'}
        </div>
      )}
      {filtered.map(o => (
        <div key={o.label} className="combo-opt" onMouseDown={e => { e.preventDefault(); addItem(o.label, o.clauseTag) }}>
          {o.label}
        </div>
      ))}
    </div>
  )

  return (
    <div ref={containerRef} className="combo-wrap">
      <div className={`tags-input-wrap${disabled ? ' tags-input-wrap--disabled' : ''}`}>
        {value.map((item, i) => (
          <span key={`${item.label}-${i}`} className="chip chip-primary tags-chip">
            {item.label}
            {!disabled && (
              <button type="button" className="tags-chip-remove" onClick={() => removeItem(i)} aria-label={`Șterge „${item.label}"`}>×</button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            ref={inputRef}
            className="tags-input"
            placeholder={value.length === 0 ? 'Adaugă tip de cerere...' : 'Adaugă altul...'}
            value={query}
            onChange={e => { setQuery(e.target.value); handleFocus() }}
            onFocus={handleFocus}
            onClick={handleFocus}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addItem(query) }
              else if (e.key === 'Backspace' && !query && value.length > 0) removeItem(value.length - 1)
              else if (e.key === 'Escape') close()
            }}
          />
        )}
      </div>
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
