import { useEffect, useState } from 'react'
import type { Client } from '../../types'
import type { ClientPatchProposal } from '../../lib/clauseFieldSpecs'

interface Props {
  client?: Partial<Client> | null
  fields: Record<string, string>
  onField: (key: string, value: string) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
}

export default function ModificareIdentitateAsociatFields({ client, fields, onField, onClientPatch }: Props) {
  const asociati = client?.asociati ?? []
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const handleSelect = (value: string) => {
    const idx = value === '' ? null : Number(value)
    setSelectedIndex(idx)
    if (idx === null) return
    const p = asociati[idx]
    onField('ASOCIAT_MODIFICAT_NUME', p.nume)
    onField('ASOCIAT_MODIFICAT_PRENUME', p.prenume)
    onField('ASOCIAT_MODIFICAT_SERIE_NUMAR', p.serie_numar)
  }

  // Propune (nu aplică direct) suprascrierea datelor asociatului ales cu
  // valorile editate — userul confirmă explicit în dialogul afișat după
  // generare (același mecanism ca la Schimbare Administrator / Majorare Capital).
  useEffect(() => {
    if (selectedIndex === null) { onClientPatch(null); return }
    const nume = fields.ASOCIAT_MODIFICAT_NUME ?? ''
    const prenume = fields.ASOCIAT_MODIFICAT_PRENUME ?? ''
    const serieNumar = fields.ASOCIAT_MODIFICAT_SERIE_NUMAR ?? ''
    const noi = asociati.map((a, i) => i === selectedIndex ? { ...a, nume, prenume, serie_numar: serieNumar } : a)
    onClientPatch({
      label: `Actualizează date identificare: ${nume} ${prenume}`.trim(),
      patch: { asociati: noi },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, fields.ASOCIAT_MODIFICAT_NUME, fields.ASOCIAT_MODIFICAT_PRENUME, fields.ASOCIAT_MODIFICAT_SERIE_NUMAR])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div className="field">
        <label className="field-label">Asociat</label>
        <select className="field-input" value={selectedIndex ?? ''} onChange={e => handleSelect(e.target.value)}>
          <option value="">— alege —</option>
          {asociati.map((a, i) => (
            <option key={i} value={i}>{a.nume} {a.prenume}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '.375rem' }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">Nume</label>
          <input className="field-input" value={fields.ASOCIAT_MODIFICAT_NUME ?? ''} onChange={e => onField('ASOCIAT_MODIFICAT_NUME', e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">Prenume</label>
          <input className="field-input" value={fields.ASOCIAT_MODIFICAT_PRENUME ?? ''} onChange={e => onField('ASOCIAT_MODIFICAT_PRENUME', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label className="field-label">Serie și nr. CI</label>
        <input className="field-input" value={fields.ASOCIAT_MODIFICAT_SERIE_NUMAR ?? ''} onChange={e => onField('ASOCIAT_MODIFICAT_SERIE_NUMAR', e.target.value)} />
      </div>
    </div>
  )
}
