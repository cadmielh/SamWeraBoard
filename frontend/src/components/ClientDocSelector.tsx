import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Client } from '../types'
import { usePositionedDropdown } from '../lib/usePositionedDropdown'

interface Props {
  clients: Client[]
  loading: boolean
  onSelect: (client: Client) => void
}

export default function ClientDocSelector({ clients, loading, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { open, position, containerRef, openAt, close } = usePositionedDropdown({
    matchTriggerWidth: true, onScroll: 'reposition',
  })

  const filtered = query.trim().length < 1
    ? clients.slice(0, 40)
    : clients.filter(c =>
        c.denumireLower.includes(query.toLowerCase()) ||
        c.codFiscal.includes(query)
      ).slice(0, 30)

  const handleOpen = () => {
    if (inputRef.current) openAt(inputRef.current)
  }

  const dropdown = open && (
    <div style={{
      position: 'fixed', top: position?.top, left: position?.left, width: position?.width, zIndex: 9999,
      background: '#fff', border: '1.5px solid var(--s200)', borderRadius: 'var(--r-sm)',
      boxShadow: 'var(--sh-md)', maxHeight: 300, overflow: 'auto',
    }}>
      {loading && (
        <div style={{ padding: '.75rem', fontSize: '.85rem', color: 'var(--s400)', textAlign: 'center' }}>
          <span className="spin" style={{ display: 'inline-block' }} />
        </div>
      )}
      {!loading && filtered.length === 0 && (
        <div style={{ padding: '.75rem', fontSize: '.85rem', color: 'var(--s400)', textAlign: 'center' }}>
          Niciun client găsit
        </div>
      )}
      {!loading && filtered.map(c => (
        <button
          key={c.id}
          onMouseDown={e => {
            e.preventDefault()
            onSelect(c)
            setQuery(c.denumire)
            close()
          }}
          style={{
            width: '100%', textAlign: 'left', background: 'none', border: 'none',
            padding: '.5rem .75rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '.15rem',
            borderBottom: '1px solid var(--s100)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--p50)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            {c.formaJuridica && (
              <span style={{ fontSize: '.65rem', fontWeight: 700, color: 'var(--p600)', background: 'var(--p50)', padding: '.1rem .35rem', borderRadius: 3 }}>
                {c.formaJuridica}
              </span>
            )}
            <span style={{ fontWeight: 600, fontSize: '.875rem', color: 'var(--s800)' }}>{c.denumire}</span>
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--s400)', display: 'flex', gap: '.75rem' }}>
            {c.codFiscal && <span>CIF: {c.codFiscal}</span>}
            {c.asociati.length > 0 && <span>{c.asociati.length} asociat{c.asociati.length !== 1 ? 'i' : ''}</span>}
            {c.administratori.length > 0 && <span>{c.administratori.length} admin{c.administratori.length !== 1 ? 'istratori' : 'istrator'}</span>}
          </div>
        </button>
      ))}
    </div>
  )

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: 480 }}>
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); handleOpen() }}
        onFocus={handleOpen}
        onBlur={() => setTimeout(() => close(), 150)}
        placeholder="Caută client după denumire sau CIF…"
        style={{
          width: '100%', padding: '.5rem .75rem',
          borderRadius: 'var(--r-sm)', border: '1.5px solid var(--s300)',
          fontSize: '.875rem', fontFamily: 'var(--font)', color: 'var(--s800)',
          background: '#fff', outline: 'none', boxSizing: 'border-box',
        }}
      />
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
