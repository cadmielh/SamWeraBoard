import { useState, useMemo, useCallback, useReducer, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Dosar, DosarInput } from '../types'
import { obiecteCereriiText, resolveFacturareConfig } from '../types'
import { useDosare, isDosarArhivat } from '../lib/dosare'
import { useSarcini } from '../lib/sarcini'
import { buildSarcinaForDosar } from '../lib/dosarSarcini'
import { useApp } from '../AppContext'
import DosarModal from '../components/DosarModal'
import DosarView from '../components/DosarView'
import DosarTable, { DosarColumnsPanel } from '../components/dosare/DosarTable'
import { applyFilters, applySort, sortReducer, getUniqueValues, EXTRA_COL_KEYS, getVisibleColumns } from '../components/dosare/dosarColumns'
import DosarStatsPanel from '../components/dosare/DosarStatsPanel'
import ArchivedDosareSection from '../components/dosare/ArchivedDosareSection'
import { LUNI, type StatsPeriod } from '../lib/dosareStats'
import Modal from '../components/Modal'

type ModalState = 'add' | Dosar | null
type Tab = 'lista' | string

const STATS_PERIOD_OPTIONS: { key: StatsPeriod; label: string }[] = [
  { key: 'luna', label: 'Lună' },
  { key: 'trimestru', label: 'Trimestru' },
  { key: 'an', label: 'An' },
]

export default function DosarePage() {
  const { user, activeWorkspace, toast, hasFeature } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const samiAdiEnabled = hasFeature('facturareSamiAdi')
  const columns = useMemo(() => getVisibleColumns(samiAdiEnabled), [samiAdiEnabled])
  // Memoizat pe identitatea config-ului salvat — resolveFacturareConfig()
  // creează un obiect nou la fiecare apel, iar facturareConfig e folosit ca
  // dependință de useEffect în DosarStatsPanel; fără memo, ar re-declanșa
  // fetch-uri de statistici la fiecare render al acestei pagini.
  const facturareConfig = useMemo(
    () => resolveFacturareConfig(activeWorkspace?.facturareConfig),
    [activeWorkspace?.facturareConfig]
  )

  const { dosare, loading, hasMore, loadingMore, loadMore, add, update, remove } = useDosare(workspaceId)
  const sarciniCtx = useSarcini(workspaceId)

  const [tab, setTab] = useState<Tab>('lista')
  const [searchQuery, setSearchQuery] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [deleteConf, setDeleteConf] = useState<Dosar | null>(null)
  // Ștergere amânată (Undo din toast) — vezi handleDelete.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const [prefillClient, setPrefillClient] = useState<{ id: string; denumire: string } | undefined>(undefined)

  // Incrementat după o arhivare/restaurare reușită — ArchivedDosareSection
  // folosește un hook one-shot, nu live, deci fără asta noul item ar apărea
  // doar la reload de pagină.
  const [archiveRefreshKey, setArchiveRefreshKey] = useState(0)
  // Cardurile din DosarStatsPanel fac propriile citiri Firestore (pe
  // perioadă), separate de `dosare` — nu se actualizează singure la o
  // adăugare/editare/ștergere. Incrementat la orice mutație, forțează
  // panoul să refacă citirea, ca la archiveRefreshKey mai jos.
  const [statsRefreshKey, setStatsRefreshKey] = useState(0)

  /* Perioadă + lună navigate pentru statisticile din header — selectorul e
     afișat acolo (nu în DosarStatsPanel), ca să nu mai ocupe un rând separat.
     Luna/anul rămân ancora pentru toate perioadele navigabile (T = Math.floor
     (month0/3)); navigarea sare din 3/12 în 3/12 luni în modul trimestru/an,
     e ignorată la total. */
  const now = new Date()
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>('luna')
  const [year, setYear] = useState(now.getFullYear())
  const [month0, setMonth0] = useState(now.getMonth())

  const shiftStatsMonth = (delta: number) => {
    const total = year * 12 + month0 + delta
    setYear(Math.floor(total / 12))
    setMonth0(((total % 12) + 12) % 12)
  }
  const statsStep = statsPeriod === 'an' ? 12 : statsPeriod === 'trimestru' ? 3 : 1
  const goPrevStats = () => shiftStatsMonth(-statsStep)
  const goNextStats = () => shiftStatsMonth(statsStep)

  const statsLabel = statsPeriod === 'total'
    ? 'Toate datele'
    : statsPeriod === 'an'
      ? `${year}`
      : statsPeriod === 'trimestru'
        ? `T${Math.floor(month0 / 3) + 1} ${year}`
        : `${LUNI[month0]} ${year}`

  /* Tab-uri per dosar deschis — mai multe dosare pot fi deschise simultan,
     ca la Clienți; „lista" rămâne tab-ul static implicit. */
  const [openDosarIds, setOpenDosarIds] = useState<string[]>([])
  // Dosare deschise ca tab dar absente din pagina curentă de `dosare` (ex.
  // unul arhivat, deschis direct din ArchivedDosareSection — care are propria
  // interogare, separată de paginarea listei principale). Fallback la
  // openDosare de mai jos; patch-uite manual în onSaveField mai jos, ca update()
  // din useDosare (care scrie doar în `dosare`) să nu le lase desincronizate.
  const [extraDosare, setExtraDosare] = useState<Record<string, Dosar>>({})

  const openDosare = useMemo(
    () => openDosarIds
      .map(id => dosare.find(d => d.id === id) ?? extraDosare[id])
      .filter(d => d && !pendingDeleteIds.has(d.id)) as Dosar[],
    [openDosarIds, dosare, extraDosare, pendingDeleteIds]
  )

  const openTab = useCallback((d: Dosar) => {
    setOpenDosarIds(prev => prev.includes(d.id) ? prev : [...prev, d.id])
    setTab(d.id)
  }, [])

  // Deschide un dosar din arhivă — reține obiectul complet în extraDosare,
  // fiindcă useArchivedDosare nu partajează pagina cu useDosare.
  const openArchivedTab = useCallback((d: Dosar) => {
    setExtraDosare(prev => ({ ...prev, [d.id]: d }))
    openTab(d)
  }, [openTab])

  const closeTab = useCallback((id: string) => {
    setOpenDosarIds(prev => prev.filter(x => x !== id))
    setTab(prev => prev === id ? 'lista' : prev)
    setExtraDosare(prev => {
      if (!(id in prev)) return prev
      const next = { ...prev }; delete next[id]; return next
    })
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tab !== 'lista') setTab('lista')
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [tab])

  // Deep-link din ClientView: ?open=<dosarId> deschide direct fișa acelui
  // dosar (ca tab nou); ?newForClient=<id>&denumire=<nume> deschide
  // formularul de creare cu clientul deja ales — ambele consumate o
  // singură dată, la montare.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const openId = searchParams.get('open')
    const newForClient = searchParams.get('newForClient')
    const denumire = searchParams.get('denumire')
    if (!openId && !newForClient) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (openId) { setOpenDosarIds(prev => prev.includes(openId) ? prev : [...prev, openId]); setTab(openId) }
    if (newForClient && denumire) { setPrefillClient({ id: newForClient, denumire }); setModal('add') }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('open'); next.delete('newForClient'); next.delete('denumire')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [sortState, dispatchSort] = useReducer(sortReducer, { col: null, dir: 'asc' })
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('samwera-dosare-hidden-cols')
      if (raw) {
        const saved = new Set(JSON.parse(raw) as string[])
        // Migrare — coloanele adăugate ulterior (Certificat Constatator, Client
        // Adi, Semnătură electronică) trebuie să rămână ascunse implicit și
        // pentru userii cu preferințe salvate dinainte de introducerea lor, nu
        // doar pentru userii noi (care le primesc ascunse din EXTRA_COL_KEYS).
        const migrationKey = 'samwera-dosare-hidden-cols-migrated-v2'
        if (!localStorage.getItem(migrationKey)) {
          for (const k of ['certificatConstatator', 'esteClientAdi', 'semnaturaElectronica']) saved.add(k)
          localStorage.setItem('samwera-dosare-hidden-cols', JSON.stringify([...saved]))
          localStorage.setItem(migrationKey, '1')
        }
        return saved
      }
    } catch { /* localStorage indisponibil sau valoare coruptă — folosim implicitul */ }
    return new Set(EXTRA_COL_KEYS)
  })
  const [showColsPanel, setShowColsPanel] = useState(false)

  const displayed = useMemo(() => {
    const active = dosare.filter(d => !isDosarArhivat(d) && !pendingDeleteIds.has(d.id))
    const q = searchQuery.trim().toLowerCase()
    if (!q) return active
    return active.filter(d =>
      (d.clientDenumire || d.clientDenumireLibera || '').toLowerCase().includes(q) ||
      obiecteCereriiText(d.obiecteCererii).toLowerCase().includes(q) ||
      d.nrInregistrareDosar.toLowerCase().includes(q)
    )
  }, [dosare, searchQuery, pendingDeleteIds])

  const processedDosare = useMemo(() => {
    const filtered = applyFilters(displayed, colFilters, facturareConfig)
    return applySort(filtered, sortState.col, sortState.dir, facturareConfig)
  }, [displayed, colFilters, sortState, facturareConfig])

  const hasActiveFiltersOrSort = Object.values(colFilters).some(v => v.length > 0) || sortState.col !== null

  const viewing = tab !== 'lista'
    ? openDosare.find(d => d.id === tab) ?? null
    : null

  const toggleColVisibility = useCallback((key: string) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      localStorage.setItem('samwera-dosare-hidden-cols', JSON.stringify([...next]))
      return next
    })
  }, [])

  const showAllColumns = useCallback(() => {
    localStorage.setItem('samwera-dosare-hidden-cols', JSON.stringify([]))
    setHiddenCols(new Set())
  }, [])

  const hideAllColumns = useCallback(() => {
    const next = new Set(columns.filter(c => !c.fixed).map(c => c.key))
    localStorage.setItem('samwera-dosare-hidden-cols', JSON.stringify([...next]))
    setHiddenCols(next)
  }, [columns])

  const handleFilterToggle = useCallback((key: string, val: string) => {
    setColFilters(prev => {
      const curr = prev[key] ?? []
      const next = curr.includes(val) ? curr.filter(v => v !== val) : [...curr, val]
      return { ...prev, [key]: next }
    })
  }, [])

  const handleSelectAllFilter = useCallback((key: string) => {
    const all = getUniqueValues(displayed, key, facturareConfig)
    setColFilters(prev => {
      const curr = prev[key] ?? []
      const allSelected = all.length > 0 && all.every(v => curr.includes(v))
      return { ...prev, [key]: allSelected ? [] : all }
    })
  }, [displayed, facturareConfig])

  const handleClearFilter = useCallback((key: string) => {
    setColFilters(prev => ({ ...prev, [key]: [] }))
  }, [])

  const resetAll = useCallback(() => {
    setColFilters({})
    dispatchSort({ type: 'RESET' })
  }, [])

  // Restaurare rapidă din arhivă — direct în „În lucru", fără a deschide
  // dosarul. Trece prin update() din useDosare (nu o scriere Firestore
  // directă), ca lista principală să se actualizeze imediat, la fel ca orice
  // altă editare de stadiu.
  const handleQuickRestore = useCallback(async (d: Dosar) => {
    if (!workspaceId) return
    await update(workspaceId, d.id, { stadiu: 'in_lucru' }, d)
    setExtraDosare(prev => prev[d.id] ? { ...prev, [d.id]: { ...prev[d.id], stadiu: 'in_lucru' } } : prev)
    setArchiveRefreshKey(k => k + 1)
    setStatsRefreshKey(k => k + 1)
    toast('Dosar restaurat — În lucru', 'ok')
  }, [workspaceId, update, toast])

  const handleSave = useCallback(async (data: DosarInput, creeazaSarcina: boolean) => {
    if (!workspaceId || !user) return
    if (modal && typeof modal === 'object') {
      await update(workspaceId, modal.id, data, modal)
      toast('Dosar actualizat', 'ok')
      setArchiveRefreshKey(k => k + 1)
      setStatsRefreshKey(k => k + 1)
      return
    }
    const dosarId = await add(workspaceId, data, user.uid)
    toast('Dosar adăugat', 'ok')
    setStatsRefreshKey(k => k + 1)
    if (creeazaSarcina && data.obiecteCererii.length > 0) {
      // Relația Dosar↔Sarcină e 1:N, citită din Sarcina.dosarId — nu mai
      // scriem înapoi un id pe Dosar. O singură sarcină combinată, cu toate
      // obiectele cererii listate în descriere — vezi buildSarcinaForDosar.
      await sarciniCtx.add(workspaceId, buildSarcinaForDosar(data, dosarId), user.uid)
    }
  }, [modal, workspaceId, user, add, update, sarciniCtx, toast])

  // Ștergere amânată — dosarul dispare imediat din UI (pendingDeleteIds,
  // filtrat în displayed/openDosare), dar scrierea reală în Firestore se
  // întâmplă abia când expiră toast-ul; "Anulează" doar scoate id-ul din
  // pendingDeleteIds — nimic n-a fost șters vreodată.
  const handleDelete = useCallback(() => {
    if (!deleteConf || !workspaceId) return
    const id = deleteConf.id
    const label = deleteConf.clientDenumire || deleteConf.clientDenumireLibera || 'dosarul'
    setPendingDeleteIds(prev => new Set(prev).add(id))
    if (tab === id) setTab('lista')
    setDeleteConf(null)
    toast(`Dosarul „${label}" a fost șters`, 'ok', {
      onExpire: async () => {
        try {
          await remove(workspaceId, id)
          setOpenDosarIds(prev => prev.filter(x => x !== id))
          setStatsRefreshKey(k => k + 1)
        } catch (err: unknown) {
          setPendingDeleteIds(prev => { const next = new Set(prev); next.delete(id); return next })
          toast((err as Error).message ?? 'Eroare la ștergerea dosarului', 'err')
        }
      },
      action: {
        label: 'Anulează',
        onClick: () => setPendingDeleteIds(prev => { const next = new Set(prev); next.delete(id); return next }),
      },
    })
  }, [deleteConf, workspaceId, remove, toast, tab])

  if (!workspaceId) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🗂️</div>
        <div className="empty-state-text">Selectați un spațiu de lucru pentru a vedea dosarele.</div>
      </div>
    )
  }

  return (
    <>
      <div className="page--data">
        <div className="page-top">
          <div className="page-header" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
            <div>
              <div className="page-title">Dosare</div>
              <div className="page-subtitle">Registrul dosarelor depuse la Registrul Comerțului (ONRC)</div>
            </div>
            <div style={{ justifySelf: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                {STATS_PERIOD_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`btn btn-xs ${statsPeriod === opt.key ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setStatsPeriod(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
                <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--s200)', margin: '0 .25rem' }} />
                <button
                  type="button"
                  className={`btn btn-xs ${statsPeriod === 'total' ? 'btn-slate' : 'btn-ghost'}`}
                  onClick={() => setStatsPeriod('total')}
                >
                  Total
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={goPrevStats}
                  disabled={statsPeriod === 'total'}
                  style={{ visibility: statsPeriod === 'total' ? 'hidden' : 'visible' }}
                >‹</button>
                <span style={{ fontWeight: 700, fontSize: '.9375rem', color: 'var(--s900)', minWidth: 120, textAlign: 'center' }}>
                  {statsLabel}
                </span>
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={goNextStats}
                  disabled={statsPeriod === 'total'}
                  style={{ visibility: statsPeriod === 'total' ? 'hidden' : 'visible' }}
                >›</button>
              </div>
            </div>
            <div className="page-actions" style={{ justifySelf: 'end' }}>
              <button className="btn btn-primary" onClick={() => { setPrefillClient(undefined); setModal('add') }}>+ Dosar nou</button>
            </div>
          </div>

          <DosarStatsPanel workspaceId={workspaceId} period={statsPeriod} year={year} month0={month0} facturareConfig={facturareConfig} samiAdiEnabled={samiAdiEnabled} refreshKey={statsRefreshKey} />
        </div>

        <div className="page-tabs page-tabs--lg">
          <button className={`page-tab${tab === 'lista' ? ' page-tab--active' : ''}`} onClick={() => setTab('lista')}>Listă</button>
          {openDosare.map(d => (
            <button
              key={d.id}
              className={`page-tab${tab === d.id ? ' page-tab--active' : ''}`}
              onClick={() => setTab(d.id)}
            >
              <span className="page-tab__label">{d.clientDenumire || d.clientDenumireLibera}</span>
              <span className="page-tab__close" onClick={e => { e.stopPropagation(); closeTab(d.id) }}>×</span>
            </button>
          ))}
        </div>

        {/* overflow:auto (nu :hidden, ca implicit .page-body) — necesar ca
            secțiunea de arhivă de mai jos să rămână accesibilă prin scroll
            odată extinsă, fără să comprime tabelul de sus. */}
        <div className="page-body" style={{ overflow: 'auto' }}>
          {tab === 'lista' && (
            <>
              <div className="toolbar" style={{ flexShrink: 0 }}>
                <div className="search-box">
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="var(--s400)" strokeWidth="2" strokeLinecap="round">
                    <circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" />
                  </svg>
                  <input placeholder="Caută după client, obiectul cererii, nr. dosar..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
                  )}
                </div>
              </div>

              <div className="table-controls" style={{ flexShrink: 0 }}>
                <span>
                  {loading
                    ? 'Se încarcă...'
                    : `${processedDosare.length}${processedDosare.length !== displayed.length ? ` / ${displayed.length}` : ''} dosar${displayed.length !== 1 ? 'e' : ''}`}
                  {searchQuery && ` · rezultate pentru „${searchQuery}"`}
                  {!searchQuery && hasMore && !loading && ' (nu toate sunt încărcate încă)'}
                </span>
                <div style={{ flex: 1 }} />
                {hasActiveFiltersOrSort && (
                  <button className="btn btn-ghost btn-sm" onClick={resetAll}>× Resetează filtre</button>
                )}
                <div style={{ position: 'relative' }}>
                  <button
                    className={`btn btn-ghost btn-sm${hiddenCols.size > 0 ? ' btn--cols-active' : ''}`}
                    onClick={() => setShowColsPanel(p => !p)}
                  >
                    Coloane{hiddenCols.size > 0 && <span className="cols-badge">{hiddenCols.size}</span>}
                  </button>
                  {showColsPanel && (
                    <DosarColumnsPanel
                      columns={columns}
                      hiddenCols={hiddenCols}
                      onToggle={toggleColVisibility}
                      onSelectAll={showAllColumns}
                      onDeselectAll={hideAllColumns}
                      onClose={() => setShowColsPanel(false)}
                    />
                  )}
                </div>
              </div>
            </>
          )}
          <div className="table-card" style={{ flex: '1 0 420px' }}>
            {viewing ? (
              <DosarView
                dosar={viewing}
                embedded
                onClose={() => setTab('lista')}
                onEdit={() => setModal(viewing)}
                onDelete={() => setDeleteConf(viewing)}
                onSaveField={async patch => {
                  try {
                    await update(workspaceId, viewing.id, patch, viewing)
                  } catch (err: unknown) {
                    toast((err as Error).message ?? 'Eroare la actualizarea dosarului', 'err')
                    return
                  }
                  // update() scrie optimist doar în `dosare` — un dosar deschis
                  // din arhivă (extraDosare) trebuie ținut la zi separat.
                  setExtraDosare(prev => prev[viewing.id]
                    ? { ...prev, [viewing.id]: { ...prev[viewing.id], ...patch } as Dosar }
                    : prev)
                  toast('Dosar actualizat', 'ok')
                  // Arhivarea depinde de stadiu ȘI facturat — dacă oricare
                  // s-a schimbat, semnalăm secțiunii de arhivă să se reîncarce.
                  if (patch.stadiu !== undefined || patch.facturat !== undefined) {
                    setArchiveRefreshKey(k => k + 1)
                  }
                  // Orice câmp editat inline poate afecta cardurile financiare
                  // (tarif, taxe, facturat, split Adi) — reîncărcăm întotdeauna.
                  setStatsRefreshKey(k => k + 1)
                }}
              />
            ) : (
              <>
                {loading && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
                    <span className="spin spin-dark" style={{ width: 24, height: 24 }} />
                  </div>
                )}
                {!loading && processedDosare.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-state-icon">🗂️</div>
                    <div className="empty-state-text">
                      {searchQuery || hasActiveFiltersOrSort ? 'Niciun dosar nu corespunde filtrelor active.' : 'Nu există dosare înregistrate.'}
                    </div>
                    {!searchQuery && !hasActiveFiltersOrSort && (
                      <button className="btn btn-primary" onClick={() => { setPrefillClient(undefined); setModal('add') }}>+ Adaugă primul dosar</button>
                    )}
                    {hasActiveFiltersOrSort && (
                      <button className="btn btn-ghost btn-sm" onClick={resetAll}>Resetează filtrele</button>
                    )}
                  </div>
                )}
                {!loading && processedDosare.length > 0 && (
                  <DosarTable
                    columns={columns}
                    dosare={processedDosare}
                    rawDosare={displayed}
                    sortState={sortState}
                    colFilters={colFilters}
                    hiddenCols={hiddenCols}
                    facturareConfig={facturareConfig}
                    onColSort={col => dispatchSort({ type: 'TOGGLE', col })}
                    onFilterToggle={handleFilterToggle}
                    onSelectAllFilter={handleSelectAllFilter}
                    onClearFilter={handleClearFilter}
                    onView={openTab}
                    onEdit={d => setModal(d)}
                    onDelete={d => setDeleteConf(d)}
                  />
                )}
                {!loading && !searchQuery && hasMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '.75rem', borderTop: '1px solid var(--s100)' }}>
                    <button className="btn btn-ghost btn-sm" disabled={loadingMore} onClick={() => loadMore(workspaceId)}>
                      {loadingMore ? 'Se încarcă...' : 'Încarcă mai multe dosare'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          {tab === 'lista' && <ArchivedDosareSection workspaceId={workspaceId} refreshKey={archiveRefreshKey} onOpenDosar={openArchivedTab} onRestore={handleQuickRestore} />}
        </div>
      </div>

      {modal && (
        <DosarModal
          initial={typeof modal === 'object' ? modal : null}
          onSave={handleSave}
          onClose={() => { setModal(null); setPrefillClient(undefined) }}
          prefillClient={prefillClient}
        />
      )}

      {deleteConf && (
        <Modal onClose={() => setDeleteConf(null)} className="modal-box--sm" ariaLabel="Șterge dosar">
          <div className="modal-head">
            <span className="modal-title">Șterge dosar</span>
            <button className="modal-close" onClick={() => setDeleteConf(null)}>×</button>
          </div>
          <div className="modal-body">
            <p style={{ color: 'var(--s600)', fontSize: '.9375rem' }}>
              Ești sigur că vrei să ștergi dosarul lui <strong>{deleteConf.clientDenumire || deleteConf.clientDenumireLibera}</strong> ({obiecteCereriiText(deleteConf.obiecteCererii)})?
            </p>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setDeleteConf(null)}>Anulează</button>
            <button className="btn" style={{ background: 'var(--r500)', color: '#fff' }} onClick={handleDelete}>Șterge</button>
          </div>
        </Modal>
      )}
    </>
  )
}
