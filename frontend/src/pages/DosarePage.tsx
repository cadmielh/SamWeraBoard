import { useState, useMemo, useCallback, useReducer, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Dosar, DosarInput } from '../types'
import { obiecteCereriiText, resolveFacturareConfig } from '../types'
import { useDosare, useArchivedDosare, isDosarArhivat, fetchAllDosare, fetchDosarById } from '../lib/dosare'
import { useSarcini } from '../lib/sarcini'
import { buildSarcinaForDosar } from '../lib/dosarSarcini'
import { useApp } from '../AppContext'
import { READ_ONLY_TITLE } from '../lib/billing'
import DosarModal from '../components/DosarModal'
import DosarView from '../components/DosarView'
import DosarTable, { DosarCardList, DosarColumnsPanel } from '../components/dosare/DosarTable'
import {
  applyFilters, applySort, sortReducer, getUniqueValues, EXTRA_COL_KEYS, getVisibleColumns,
  DATE_FIELD_OPTIONS, getDosarDateValue, getExportValue,
} from '../components/dosare/dosarColumns'
import DosarStatsPanel from '../components/dosare/DosarStatsPanel'
import IconExport from '../components/IconExport'
import { LUNI, type StatsPeriod, computeDosarStats, computeTarifStats, computeSumarLunar, buildDosarSummarySections } from '../lib/dosareStats'
import type { ExportColumnSpec } from '../lib/xlsxExport'
import ExportRangeDialog, { type ExportRangeResult } from '../components/export/ExportRangeDialog'
import Modal from '../components/Modal'
import NotificariBell from '../components/NotificariBell'
import { SkeletonRows } from '../components/Skeleton'
import { withViewTransition } from '../lib/viewTransition'
import { useIsMobile } from '../lib/useIsMobile'
import { useMobileBack } from '../lib/useMobileBack'
import { IconBack } from '../components/NavIcons'

type ModalState = 'add' | Dosar | null
/* Fila „active" = dosare în lucru (tot ce nu e arhivat), fila „incheiate" =
   fosta arhivă (stadiu documente_predate_client + facturat === true) — vezi
   isDosarArhivat/useArchivedDosare din lib/dosare.ts. Orice alt string = id
   de dosar deschis ca tab, ca la Clienți. */
type ListTab = 'active' | 'incheiate'
type Tab = ListTab | string
const isListTab = (t: Tab): t is ListTab => t === 'active' || t === 'incheiate'

const STATS_PERIOD_OPTIONS: { key: StatsPeriod; label: string }[] = [
  { key: 'luna', label: 'Lună' },
  { key: 'trimestru', label: 'Trimestru' },
  { key: 'an', label: 'An' },
]

export default function DosarePage() {
  const { user, activeWorkspace, toast, hasFeature, canEdit } = useApp()
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

  const [tab, setTab] = useState<Tab>('active')
  // Fila listă la care se revine la închiderea unui dosar deschis (Escape,
  // ×, ștergere) — reținută la deschidere, ca un dosar deschis din „Dosare
  // încheiate" să nu te arunce înapoi în „Dosare în lucru".
  const [returnTab, setReturnTab] = useState<ListTab>('active')
  const [searchQuery, setSearchQuery] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [deleteConf, setDeleteConf] = useState<Dosar | null>(null)
  // Ștergere amânată (Undo din toast) — vezi handleDelete.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const [prefillClient, setPrefillClient] = useState<{ id: string; denumire: string } | undefined>(undefined)

  // Incrementat după o editare care poate schimba componența filei „Dosare
  // încheiate" (stadiu/facturat) — useArchivedDosare e one-shot, nu live,
  // deci fără asta un dosar proaspăt încheiat/redeschis n-ar apărea/dispărea
  // din filă decât la reload de pagină.
  const [incheiateRefreshKey, setIncheiateRefreshKey] = useState(0)
  const { dosare: dosareIncheiate, loading: loadingIncheiate, hasMore: hasMoreIncheiate, loadingMore: loadingMoreIncheiate, loadMore: loadMoreIncheiate } = useArchivedDosare(workspaceId, incheiateRefreshKey)
  // Cardurile din DosarStatsPanel fac propriile citiri Firestore (pe
  // perioadă), separate de `dosare` — nu se actualizează singure la o
  // adăugare/editare/ștergere. Incrementat la orice mutație, forțează
  // panoul să refacă citirea, ca la incheiateRefreshKey mai jos.
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
     ca la Clienți; „active"/„incheiate" rămân filele-listă statice. */
  const [openDosarIds, setOpenDosarIds] = useState<string[]>([])
  // Dosare deschise ca tab dar absente din pagina curentă a listei din care
  // au fost deschise (ex. unul din „Dosare încheiate", care are propria
  // interogare/paginare, separată de cea a listei „active"). Fallback la
  // openDosare de mai jos; patch-uit manual în onSaveField mai jos, ca
  // update() din useDosare (care scrie doar în `dosare`) să nu-l lase
  // desincronizat.
  const [extraDosare, setExtraDosare] = useState<Record<string, Dosar>>({})

  const openDosare = useMemo(
    () => openDosarIds
      .map(id => dosare.find(d => d.id === id) ?? extraDosare[id] ?? dosareIncheiate.find(d => d.id === id))
      .filter(d => d && !pendingDeleteIds.has(d.id)) as Dosar[],
    [openDosarIds, dosare, extraDosare, dosareIncheiate, pendingDeleteIds]
  )

  const openTab = useCallback((d: Dosar) => {
    setReturnTab(prev => (isListTab(tab) ? (tab as ListTab) : prev))
    setExtraDosare(prev => ({ ...prev, [d.id]: d }))
    // Deschiderea dosarului trece printr-o tranziție scurtă a browserului (lista → dosarul).
    withViewTransition(() => {
      setOpenDosarIds(prev => prev.includes(d.id) ? prev : [...prev, d.id])
      setTab(d.id)
    })
  }, [tab])

  const closeTab = useCallback((id: string) => {
    setOpenDosarIds(prev => prev.filter(x => x !== id))
    setTab(prev => prev === id ? returnTab : prev)
    setExtraDosare(prev => {
      if (!(id in prev)) return prev
      const next = { ...prev }; delete next[id]; return next
    })
  }, [returnTab])

  // Pe telefon dosarul ocupă tot ecranul, fără file: „Înapoi” (și gestul telefonului) revine la lista din care a venit.
  const isMobile = useIsMobile()
  const mobileDetail = isMobile && !isListTab(tab)
  const mobileBack = useMobileBack(!isListTab(tab), () => {
    withViewTransition(() => { setOpenDosarIds([]); setTab(returnTab) })
  })
  // Pe telefon statisticile ocupă aproape un ecran: stau restrânse sub un singur rând, deschise la cerere.
  const [mobileStatsOpen, setMobileStatsOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isListTab(tab)) setTab(returnTab)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [tab, returnTab])

  // Deep-link din ClientView și din alerte: ?open=<dosarId> deschide direct fișa
  // acelui dosar (ca tab nou); ?newForClient=<id>&denumire=<nume> deschide
  // formularul de creare cu clientul deja ales — ambele consumate o
  // singură dată (și la un link nou, ex. din clopoțel, cu pagina deja deschisă). Dosarul se citește după id, nu se caută în listă:
  // poate fi în afara primei pagini sau în „Dosare încheiate” (paginate separat);
  // ținut în extraDosare, ca un dosar deschis din „încheiate”.
  const [searchParams, setSearchParams] = useSearchParams()
  // Ultimul ?open= tratat — ca efectul rulat de două ori (StrictMode) să nu citească și să anunțe de două ori.
  const handledOpenRef = useRef<string | null>(null)
  useEffect(() => {
    const openId = searchParams.get('open')
    const newForClient = searchParams.get('newForClient')
    const denumire = searchParams.get('denumire')
    if (!openId && !newForClient) { handledOpenRef.current = null; return }
    if (!workspaceId) return // reîncearcă după ce se încarcă cabinetul
    if (openId && handledOpenRef.current !== openId) {
      handledOpenRef.current = openId
      fetchDosarById(workspaceId, openId).then(d => {
        if (!d) { toast('Dosarul nu mai există.', 'info'); return }
        setExtraDosare(prev => ({ ...prev, [d.id]: d }))
        setOpenDosarIds(prev => prev.includes(d.id) ? prev : [...prev, d.id])
        setTab(d.id)
      }).catch((err: unknown) => toast((err as Error).message ?? 'Eroare la deschiderea dosarului', 'err'))
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (newForClient && denumire) { setPrefillClient({ id: newForClient, denumire }); setModal('add') }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('open'); next.delete('newForClient'); next.delete('denumire')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, workspaceId])

  // Stare de sortare/filtrare — separată pe fiecare filă-listă, ca filtrele
  // aplicate în „Dosare în lucru" să nu se scurgă în „Dosare încheiate" și
  // invers. Coloanele vizibile (hiddenCols) rămân comune — e o preferință
  // vizuală, nu una legată de conținutul filei.
  const [sortState, dispatchSort] = useReducer(sortReducer, { col: null, dir: 'asc' })
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})
  const [sortStateInch, dispatchSortInch] = useReducer(sortReducer, { col: null, dir: 'asc' })
  const [colFiltersInch, setColFiltersInch] = useState<Record<string, string[]>>({})
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
  const [showExportDialog, setShowExportDialog] = useState<ListTab | null>(null)
  const [exporting, setExporting] = useState(false)

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

  const displayedIncheiate = useMemo(() => {
    const active = dosareIncheiate.filter(d => !pendingDeleteIds.has(d.id))
    const q = searchQuery.trim().toLowerCase()
    if (!q) return active
    return active.filter(d =>
      (d.clientDenumire || d.clientDenumireLibera || '').toLowerCase().includes(q) ||
      obiecteCereriiText(d.obiecteCererii).toLowerCase().includes(q) ||
      d.nrInregistrareDosar.toLowerCase().includes(q)
    )
  }, [dosareIncheiate, searchQuery, pendingDeleteIds])

  const processedDosare = useMemo(() => {
    const filtered = applyFilters(displayed, colFilters, facturareConfig)
    return applySort(filtered, sortState.col, sortState.dir, facturareConfig)
  }, [displayed, colFilters, sortState, facturareConfig])

  const processedDosareIncheiate = useMemo(() => {
    const filtered = applyFilters(displayedIncheiate, colFiltersInch, facturareConfig)
    return applySort(filtered, sortStateInch.col, sortStateInch.dir, facturareConfig)
  }, [displayedIncheiate, colFiltersInch, sortStateInch, facturareConfig])

  const hasActiveFiltersOrSort = Object.values(colFilters).some(v => v.length > 0) || sortState.col !== null
  const hasActiveFiltersOrSortInch = Object.values(colFiltersInch).some(v => v.length > 0) || sortStateInch.col !== null

  const viewing = !isListTab(tab)
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

  const handleFilterToggleInch = useCallback((key: string, val: string) => {
    setColFiltersInch(prev => {
      const curr = prev[key] ?? []
      const next = curr.includes(val) ? curr.filter(v => v !== val) : [...curr, val]
      return { ...prev, [key]: next }
    })
  }, [])

  const handleSelectAllFilterInch = useCallback((key: string) => {
    const all = getUniqueValues(displayedIncheiate, key, facturareConfig)
    setColFiltersInch(prev => {
      const curr = prev[key] ?? []
      const allSelected = all.length > 0 && all.every(v => curr.includes(v))
      return { ...prev, [key]: allSelected ? [] : all }
    })
  }, [displayedIncheiate, facturareConfig])

  const handleClearFilterInch = useCallback((key: string) => {
    setColFiltersInch(prev => ({ ...prev, [key]: [] }))
  }, [])

  const resetAllInch = useCallback(() => {
    setColFiltersInch({})
    dispatchSortInch({ type: 'RESET' })
  }, [])

  const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  /** Exportă .xlsx cu toate coloanele existente pentru workspace (inclusiv ascunse —
   * doar cele samiAdiOnly sunt omise dacă feature-ul nu e activ), peste TOATE dosarele
   * workspace-ului (vezi fetchAllDosare), filtrate exact ca tab-ul curent (filtre pe
   * coloană + opțional căutarea text), restricționate la intervalul ales pe câmpul de
   * dată ales. Foaia „Sumar" se calculează pe acel set exact (bounds=null — intervalul
   * a fost deja aplicat mai sus). */
  const handleExportDosare = useCallback(async (tabKind: ListTab, { dateField, start, end, respectSearch, selectedColumnKeys }: ExportRangeResult) => {
    if (!workspaceId) return
    setExporting(true)
    try {
      // exceljs e o dependență mare, descărcată doar la nevoie (export e o acțiune rară) —
      // niciun import static al ei nu trebuie să ajungă în bundle-ul principal al paginii.
      const { exportRowsToXlsx } = await import('../lib/xlsxExport')
      const all = await fetchAllDosare(workspaceId)
      const tabFiltered = tabKind === 'active' ? all.filter(d => !isDosarArhivat(d)) : all.filter(isDosarArhivat)
      const filters = tabKind === 'active' ? colFilters : colFiltersInch
      const colFilteredDosare = applyFilters(tabFiltered, filters, facturareConfig)

      const q = searchQuery.trim().toLowerCase()
      const searchFiltered = respectSearch && q
        ? colFilteredDosare.filter(d =>
          (d.clientDenumire || d.clientDenumireLibera || '').toLowerCase().includes(q) ||
          obiecteCereriiText(d.obiecteCererii).toLowerCase().includes(q) ||
          d.nrInregistrareDosar.toLowerCase().includes(q))
        : colFilteredDosare

      const ranged = searchFiltered.filter(d => {
        const dt = getDosarDateValue(d, dateField)
        return dt !== null && dt >= start && dt < end
      })

      const dosarStats = computeDosarStats(ranged)
      const tarifStats = computeTarifStats(ranged, null)
      const sumarLunar = samiAdiEnabled ? computeSumarLunar(ranged.filter(d => d.facturat), facturareConfig) : null

      const selectedKeySet = new Set(selectedColumnKeys)
      const exportColumns: ExportColumnSpec<Dosar>[] = columns.filter(col => selectedKeySet.has(col.key)).map(col => ({
        key: col.key, label: col.label, width: col.width, type: col.exportType,
        getValue: (d: Dosar) => getExportValue(d, col.key, facturareConfig),
      }))

      const tabLabel = tabKind === 'active' ? 'in-lucru' : 'incheiate'
      await exportRowsToXlsx({
        filename: `dosare_${tabLabel}_${isoLocal(start)}_${isoLocal(new Date(end.getTime() - 86400000))}.xlsx`,
        sheetName: 'Dosare',
        columns: exportColumns,
        rows: ranged,
        summary: { sheetName: 'Sumar', sections: buildDosarSummarySections(dosarStats, tarifStats, sumarLunar) },
      })
      setShowExportDialog(null)
    } finally {
      setExporting(false)
    }
  }, [workspaceId, colFilters, colFiltersInch, facturareConfig, searchQuery, samiAdiEnabled, columns])

  const handleSave = useCallback(async (data: DosarInput, creeazaSarcina: boolean) => {
    if (!workspaceId || !user) return
    if (modal && typeof modal === 'object') {
      await update(workspaceId, modal.id, data, modal)
      toast('Dosar actualizat', 'ok')
      setIncheiateRefreshKey(k => k + 1)
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
  // filtrat în displayed/displayedIncheiate/openDosare), dar scrierea reală
  // în Firestore se întâmplă abia când expiră toast-ul; "Anulează" doar
  // scoate id-ul din pendingDeleteIds — nimic n-a fost șters vreodată.
  const handleDelete = useCallback(() => {
    if (!deleteConf || !workspaceId) return
    const id = deleteConf.id
    const label = deleteConf.clientDenumire || deleteConf.clientDenumireLibera || 'dosarul'
    setPendingDeleteIds(prev => new Set(prev).add(id))
    if (tab === id) setTab(returnTab)
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
  }, [deleteConf, workspaceId, remove, toast, tab, returnTab])

  if (!workspaceId) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🗂️</div>
        <div className="empty-state-text">Selectați un spațiu de lucru pentru a vedea dosarele.</div>
      </div>
    )
  }

  // Perioada statisticilor. Pe desktop stă în antet, pe un singur rând, ca antetul să aibă aceeași înălțime
  // ca pe celelalte pagini (titlul și clopoțelul nu „sar”); pe telefon, deasupra statisticilor deschise.
  const periodSelector = (
    <div style={{ justifySelf: 'center', display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
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
  )

  return (
    <>
      <div className={`page--data${mobileDetail ? ' page--mobile-detail' : ''}`}>
        {mobileDetail && viewing && (
          <div className="mobile-detail-bar">
            <button type="button" className="mobile-back" onClick={mobileBack}><IconBack /> Dosare</button>
          </div>
        )}
        <div className="page-top">
          <div className="page-header" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center' }}>
            <div>
              <div className="page-title">Dosare</div>
              <div className="page-subtitle">Registrul dosarelor depuse la Registrul Comerțului (ONRC)</div>
            </div>
            {isMobile ? <span /> : periodSelector}
            <div className="page-actions" style={{ justifySelf: 'end' }}>
              <button className="btn btn-ghost" onClick={() => setShowExportDialog(isListTab(tab) ? tab : returnTab)} aria-label="Exportă">
                <IconExport /> <span className="btn-label">Exportă</span>
              </button>
              <button className="btn btn-primary page-fab" onClick={() => { setPrefillClient(undefined); setModal('add') }} disabled={!canEdit} title={canEdit ? undefined : READ_ONLY_TITLE}>+ Dosar nou</button>
              <NotificariBell />
            </div>
          </div>

          {isMobile && (
            <button type="button" className="m-stats-toggle" aria-expanded={mobileStatsOpen} onClick={() => setMobileStatsOpen(o => !o)}>
              <span>Statistici · {statsLabel}</span>
              <span className={`sumar-lunar-chevron${mobileStatsOpen ? ' sumar-lunar-chevron--up' : ''}`} aria-hidden>▼</span>
            </button>
          )}
          {isMobile && mobileStatsOpen && <div className="m-stats-period">{periodSelector}</div>}
          {(!isMobile || mobileStatsOpen) && (
            <DosarStatsPanel workspaceId={workspaceId} period={statsPeriod} year={year} month0={month0} facturareConfig={facturareConfig} samiAdiEnabled={samiAdiEnabled} refreshKey={statsRefreshKey} />
          )}
        </div>

        <div className="page-tabs page-tabs--lg">
          <button className={`page-tab${tab === 'active' ? ' page-tab--active' : ''}`} onClick={() => withViewTransition(() => setTab('active'))}>Dosare în lucru</button>
          <button
            className={`page-tab${tab === 'incheiate' ? ' page-tab--active' : ''}`}
            onClick={() => withViewTransition(() => setTab('incheiate'))}
            data-tooltip='Ajung aici automat dosarele cu stadiul „Documente predate client" ȘI marcate „Facturat". Le lipsește oricare din cele două → rămân în „Dosare în lucru".'
          >
            Dosare încheiate
          </button>
          {!isMobile && openDosare.map(d => (
            <button
              key={d.id}
              className={`page-tab${tab === d.id ? ' page-tab--active' : ''}`}
              onClick={() => withViewTransition(() => setTab(d.id))}
            >
              <span className="page-tab__label">{d.clientDenumire || d.clientDenumireLibera}</span>
              <span className="page-tab__close" onClick={e => { e.stopPropagation(); closeTab(d.id) }}>×</span>
            </button>
          ))}
        </div>

        <div className="page-body" style={{ overflow: 'auto' }}>
          {isListTab(tab) && (
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
                {tab === 'active' ? (
                  <span>
                    {loading
                      ? 'Se încarcă...'
                      : `${processedDosare.length}${processedDosare.length !== displayed.length ? ` / ${displayed.length}` : ''} dosar${displayed.length !== 1 ? 'e' : ''}`}
                    {searchQuery && ` · rezultate pentru „${searchQuery}"`}
                    {!searchQuery && hasMore && !loading && ' (nu toate sunt încărcate încă)'}
                  </span>
                ) : (
                  <span>
                    {loadingIncheiate
                      ? 'Se încarcă...'
                      : `${processedDosareIncheiate.length}${processedDosareIncheiate.length !== displayedIncheiate.length ? ` / ${displayedIncheiate.length}` : ''} dosar${displayedIncheiate.length !== 1 ? 'e' : ''}`}
                    {searchQuery && ` · rezultate pentru „${searchQuery}"`}
                    {!searchQuery && hasMoreIncheiate && !loadingIncheiate && ' (nu toate sunt încărcate încă)'}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                {(tab === 'active' ? hasActiveFiltersOrSort : hasActiveFiltersOrSortInch) && (
                  <button className="btn btn-ghost btn-sm" onClick={tab === 'active' ? resetAll : resetAllInch}>× Resetează filtre</button>
                )}
                {/* Coloanele țin de tabel; pe telefon lista e din carduri. */}
                {!isMobile && (
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
                )}
              </div>
            </>
          )}
          {showExportDialog && (
            <ExportRangeDialog
              title={`Exportă dosare — ${showExportDialog === 'active' ? 'în lucru' : 'încheiate'}`}
              dateFieldOptions={DATE_FIELD_OPTIONS}
              showSearchToggle={searchQuery.trim().length > 0}
              columnOptions={columns.map(col => ({ key: col.key, label: col.label }))}
              busy={exporting}
              onConfirm={result => handleExportDosare(showExportDialog, result)}
              onClose={() => setShowExportDialog(null)}
            />
          )}
          <div className="table-card" style={{ flex: '1 0 420px' }}>
            {viewing ? (
              <DosarView
                dosar={viewing}
                embedded
                onClose={() => setTab(returnTab)}
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
                  // din „Dosare încheiate" trebuie ținut la zi separat.
                  setExtraDosare(prev => prev[viewing.id]
                    ? { ...prev, [viewing.id]: { ...prev[viewing.id], ...patch } as Dosar }
                    : prev)
                  toast('Dosar actualizat', 'ok')
                  // Orice câmp editat inline poate schimba ce apare în „Dosare
                  // încheiate" (nu doar stadiu/facturat, ci și restul
                  // coloanelor vizibile acolo) — reîncărcăm întotdeauna.
                  setIncheiateRefreshKey(k => k + 1)
                  // La fel și cardurile financiare (tarif, taxe, facturat,
                  // split Adi) — reîncărcăm întotdeauna.
                  setStatsRefreshKey(k => k + 1)
                }}
              />
            ) : tab === 'active' ? (
              <>
                {loading && (
                  <SkeletonRows />
                )}
                {!loading && processedDosare.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-state-icon">🗂️</div>
                    <div className="empty-state-text">
                      {searchQuery || hasActiveFiltersOrSort ? 'Niciun dosar nu corespunde filtrelor active.' : 'Nu există dosare înregistrate.'}
                    </div>
                    {!searchQuery && !hasActiveFiltersOrSort && (
                      <button className="btn btn-primary" onClick={() => { setPrefillClient(undefined); setModal('add') }} disabled={!canEdit} title={canEdit ? undefined : READ_ONLY_TITLE}>+ Adaugă primul dosar</button>
                    )}
                    {hasActiveFiltersOrSort && (
                      <button className="btn btn-ghost btn-sm" onClick={resetAll}>Resetează filtrele</button>
                    )}
                  </div>
                )}
                {!loading && processedDosare.length > 0 && isMobile && <DosarCardList dosare={processedDosare} onOpen={openTab} />}
                {!loading && processedDosare.length > 0 && !isMobile && (
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
            ) : (
              <>
                {loadingIncheiate && (
                  <SkeletonRows />
                )}
                {!loadingIncheiate && processedDosareIncheiate.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-state-icon">✅</div>
                    <div className="empty-state-text">
                      {searchQuery || hasActiveFiltersOrSortInch ? 'Niciun dosar nu corespunde filtrelor active.' : 'Nu există dosare încheiate.'}
                    </div>
                    {hasActiveFiltersOrSortInch && (
                      <button className="btn btn-ghost btn-sm" onClick={resetAllInch}>Resetează filtrele</button>
                    )}
                  </div>
                )}
                {!loadingIncheiate && processedDosareIncheiate.length > 0 && isMobile && <DosarCardList dosare={processedDosareIncheiate} onOpen={openTab} />}
                {!loadingIncheiate && processedDosareIncheiate.length > 0 && !isMobile && (
                  <DosarTable
                    columns={columns}
                    dosare={processedDosareIncheiate}
                    rawDosare={displayedIncheiate}
                    sortState={sortStateInch}
                    colFilters={colFiltersInch}
                    hiddenCols={hiddenCols}
                    facturareConfig={facturareConfig}
                    onColSort={col => dispatchSortInch({ type: 'TOGGLE', col })}
                    onFilterToggle={handleFilterToggleInch}
                    onSelectAllFilter={handleSelectAllFilterInch}
                    onClearFilter={handleClearFilterInch}
                    onView={openTab}
                    onEdit={d => setModal(d)}
                    onDelete={d => setDeleteConf(d)}
                  />
                )}
                {!loadingIncheiate && !searchQuery && hasMoreIncheiate && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '.75rem', borderTop: '1px solid var(--s100)' }}>
                    <button className="btn btn-ghost btn-sm" disabled={loadingMoreIncheiate} onClick={() => loadMoreIncheiate(workspaceId)}>
                      {loadingMoreIncheiate ? 'Se încarcă...' : 'Încarcă mai multe dosare'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
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
