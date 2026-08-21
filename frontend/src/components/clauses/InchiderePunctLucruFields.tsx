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
    <div className="field">
      <label className="field-label">Punct de lucru care se închide</label>
      <select className="field-input" value={value} onChange={e => onChange(e.target.value)}>
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
