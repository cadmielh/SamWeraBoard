import type { CSSProperties } from 'react'
import type { Client } from '../../types'

interface Props {
  client?: Partial<Client> | null
  value: string
  onChange: (value: string) => void
}

/** Punctul de lucru trebuie ales dintr-o listă existentă, nu tastat liber —
 * altfel nu poate fi "scăzut" sigur din client.puncteLucru la confirmare. */
export default function InchiderePunctLucruFields({ client, value, onChange }: Props) {
  const puncteLucru = client?.puncteLucru ?? []
  return (
    <div>
      <label style={LABEL}>Punct de lucru care se închide</label>
      <select style={INPUT} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— alege —</option>
        {puncteLucru.map((adresa, i) => (
          <option key={i} value={adresa}>{adresa}</option>
        ))}
      </select>
      {puncteLucru.length === 0 && (
        <p style={{ fontSize: '.78rem', color: 'var(--s400)', marginTop: '.25rem' }}>
          Clientul nu are niciun punct de lucru înregistrat în profil.
        </p>
      )}
    </div>
  )
}

const LABEL: CSSProperties = { fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.04em', textTransform: 'uppercase', display: 'block', marginBottom: '.25rem' }
const INPUT: CSSProperties = { padding: '.375rem .625rem', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--s300)', fontSize: '.85rem', color: 'var(--s800)', background: '#fff', width: '100%', fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box' }
