import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import type { Dosar } from '../../types'
import { STADIU_DOSAR_LABELS, STADIU_DOSAR_COLOR, obiecteCereriiText } from '../../types'
import { dosarProfit } from '../../lib/dosareStats'
import { usePositionedDropdown } from '../../lib/usePositionedDropdown'
import {
  COLUMNS, type ColDef, EMPTY_PLACEHOLDER, fmtDateShort, getColValue, getUniqueValues,
  type SortState,
} from './dosarColumns'
import IconTrash from '../IconTrash'
import IconPencil from '../IconPencil'
import IconEye from '../IconEye'

const ACTION_W = 152
const HEADER_H = 36
const ROW_H = 48

function renderCellContent(d: Dosar, key: string): React.ReactNode {
  switch (key) {
    case 'clientDenumire':
      return (
        <>
          {d.clientDenumire || d.clientDenumireLibera}
          {!d.clientId && <span className="chip chip-muted" style={{ marginLeft: '.4rem', fontSize: '.6rem' }} title="Client fără fișă în registru">liber</span>}
        </>
      )
    case 'clientCui':
      return d.clientCui ? <span style={{ fontFamily: 'monospace', fontSize: '.8125rem' }}>{d.clientCui}</span> : null
    case 'stadiu':
      return <span className={`badge stadiu-badge-${STADIU_DOSAR_COLOR[d.stadiu]}`}>{STADIU_DOSAR_LABELS[d.stadiu]}</span>
    case 'facturat':
      return <span className={`chip ${d.facturat ? 'chip-success' : 'chip-muted'}`}>{d.facturat ? 'Da' : 'Nu'}</span>
    case 'profit': {
      const p = dosarProfit(d)
      return <span style={{ fontWeight: 700, color: p >= 0 ? 'var(--g700)' : 'var(--r600)' }}>{p.toLocaleString('ro-RO')} RON</span>
    }
    case 'taxeOnrc':
    case 'tarifClient': {
      const v = d[key]
      return v == null ? null : `${v.toLocaleString('ro-RO')} RON`
    }
    case 'dataAdmiterii':
    case 'dataPlanificare': {
      const v = d[key]
      return v ? fmtDateShort(v) : null
    }
    case 'obiecteCererii':
      return obiecteCereriiText(d.obiecteCererii)
    default:
      return getColValue(d, key)
  }
}

/* ── ColumnsPanel ── */
interface ColumnsPanelProps {
  hiddenCols: Set<string>
  onToggle: (key: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onClose: () => void
}

export function DosarColumnsPanel({ hiddenCols, onToggle, onSelectAll, onDeselectAll, onClose }: ColumnsPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const allVisible = COLUMNS.every(c => c.fixed || !hiddenCols.has(c.key))

  return (
    <div ref={ref} className="cols-panel">
      <div className="cols-panel__head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Coloane vizibile</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={allVisible ? onDeselectAll : onSelectAll}>
          {allVisible ? 'Deselectează tot' : 'Selectează tot'}
        </button>
      </div>
      {COLUMNS.map(col => (
        <label key={col.key} className="cols-panel__item">
          <input
            type="checkbox"
            checked={col.fixed || !hiddenCols.has(col.key)}
            disabled={col.fixed}
            onChange={() => !col.fixed && onToggle(col.key)}
          />
          <span>{col.label}</span>
          {col.fixed && <span className="cols-panel__fixed-badge">Fix</span>}
        </label>
      ))}
    </div>
  )
}

/* ── Table ── */
interface Props {
  dosare: Dosar[]
  rawDosare: Dosar[]
  sortState: SortState
  colFilters: Record<string, string[]>
  hiddenCols: Set<string>
  onColSort: (key: string) => void
  onFilterToggle: (key: string, val: string) => void
  onSelectAllFilter: (key: string) => void
  onClearFilter: (key: string) => void
  onView: (d: Dosar) => void
  onEdit: (d: Dosar) => void
  onDelete: (d: Dosar) => void
}

export default function DosarTable({
  dosare, rawDosare, sortState, colFilters, hiddenCols,
  onColSort, onFilterToggle, onSelectAllFilter, onClearFilter,
  onView, onEdit, onDelete,
}: Props) {
  /* Lățimea reală a containerului — coloanele vizibile se întind proporțional
     s-o umple, ca la ClientiPage.tsx, ca să nu rămână loc liber înainte de
     coloana de acțiuni când sunt puține coloane vizibile. */
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => setContainerWidth(entries[0]?.contentRect.width ?? 800))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  /* Column order */
  const [colOrder, setColOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('samwera-dosare-col-order')
      if (raw) {
        const saved = JSON.parse(raw) as string[]
        const allKeys = COLUMNS.map(c => c.key)
        return [...saved.filter(k => allKeys.includes(k)), ...allKeys.filter(k => !saved.includes(k))]
      }
    } catch { /* localStorage indisponibil sau valoare coruptă — folosim implicitul */ }
    return COLUMNS.map(c => c.key)
  })

  /* Column widths */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('samwera-dosare-col-widths')
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })
  const colWidthsRef = useRef(colWidths)

  /* Drag-and-drop reorder */
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const resizingRef = useRef(false)

  /* Filter dropdown */
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null)
  const filterDropdown = usePositionedDropdown<HTMLDivElement>({ clampWidth: 240, onScroll: 'reposition' })
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!filterDropdown.open) setOpenFilterKey(null)
  }, [filterDropdown.open])

  const colMap = useMemo(() => new Map(COLUMNS.map(c => [c.key, c])), [])

  const orderedVisibleColumns = useMemo(() => {
    return colOrder
      .map(key => colMap.get(key))
      .filter((col): col is ColDef => !!col && (!!col.fixed || !hiddenCols.has(col.key)))
  }, [colOrder, hiddenCols, colMap])

  const getW = useCallback((key: string): number => colWidths[key] ?? colMap.get(key)?.width ?? 150, [colWidths, colMap])

  const totalDataW = useMemo(
    () => orderedVisibleColumns.reduce((s, c) => s + getW(c.key), 0),
    [orderedVisibleColumns, getW]
  )

  // Când coloanele vizibile nu umplu lățimea disponibilă (puține coloane
  // afișate), le întindem proporțional ca tabelul să nu lase loc liber până
  // la coloana de acțiuni — fără să atingem lățimile salvate de utilizator.
  const availableDataW = Math.max(0, containerWidth - ACTION_W)
  const stretchScale = totalDataW > 0 && totalDataW < availableDataW ? availableDataW / totalDataW : 1
  const getDisplayW = useCallback((key: string): number => getW(key) * stretchScale, [getW, stretchScale])
  const totalDisplayW = totalDataW * stretchScale
  const minW = Math.max(totalDisplayW + ACTION_W, 400)

  /* Resize handler */
  const startResize = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = true
    const th = (e.currentTarget as HTMLElement).closest('[data-colkey]') as HTMLElement | null
    const startX = e.clientX
    const startWidth = th ? th.offsetWidth : getW(colKey)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(60, startWidth + (ev.clientX - startX))
      setColWidths(prev => {
        const next = { ...prev, [colKey]: newWidth }
        colWidthsRef.current = next
        return next
      })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem('samwera-dosare-col-widths', JSON.stringify(colWidthsRef.current))
      setTimeout(() => { resizingRef.current = false }, 0)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [getW])

  /* Drag-and-drop handlers */
  const handleColDragStart = (e: React.DragEvent, key: string) => {
    setDragCol(key)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleColDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (key !== dragCol) setDragOver(key)
  }
  const handleColDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault()
    setDragOver(null)
    if (!dragCol || dragCol === targetKey) return
    setColOrder(prev => {
      const fromIdx = prev.indexOf(dragCol)
      const toIdx = prev.indexOf(targetKey)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = [...prev]
      next.splice(fromIdx, 1)
      next.splice(toIdx, 0, dragCol)
      localStorage.setItem('samwera-dosare-col-order', JSON.stringify(next))
      return next
    })
    setDragCol(null)
  }
  const handleColDragEnd = () => { setDragCol(null); setDragOver(null) }

  const handleFilterBtnClick = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (filterDropdown.open && openFilterKey === key) { filterDropdown.close(); return }
    setOpenFilterKey(key)
    filterDropdown.openAt(e.currentTarget as HTMLElement)
  }

  return (
    <div ref={containerRef} style={{ height: '100%', overflow: 'auto' }}>
      <div className="table-header" style={{ width: minW, minWidth: '100%', position: 'sticky', top: 0, zIndex: 5, height: HEADER_H }}>
        {orderedVisibleColumns.map(col => {
          const isActive = sortState.col === col.key
          const hasFilter = (colFilters[col.key]?.length ?? 0) > 0
          const isFixed = !!col.fixed
          const thClass = [
            'th',
            col.sortable ? 'th--sortable' : '',
            isActive ? `th--sort-${sortState.dir}` : '',
            hasFilter ? 'th--filtered' : '',
            !isFixed ? 'th--draggable' : '',
            dragCol === col.key ? 'th--dragging' : '',
            dragOver === col.key ? 'th--drag-over' : '',
          ].filter(Boolean).join(' ')
          return (
            <div
              key={col.key}
              className={thClass}
              data-colkey={col.key}
              style={{ width: getDisplayW(col.key) }}
              onClick={() => col.sortable && !resizingRef.current && onColSort(col.key)}
              draggable={!isFixed}
              onDragStart={!isFixed ? e => handleColDragStart(e, col.key) : undefined}
              onDragOver={!isFixed ? e => handleColDragOver(e, col.key) : undefined}
              onDrop={!isFixed ? e => handleColDrop(e, col.key) : undefined}
              onDragEnd={!isFixed ? handleColDragEnd : undefined}
            >
              <span className="th__label">{col.label}</span>
              {col.sortable && (
                <span className="th__sort-icon">{isActive ? (sortState.dir === 'asc' ? '▴' : '▾') : ''}</span>
              )}
              {col.filterable && (
                <button
                  className={`th__filter-btn${hasFilter ? ' th__filter-btn--active' : ''}`}
                  onClick={e => handleFilterBtnClick(col.key, e)}
                  title={`Filtrează ${col.label}`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                </button>
              )}
              <div className="col-resize-handle" onMouseDown={e => startResize(e, col.key)} onClick={e => e.stopPropagation()} />
            </div>
          )
        })}
        <div className="th" style={{ width: ACTION_W, flexShrink: 0, marginLeft: 'auto', position: 'sticky', right: 0, justifyContent: 'flex-end', background: 'var(--surface-2)' }} />
      </div>

      {dosare.map(d => {
        const profit = dosarProfit(d)
        return (
          <div key={d.id} className="vrow" style={{ width: minW, minWidth: '100%', height: ROW_H }}>
            {orderedVisibleColumns.map(col => (
              <div
                key={col.key}
                className={`td${col.key === 'clientDenumire' ? ' td-bold' : col.key === 'stadiu' || col.key === 'facturat' ? '' : ' td-muted'}`}
                style={{ width: getDisplayW(col.key), flexShrink: 0 }}
                title={col.key === 'obiecteCererii' ? obiecteCereriiText(d.obiecteCererii) : undefined}
              >
                {col.key === 'profit'
                  ? <span style={{ fontWeight: 700, color: profit >= 0 ? 'var(--g700)' : 'var(--r600)' }}>{profit.toLocaleString('ro-RO')} RON</span>
                  : renderCellContent(d, col.key)}
              </div>
            ))}
            <div
              className="td"
              style={{ width: ACTION_W, flexShrink: 0, marginLeft: 'auto', position: 'sticky', right: 0, background: 'var(--surface)', display: 'flex', justifyContent: 'flex-end', gap: '.25rem' }}
            >
              <button className="btn btn-ghost btn-xs" onClick={() => onView(d)} title="Vizualizează"><IconEye /></button>
              <button className="btn btn-ghost btn-xs" onClick={() => onEdit(d)} title="Editează"><IconPencil /></button>
              <button className="btn btn-ghost btn-xs" onClick={() => onDelete(d)} title="Șterge" style={{ color: 'var(--r500)' }}><IconTrash /></button>
            </div>
          </div>
        )
      })}

      {openFilterKey && filterDropdown.open && filterDropdown.position && (() => {
        const key = openFilterKey
        const col = colMap.get(key)!
        const opts = getUniqueValues(rawDosare, key)
        const selected = colFilters[key] ?? []
        const allSel = opts.length > 0 && opts.every(v => selected.includes(v))
        return (
          <div
            ref={filterDropdown.containerRef}
            className="col-filter-dd"
            style={{ position: 'fixed', top: filterDropdown.position.top, left: filterDropdown.position.left, zIndex: 600 }}
          >
            <div className="col-filter-dd__head">
              <span>{col?.label}</span>
              <button onClick={() => { onClearFilter(key); filterDropdown.close() }}>Golește filtrul</button>
            </div>
            <div className="col-filter-dd__list">
              <label className={`col-filter-dd__opt col-filter-dd__opt--all${allSel ? ' col-filter-dd__opt--on' : ''}`}>
                <input type="checkbox" checked={allSel} onChange={() => onSelectAllFilter(key)} />
                <span>Selectează tot</span>
              </label>
              {opts.map(val => {
                const isSel = selected.includes(val)
                const isEmpty = val === EMPTY_PLACEHOLDER
                return (
                  <label key={val} className={`col-filter-dd__opt${isSel ? ' col-filter-dd__opt--on' : ''}${isEmpty ? ' col-filter-dd__opt--empty' : ''}`}>
                    <input type="checkbox" checked={isSel} onChange={() => onFilterToggle(key, val)} />
                    <span>{val}</span>
                  </label>
                )
              })}
              {opts.length === 0 && <div className="col-filter-dd__empty">Nicio valoare</div>}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
