import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { formatDateRo, isoDateToRo, roDateToISO } from '../lib/dates'
import IconCalendar from './IconCalendar'

interface Props {
  id?: string
  label: string
  /** Formatul românesc, zz.ll.aaaa (ca orice altă valoare de completare din document). */
  value: string
  onChange: (v: string) => void
  style?: CSSProperties
}

/**
 * Câmp de dată generic — text liber (zz.ll.aaaa, cu sugestia chiar în câmp — `input[type=date]` NU arată
 * `placeholder`-ul pus pe el, e ignorat de browser, iar formatul nativ afișat când e gol depinde de
 * limba/regiunea browserului, nu de pagină, deci nu poate fi forțat „zz.ll.aaaa" direct pe el) + un buton de
 * calendar, care deschide picker-ul nativ al browserului (un <input type="date"> ascuns, sincronizat cu
 * același text) + bifă „Azi”, care completează automat data curentă.
 *
 * Pentru câmpurile completate manual la generare (CAMP_…, câmpuri ad-hoc de clauză — „Nr./Data contract…”
 * etc.), unde data cerută e adesea chiar ziua redactării. Nu se folosește pentru datele persoanei (naștere,
 * valabilitate CI) — acelea nu au legătură cu „azi”; PersoanaModal are deja propriul <input type="date">
 * simplu, fără bifă.
 */
export default function DateFieldInput({ id, label, value, onChange, style }: Props) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const today = formatDateRo(new Date())
  const isToday = !!value && value === today

  const openPicker = () => {
    const el = pickerRef.current
    if (el && "showPicker" in el) {
      try { (el as HTMLInputElement & { showPicker: () => void }).showPicker() } catch { el.focus() }
    } else {
      el?.focus()
    }
  }

  return (
    <div className="field" style={style}>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="field-with-btn">
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            id={id} className="field-input" type="text" placeholder="zz.ll.aaaa"
            style={{ paddingRight: '2.25rem' }}
            value={value}
            onChange={e => onChange(e.target.value)}
          />
          <button
            type="button" onClick={openPicker} aria-label="Alege data din calendar"
            style={{
              position: 'absolute', right: '.4rem', top: '50%', transform: 'translateY(-50%)',
              display: 'flex', background: 'none', border: 'none', padding: '.2rem', cursor: 'pointer',
              color: 'var(--s400)',
            }}
          >
            <IconCalendar />
          </button>
          {/* Nevăzut — doar ca să deschidă picker-ul nativ de dată (showPicker) și să-l citească la alegere. */}
          <input
            ref={pickerRef} type="date" tabIndex={-1} aria-hidden="true"
            value={roDateToISO(value)}
            onChange={e => onChange(isoDateToRo(e.target.value))}
            style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', width: '100%', height: '100%' }}
          />
        </div>
        <label className="field-checkbox-row" style={{ whiteSpace: 'nowrap' }}>
          <input
            type="checkbox" className="field-checkbox" checked={isToday}
            onChange={e => onChange(e.target.checked ? today : '')}
          />
          Azi
        </label>
      </div>
    </div>
  )
}
