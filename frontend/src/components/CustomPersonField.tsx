import { useState } from 'react'
import type { Persoana } from '../types'
import { roleLabel } from '../lib/placeholders'
import PersoanaModal from './PersoanaModal'

interface Props {
  /** Rolul detectat din etichetele șablonului, ex. „COMODANT”, „REPREZENTANT_LEGAL” — vezi detectCustomPersonRoles. */
  role: string
  /** Poziția (1, 2, …) — mai multe persoane cu același rol în același șablon. */
  position: number
  /** Persoanele deja cunoscute la firma curentă (asociați + administratori) — vezi TemplateFiller. */
  existing: Persoana[]
  value: Persoana | null
  onChange: (p: Persoana) => void
}

const personLabel = (p: Persoana): string => {
  const nume = `${p.nume ?? ''} ${p.prenume ?? ''}`.trim() || '(fără nume)'
  return p.calitate ? `${nume} — ${p.calitate}` : nume
}

// Două valori distincte: una arată persoana curentă (dacă e introdusă manual, nu din listă), cealaltă
// declanșează formularul de adăugare — dacă ar fi aceeași, opțiunea "curentă" și "+ Persoană nouă…" ar avea
// aceeași valoare în <select>, imposibil de deosebit la click.
const CURRENT_NEW_VALUE = '__current_new__'
const ADD_NEW_VALUE = '__add_new__'

/**
 * Un câmp de tip "alege sau adaugă persoana" pentru un rol de persoană necunoscut dinainte de firmă/administrare
 * (comodant, reprezentant legal…) — spre deosebire de asociați/administratori, nu se completează automat din
 * client, dar poate fi ORICARE dintre persoanele deja cunoscute acolo (adesea chiar unul dintre ei), sau o
 * persoană complet nouă, introdusă manual (fără să se salveze la fișa clientului — doar pentru acest document).
 */
export default function CustomPersonField({ role, position, existing, value, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  const selectedIdx = value ? existing.indexOf(value) : -1
  const selectValue = selectedIdx >= 0 ? String(selectedIdx) : value ? CURRENT_NEW_VALUE : ''

  return (
    <div className="field">
      <label className="field-label" htmlFor={`custom-person-${role}-${position}`}>{roleLabel(role)} {position}</label>
      <select
        id={`custom-person-${role}-${position}`}
        className="field-input"
        value={selectValue}
        onChange={e => {
          const v = e.target.value
          if (v === ADD_NEW_VALUE) { setAdding(true); return }
          if (v === '' || v === CURRENT_NEW_VALUE) return
          onChange(existing[Number(v)])
        }}
      >
        <option value="">— alege persoana —</option>
        {existing.map((p, i) => <option key={i} value={i}>{personLabel(p)}</option>)}
        {value && selectedIdx < 0 && <option value={CURRENT_NEW_VALUE}>{personLabel(value)} (nouă)</option>}
        <option value={ADD_NEW_VALUE}>+ Persoană nouă…</option>
      </select>
      {adding && (
        <PersoanaModal
          initial={null}
          calitateDefault={roleLabel(role)}
          showCota={false}
          onSave={p => { onChange(p); setAdding(false) }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
