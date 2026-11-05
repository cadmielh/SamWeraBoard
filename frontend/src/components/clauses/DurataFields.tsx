import { useState } from 'react'
import { durataText, type DurataTip } from '../../lib/placeholders'
import DateFieldInput from '../DateFieldInput'

interface Props {
  /** Variantele oferite, în ordinea afișării (mandatul administratorului nu are „nedeterminată” în șablon). */
  tipuri: DurataTip[]
  onChange: (text: string) => void
}

const ETICHETA: Record<DurataTip, string> = { nedeterminata: 'Nedeterminată', ani: 'Pe un număr de ani', data: 'Până la o dată' }

/** O singură clauză de durată, cu varianta aleasă aici — textul ei („nedeterminată”, „de 10 ani”, „până la data
 * de …”) intră în document în locul etichetei. */
export default function DurataFields({ tipuri, onChange }: Props) {
  const [tip, setTip] = useState<DurataTip | null>(null)
  const [ani, setAni] = useState('')
  const [data, setData] = useState('')

  const update = (t: DurataTip, a: string, d: string) => {
    setTip(t); setAni(a); setData(d)
    onChange(durataText(t, a, d))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
      {tipuri.map(t => (
        <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.85rem', cursor: 'pointer' }}>
          <input type="radio" checked={tip === t} onChange={() => update(t, ani, data)} />
          {ETICHETA[t]}
        </label>
      ))}
      {tip === 'ani' && (
        <div className="field">
          <label className="field-label">Număr de ani</label>
          <input className="field-input" inputMode="numeric" value={ani} onChange={e => update('ani', e.target.value.replace(/\D/g, ''), data)} />
        </div>
      )}
      {tip === 'data' && <DateFieldInput label="Data" value={data} onChange={v => update('data', ani, v)} />}
    </div>
  )
}
