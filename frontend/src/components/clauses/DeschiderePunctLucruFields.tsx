import { useState } from 'react'
import type { Client } from '../../types'

interface Props {
  client?: Partial<Client> | null
  value: string
  onChange: (value: string) => void
}

const NOU = '__nou__'

/** Punctul de lucru care se deschide: unul deja trecut în fișa clientului sau unul nou, introdus aici — pe acesta
 * din urmă aplicația propune să-l salveze în fișă după generare (ClauseSelector: computeInlinePatch). */
export default function DeschiderePunctLucruFields({ client, value, onChange }: Props) {
  const puncteLucru = client?.puncteLucru ?? []
  const [manual, setManual] = useState(() => puncteLucru.length === 0 || (!!value && !puncteLucru.includes(value)))

  const select = (v: string) => {
    if (v === NOU) { setManual(true); onChange(''); return }
    setManual(false)
    onChange(v)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
      {puncteLucru.length > 0 && (
        <div className="field">
          <label className="field-label">Punct de lucru care se deschide</label>
          <select className="field-input" value={manual ? NOU : value} onChange={e => select(e.target.value)}>
            <option value="">— alege —</option>
            {puncteLucru.map((adresa, i) => (
              <option key={i} value={adresa}>{adresa}</option>
            ))}
            <option value={NOU}>+ Punct de lucru nou (introdu adresa)</option>
          </select>
        </div>
      )}
      {manual && (
        <div className="field">
          <label className="field-label">Adresa punctului de lucru nou</label>
          <input className="field-input" value={value} onChange={e => onChange(e.target.value)} placeholder="ex. Arad, str. Unirii nr. 5, jud. Arad" />
          <p style={{ fontSize: '.78rem', color: 'var(--s400)', marginTop: '.25rem' }}>
            După generare îți propunem să-l salvăm în fișa clientului.
          </p>
        </div>
      )}
    </div>
  )
}
