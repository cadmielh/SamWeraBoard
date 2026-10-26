import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { Client } from '../types'
import {
  EMPTY_ANEXA1_STATE, buildAnexa1DocxData, declarantCandidatesAnexa1,
} from '../lib/anexa1Filler'
import type { Anexa1FormState } from '../lib/anexa1Filler'
import { useFieldRefs } from '../lib/useFieldRefs'
import type { ElRef } from '../lib/useFieldRefs'
import DateFieldInput from './DateFieldInput'
import { SectionCard } from './FormFillerKit'

export interface Anexa1FormValue {
  replacements: Record<string, string>
  isComplete: boolean
  /** Câte dintre câmpurile obligatorii sunt completate — baza procentului afișat lângă șablon, la fel ca la
   * declarația de activitate. Secțiunea opțională nu contează la acest total (e, din definiție, opțională). */
  completion: { done: number; total: number; missing: string[] }
}

interface Props {
  client?: Partial<Client> | null
  onChange: (value: Anexa1FormValue) => void
}

export interface Anexa1FillerHandle {
  scrollToFirstMissing: () => string[]
}

// Variantă mai vizibilă a alegerii (butoane mari, nu radio mici) — pentru decizii obligatorii importante,
// mai ales una cu valoare precompletată (ușor de trecut cu vederea dacă arată ca un simplu radio).
function ToggleButtonRow({ label, options, value, onChange }: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        {options.map(o => (
          <button
            key={o.value} type="button"
            className={`btn btn-sm ${value === o.value ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, flex = 1, fieldRef }: {
  label: string; value: string; onChange: (v: string) => void; flex?: number; fieldRef?: ElRef
}) {
  return (
    <div className="field" style={{ flex, minWidth: 0 }}>
      <label className="field-label">{label}</label>
      <input ref={fieldRef} className="field-input" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
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
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {options.map(o => (
          <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.83rem', cursor: 'pointer' }}>
            <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}

function CheckboxRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.83rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

const Anexa1Filler = forwardRef<Anexa1FillerHandle, Props>(function Anexa1Filler({ client, onChange }, ref) {
  const candidates = declarantCandidatesAnexa1(client)
  const [state, setState] = useState<Anexa1FormState>(() => ({
    ...EMPTY_ANEXA1_STATE,
    declarantIndex: candidates.length === 1 ? 0 : null,
  }))
  const [showOptional, setShowOptional] = useState(false)
  const patch = (p: Partial<Anexa1FormState>) => setState(prev => ({ ...prev, ...p }))

  const { bindRef, scrollToFirstMissing } = useFieldRefs()

  const isProfit = state.impozitTip === 'profit'
  const buildValidationChecks = (): { invalid: boolean; id: string; message: string }[] => [
    {
      invalid: isProfit ? !state.dataLuareEvidentaProfit.trim() : !state.dataLuareEvidentaMicro.trim(),
      id: 'data-luare-evidenta',
      message: isProfit ? 'data luării în evidență (1.1)' : 'data luării în evidență (2.1)',
    },
    { invalid: state.declarantIndex == null, id: 'declarant-choice', message: 'persoana declarantului' },
  ]

  useImperativeHandle(ref, () => ({
    scrollToFirstMissing: () => scrollToFirstMissing(buildValidationChecks()),
  }))

  useEffect(() => {
    const { replacements } = buildAnexa1DocxData(state, client)
    const checks = buildValidationChecks()
    const isComplete = checks.every(c => !c.invalid)
    const completion = { total: checks.length, done: checks.filter(c => !c.invalid).length, missing: checks.filter(c => c.invalid).map(c => c.message) }
    onChange({ replacements, isComplete, completion })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, client])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
      <SectionCard title="Cerere">
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <Field label="Nr. cerere (opțional)" value={state.nrCerere} onChange={v => patch({ nrCerere: v })} />
          <DateFieldInput label="Data cerere (opțional)" value={state.dataCerere} onChange={v => patch({ dataCerere: v })} style={{ flex: 1, minWidth: 0 }} />
        </div>
      </SectionCard>

      <SectionCard title="Impozit pe profit / microîntreprinderi" accent>
        <ToggleButtonRow
          label={'Tip de impozit — verifică alegerea, e precompletată cu „Impozit pe profit”'}
          value={state.impozitTip}
          onChange={v => patch({ impozitTip: v as Anexa1FormState['impozitTip'] })}
          options={[{ value: 'profit', label: '1. Impozit pe profit' }, { value: 'micro', label: '2. Impozit pe veniturile microîntreprinderilor' }]}
        />
        {isProfit ? (
          <>
            <div ref={bindRef('data-luare-evidenta')}>
              <DateFieldInput label="1.1. Luare în evidență începând cu data de" value={state.dataLuareEvidentaProfit} onChange={v => patch({ dataLuareEvidentaProfit: v })} />
            </div>
            <RadioRow
              label="1.2. Perioada fiscală"
              value={state.perioadaProfit}
              onChange={v => patch({ perioadaProfit: v as Anexa1FormState['perioadaProfit'] })}
              options={[{ value: 'trimestriala', label: 'Trimestrială' }, { value: 'anuala', label: 'Anuală' }]}
            />
          </>
        ) : (
          <div ref={bindRef('data-luare-evidenta')}>
            <DateFieldInput label="2.1. Luare în evidență începând cu data de" value={state.dataLuareEvidentaMicro} onChange={v => patch({ dataLuareEvidentaMicro: v })} />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Declarant">
        <div className="field" ref={bindRef('declarant-choice')}>
          <label className="field-label">Persoana care face declarația</label>
          <select
            className="field-input"
            value={state.declarantIndex ?? ''}
            onChange={e => patch({ declarantIndex: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">— alege —</option>
            {candidates.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
          </select>
          {candidates.length === 0 && (
            <div style={{ fontSize: '.78rem', color: 'var(--s400)', marginTop: '.25rem' }}>
              {client?.tipClient === 'PF' ? 'Clientul nu are titular completat în profil.' : 'Clientul nu are niciun administrator completat în profil.'}
            </div>
          )}
        </div>
      </SectionCard>

      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowOptional(v => !v)} style={{ alignSelf: 'flex-start' }}>
        {showOptional ? '▴ Ascunde' : '▾ Arată'} secțiunile opționale (3–4.5: salarii și contribuții sociale, TVA)
      </button>

      {showOptional && (
        <>
          <SectionCard title="3. Impozit pe salarii și contribuții sociale">
            <CheckboxRow label="3.1.1. Număr mediu de salariați estimat de până la 3 salariați exclusiv" checked={state.salariatiSub3} onChange={v => patch({ salariatiSub3: v })} />
            <CheckboxRow label="3.1.2. Venit total estimat de până la 100.000 euro" checked={state.venitSub100k} onChange={v => patch({ venitSub100k: v })} />
            <RadioRow
              label="3.2. Perioada fiscală"
              value={state.salariiPerioada}
              onChange={v => patch({ salariiPerioada: v as Anexa1FormState['salariiPerioada'] })}
              options={[{ value: 'lunara', label: 'Lunară' }, { value: 'trimestriala', label: 'Trimestrială' }]}
            />
            <CheckboxRow label="3.3. Impozit pe veniturile din salarii și asimilate salariilor" checked={state.impozitSalarii} onChange={v => patch({ impozitSalarii: v })} />
            {state.impozitSalarii && (
              <DateFieldInput label="3.3.1. Luare în evidență începând cu data de" value={state.dataLuareEvidentaSalarii} onChange={v => patch({ dataLuareEvidentaSalarii: v })} />
            )}
            <CheckboxRow label="3.4. Contribuție de asigurări sociale (datorată de angajat)" checked={state.cas} onChange={v => patch({ cas: v })} />
            {state.cas && (
              <DateFieldInput label="3.4.1. Luare în evidență începând cu data de" value={state.dataLuareEvidentaCas} onChange={v => patch({ dataLuareEvidentaCas: v })} />
            )}
            <CheckboxRow label="3.5. Contribuție de asigurări sociale de sănătate (datorată de angajat)" checked={state.cass} onChange={v => patch({ cass: v })} />
            {state.cass && (
              <DateFieldInput label="3.5.1. Luare în evidență începând cu data de" value={state.dataLuareEvidentaCass} onChange={v => patch({ dataLuareEvidentaCass: v })} />
            )}
            <CheckboxRow label="3.6. Contribuție asiguratorie pentru muncă (datorată de angajator)" checked={state.cam} onChange={v => patch({ cam: v })} />
            {state.cam && (
              <DateFieldInput label="3.6.1. Luare în evidență începând cu data de" value={state.dataLuareEvidentaCam} onChange={v => patch({ dataLuareEvidentaCam: v })} />
            )}
          </SectionCard>

          <SectionCard title="4. Taxa pe valoarea adăugată">
            <CheckboxRow label="Înregistrare în scopuri de TVA" checked={state.tva} onChange={v => patch({ tva: v })} />
            {state.tva && (
              <>
                <Field label="4.1. Cifra de afaceri estimată (lei)" value={state.cifraAfaceriTva} onChange={v => patch({ cifraAfaceriTva: v })} />
                <RadioRow
                  label="Regim de înregistrare"
                  value={state.tvaRegim}
                  onChange={v => patch({ tvaRegim: v as Anexa1FormState['tvaRegim'] })}
                  options={[
                    { value: 'depasire', label: '4.2. Ca urmare a depășirii plafonului de scutire' },
                    { value: 'optiune', label: '4.3. Prin opțiune (cifră de afaceri sub plafon)' },
                  ]}
                />
                <RadioRow
                  label="4.4. Perioada fiscală"
                  value={state.tvaPerioada}
                  onChange={v => patch({ tvaPerioada: v as Anexa1FormState['tvaPerioada'] })}
                  options={[{ value: 'lunara', label: 'Lunară' }, { value: 'trimestriala', label: 'Trimestrială' }]}
                />
                <CheckboxRow label="4.5. Aplic sistemul TVA la încasare" checked={state.tvaLaIncasare} onChange={v => patch({ tvaLaIncasare: v })} />
              </>
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
})

export default Anexa1Filler
