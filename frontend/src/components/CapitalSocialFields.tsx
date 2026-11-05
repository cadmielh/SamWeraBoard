import type { RefObject } from 'react'
import { blurNumberInputOnWheel } from '../lib/inputEvents'
import { parteSocialaError, valoareParteSociala } from '../lib/cota'

interface Props {
  capitalSocial: number | null
  valoareParte: number | null | undefined
  onCapital: (v: number | null) => void
  onValoareParte: (v: number | null) => void
  capitalRef: RefObject<HTMLInputElement | null>
  valoareParteRef: RefObject<HTMLInputElement | null>
}

/** Rândul Capital social / Valoare parte socială / Părți sociale din formularele de client (ClientModal,
 * CompanyInfoForm). Părțile sociale nu se stochează: se calculează din capital și valoarea unei părți (implicit 10 lei). */
export default function CapitalSocialFields({ capitalSocial, valoareParte, onCapital, onValoareParte, capitalRef, valoareParteRef }: Props) {
  const error = parteSocialaError(capitalSocial, valoareParte)
  const parti = capitalSocial != null && !error ? capitalSocial / valoareParteSociala({ valoareParteSociala: valoareParte }) : null
  return (
    <div className="full form-row-capital">
      <div className="field">
        <label className="field-label">Capital social (lei) <span style={{ color: 'var(--r500)' }}>*</span></label>
        <input ref={capitalRef} className="field-input" type="number" min={0} placeholder="-"
          value={capitalSocial ?? ''}
          onChange={e => onCapital(e.target.value === '' ? null : Number(e.target.value))}
          onWheel={blurNumberInputOnWheel} />
      </div>
      <div className="field">
        <label className="field-label">Valoare parte socială (lei)</label>
        <input ref={valoareParteRef} className="field-input" type="number" min={1} step={1} placeholder="10"
          value={valoareParte ?? ''}
          onChange={e => onValoareParte(e.target.value === '' ? null : Number(e.target.value))}
          onWheel={blurNumberInputOnWheel}
          aria-invalid={!!error} />
      </div>
      <div className="field">
        <label className="field-label">Părți sociale</label>
        <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)' }}>
          {parti != null ? parti.toLocaleString('ro-RO') : '—'}
        </div>
      </div>
      {error && <span className="field-error" style={{ gridColumn: '1/-1' }}>{error}</span>}
    </div>
  )
}
