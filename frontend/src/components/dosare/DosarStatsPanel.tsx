import { useState, useEffect } from 'react'
import { fetchDosareByMonth, fetchDosareByRange, fetchAllDosare, fetchDosareFacturate } from '../../lib/dosare'
import { computeDosarStats, computeSumarLunar, dataEfectivaFacturare, trendColor, type DosarMonthStats, type SumarLunarStats, type StatsPeriod } from '../../lib/dosareStats'
import type { Dosar, FacturareConfig } from '../../types'
import { DEFAULT_FACTURARE_CONFIG } from '../../types'
import { formatRon } from '../../lib/format'
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

export default function DosarStatsPanel({ workspaceId, period, year, month0, facturareConfig = DEFAULT_FACTURARE_CONFIG, refreshKey = 0 }: Props) {
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState<DosarMonthStats | null>(null)
  const [previous, setPrevious] = useState<DosarMonthStats | null>(null)
  const [sumarLunar, setSumarLunar] = useState<SumarLunarStats | null>(null)
  const [sumarExpanded, setSumarExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    // Resetăm datele vechi înainte de fetch — altfel, la schimbarea de
    // lună/config, cardurile ar arăta cifrele perioadei anterioare (doar cu un
    // spinner mic în colț) până vine răspunsul, risc de citire greșită a unei
    // cifre financiare.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrent(null); setPrevious(null); setSumarLunar(null)

    const [currentFetch, previousFetch] = fetchForPeriod(workspaceId, period, year, month0)
    const bounds = periodBounds(period, year, month0)

    Promise.all([currentFetch, previousFetch ?? Promise.resolve(null), fetchDosareFacturate(workspaceId)]).then(([curDosare, prevDosare, facturate]) => {
      if (cancelled) return
      setCurrent(computeDosarStats(curDosare))
      setPrevious(prevDosare ? computeDosarStats(prevDosare) : null)
      // Sumarul lunar (CAA reală, Barou) se raportează la luna FACTURĂRII, nu
      // la `createdAt` ca restul cardurilor — un dosar deschis în august dar
      // facturat în octombrie contează pentru octombrie aici (vezi
      // dataEfectivaFacturare).
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
  const ron = formatRon

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

      {/* Cele 2 carduri de volum (createdAt) + Sumarul lunar (facturare) pe
          același rând — Sumarul rămâne grupat, cu propriul header/chevron,
          doar poziționat ca a treia coloană, mai lată. Sub breakpoint, cade
          pe rândul următor, full-width (vezi .dosar-top-row în tokens.css). */}
      <div className="dosar-top-row">
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

        {sumarLunar && (
          <SumarLunarCard
            stats={sumarLunar}
            facturareConfig={facturareConfig}
            expanded={sumarExpanded}
            onToggleExpanded={() => setSumarExpanded(e => !e)}
          />
        )}
      </div>
    </div>
  )
}
