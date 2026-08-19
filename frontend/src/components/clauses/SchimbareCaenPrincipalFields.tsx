import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import CAENCombobox from '../CAENCombobox'
import type { ClientPatchProposal } from '../../lib/clauseFieldSpecs'

interface Props {
  value: string
  onChange: (value: string) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
}

function splitCaen(v: string): [string, string] {
  const idx = v.indexOf(' - ')
  return idx === -1 ? [v, ''] : [v.slice(0, idx), v.slice(idx + 3)]
}

export default function SchimbareCaenPrincipalFields({ value, onChange, onClientPatch }: Props) {
  const [cod, descriere] = splitCaen(value)

  useEffect(() => {
    if (!cod) { onClientPatch(null); return }
    onClientPatch({
      label: `CAEN principal nou: ${value}`,
      patch: { caenCod: cod, caenDescriere: descriere },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div>
      <label style={LABEL}>Cod CAEN principal nou</label>
      <CAENCombobox value={cod} descriere={descriere} onChange={(c, d) => onChange(d ? `${c} - ${d}` : c)} />
    </div>
  )
}

const LABEL: CSSProperties = { fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.04em', textTransform: 'uppercase', display: 'block', marginBottom: '.25rem' }
