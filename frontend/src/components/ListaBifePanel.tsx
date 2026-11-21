import { useState } from 'react'

interface Props {
  id: string
  titlu: string
  optiuni: string[]
  /** Elementele alese: din `optiuni` sau scrise de mână. */
  alese: string[]
  onChange: (alese: string[]) => void
  /** Rezultatul, așa cum intră în document. */
  text: string
  nota?: string
}

const norm = (s: string) => s.trim().toLowerCase()

/** Un câmp de tip listă („operațiunea”, „lista actelor” — vezi lib/listeBife): cele alese sunt etichete (ca la
 * „Obiectul cererii” din dosar), sugestiile rămase sunt pastile pe care se dă click; orice altceva se scrie + Enter. */
export default function ListaBifePanel({ id, titlu, optiuni, alese, onChange, text, nota }: Props) {
  const [query, setQuery] = useState('')
  const luate = new Set(alese.map(norm))
  const q = norm(query)
  const ramase = optiuni.filter(o => !luate.has(norm(o)) && (!q || norm(o).includes(q)))
  const adauga = (v: string) => {
    setQuery('')
    if (v.trim() && !luate.has(norm(v))) onChange([...alese, v.trim()])
  }
  const scoate = (i: number) => onChange(alese.filter((_, j) => j !== i))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', marginBottom: '.375rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
        <label htmlFor={id} style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>{titlu}</label>
        {nota && <span style={{ fontSize: '.72rem', color: 'var(--s400)' }}>{nota}</span>}
      </div>
      <div className="tags-input-wrap">
        {alese.map((a, i) => (
          <span key={a} className="chip chip-primary tags-chip lb-chip">
            {a}
            <button type="button" className="tags-chip-remove" onClick={() => scoate(i)} aria-label={`Scoate „${a}”`}>×</button>
          </span>
        ))}
        <input id={id} className="tags-input" value={query}
          placeholder={alese.length ? 'Caută sau scrie altul + Enter' : 'Alege de mai jos, caută sau scrie + Enter'}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); adauga(ramase.length === 1 && q ? ramase[0] : query) }
            else if (e.key === 'Backspace' && !query && alese.length) scoate(alese.length - 1)
          }} />
      </div>
      {ramase.length > 0 && (
        <div className="lb-pills">
          {ramase.map(o => (
            <button key={o} type="button" className="lb-pill" onClick={() => adauga(o)}>
              <span className="lb-pill-plus">+</span>{o}
            </button>
          ))}
        </div>
      )}
      {text && (
        <div style={{ fontSize: '.78rem', color: 'var(--s500)' }}>
          În document: <span style={{ color: 'var(--s700)' }}>„{text}”</span>
        </div>
      )}
    </div>
  )
}
