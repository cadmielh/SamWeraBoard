import { useState } from 'react'
import Modal from '../Modal'
import DateFieldInput from '../DateFieldInput'
import { roDateToISO, parseIsoDateLocal } from '../../lib/dates'

export interface ExportDateFieldOption { key: string; label: string }
export interface ExportColumnOption { key: string; label: string }

export interface ExportRangeResult {
  dateField: string
  start: Date
  end: Date
  respectSearch: boolean
  selectedColumnKeys: string[]
}

interface Props {
  title: string
  /** Omis/vid → fără selector de câmp (ex. Clienți, fix pe data creării). */
  dateFieldOptions?: ExportDateFieldOption[]
  /** Afișează checkbox-ul „Respectă și căutarea text curentă” — doar când e relevant. */
  showSearchToggle: boolean
  /** Coloanele disponibile pentru export — afișate ca checkbox-uri, toate bifate implicit. */
  columnOptions: ExportColumnOption[]
  busy?: boolean
  onConfirm: (result: ExportRangeResult) => void
  onClose: () => void
}

/** Dialog comun pentru exportul .xlsx (Clienți/Dosare) — alegerea câmpului de dată
 * (dacă e cazul), a intervalului start-final (picker de calendar, ca la DateFieldInput),
 * dacă exportul respectă și căutarea text curentă din tabel și ce coloane se exportă. */
export default function ExportRangeDialog({ title, dateFieldOptions, showSearchToggle, columnOptions, busy, onConfirm, onClose }: Props) {
  const [dateField, setDateField] = useState(dateFieldOptions?.[0]?.key ?? '')
  const [startRo, setStartRo] = useState('')
  const [endRo, setEndRo] = useState('')
  const [respectSearch, setRespectSearch] = useState(true)
  const [excludedCols, setExcludedCols] = useState<Set<string>>(new Set())

  const startDate = parseIsoDateLocal(roDateToISO(startRo))
  const endDate = parseIsoDateLocal(roDateToISO(endRo))
  const rangeValid = !!startDate && !!endDate && startDate <= endDate
  const selectedColumnKeys = columnOptions.filter(c => !excludedCols.has(c.key)).map(c => c.key)
  const allColsSelected = excludedCols.size === 0
  const canSubmit = rangeValid && !busy && selectedColumnKeys.length > 0

  const toggleCol = (key: string) => {
    setExcludedCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const handleSubmit = () => {
    if (!startDate || !endDate || selectedColumnKeys.length === 0) return
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1)
    onConfirm({ dateField, start: startDate, end, respectSearch, selectedColumnKeys })
  }

  return (
    <Modal onClose={onClose} ariaLabel={title}>
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

          <div className="field full">
            <div className="export-cols__head">
              <span className="field-label">Coloane de exportat</span>
              <button
                type="button" className="btn btn-ghost btn-xs"
                onClick={() => setExcludedCols(allColsSelected ? new Set(columnOptions.map(c => c.key)) : new Set())}
              >
                {allColsSelected ? 'Deselectează tot' : 'Selectează tot'}
              </button>
            </div>
            <div className="export-cols-grid">
              {columnOptions.map(col => (
                <label key={col.key} className="cols-panel__item">
                  <input
                    type="checkbox"
                    checked={!excludedCols.has(col.key)}
                    onChange={() => toggleCol(col.key)}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
            {selectedColumnKeys.length === 0 && (
              <div style={{ color: 'var(--r600)', fontSize: '.8125rem', marginTop: '.25rem' }}>
                Selectați cel puțin o coloană.
              </div>
            )}
          </div>
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
