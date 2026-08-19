import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import CAENCombobox from '../CAENCombobox'
import type { Client } from '../../types'
import type { ClientPatchProposal } from '../../lib/clauseFieldSpecs'

interface Props {
  client?: Partial<Client> | null
  rows: Record<string, string>[]
  onRows: (rows: Record<string, string>[]) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
}

function splitCaen(v: string): [string, string] {
  const idx = v.indexOf(' - ')
  return idx === -1 ? [v, ''] : [v.slice(0, idx), v.slice(idx + 3)]
}

export default function AdaugareCaenFields({ client, rows, onRows, onClientPatch }: Props) {
  const addRow = () => onRows([...rows, { CAEN: '' }])
  const updateRow = (i: number, cod: string, descriere: string) =>
    onRows(rows.map((r, idx) => idx === i ? { CAEN: descriere ? `${cod} - ${descriere}` : cod } : r))
  const removeRow = (i: number) => onRows(rows.filter((_, idx) => idx !== i))

  useEffect(() => {
    const complete = rows.filter(r => r.CAEN && r.CAEN.trim() !== '')
    if (complete.length === 0) { onClientPatch(null); return }
    const noi = complete.map(r => { const [cod, descriere] = splitCaen(r.CAEN); return { cod, descriere } })
    onClientPatch({
      label: `Adaugă ${noi.length} cod${noi.length === 1 ? '' : 'uri'} CAEN secundare`,
      patch: { caenSecundare: [...(client?.caenSecundare ?? []), ...noi] },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
      <label style={LABEL}>Coduri CAEN noi (activități secundare)</label>
      {rows.map((r, i) => {
        const [cod, descriere] = splitCaen(r.CAEN ?? '')
        return (
          <div key={i} style={{ display: 'flex', gap: '.375rem', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <CAENCombobox value={cod} descriere={descriere} onChange={(c, d) => updateRow(i, c, d)} />
            </div>
            <button type="button" onClick={() => removeRow(i)} style={BTN_X}>×</button>
          </div>
        )
      })}
      <button type="button" className="btn btn-ghost btn-sm" onClick={addRow} style={{ alignSelf: 'flex-start' }}>
        + Adaugă cod CAEN
      </button>
    </div>
  )
}

const LABEL: CSSProperties = { fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.04em', textTransform: 'uppercase', display: 'block' }
const BTN_X: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: '.125rem .25rem' }
