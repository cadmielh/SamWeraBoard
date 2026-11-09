import { stareDurataSocietate, type Durata } from '../lib/durata'
import DurataFields from './clauses/DurataFields'
import TermenBadge from './TermenBadge'
import DateFieldInput from './DateFieldInput'

interface Props {
  value: Durata | undefined
  onChange: (d: Durata) => void
  dataInmatricularii?: string
}

/** Durata societății din actul constitutiv — în fișa clientului și în formularul de firmă nouă. */
export default function DurataSocietateField({ value, onChange, dataInmatricularii }: Props) {
  const stare = stareDurataSocietate(value, dataInmatricularii)
  return (
    <div className="field full">
      <label className="field-label">Durata societății</label>
      <DurataFields tipuri={['nedeterminata', 'ani', 'data']} value={value} onChange={onChange} />
      {stare.stare === 'incomplet'
        ? <span style={{ fontSize: '.75rem', color: 'var(--s500)' }}>Opțional — doar pentru șabloanele care scriu durata societății.</span>
        : stare.stare !== 'nedeterminat' && <TermenBadge stare={stare} />}
    </div>
  )
}

/** Data înmatriculării la ONRC — de la ea curg durata societății și mandatele administratorilor numiți la înființare.
 * Se completează de pe certificatul de înregistrare sau singură, cu butonul ANAF de lângă CIF. `laIesire`: CUI-ul și J-ul
 * s-au completat la o firmă încă marcată în înființare — la salvare iese din înființare (vezi resolveInfiintare). */
export function DataInmatriculariiField({ value, onChange, inInfiintare, laIesire, dinAnaf }: {
  value: string; onChange: (v: string) => void; inInfiintare?: boolean; laIesire?: boolean; dinAnaf?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
      <DateFieldInput label="Data înmatriculării (ONRC)" value={value} onChange={onChange} showToday={false}
        className={dinAnaf ? 'auto-field' : undefined} />
      <span style={{ fontSize: '.75rem', color: laIesire ? 'var(--b700)' : 'var(--s500)' }}>
        {laIesire
          ? 'La salvare, firma iese din „în înființare”. De la data înmatriculării curg mandatele administratorilor numiți la înființare și durata societății.'
          : inInfiintare
            ? 'Se completează după aprobarea dosarului: de pe certificatul de înregistrare sau cu butonul ANAF de lângă CIF.'
            : 'De pe certificatul de înregistrare sau cu butonul ANAF de lângă CIF.'}
      </span>
    </div>
  )
}
