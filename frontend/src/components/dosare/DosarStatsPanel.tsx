import { useState, useEffect } from 'react'
import { fetchDosareByMonth, fetchDosareByRange, fetchAllDosare, fetchDosareFacturate } from '../../lib/dosare'
import { computeDosarStats, computeSumarLunar, dataEfectivaFacturare, trendColor, type DosarMonthStats, type SumarLunarStats, type StatsPeriod } from '../../lib/dosareStats'
import type { Dosar, FacturareConfig } from '../../types'
import { DEFAULT_FACTURARE_CONFIG } from '../../types'
import SumarLunarCard from './SumarLunarCard'

interface Props {
  workspaceId: string
  period: StatsPeriod
  /** Lună/an navigate din header-ul DosarePage (navigatorul e afișat acolo,
   * lângă titlu). Pentru 'trimestru'/'an', luna/anul determină perioada din
   * care face parte; pentru 'total' sunt ignorate. */
  year: number
  month0: number
  facturareConfig?: FacturareConfig
  /** Incrementat de DosarePage la orice adăugare/editare/ștergere de dosar —
   * panoul face propriile citiri Firestore, separate de `dosare`, deci nu
   * s-ar actualiza altfel decât la schimbarea perioadei. */
  refreshKey?: number
}

const TREND_SUFFIX: Record<StatsPeriod, string> = {
  luna: 'vs. luna trecută',
  trimestru: 'vs. trimestrul trecut',
  an: 'vs. anul trecut',
  total: '',
}

const EMPTY_STATS: DosarMonthStats = {
  totalDosare: 0, facturate: 0, tarifClientTotal: 0, tarifClientFacturat: 0,
  profitSamiTotal: 0, profitSamiFacturat: 0, profitAdiTotal: 0, profitAdiFacturat: 0,
}

function fetchForPeriod(workspaceId: string, period: StatsPeriod, year: number, month0: number): [Promise<Dosar[]>, Promise<Dosar[]> | null] {
  if (period === 'total') return [fetchAllDosare(workspaceId), null]

  if (period === 'an') {
    const current = fetchDosareByRange(workspaceId, new Date(year, 0, 1), new Date(year + 1, 0, 1))
    const previous = fetchDosareByRange(workspaceId, new Date(year - 1, 0, 1), new Date(year, 0, 1))
    return [current, previous]
  }

  if (period === 'trimestru') {
    const q = Math.floor(month0 / 3)
    const current = fetchDosareByRange(workspaceId, new Date(year, q * 3, 1), new Date(year, q * 3 + 3, 1))
    const totalQ = year * 4 + q - 1
    const py = Math.floor(totalQ / 4)
    const pq = totalQ - py * 4
    const previous = fetchDosareByRange(workspaceId, new Date(py, pq * 3, 1), new Date(py, pq * 3 + 3, 1))
    return [current, previous]
  }

  const prevMonth0 = month0 === 0 ? 11 : month0 - 1
  const prevYear = month0 === 0 ? year - 1 : year
  return [
    fetchDosareByMonth(workspaceId, year, month0),
    fetchDosareByMonth(workspaceId, prevYear, prevMonth0),
  ]
}

/** Limitele [start, end) ale perioadei curent afișate — folosite să filtrăm
 * client-side dosarele facturate (vezi fetchDosareFacturate) după luna
 * facturării, în loc de `createdAt` ca restul cardurilor. `null` pentru
 * 'total' — nicio limită. */
function periodBounds(period: StatsPeriod, year: number, month0: number): [Date, Date] | null {
  if (period === 'total') return null
  if (period === 'an') return [new Date(year, 0, 1), new Date(year + 1, 0, 1)]
  if (period === 'trimestru') {
    const q = Math.floor(month0 / 3)
    return [new Date(year, q * 3, 1), new Date(year, q * 3 + 3, 1)]
  }
  return [new Date(year, month0, 1), new Date(year, month0 + 1, 1)]
}

const SUMAR_LUNAR_ID = 'sumar-lunar-card'

export default function DosarStatsPanel({ workspaceId, period, year, month0, facturareConfig = DEFAULT_FACTURARE_CONFIG, refreshKey = 0 }: Props) {
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState<DosarMonthStats | null>(null)
  const [previous, setPrevious] = useState<DosarMonthStats | null>(null)
  const [sumarLunar, setSumarLunar] = useState<SumarLunarStats | null>(null)
  const [sumarExpanded, setSumarExpanded] = useState(false)
  const [sumarHighlight, setSumarHighlight] = useState(false)

  // Link-ul "vezi cifra oficială" din cardul Profit Sami — expandează Sumarul
  // lunar, îl scrollează în vizor și îl evidențiază scurt, ca utilizatorul să
  // nu-l caute cu ochii pe pagină.
  const jumpToSumarLunar = () => {
    setSumarExpanded(true)
    document.getElementById(SUMAR_LUNAR_ID)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setSumarHighlight(true)
    setTimeout(() => setSumarHighlight(false), 1200)
  }

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)

    const [currentFetch, previousFetch] = fetchForPeriod(workspaceId, period, year, month0)
    const bounds = periodBounds(period, year, month0)

    Promise.all([currentFetch, previousFetch ?? Promise.resolve(null), fetchDosareFacturate(workspaceId)]).then(([curDosare, prevDosare, facturate]) => {
      if (cancelled) return
      setCurrent(computeDosarStats(curDosare, facturareConfig))
      setPrevious(prevDosare ? computeDosarStats(prevDosare, facturareConfig) : null)
      // Sumarul lunar (CAA reală, Barou) și butonul "vezi oficial" se rapor-
      // tează la luna FACTURĂRII, nu la `createdAt` ca restul cardurilor —
      // un dosar deschis în august dar facturat în octombrie contează pentru
      // octombrie aici (vezi dataEfectivaFacturare).
      const facturateInPerioada = bounds
        ? facturate.filter(d => {
          const dt = dataEfectivaFacturare(d)
          return dt && dt >= bounds[0] && dt < bounds[1]
        })
        : facturate
      setSumarLunar(computeSumarLunar(facturateInPerioada, facturareConfig))
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [workspaceId, period, year, month0, facturareConfig, refreshKey])

  const cur = current ?? EMPTY_STATS
  const ron = (v: number) => v.toLocaleString('ro-RO')

  // Butonul "vezi oficial" nu are rost cât timp regimul CAA e procentual —
  // CAA reală ≈ CAA per dosar (ambele ~14%), deci diferența e neglijabilă.
  // Rămâne ambiguu (implicit afișat) când perioada acoperă mai multe luni,
  // fiecare cu propriul regim.
  const luniActiveSumar = sumarLunar?.luni.filter(m => m.totalVenit > 0) ?? []
  const arataButonOficial = luniActiveSumar.length > 0 && (luniActiveSumar.length !== 1 || luniActiveSumar[0].regim !== 'procent')

  const renderTrend = (delta: number, up: boolean) => (
    <div className="stat-tile-trend" style={{ color: previous ? trendColor(delta, up) : 'transparent' }}>
      {previous
        ? <>{delta === 0 ? '—' : delta > 0 ? `▲ +${ron(delta)}` : `▼ ${ron(delta)}`}<span style={{ color: 'var(--s400)', fontWeight: 400 }}> {TREND_SUFFIX[period]}</span></>
        : ' '}
    </div>
  )

  return (
    <div style={{ marginTop: '.875rem', position: 'relative' }}>
      {loading && <span className="spin spin-dark" style={{ position: 'absolute', top: 0, right: 0 }} />}

      <div className="dosar-stats-grid">
        <div className="stat-tile">
          <div className="stat-tile-label">Număr dosare</div>
          <div className="stat-tile-value">
            {ron(cur.facturate)} <span className="stat-tile-value-total">/ {ron(cur.totalDosare)}</span>
          </div>
          <div className="stat-tile-secondary">facturate / total</div>
          {renderTrend(cur.facturate - (previous?.facturate ?? 0), true)}
        </div>

        <div className="stat-tile">
          <div className="stat-tile-label">Tarife aplicate clienților</div>
          <div className="stat-tile-value">{ron(cur.tarifClientFacturat)} RON <span className="stat-tile-tag">facturat</span></div>
          <div className="stat-tile-secondary">Dintr-un total de {ron(cur.tarifClientTotal)} RON</div>
          {renderTrend(cur.tarifClientFacturat - (previous?.tarifClientFacturat ?? 0), true)}
        </div>

        <div className={`stat-tile${arataButonOficial ? ' stat-tile--flagged' : ''}`}>
          <div className="stat-tile-label">Profit Sami</div>
          <div className="stat-tile-value">{ron(cur.profitSamiFacturat)} RON <span className="stat-tile-tag">facturat</span></div>
          <div className="stat-tile-secondary">Dintr-un total de {ron(cur.profitSamiTotal)} RON</div>
          {renderTrend(cur.profitSamiFacturat - (previous?.profitSamiFacturat ?? 0), true)}
          {arataButonOficial && (
            <button type="button" className="stat-tile-discrepancy-btn" data-tooltip="Suma de aici e per dosar (CAA 14% fix, fără Barou) — click pentru cifra oficială, cu prag" onClick={jumpToSumarLunar}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></svg>
              vezi oficial
            </button>
          )}
        </div>

        <div className={`stat-tile${arataButonOficial ? ' stat-tile--flagged' : ''}`}>
          <div className="stat-tile-label">De facturat către Adi</div>
          <div className="stat-tile-value">{ron(cur.profitAdiFacturat)} RON <span className="stat-tile-tag">facturat</span></div>
          <div className="stat-tile-secondary">Dintr-un total de {ron(cur.profitAdiTotal)} RON</div>
          {renderTrend(cur.profitAdiFacturat - (previous?.profitAdiFacturat ?? 0), true)}
          {arataButonOficial && (
            <button type="button" className="stat-tile-discrepancy-btn" data-tooltip="Suma de aici e per dosar (CAA 14% fix, fără Barou) — click pentru cifra oficială, cu prag" onClick={jumpToSumarLunar}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></svg>
              vezi oficial
            </button>
          )}
        </div>
      </div>

      {sumarLunar && (
        <SumarLunarCard
          id={SUMAR_LUNAR_ID}
          stats={sumarLunar}
          facturareConfig={facturareConfig}
          profitSamiPerDosar={cur.profitSamiFacturat}
          profitAdiPerDosar={cur.profitAdiFacturat}
          expanded={sumarExpanded}
          onToggleExpanded={() => setSumarExpanded(e => !e)}
          highlight={sumarHighlight}
        />
      )}
    </div>
  )
}
