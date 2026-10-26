import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { Client } from '../types'
import {
  EMPTY_BRX_STATE, EMPTY_BRX_BENEFICIAR_ROW, buildBeneficiariRealiDocxData, reprezentantCandidatesBrx,
  BRX_TIP_DECLARATIE_OPTIONS, BRX_TEMEI_OPTIONS,
} from '../lib/beneficiariRealiFiller'
import type { BeneficiariRealiFormState, BrxTemei } from '../lib/beneficiariRealiFiller'
import { useFieldRefs } from '../lib/useFieldRefs'
import { SectionCard } from './FormFillerKit'

export interface BrxFormValue {
  replacements: Record<string, string>
  groups: Record<string, Record<string, string>[]>
  isComplete: boolean
  completion: { done: number; total: number; missing: string[] }
}

interface Props {
  client?: Partial<Client> | null
  onChange: (value: BrxFormValue) => void
}

export interface BrxFillerHandle {
  scrollToFirstMissing: () => string[]
}

function RadioRow({ label, options, value, onChange }: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
        {options.map(o => (
          <label key={o.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '.35rem', fontSize: '.83rem', cursor: 'pointer' }}>
            <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} style={{ marginTop: '.15rem' }} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}

const BeneficiariRealiFiller = forwardRef<BrxFillerHandle, Props>(function BeneficiariRealiFiller({ client, onChange }, ref) {
  const candidates = reprezentantCandidatesBrx(client)
  const administratori = client?.administratori ?? []
  const asociati = client?.asociati ?? []
  const [state, setState] = useState<BeneficiariRealiFormState>(() => ({
    ...EMPTY_BRX_STATE,
    reprezentantIndex: candidates.length === 1 ? 0 : null,
    email: client?.email ?? '',
    telefon: client?.telefon ?? '',
  }))
  const patch = (p: Partial<BeneficiariRealiFormState>) => setState(prev => ({ ...prev, ...p }))

  const { bindRef, scrollToFirstMissing } = useFieldRefs()

  const buildValidationChecks = (): { invalid: boolean; id: string; message: string }[] => [
    { invalid: !state.tipDeclaratie, id: 'tip-declaratie', message: 'tipul declarației (II)' },
    { invalid: state.reprezentantIndex == null, id: 'reprezentant-choice', message: 'reprezentantul legal (IV)' },
    { invalid: state.beneficiari.length === 0, id: 'beneficiari-choice', message: 'cel puțin un beneficiar real' },
    { invalid: !state.email.trim() && !state.telefon.trim(), id: 'contact-choice', message: 'email sau telefon (VI)' },
  ]

  useImperativeHandle(ref, () => ({
    scrollToFirstMissing: () => scrollToFirstMissing(buildValidationChecks()),
  }))

  useEffect(() => {
    const { replacements, groups } = buildBeneficiariRealiDocxData(state, client)
    const checks = buildValidationChecks()
    const isComplete = checks.every(c => !c.invalid)
    const completion = { total: checks.length, done: checks.filter(c => !c.invalid).length, missing: checks.filter(c => c.invalid).map(c => c.message) }
    onChange({ replacements, groups, isComplete, completion })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, client])

  const beneficiarLabel = (asociatIndex: number) => {
    const p = asociati[asociatIndex]
    const nume = `${p?.nume ?? ''} ${p?.prenume ?? ''}`.trim() || '(fără nume)'
    return p?.cotaParticipare ? `${nume} — ${p.cotaParticipare}%` : nume
  }

  const chosenIndexes = new Set(state.beneficiari.map(b => b.asociatIndex))
  const availableAsociati = asociati.map((_, i) => i).filter(i => !chosenIndexes.has(i))

  const updateRow = (i: number, patchRow: Partial<{ temei: BrxTemei; descriere: string }>) =>
    patch({ beneficiari: state.beneficiari.map((b, j) => (j === i ? { ...b, ...patchRow } : b)) })
  const removeRow = (i: number) => patch({ beneficiari: state.beneficiari.filter((_, j) => j !== i) })
  const addRow = (asociatIndex: number) => patch({ beneficiari: [...state.beneficiari, EMPTY_BRX_BENEFICIAR_ROW(asociatIndex)] })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
      <SectionCard title="II. Tip declarație" accent>
        <div ref={bindRef('tip-declaratie')}>
          <RadioRow
            label="Alege varianta care se aplică"
            value={state.tipDeclaratie ?? ''}
            onChange={v => patch({ tipDeclaratie: v as BeneficiariRealiFormState['tipDeclaratie'] })}
            options={BRX_TIP_DECLARATIE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          />
        </div>
      </SectionCard>

      <SectionCard title="IV. Subsemnatul(a) — reprezentant legal">
        <div className="field" ref={bindRef('reprezentant-choice')}>
          <label className="field-label">Administrator</label>
          <select
            className="field-input"
            value={state.reprezentantIndex ?? ''}
            onChange={e => patch({ reprezentantIndex: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">— alege —</option>
            {candidates.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
          </select>
          {candidates.length === 0 && (
            <div style={{ fontSize: '.78rem', color: 'var(--s400)', marginTop: '.25rem' }}>
              Clientul nu are niciun administrator completat în profil.
            </div>
          )}
          {/* CNP lipsă e un caz legitim (administrator străin, fără CNP românesc) — avertisment, nu blocare. */}
          {state.reprezentantIndex != null && !administratori[state.reprezentantIndex]?.cnp && (
            <div style={{ fontSize: '.78rem', color: 'var(--a800)', marginTop: '.25rem' }}>
              ⚠ Acest administrator nu are CNP completat în profil — verifică înainte de depunere.
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Beneficiari reali (dintre asociați)" accent>
        <div ref={bindRef('beneficiari-choice')} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {state.beneficiari.map((row, i) => (
            <div key={row.asociatIndex} style={{
              border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.5rem', display: 'flex', flexDirection: 'column', gap: '.4rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '.85rem' }}>{beneficiarLabel(row.asociatIndex)}</strong>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(i)} title="Elimină din listă">✕</button>
              </div>
              <div className="field">
                <label className="field-label">Temei legal (art. 4 alin. (2))</label>
                <select className="field-input" value={row.temei} onChange={e => updateRow(i, { temei: e.target.value as BrxTemei })}>
                  {BRX_TEMEI_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Descriere</label>
                <input className="field-input" value={row.descriere} onChange={e => updateRow(i, { descriere: e.target.value })} />
              </div>
              {/* CNP lipsă e un caz legitim (beneficiar străin, fără CNP românesc) — avertisment, nu blocare. */}
              {!asociati[row.asociatIndex]?.cnp && (
                <div style={{ fontSize: '.78rem', color: 'var(--a800)' }}>
                  ⚠ Acest beneficiar nu are CNP completat în profil — verifică înainte de depunere.
                </div>
              )}
            </div>
          ))}
          {availableAsociati.length > 0 && (
            <select className="field-input" value="" onChange={e => { const v = e.target.value; if (v) addRow(Number(v)) }}>
              <option value="">+ Adaugă din asociați…</option>
              {availableAsociati.map(i => <option key={i} value={i}>{beneficiarLabel(i)}</option>)}
            </select>
          )}
          {asociati.length === 0 && (
            <div style={{ fontSize: '.78rem', color: 'var(--s400)' }}>Clientul nu are niciun asociat completat în profil.</div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="VI. Persoana desemnată pentru comunicări">
        <div style={{ fontSize: '.78rem', color: 'var(--s400)' }}>Precompletate din datele societății (identificare fiscală) — poți edita.</div>
        <div style={{ display: 'flex', gap: '.5rem' }} ref={bindRef('contact-choice')}>
          <div className="field" style={{ flex: 1 }}>
            <label className="field-label">Email</label>
            <input className="field-input" value={state.email} onChange={e => patch({ email: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="field-label">Telefon</label>
            <input className="field-input" value={state.telefon} onChange={e => patch({ telefon: e.target.value })} />
          </div>
        </div>
        <div style={{ fontSize: '.78rem', color: 'var(--s400)' }}>Cel puțin unul dintre cele două e obligatoriu.</div>
      </SectionCard>
    </div>
  )
})

export default BeneficiariRealiFiller
