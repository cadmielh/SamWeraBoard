import { useId, useState } from 'react'
import { avertizareMandat, mandatImplicit, stareMandat, tipuriMandat, type Mandat } from '../lib/durata'
import DurataFields from './clauses/DurataFields'
import DateFieldInput from './DateFieldInput'
import TermenBadge from './TermenBadge'

interface Props {
  /** Lipsă = necompletat (administrator de dinainte); prima alegere pornește de la mandatul implicit. */
  value: Mandat | undefined
  onChange: (m: Mandat) => void
  formaJuridica?: string
}

const RADIO_LABEL = { display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.85rem', cursor: 'pointer' } as const

/** Durata mandatului unui administrator și momentul de la care curge — „din prezent” (juridic, de la aprobarea
 * dosarului la ONRC, dată completată după aprobare) sau de la o dată anume. */
export default function MandatFields({ value, onChange, formaJuridica }: Props) {
  const name = useId()
  const infoId = useId()
  const [info, setInfo] = useState(false)
  // Data aprobării contează doar la un mandat pe ani (de la ea se calculează expirarea); altfel se cere doar la nevoie,
  // pentru documentele care o scriu în text
  const [cuDataAprobarii, setCuDataAprobarii] = useState(false)
  const base = value ?? mandatImplicit(formaJuridica)
  const set = (patch: Partial<Mandat>) => onChange({ ...base, ...patch })
  const avertizare = value ? avertizareMandat(formaJuridica, value) : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <DurataFields tipuri={tipuriMandat(formaJuridica)} value={value?.durata} onChange={durata => set({ durata })} />
      {avertizare && <span style={{ fontSize: '.75rem', color: 'var(--y700)' }}>⚠ {avertizare}</span>}

      {value && (
        <>
          <div>
            <div className="field-label" style={{ marginBottom: '.25rem' }}>Mandatul începe</div>
            <div role="radiogroup" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.375rem 1rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                <label style={RADIO_LABEL}>
                  <input type="radio" name={name} checked={value.inceput === 'aprobare'} onChange={() => set({ inceput: 'aprobare' })} />
                  Din prezent
                </label>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setInfo(o => !o)}
                  aria-expanded={info} aria-controls={infoId} aria-label="Ce înseamnă „Din prezent”" title="Ce înseamnă „Din prezent”"
                  style={{ padding: '0 .3rem', lineHeight: 1.2, color: 'var(--b600)' }}>ⓘ</button>
              </span>
              <label style={RADIO_LABEL}>
                <input type="radio" name={name} checked={value.inceput === 'data'} onChange={() => set({ inceput: 'data' })} />
                De la o dată anume
              </label>
            </div>
            {info && (
              <p id={infoId} style={{ fontSize: '.75rem', color: 'var(--s600)', background: 'var(--b50)', borderRadius: 'var(--r-sm)', padding: '.4rem .6rem', margin: '.375rem 0 0' }}>
                Juridic, mandatul curge de la data aprobării dosarului la ONRC: înmatricularea, la o firmă nouă, sau
                înregistrarea mențiunii, la una existentă. La o firmă nouă data se completează singură, din data
                înmatriculării trecută în fișa firmei (o poți prelua din ANAF). La o firmă existentă, e data rezoluției
                ONRC de înregistrare a mențiunii. Până atunci, în documente rămâne loc de completat de mână.
              </p>
            )}
          </div>
          {value.inceput === 'aprobare' && (value.durata.tip === 'ani' || value.dataNumire || cuDataAprobarii) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
              <DateFieldInput label="Data aprobării dosarului (ONRC)" value={value.dataNumire}
                onChange={dataNumire => set({ dataNumire })} showToday={false} />
              <span style={{ fontSize: '.75rem', color: 'var(--s500)' }}>
                {value.durata.tip === 'ani' ? 'Ca să știm când expiră mandatul. ' : ''}
                La o firmă nouă se completează singură, din data înmatriculării; la una existentă, data rezoluției ONRC.
              </span>
            </div>
          )}
          {value.inceput === 'aprobare' && value.durata.tip !== 'ani' && !value.dataNumire && !cuDataAprobarii && (
            <button type="button" className="btn btn-ghost btn-xs" style={{ alignSelf: 'flex-start' }} onClick={() => setCuDataAprobarii(true)}
              title="Pentru documentele care scriu în text data de la care începe mandatul">
              + adaugă data aprobării
            </button>
          )}
          {value.inceput === 'data' && (
            <DateFieldInput label="Data numirii" value={value.dataNumire} onChange={dataNumire => set({ dataNumire })} showToday={false} />
          )}
          <TermenBadge stare={stareMandat(value)} />
        </>
      )}
    </div>
  )
}
