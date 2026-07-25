import { useState, useRef, useCallback } from 'react'
import { extractFile } from '../lib/api'
import type { IDFields } from '../lib/api'
import type { ToastItem } from '../types'
import { EMPTY_ID_FIELDS } from '../lib/idFields'
import Modal from './Modal'

interface Props {
  personLabel: string          // ex: "Asociat 1 — Ion Popescu"
  accessToken: string
  initialFields?: IDFields
  mode?: 'scan' | 'manual'
  onConfirm: (fields: IDFields) => void
  onClose: () => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf'

const FIELD_LABELS: Record<keyof IDFields, string> = {
  cnp: 'CNP',
  nume: 'Nume',
  prenume: 'Prenume',
  serie_numar: 'Serie & Nr. CI',
  data_nasterii: 'Data nașterii',
  locul_nasterii: 'Locul nașterii',
  cetatenia: 'Cetățenia',
  adresa: 'Adresa',
  judet: 'Județ',
  emisa_de: 'Emisă de',
  valabila_pana_la: 'Valabilă până la',
}

type Phase = 'upload' | 'review'

export default function PersonScanModal({ personLabel, accessToken, initialFields, mode = 'scan', onConfirm, onClose, onToast }: Props) {
  const [phase, setPhase] = useState<Phase>(initialFields ? 'review' : 'upload')
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [fields, setFields] = useState<IDFields>(initialFields ?? EMPTY_ID_FIELDS)
  const inputRef = useRef<HTMLInputElement>(null)

  const setFileAndPreview = useCallback((f: File) => {
    setFile(f)
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) setFileAndPreview(f)
  }, [setFileAndPreview])

  const handleExtract = async () => {
    if (!file) return
    setLoading(true)
    try {
      const result = await extractFile(file, accessToken)
      setFields(result)
      setPhase('review')
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Extragere eșuată', 'err')
    } finally {
      setLoading(false)
    }
  }

  const handleManual = () => {
    setFields(EMPTY_ID_FIELDS)
    setPhase('review')
  }

  const handleFieldChange = (key: keyof IDFields, val: string) =>
    setFields(prev => ({ ...prev, [key]: val }))

  const cnpValid = !fields.cnp || /^\d{13}$/.test(fields.cnp)

  return (
    <Modal
      onClose={onClose}
      ariaLabel={mode === 'manual' ? 'Editare date' : 'Scanare CI'}
      backdropStyle={{ background: 'rgba(15,23,42,.45)', zIndex: 300, alignItems: 'center', padding: '1rem' }}
      boxStyle={{ maxWidth: 580, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}
    >
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--s200)', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <span style={{ fontSize: '1.1rem' }}>{mode === 'manual' ? '✏️' : '📷'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)' }}>
              {mode === 'manual' ? 'Editare date' : 'Scanare CI'}
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--s400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{personLabel}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1.25rem', lineHeight: 1, padding: '.25rem' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '1.25rem' }}>
          {phase === 'upload' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                style={{
                  border: `2px dashed ${dragging ? 'var(--p500)' : 'var(--s300)'}`,
                  borderRadius: 'var(--r-md)', padding: '2rem 1.5rem',
                  textAlign: 'center', cursor: 'pointer',
                  background: dragging ? 'var(--p50)' : 'var(--s50)',
                  transition: 'all var(--t)',
                }}
              >
                {preview
                  ? <img src={preview} alt="preview" style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 'var(--r-sm)', marginBottom: '.5rem' }} />
                  : <div style={{ fontSize: '2rem', marginBottom: '.375rem', opacity: .4 }}>⬆</div>
                }
                <div style={{ fontWeight: 600, color: 'var(--s700)', fontSize: '.875rem' }}>
                  {file ? file.name : 'Aruncă CI aici sau apasă pentru a alege'}
                </div>
                <div style={{ fontSize: '.75rem', color: 'var(--s400)', marginTop: '.2rem' }}>JPG, PNG, WEBP, PDF</div>
                <input ref={inputRef} type="file" accept={ACCEPT} style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) setFileAndPreview(f) }} />
              </div>
              <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="btn btn-ghost btn-sm" onClick={handleManual}>✏️ Introdu manual</button>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  {file && <button className="btn btn-ghost btn-sm" onClick={() => { setFile(null); setPreview(null) }}>Șterge</button>}
                  <button className="btn btn-primary" disabled={!file || loading} onClick={handleExtract}>
                    {loading ? <><span className="spin" />&nbsp;Se extrage…</> : 'Extrage câmpuri'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === 'review' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '.625rem' }}>
                {(Object.keys(FIELD_LABELS) as (keyof IDFields)[]).map(key => (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                    <label style={{ fontSize: '.67rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                      {FIELD_LABELS[key]}
                      {key === 'cnp' && fields.cnp && (
                        <span style={{ marginLeft: '.3rem', fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: cnpValid ? 'var(--g600)' : 'var(--r500)' }}>
                          {cnpValid ? '✓' : '⚠ invalid'}
                        </span>
                      )}
                    </label>
                    <input
                      value={fields[key]}
                      onChange={e => handleFieldChange(key, e.target.value)}
                      style={{
                        padding: '.3rem .5rem', borderRadius: 'var(--r-sm)',
                        border: `1.5px solid ${key === 'cnp' && fields.cnp && !cnpValid ? 'var(--r500)' : 'var(--s300)'}`,
                        fontSize: '.85rem', color: 'var(--s800)', background: '#fff',
                        fontFamily: 'var(--font)', outline: 'none', width: '100%',
                      }}
                    />
                  </div>
                ))}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setPhase('upload')}
                style={{ alignSelf: 'flex-start', marginTop: '.25rem' }}
              >
                ← Scanează din nou
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--s200)', display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Anulează</button>
          {phase === 'review' && (
            <button className="btn btn-primary" onClick={() => onConfirm(fields)}>
              ✓ Confirmă datele
            </button>
          )}
        </div>
    </Modal>
  )
}
