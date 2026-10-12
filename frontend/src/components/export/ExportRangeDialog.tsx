import { useState } from 'react'
import Modal from '../Modal'
import DateFieldInput from '../DateFieldInput'
import { roDateToISO, parseIsoDateLocal } from '../../lib/dates'

export interface ExportDateFieldOption { key: string; label: string }

export interface ExportRangeResult {
  dateField: string
  start: Date
  end: Date
  respectSearch: boolean
}

interface Props {
  title: string
  /** Omis/vid → fără selector de câmp (ex. Clienți, fix pe data creării). */
  dateFieldOptions?: ExportDateFieldOption[]
  /** Afișează checkbox-ul „Respectă și căutarea text curentă” — doar când e relevant. */
  showSearchToggle: boolean
  busy?: boolean
  onConfirm: (result: ExportRangeResult) => void
  onClose: () => void
}

/** Dialog comun pentru exportul .xlsx (Clienți/Dosare) — alegerea câmpului de dată
 * (dacă e cazul), a intervalului start-final (picker de calendar, ca la DateFieldInput)
 * și dacă exportul respectă și căutarea text curentă din tabel. */
export default function ExportRangeDialog({ title, dateFieldOptions, showSearchToggle, busy, onConfirm, onClose }: Props) {
  const [dateField, setDateField] = useState(dateFieldOptions?.[0]?.key ?? '')
  const [startRo, setStartRo] = useState('')
  const [endRo, setEndRo] = useState('')
  const [respectSearch, setRespectSearch] = useState(true)

  const startDate = parseIsoDateLocal(roDateToISO(startRo))
  const endDate = parseIsoDateLocal(roDateToISO(endRo))
  const rangeValid = !!startDate && !!endDate && startDate <= endDate
  const canSubmit = rangeValid && !busy

  const handleSubmit = () => {
    if (!startDate || !endDate) return
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1)
    onConfirm({ dateField, start: startDate, end, respectSearch })
  }

  return (
    <Modal onClose={onClose} className="modal-box--sm" ariaLabel={title}>
      <div className="modal-head">
        <span className="modal-title">{title}</span>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>

      <div className="modal-body">
        <div className="form-grid">
          {dateFieldOptions && dateFieldOptions.length > 0 && (
            <div className="field full">
              <label className="field-label">Interval pe câmpul</label>
              <select
                className="field-input"
                value={dateField}
                onChange={e => setDateField(e.target.value)}
                disabled={dateFieldOptions.length === 1}
              >
                {dateFieldOptions.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
              </select>
            </div>
          )}

          <DateFieldInput id="export-start" label="Data de start" value={startRo} onChange={setStartRo} />
          <DateFieldInput id="export-end" label="Data de final" value={endRo} onChange={setEndRo} />

          {startRo && endRo && !rangeValid && (
            <div className="field full" style={{ color: 'var(--r600)', fontSize: '.8125rem' }}>
              Data de start trebuie să fie înainte de (sau egală cu) data de final.
            </div>
          )}

          {showSearchToggle && (
            <label className="field-checkbox-row field full">
              <input
                type="checkbox" className="field-checkbox"
                checked={respectSearch}
                onChange={e => setRespectSearch(e.target.checked)}
              />
              Respectă și căutarea text curentă
            </label>
          )}
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Anulează</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
          {busy ? 'Se exportă…' : 'Exportă'}
        </button>
      </div>
    </Modal>
  )
}
