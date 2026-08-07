import type { IDFields } from '../lib/api'
import { roDateToISO, isoDateToRo } from '../lib/dates'
import { JUDETE_ROMANIA } from '../lib/counties'
import { CETATENII } from '../lib/citizenships'
import Combobox from './Combobox'

const DATE_KEYS = new Set<keyof IDFields>(['data_nasterii', 'valabila_de_la', 'valabila_pana_la'])

interface Props {
  fields: IDFields
  sourceFile: string
  onFieldsChange: (fields: IDFields) => void
  onNext: () => void
  onBack: () => void
}

// Ordinea controlează layout-ul pe 2 coloane din grila .form-grid — aceeași
// convenție ca în PersonScanModal (folosit pentru asociați/administratori),
// ca toate formularele de CI să arate identic.
const FIELD_LABELS: Record<keyof IDFields, string> = {
  cnp: 'CNP',
  serie_numar: 'Serie și număr',
  nume: 'Nume',
  prenume: 'Prenume',
  data_nasterii: 'Data nașterii',
  locul_nasterii: 'Locul nașterii',
  cetatenia: 'Cetățenia',
  judet: 'Județ',
  adresa: 'Adresa',
  valabila_de_la: 'Valabilă de la',
  valabila_pana_la: 'Valabilă până la',
  emisa_de: 'Emisă de',
}

// Adresa are nevoie de mai mult spațiu — ocupă tot rândul (ambele coloane).
const FULL_WIDTH_FIELDS = new Set<keyof IDFields>(['adresa'])

const CNP_RE = /^\d{13}$/

export default function FieldsForm({ fields, sourceFile, onFieldsChange, onNext, onBack }: Props) {
  const cnpValid = !fields.cnp || CNP_RE.test(fields.cnp)
  const keys = Object.keys(FIELD_LABELS) as (keyof IDFields)[]

  const handleChange = (key: keyof IDFields, val: string) =>
    onFieldsChange({ ...fields, [key]: val })

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <span className="card-title">
            <span className="step-chip">2</span>
            Câmpuri extrase
          </span>
          <p className="card-sub">Sursă: {sourceFile}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Înapoi</button>
      </div>
      <div className="card-body">
        <div className="form-grid">
          {keys.map(key => (
            <div key={key} className={FULL_WIDTH_FIELDS.has(key) ? 'field full' : 'field'}>
              <label className="field-label">
                {FIELD_LABELS[key]}
                {key === 'cnp' && fields.cnp && (
                  <span style={{ marginLeft: '.375rem', fontWeight: 400, textTransform: 'none', color: cnpValid ? 'var(--g600)' : 'var(--r500)', letterSpacing: 0 }}>
                    {cnpValid ? '✓' : '⚠ lungime invalidă'}
                  </span>
                )}
              </label>
              {key === 'judet' ? (
                <Combobox value={fields.judet} options={JUDETE_ROMANIA} onChange={val => handleChange('judet', val)} placeholder="Județul" />
              ) : key === 'cetatenia' ? (
                <Combobox value={fields.cetatenia} options={CETATENII} onChange={val => handleChange('cetatenia', val)} placeholder="Cetățenia" />
              ) : (
                <input
                  className="field-input"
                  type={DATE_KEYS.has(key) ? 'date' : 'text'}
                  value={DATE_KEYS.has(key) ? roDateToISO(fields[key]) : fields[key]}
                  onChange={e => handleChange(key, DATE_KEYS.has(key) ? isoDateToRo(e.target.value) : e.target.value)}
                  aria-invalid={key === 'cnp' && !!fields.cnp && !cnpValid}
                />
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={onNext}>
            Completează șablonul →
          </button>
        </div>
      </div>
    </div>
  )
}
