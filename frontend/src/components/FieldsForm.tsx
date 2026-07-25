import { useState } from 'react'
import type { IDFields } from '../lib/api'
import { roDateToISO, isoDateToRo } from '../lib/dates'
import { JUDETE_ROMANIA } from '../lib/counties'
import { CETATENII } from '../lib/citizenships'
import Combobox from './Combobox'

const DATE_KEYS = new Set<keyof IDFields>(['data_nasterii', 'valabila_de_la', 'valabila_pana_la'])

interface Props {
  fields: IDFields
  sourceFile: string
  initialEditing?: boolean
  onFieldsChange: (fields: IDFields) => void
  onNext: () => void
  onBack: () => void
}

const FIELD_LABELS: Record<keyof IDFields, string> = {
  cnp: 'CNP',
  nume: 'Nume',
  prenume: 'Prenume',
  serie_numar: 'Serie și număr',
  data_nasterii: 'Data nașterii',
  locul_nasterii: 'Locul nașterii',
  cetatenia: 'Cetățenia',
  adresa: 'Adresa',
  judet: 'Județ',
  emisa_de: 'Emisă de',
  valabila_de_la: 'Valabilă de la',
  valabila_pana_la: 'Valabilă până la',
}

const CNP_RE = /^\d{13}$/

export default function FieldsForm({ fields, sourceFile, initialEditing, onFieldsChange, onNext, onBack }: Props) {
  const [editing, setEditing] = useState(initialEditing ?? false)
  const [local, setLocal] = useState<IDFields>({ ...fields })

  const cnpValid = !local.cnp || CNP_RE.test(local.cnp)
  const keys = Object.keys(FIELD_LABELS) as (keyof IDFields)[]

  const handleChange = (key: keyof IDFields, val: string) => {
    const next = { ...local, [key]: val }
    setLocal(next)
  }

  const handleSave = () => {
    onFieldsChange(local)
    setEditing(false)
  }

  const handleReset = () => {
    setLocal({ ...fields })
    setEditing(false)
  }

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
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Înapoi</button>
          {editing ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handleReset}>Resetează</button>
              <button className="btn btn-success btn-sm" onClick={handleSave}>Salvează</button>
            </>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Editează</button>
          )}
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '.75rem' }}>
          {keys.map(key => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
              <label style={{ fontSize: '.695rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                {FIELD_LABELS[key]}
                {key === 'cnp' && local.cnp && (
                  <span style={{ marginLeft: '.375rem', fontWeight: 400, textTransform: 'none', color: cnpValid ? 'var(--g600)' : 'var(--r500)', letterSpacing: 0 }}>
                    {cnpValid ? '✓' : '⚠ lungime invalidă'}
                  </span>
                )}
              </label>
              {editing ? (
                key === 'judet' ? (
                  <Combobox value={local.judet} options={JUDETE_ROMANIA} onChange={val => handleChange('judet', val)} placeholder="Județul" />
                ) : key === 'cetatenia' ? (
                  <Combobox value={local.cetatenia} options={CETATENII} onChange={val => handleChange('cetatenia', val)} placeholder="Cetățenia" />
                ) : (
                  <input
                    type={DATE_KEYS.has(key) ? 'date' : 'text'}
                    value={DATE_KEYS.has(key) ? roDateToISO(local[key]) : local[key]}
                    onChange={e => handleChange(key, DATE_KEYS.has(key) ? isoDateToRo(e.target.value) : e.target.value)}
                    style={{
                      padding: '.375rem .625rem', borderRadius: 'var(--r-sm)',
                      border: `1.5px solid ${key === 'cnp' && local.cnp && !cnpValid ? 'var(--r500)' : 'var(--s300)'}`,
                      fontSize: '.875rem', color: 'var(--s800)', background: '#fff',
                      width: '100%', fontFamily: 'var(--font)', outline: 'none',
                    }}
                  />
                )
              ) : (
                <div style={{
                  padding: '.375rem .625rem', borderRadius: 'var(--r-sm)',
                  border: '1.5px solid var(--s200)', fontSize: '.875rem',
                  color: local[key] ? 'var(--s800)' : 'var(--s300)',
                  background: 'var(--s50)', minHeight: 34,
                }}>
                  {local[key] || '—'}
                </div>
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
