import CAENCombobox from '../CAENCombobox'
import { findCaenDescriere } from '../../data/caen'

interface Props {
  label: string
  /** 'full' = valoarea e „cod - denumire”, 'cod' = doar codul. */
  kind: 'full' | 'cod'
  value: string
  onChange: (value: string) => void
}

/** Câmp CAEN dintr-o clauză: pornește de la codul din fișa clientului și se poate schimba din lista CAEN (REV 3). */
export default function CaenFieldInput({ label, kind, value, onChange }: Props) {
  const idx = value.indexOf(' - ')
  const cod = idx === -1 ? value : value.slice(0, idx)
  const descriere = idx === -1 ? findCaenDescriere(cod) : value.slice(idx + 3)

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <CAENCombobox
        value={cod}
        descriere={descriere}
        onChange={(c, d) => onChange(kind === 'cod' || !d ? c : `${c} - ${d}`)}
      />
      {kind === 'cod' && (
        <div style={{ fontSize: '.75rem', color: 'var(--s500)', marginTop: '.25rem' }}>
          ℹ️ În document apare doar codul, fără descriere.
        </div>
      )}
    </div>
  )
}
