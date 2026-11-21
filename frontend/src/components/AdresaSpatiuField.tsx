import { useState } from 'react'
import type { OptiuneAdresa } from '../lib/adresaSpatiu'
import { felAdresa, normAdresa } from '../lib/adresaSpatiu'

interface Props {
  id: string
  label: string
  value: string
  optiuni: OptiuneAdresa[]
  onChange: (v: string) => void
  nota?: React.ReactNode
  /** Lângă etichetă (ContextCampInfo). */
  info?: React.ReactNode
}

const NOUA = '__noua__'

/** Adresa unui spațiu: sediul social sau un punct de lucru al clientului, ori o adresă nouă scrisă de mână. */
export default function AdresaSpatiuField({ id, label, value, optiuni, onChange, nota, info }: Props) {
  const fel = felAdresa(value, optiuni)
  const [scrieNoua, setScrieNoua] = useState(false)
  const noua = scrieNoua || fel === 'noua'
  const selectat = noua ? NOUA : (optiuni.find(o => normAdresa(o.adresa) === normAdresa(value))?.adresa ?? '')
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}{info}</label>
      <select id={id} className="field-input" style={{ appearance: 'auto' }} value={selectat}
        onChange={e => {
          if (e.target.value === NOUA) { setScrieNoua(true); if (fel !== 'noua') onChange('') }
          else { setScrieNoua(false); onChange(e.target.value) }
        }}>
        <option value="">— alege adresa —</option>
        {optiuni.map(o => (
          <option key={`${o.fel}-${o.adresa}`} value={o.adresa}>{o.fel === 'sediu' ? 'Sediul social' : 'Punct de lucru'}: {o.adresa}</option>
        ))}
        <option value={NOUA}>Adresă nouă…</option>
      </select>
      {noua && (
        <input className="field-input" style={{ marginTop: '.375rem' }} value={value} autoFocus={scrieNoua && !value}
          placeholder="Str. …, nr. …, localitatea …, județul …" aria-label={`${label} (adresă nouă)`}
          onChange={e => onChange(e.target.value)} />
      )}
      {noua && <div style={{ fontSize: '.72rem', color: 'var(--s400)' }}>După generare ți se propune adăugarea ei ca punct de lucru în fișa clientului.</div>}
      {nota}
    </div>
  )
}
