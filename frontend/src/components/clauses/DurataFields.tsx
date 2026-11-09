import { useId } from 'react'
import { normalizeDurata, type Durata, type DurataTip } from '../../lib/durata'
import DateFieldInput from '../DateFieldInput'

interface Props {
  /** Variantele oferite, în ordinea afișării (ex. la SA mandatul nu poate fi pe durată nedeterminată). */
  tipuri: DurataTip[]
  /** Lipsă = încă nealeasă (ex. un client de dinainte, fără durată salvată). */
  value: Durata | null | undefined
  onChange: (d: Durata) => void
}

const ETICHETA: Record<DurataTip, string> = { nedeterminata: 'Nedeterminată', ani: 'Pe un număr de ani', data: 'Până la o dată' }

/** Alegerea unei durate (a societății sau a unui mandat): nedeterminată, un număr de ani sau până la o dată.
 * Textul pentru document se obține din valoare (lib/durata.ts: durataScurta, durataFraza). */
export default function DurataFields({ tipuri, value, onChange }: Props) {
  const name = useId()
  const update = (patch: Partial<Durata>) =>
    onChange(normalizeDurata({ tip: value?.tip ?? tipuri[0], ani: value?.ani ?? '', data: value?.data ?? '', ...patch }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
      <div role="radiogroup" style={{ display: 'flex', flexWrap: 'wrap', gap: '.375rem 1rem' }}>
        {tipuri.map(t => (
          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.85rem', cursor: 'pointer' }}>
            <input type="radio" name={name} checked={value?.tip === t} onChange={() => update({ tip: t })} />
            {ETICHETA[t]}
          </label>
        ))}
      </div>
      {value?.tip === 'ani' && (
        <div className="field" style={{ maxWidth: '10rem' }}>
          <label className="field-label">Număr de ani</label>
          <input className="field-input" inputMode="numeric" value={value.ani}
            onChange={e => update({ ani: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
        </div>
      )}
      {value?.tip === 'data' && <DateFieldInput label="Data" value={value.data} onChange={v => update({ data: v })} showToday={false} />}
    </div>
  )
}
