import { useState, useEffect, useRef, useCallback, useMemo, useReducer, forwardRef } from 'react'
import { FixedSizeList } from 'react-window'
import type { Client } from '../types'
import type { ClientInput } from '../lib/clienti'
import { useClienti } from '../lib/clienti'
import { useApp } from '../AppLayout'
import ClientModal from '../components/ClientModal'
import ClientView from '../components/ClientView'

/* ── Column definitions ── */
interface ColDef {
  key: string
  label: string
  width: number
  fixed?: boolean
  sortable?: boolean
  filterable?: boolean
}

const COLUMNS: ColDef[] = [
  { key: 'denumire',      label: 'Denumire',      width: 220, fixed: true, sortable: true,  filterable: true  },
  { key: 'formaJuridica', label: 'Tip',           width: 80,  sortable: true,  filterable: true  },
  { key: 'codFiscal',     label: 'Cod fiscal',    width: 120, sortable: true,  filterable: true  },
  { key: 'caenCod',       label: 'CAEN',          width: 180, sortable: true,  filterable: true  },
  { key: 'tva',           label: 'TVA',           width: 110, sortable: false, filterable: true  },
  { key: 'statutFiscal',  label: 'Statut',        width: 90,  sortable: true,  filterable: true  },
  { key: 'asoc',          label: 'Asoc.',         width: 70,  sortable: true,  filterable: true  },
  /* câmpuri suplimentare — ascunse implicit */
  { key: 'email',         label: 'Email',         width: 200, sortable: true,  filterable: false },
  { key: 'nrRegistrul',   label: 'Nr. RC',        width: 150, sortable: true,  filterable: true  },
  { key: 'telefon',       label: 'Telefon',       width: 130, sortable: true,  filterable: false },
  { key: 'sediuSocial',   label: 'Sediu social',  width: 250, sortable: false, filterable: false },
  { key: 'notite',        label: 'Notițe',        width: 200, sortable: false, filterable: false },
  { key: 'admin',         label: 'Admin.',        width: 70,  sortable: true,  filterable: true  },
]

const EXTRA_COL_KEYS = new Set(['email', 'nrRegistrul', 'telefon', 'sediuSocial', 'notite', 'admin'])

const ROW_H = 48
const ACTION_W = 130
const HEADER_H = 36
const EMPTY_PLACEHOLDER = '(Necompletat)'

/* ── Outer element types for react-window scroll sync ── */
const VirtualListOuter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, ...rest }, ref) => (
    <div ref={ref} style={{ ...style, overflowX: 'hidden' }} {...rest} />
  )
)

const ActionsListOuter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, ...rest }, ref) => (
    <div
      ref={ref}
      className="actions-list-outer"
      style={{ ...style, overflowX: 'hidden', overflowY: 'scroll', scrollbarWidth: 'none' } as React.CSSProperties}
      {...rest}
    />
  )
)

/* ── Pure helper functions ── */

function getColValue(c: Client, key: string): string {
  switch (key) {
    case 'tva':
      if (!c.platitorTva) return c.dataAnafActualizat ? 'Non-TVA' : ''
      return c.periodaTva === 'lunara' ? 'TVA lunar'
           : c.periodaTva === 'trimestriala' ? 'TVA trim.' : 'TVA'
    case 'asoc':
      return c.asociati.length > 0 ? String(c.asociati.length) : ''
    case 'admin':
      return c.administratori.length > 0 ? String(c.administratori.length) : ''
    default: {
      const val = (c as unknown as Record<string, unknown>)[key]
      if (val === null || val === undefined) return ''
      if (typeof val === 'boolean') return val ? 'Da' : 'Nu'
      return String(val)
    }
  }
}

function renderCellContent(c: Client, key: string): React.ReactNode {
  switch (key) {
    case 'tva': {
      const tva = getColValue(c, 'tva')
      return tva ? <span className={`badge ${c.platitorTva ? 'badge-tva' : 'badge-notva'}`}>{tva}</span> : null
    }
    case 'statutFiscal':
      return c.statutFiscal
        ? <span className={`badge badge-${c.statutFiscal}`}>{c.statutFiscal}</span>
        : null
    case 'asoc':
      return c.asociati.length > 0
        ? <span className="chip chip-muted">{c.asociati.length}</span>
        : null
    case 'admin':
      return c.administratori.length > 0
        ? <span className="chip chip-muted">{c.administratori.length}</span>
        : null
    case 'caenCod':
      return c.caenCod
        ? `${c.caenCod} — ${c.caenDescriere.slice(0, 28)}${c.caenDescriere.length > 28 ? '…' : ''}`
        : ''
    case 'sediuSocial':
    case 'notite': {
      const v = getColValue(c, key)
      return v.length > 45 ? `${v.slice(0, 45)}…` : v
    }
    default:
      return getColValue(c, key)
  }
}

function getUniqueValues(clients: Client[], key: string): string[] {
  const set = new Set<string>()
  let hasEmpty = false
  for (const c of clients) {
    const v = getColValue(c, key)
    if (v) set.add(v)
    else hasEmpty = true
  }
  const sorted = [...set].sort((a, b) =>
    a.localeCompare(b, 'ro', { sensitivity: 'base', numeric: true })
  )
  if (hasEmpty) sorted.unshift(EMPTY_PLACEHOLDER)
  return sorted
}

function applyFilters(clients: Client[], filters: Record<string, string[]>): Client[] {
  return clients.filter(c =>
    Object.entries(filters).every(([key, vals]) => {
      if (!vals.length) return true
      const v = getColValue(c, key)
      return vals.includes(v) || (!v && vals.includes(EMPTY_PLACEHOLDER))
    })
  )
}

function applySort(clients: Client[], col: string | null, dir: 'asc' | 'desc'): Client[] {
  if (!col) return clients
  return [...clients].sort((a, b) => {
    const av = getColValue(a, col)
    const bv = getColValue(b, col)
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    const cmp = av.localeCompare(bv, 'ro', { sensitivity: 'base', numeric: true })
    return dir === 'asc' ? cmp : -cmp
  })
}

/* ── Sort reducer ── */
type SortState = { col: string | null; dir: 'asc' | 'desc' }
type SortAction = { type: 'TOGGLE'; col: string } | { type: 'RESET' }

function sortReducer(state: SortState, action: SortAction): SortState {
  if (action.type === 'RESET') return { col: null, dir: 'asc' }
  if (state.col !== action.col) return { col: action.col, dir: 'asc' }
  if (state.dir === 'asc') return { col: action.col, dir: 'desc' }
  return { col: null, dir: 'asc' }
}

/* ── Debounce hook ── */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debouncedValue
}

/* ── ColumnsPanel ── */
interface ColumnsPanelProps {
  hiddenCols: Set<string>
  onToggle: (key: string) => void
  onClose: () => void
}

function ColumnsPanel({ hiddenCols, onToggle, onClose }: ColumnsPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="cols-panel">
      <div className="cols-panel__head">Coloane vizibile</div>
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

/* ── Main page component ── */
type ModalState = null | 'add' | Client
type DeleteState = null | Client

export default function ClientiPage() {
  const { user, activeWorkspace, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null

  const { clienti, loading, search, add, update, remove } = useClienti(workspaceId)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Client[] | null>(null)
  const debouncedQ = useDebounce(searchQuery, 300)

  useEffect(() => {
    if (!workspaceId || debouncedQ.length < 2) { setSearchResults(null); return }
    search(workspaceId, debouncedQ).then(setSearchResults).catch(() => {})
  }, [debouncedQ, workspaceId, search])

  const displayed = searchResults ?? clienti

  const [sortState, dispatchSort] = useReducer(sortReducer, { col: null, dir: 'asc' })
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('samwera-hidden-cols')
      if (raw) return new Set(JSON.parse(raw) as string[])
    } catch {}
    return new Set(EXTRA_COL_KEYS)
  })

  const [showColsPanel, setShowColsPanel] = useState(false)

  /* Tabs */
  const [openClientIds, setOpenClientIds] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<'list' | string>('list')

  const [modal, setModal] = useState<ModalState>(null)
  const [deleteConf, setDeleteConf] = useState<DeleteState>(null)

  const processedClients = useMemo(() => {
    const filtered = applyFilters(displayed, colFilters)
    return applySort(filtered, sortState.col, sortState.dir)
  }, [displayed, colFilters, sortState])

  const hasActiveFiltersOrSort =
    Object.values(colFilters).some(v => v.length > 0) || sortState.col !== null

  const openClients = useMemo(
    () => openClientIds.map(id => clienti.find(c => c.id === id)).filter(Boolean) as Client[],
    [openClientIds, clienti]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeTab !== 'list') { setActiveTab('list'); return }
        setModal(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeTab])

  const handleSave = useCallback(async (data: ClientInput) => {
    if (!workspaceId || !user) return
    if (modal && typeof modal === 'object') {
      await update(workspaceId, modal.id, data)
      toast('Client actualizat', 'ok')
    } else {
      await add(workspaceId, data, user.uid)
      toast('Client adăugat', 'ok')
    }
  }, [modal, workspaceId, user, add, update, toast])

  const handleDelete = useCallback(async () => {
    if (!deleteConf || !workspaceId) return
    await remove(workspaceId, deleteConf.id)
    toast('Client șters', 'ok')
    setOpenClientIds(prev => prev.filter(id => id !== deleteConf.id))
    if (activeTab === deleteConf.id) setActiveTab('list')
    setDeleteConf(null)
  }, [deleteConf, workspaceId, remove, toast, activeTab])

  const openTab = useCallback((c: Client) => {
    setOpenClientIds(prev => prev.includes(c.id) ? prev : [...prev, c.id])
    setActiveTab(c.id)
  }, [])

  const closeTab = useCallback((id: string) => {
    setOpenClientIds(prev => prev.filter(x => x !== id))
    setActiveTab(prev => prev === id ? 'list' : prev)
  }, [])

  const toggleColVisibility = useCallback((key: string) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      localStorage.setItem('samwera-hidden-cols', JSON.stringify([...next]))
      return next
    })
  }, [])

  const handleFilterToggle = useCallback((key: string, val: string) => {
    setColFilters(prev => {
      const curr = prev[key] ?? []
      const next = curr.includes(val) ? curr.filter(v => v !== val) : [...curr, val]
      return { ...prev, [key]: next }
    })
  }, [])

  const handleSelectAllFilter = useCallback((key: string) => {
    const all = getUniqueValues(displayed, key)
    setColFilters(prev => {
      const curr = prev[key] ?? []
      const allSelected = all.length > 0 && all.every(v => curr.includes(v))
      return { ...prev, [key]: allSelected ? [] : all }
    })
  }, [displayed])

  const handleClearFilter = useCallback((key: string) => {
    setColFilters(prev => ({ ...prev, [key]: [] }))
  }, [])

  const resetAll = useCallback(() => {
    setColFilters({})
    dispatchSort({ type: 'RESET' })
  }, [])

  const activeClient = activeTab !== 'list'
    ? openClients.find(c => c.id === activeTab) ?? null
    : null

  if (!workspaceId) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🏢</div>
        <div className="empty-state-text">Selectați un spațiu de lucru pentru a vedea clienții.</div>
      </div>
    )
  }

  return (
    <>
      <div className="page--data">
        {/* Header */}
        <div className="page-top">
          <div className="page-header">
            <div>
              <div className="page-title">Clienți</div>
              <div className="page-subtitle">Gestionare portofoliu clienți</div>
            </div>
            <div className="page-actions">
              <button className="btn btn-primary" onClick={() => setModal('add')}>
                + Adaugă client
              </button>
            </div>
          </div>

          <div className="toolbar">
            <div className="search-box">
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="var(--s400)" strokeWidth="2" strokeLinecap="round">
                <circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" />
              </svg>
              <input
                placeholder="Caută după denumire..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults(null) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
              )}
            </div>
          </div>

          <div className="table-controls">
            <span>
              {loading
                ? 'Se încarcă...'
                : `${processedClients.length}${processedClients.length !== displayed.length ? ` / ${displayed.length}` : ''} client${displayed.length !== 1 ? 'i' : ''}`}
              {searchResults !== null && ` · rezultate pentru „${debouncedQ}"`}
            </span>
            <div style={{ flex: 1 }} />
            {hasActiveFiltersOrSort && (
              <button className="btn btn-ghost btn-sm" onClick={resetAll}>
                × Resetează filtre
              </button>
            )}
            <div style={{ position: 'relative' }}>
              <button
                className={`btn btn-ghost btn-sm${hiddenCols.size > 0 ? ' btn--cols-active' : ''}`}
                onClick={() => setShowColsPanel(p => !p)}
              >
                Coloane{hiddenCols.size > 0 && <span className="cols-badge">{hiddenCols.size}</span>}
              </button>
              {showColsPanel && (
                <ColumnsPanel
                  hiddenCols={hiddenCols}
                  onToggle={toggleColVisibility}
                  onClose={() => setShowColsPanel(false)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Tab bar */}
        {openClientIds.length > 0 && (
          <div className="page-tabs">
            <button
              className={`page-tab${activeTab === 'list' ? ' page-tab--active' : ''}`}
              onClick={() => setActiveTab('list')}
            >
              Listă
            </button>
            {openClients.map(c => (
              <button
                key={c.id}
                className={`page-tab${activeTab === c.id ? ' page-tab--active' : ''}`}
                onClick={() => setActiveTab(c.id)}
              >
                <span className="page-tab__label">{c.denumire}</span>
                <span className="page-tab__close" onClick={e => { e.stopPropagation(); closeTab(c.id) }}>×</span>
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="page-body">
          <div className="table-card">
            {activeTab !== 'list' && activeClient ? (
              <ClientView
                client={activeClient}
                embedded
                onClose={() => setActiveTab('list')}
                onEdit={() => setModal(activeClient)}
                onDelete={() => setDeleteConf(activeClient)}
                onSaveNotite={async (notite) => {
                  if (!workspaceId) return
                  await update(workspaceId, activeClient.id, { notite })
                  toast('Notițe salvate', 'ok')
                }}
              />
            ) : (
              <>
                {loading && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
                    <span className="spin spin-dark" style={{ width: 24, height: 24 }} />
                  </div>
                )}
                {!loading && processedClients.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-state-icon">📋</div>
                    <div className="empty-state-text">
                      {searchQuery || hasActiveFiltersOrSort
                        ? 'Niciun client nu corespunde filtrelor active.'
                        : 'Nu există clienți înregistrați.'}
                    </div>
                    {!searchQuery && !hasActiveFiltersOrSort && (
                      <button className="btn btn-primary" onClick={() => setModal('add')}>
                        + Adaugă primul client
                      </button>
                    )}
                    {hasActiveFiltersOrSort && (
                      <button className="btn btn-ghost btn-sm" onClick={resetAll}>
                        Resetează filtrele
                      </button>
                    )}
                  </div>
                )}
                {!loading && processedClients.length > 0 && (
                  <ClientTable
                    clients={processedClients}
                    rawClients={displayed}
                    sortState={sortState}
                    colFilters={colFilters}
                    hiddenCols={hiddenCols}
                    onColSort={col => dispatchSort({ type: 'TOGGLE', col })}
                    onFilterToggle={handleFilterToggle}
                    onSelectAllFilter={handleSelectAllFilter}
                    onClearFilter={handleClearFilter}
                    onView={openTab}
                    onEdit={c => setModal(c)}
                    onDelete={setDeleteConf}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <ClientModal
          initial={typeof modal === 'object' ? modal : null}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {deleteConf && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setDeleteConf(null)}>
          <div className="modal-box modal-box--sm">
            <div className="modal-head">
              <span className="modal-title">Șterge client</span>
              <button className="modal-close" onClick={() => setDeleteConf(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--s600)', fontSize: '.9375rem' }}>
                Ești sigur că vrei să ștergi <strong>{deleteConf.denumire}</strong>? Acțiunea nu poate fi anulată.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeleteConf(null)}>Anulează</button>
              <button className="btn" style={{ background: 'var(--r500)', color: '#fff' }} onClick={handleDelete}>
                Șterge
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ── Virtual table ── */
interface TableProps {
  clients: Client[]
  rawClients: Client[]
  sortState: SortState
  colFilters: Record<string, string[]>
  hiddenCols: Set<string>
  onColSort: (key: string) => void
  onFilterToggle: (key: string, val: string) => void
  onSelectAllFilter: (key: string) => void
  onClearFilter: (key: string) => void
  onView: (c: Client) => void
  onEdit: (c: Client) => void
  onDelete: (c: Client) => void
}

function ClientTable({
  clients, rawClients, sortState, colFilters, hiddenCols,
  onColSort, onFilterToggle, onSelectAllFilter, onClearFilter,
  onView, onEdit, onDelete
}: TableProps) {
  const [height, setHeight] = useState(500)
  const containerRef = useRef<HTMLDivElement>(null)

  /* Column order */
  const [colOrder, setColOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('samwera-col-order')
      if (raw) {
        const saved = JSON.parse(raw) as string[]
        const allKeys = COLUMNS.map(c => c.key)
        const merged = [
          ...saved.filter(k => allKeys.includes(k)),
          ...allKeys.filter(k => !saved.includes(k)),
        ]
        return merged
      }
    } catch {}
    return COLUMNS.map(c => c.key)
  })

  /* Column widths */
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('samwera-col-widths')
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })
  const colWidthsRef = useRef(colWidths)

  /* Drag-and-drop reorder */
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  /* Resize */
  const resizingRef = useRef(false)

  /* Scroll sync */
  const mainListRef = useRef<FixedSizeList>(null)
  const actionsListRef = useRef<FixedSizeList>(null)
  const mainScrollOffsetRef = useRef(0)
  const actionsColCleanupRef = useRef<(() => void) | null>(null)

  /* Filter dropdown */
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const [filterPos, setFilterPos] = useState<{ top: number; left: number } | null>(null)
  const filterDdRef = useRef<HTMLDivElement>(null)

  /* Observe container height */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      setHeight(entries[0]?.contentRect.height ?? 500)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  /* Close filter on click-outside or scroll */
  useEffect(() => {
    if (!openFilter) return
    const onMouse = (e: MouseEvent) => {
      if (!filterDdRef.current?.contains(e.target as Node)) {
        setOpenFilter(null); setFilterPos(null)
      }
    }
    const onScroll = () => { setOpenFilter(null); setFilterPos(null) }
    document.addEventListener('mousedown', onMouse)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      document.removeEventListener('mousedown', onMouse)
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [openFilter])

  /* Computed columns */
  const colMap = useMemo(() => new Map(COLUMNS.map(c => [c.key, c])), [])

  const orderedVisibleColumns = useMemo(() => {
    return colOrder
      .map(key => colMap.get(key))
      .filter((col): col is ColDef => !!col && (!!col.fixed || !hiddenCols.has(col.key)))
  }, [colOrder, hiddenCols, colMap])

  const getW = useCallback((key: string): number => {
    return colWidths[key] ?? colMap.get(key)?.width ?? 150
  }, [colWidths, colMap])

  const totalDataW = useMemo(
    () => orderedVisibleColumns.reduce((s, c) => s + getW(c.key), 0),
    [orderedVisibleColumns, getW]
  )

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
      localStorage.setItem('samwera-col-widths', JSON.stringify(colWidthsRef.current))
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
      localStorage.setItem('samwera-col-order', JSON.stringify(next))
      return next
    })
    setDragCol(null)
  }

  const handleColDragEnd = () => { setDragCol(null); setDragOver(null) }

  /* Scroll sync */
  const handleListScroll = useCallback(({ scrollOffset }: { scrollOffset: number }) => {
    mainScrollOffsetRef.current = scrollOffset
    actionsListRef.current?.scrollTo(scrollOffset)
  }, [])

  const actionsColCbRef = useCallback((node: HTMLDivElement | null) => {
    actionsColCleanupRef.current?.()
    actionsColCleanupRef.current = null
    if (!node) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const list = mainListRef.current
      if (!list) return
      const max = (list.props.itemCount as number) * (list.props.itemSize as number) - (list.props.height as number)
      mainListRef.current?.scrollTo(Math.max(0, Math.min(max, mainScrollOffsetRef.current + e.deltaY)))
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    actionsColCleanupRef.current = () => node.removeEventListener('wheel', onWheel)
  }, [])

  /* Filter button click */
  const handleFilterBtnClick = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (openFilter === key) { setOpenFilter(null); setFilterPos(null); return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const dropW = 240
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - dropW - 8))
    setFilterPos({ top: rect.bottom + 4, left })
    setOpenFilter(key)
  }

  /* Rows */
  const DataRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const c = clients[index]
    return (
      <div
        className="vrow"
        style={{ ...style, width: totalDataW, display: 'flex', alignItems: 'center' }}
        onClick={() => onView(c)}
      >
        {orderedVisibleColumns.map(col => (
          <div
            key={col.key}
            className={`td${col.key === 'denumire' ? ' td-bold' : col.key === 'tva' || col.key === 'statutFiscal' || col.key === 'asoc' ? '' : ' td-muted'}`}
            style={{ width: getW(col.key), flexShrink: 0 }}
            title={col.key === 'caenCod' ? c.caenDescriere : undefined}
          >
            {renderCellContent(c, col.key)}
          </div>
        ))}
      </div>
    )
  }, [clients, orderedVisibleColumns, totalDataW, getW, onView])

  const ActionRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const c = clients[index]
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '.25rem', padding: '0 .5rem', borderBottom: '1px solid var(--s100)' }}>
        <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); onView(c) }} title="Vizualizare">👁</button>
        <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); onEdit(c) }} title="Editare">✏️</button>
        <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); onDelete(c) }} title="Șterge" style={{ color: 'var(--r500)' }}>🗑️</button>
      </div>
    )
  }, [clients, onView, onEdit, onDelete])

  const minW = Math.max(totalDataW, 400)

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {/* Data panel */}
      <div className="table-data-panel">
        <div className="table-header" style={{ width: minW }}>
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
                style={{ width: getW(col.key) }}
                onClick={() => col.sortable && !resizingRef.current && onColSort(col.key)}
                draggable={!isFixed}
                onDragStart={!isFixed ? e => handleColDragStart(e, col.key) : undefined}
                onDragOver={!isFixed ? e => handleColDragOver(e, col.key) : undefined}
                onDrop={!isFixed ? e => handleColDrop(e, col.key) : undefined}
                onDragEnd={!isFixed ? handleColDragEnd : undefined}
              >
                <span className="th__label">{col.label}</span>
                {col.sortable && (
                  <span className="th__sort-icon">
                    {isActive ? (sortState.dir === 'asc' ? '▴' : '▾') : ''}
                  </span>
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
                <div
                  className="col-resize-handle"
                  onMouseDown={e => startResize(e, col.key)}
                  onClick={e => e.stopPropagation()}
                />
              </div>
            )
          })}
        </div>

        <FixedSizeList
          ref={mainListRef}
          height={height - HEADER_H}
          itemCount={clients.length}
          itemSize={ROW_H}
          width={minW}
          outerElementType={VirtualListOuter}
          onScroll={handleListScroll}
        >
          {DataRow}
        </FixedSizeList>
      </div>

      {/* Pinned actions column */}
      <div ref={actionsColCbRef} className="table-actions-col" style={{ width: ACTION_W }}>
        <div className="action-header" />
        <FixedSizeList
          ref={actionsListRef}
          height={height - HEADER_H}
          itemCount={clients.length}
          itemSize={ROW_H}
          width={ACTION_W}
          outerElementType={ActionsListOuter}
        >
          {ActionRow}
        </FixedSizeList>
      </div>

      {/* Filter dropdown (fixed position) */}
      {openFilter && filterPos && (() => {
        const col = colMap.get(openFilter)!
        const opts = getUniqueValues(rawClients, openFilter)
        const selected = colFilters[openFilter] ?? []
        const allSel = opts.length > 0 && opts.every(v => selected.includes(v))
        return (
          <div
            ref={filterDdRef}
            className="col-filter-dd"
            style={{ position: 'fixed', top: filterPos.top, left: filterPos.left, zIndex: 600 }}
          >
            <div className="col-filter-dd__head">
              <span>{col?.label}</span>
              <button onClick={() => { onClearFilter(openFilter); setOpenFilter(null) }}>Golește filtrul</button>
            </div>
            <div className="col-filter-dd__list">
              <label
                className={`col-filter-dd__opt col-filter-dd__opt--all${allSel ? ' col-filter-dd__opt--on' : ''}`}
              >
                <input type="checkbox" checked={allSel} onChange={() => onSelectAllFilter(openFilter)} />
                <span>Selectează tot</span>
              </label>
              {opts.map(val => {
                const isSel = selected.includes(val)
                const isEmpty = val === EMPTY_PLACEHOLDER
                return (
                  <label
                    key={val}
                    className={`col-filter-dd__opt${isSel ? ' col-filter-dd__opt--on' : ''}${isEmpty ? ' col-filter-dd__opt--empty' : ''}`}
                  >
                    <input type="checkbox" checked={isSel} onChange={() => onFilterToggle(openFilter, val)} />
                    <span>{val}</span>
                  </label>
                )
              })}
              {opts.length === 0 && (
                <div className="col-filter-dd__empty">Nicio valoare</div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
