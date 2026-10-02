import { useState } from 'react'
import type { Persoana } from '../types'
import { roleLabel } from '../lib/placeholders'
import PersoanaModal from './PersoanaModal'

interface Props {
  /** Tag-ul blocului repetitiv din șablon, ex. „COMODANTI” — vezi detectCustomPersonGroups. */
  tag: string
  /** Rolul la singular, ex. „COMODANT” — pentru etichete. */
  role: string
  /** Persoanele deja cunoscute la firma curentă (asociați + administratori) — vezi TemplateFiller. */
  existing: Persoana[]
  value: Persoana[]
  onChange: (persons: Persoana[]) => void
}

const personLabel = (p: Persoana): string => {
  const nume = `${p.nume ?? ''} ${p.prenume ?? ''}`.trim() || '(fără nume)'
  return p.calitate ? `${nume} — ${p.calitate}` : nume
}

const CURRENT_VALUE = '__current__'

/**
 * Listă (câte persoane e nevoie, nu o singură poziție fixă) pentru un rol de persoană nou, scris ca bloc
 * REPETITIV în șablon ({{#COMODANTI}}…{{/COMODANTI}}, scalabil la orice număr — vezi blanks.py:
 * _split_group_paragraph) — spre deosebire de CustomPersonField (poziții fixe, {{ROL_N_CÂMP}}). Fiecare
 * persoană poate fi aleasă dintre cele deja cunoscute la firmă sau introdusă manual, exact ca la
 * CustomPersonField — fără să se salveze la fișa clientului, doar pentru acest document.
 */
export default function CustomPersonGroupField({ tag, role, existing, value, onChange }: Props) {
  const [addingNew, setAddingNew] = useState(false)
  const label = roleLabel(role)

  const setAt = (i: number, p: Persoana) => onChange(value.map((v, j) => (j === i ? p : v)))
  const removeAt = (i: number) => onChange(value.filter((_, j) => j !== i))
  const addExisting = (p: Persoana) => onChange([...value, p])

  return (
    <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
      <div className="field-label" id={`custom-group-${tag}`}>{label} — listă ({value.length})</div>
      {value.map((p, i) => {
        const selectedIdx = existing.indexOf(p)
        return (
          <div key={i} style={{ display: 'flex', gap: '.375rem', alignItems: 'center' }}>
            <select className="field-input" style={{ flex: 1 }} aria-label={`${label} ${i + 1}`}
              value={selectedIdx >= 0 ? String(selectedIdx) : CURRENT_VALUE}
              onChange={e => { const v = e.target.value; if (v !== CURRENT_VALUE) setAt(i, existing[Number(v)]) }}>
              {existing.map((ep, j) => <option key={j} value={j}>{personLabel(ep)}</option>)}
              {selectedIdx < 0 && <option value={CURRENT_VALUE}>{personLabel(p)}</option>}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeAt(i)} title={`Elimină din listă (${label.toLowerCase()})`}>✕</button>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: '.375rem', flexWrap: 'wrap' }}>
        {existing.length > 0 && (
          <select className="field-input" style={{ flex: 1, minWidth: 160 }} aria-label={`Adaugă ${label.toLowerCase()} din persoanele firmei`}
            value="" onChange={e => { const v = e.target.value; if (v) addExisting(existing[Number(v)]) }}>
            <option value="">+ Adaugă din persoanele firmei…</option>
            {existing.map((ep, j) => <option key={j} value={j}>{personLabel(ep)}</option>)}
          </select>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingNew(true)}>
          + {label} nou(ă)…
        </button>
      </div>
      {addingNew && (
        <PersoanaModal
          initial={null}
          calitateDefault={label}
          showCota={false}
          onSave={p => { addExisting(p); setAddingNew(false) }}
          onClose={() => setAddingNew(false)}
        />
      )}
    </div>
  )
}
