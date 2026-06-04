import { useState } from 'react'
import type { IDFields } from '../lib/api'

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
  nume: 'Last Name',
  prenume: 'First Name',
  serie_numar: 'Series & Number',
  data_nasterii: 'Date of Birth',
  locul_nasterii: 'Place of Birth',
  cetatenia: 'Citizenship',
  adresa: 'Address',
  judet: 'County',
  emisa_de: 'Issued By',
  valabila_pana_la: 'Valid Until',
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
            Extracted Fields
          </span>
          <p className="card-sub">Source: {sourceFile}</p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          {editing ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handleReset}>Reset</button>
              <button className="btn btn-success btn-sm" onClick={handleSave}>Save</button>
            </>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
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
                    {cnpValid ? '✓' : '⚠ invalid length'}
                  </span>
                )}
              </label>
              {editing ? (
                <input
                  value={local[key]}
                  onChange={e => handleChange(key, e.target.value)}
                  style={{
                    padding: '.375rem .625rem', borderRadius: 'var(--r-sm)',
                    border: `1.5px solid ${key === 'cnp' && local.cnp && !cnpValid ? 'var(--r500)' : 'var(--s300)'}`,
                    fontSize: '.875rem', color: 'var(--s800)', background: '#fff',
                    width: '100%', fontFamily: 'var(--font)', outline: 'none',
                  }}
                />
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
            Fill Template →
          </button>
        </div>
      </div>
    </div>
  )
}
