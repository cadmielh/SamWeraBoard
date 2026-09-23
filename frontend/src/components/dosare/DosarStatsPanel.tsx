import { useState, useEffect } from 'react'
import { fetchDosareByMonth, fetchDosareByRange, fetchAllDosare } from '../../lib/dosare'
import { computeDosarStats, computeSumarLunar, computeTarifStats, dataEfectivaFacturare, trendColor, type DosarMonthStats, type SumarLunarStats, type StatsPeriod, type TarifStats } from '../../lib/dosareStats'
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
  /** Feature 'facturareSamiAdi' activ pe workspace — dacă e false, se sare
   * peste fetch-ul și calculul Sumarului lunar (specific Sami/Adi), care nu
   * se randează deloc. */
  samiAdiEnabled: boolean
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
  totalDosare: 0, facturate: 0,
}

const EMPTY_TARIF_STATS: TarifStats = {
  tarifClientTotal: 0, tarifClientFacturat: 0,
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

/** Limitele [start, end) ale perioadei curent afișate — folosite să filtrăm client-side TOATE dosarele
 * (vezi fetchAllDosare mai jos) după data facturării (cardul „Tarife aplicate clienților”, Sumarul lunar),
 * în loc de `createdAt` ca la cardul „Număr dosare”. `null` pentru 'total' — nicio limită. */
function periodBounds(period: StatsPeriod, year: number, month0: number): [Date, Date] | null {
  if (period === 'total') return null
  if (period === 'an') return [new Date(year, 0, 1), new Date(year + 1, 0, 1)]
  if (period === 'trimestru') {
    const q = Math.floor(month0 / 3)
    return [new Date(year, q * 3, 1), new Date(year, q * 3 + 3, 1)]
  }
  return [new Date(year, month0, 1), new Date(year, month0 + 1, 1)]
}

/** Limitele perioadei ANTERIOARE celei afișate — pentru trendul cardului „Tarife aplicate clienților”
 * (comparat cu tarifele facturate în perioada dinainte, nu cu cele create atunci). `null` pentru 'total'
 * (nu are perioadă anterioară), la fel ca `periodBounds`. */
function previousPeriodBounds(period: StatsPeriod, year: number, month0: number): [Date, Date] | null {
  if (period === 'total') return null
  if (period === 'an') return [new Date(year - 1, 0, 1), new Date(year, 0, 1)]
  if (period === 'trimestru') {
    const q = Math.floor(month0 / 3)
    const totalQ = year * 4 + q - 1
    const py = Math.floor(totalQ / 4)
    const pq = totalQ - py * 4
    return [new Date(py, pq * 3, 1), new Date(py, pq * 3 + 3, 1)]
  }
  const prevMonth0 = month0 === 0 ? 11 : month0 - 1
  const prevYear = month0 === 0 ? year - 1 : year
  return [new Date(prevYear, prevMonth0, 1), new Date(prevYear, prevMonth0 + 1, 1)]
}

export default function DosarStatsPanel({ workspaceId, period, year, month0, facturareConfig = DEFAULT_FACTURARE_CONFIG, samiAdiEnabled, refreshKey = 0 }: Props) {
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState<DosarMonthStats | null>(null)
  const [previous, setPrevious] = useState<DosarMonthStats | null>(null)
  const [tarifCur, setTarifCur] = useState<TarifStats | null>(null)
  const [tarifPrev, setTarifPrev] = useState<TarifStats | null>(null)
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
    setCurrent(null); setPrevious(null); setTarifCur(null); setTarifPrev(null); setSumarLunar(null)

    const [currentFetch, previousFetch] = fetchForPeriod(workspaceId, period, year, month0)
    const bounds = periodBounds(period, year, month0)
    const prevBounds = previousPeriodBounds(period, year, month0)

    Promise.all([
      currentFetch,
      previousFetch ?? Promise.resolve(null),
      // Toate dosarele workspace-ului — nu doar cele din perioada afișată (ca restul cardurilor): tarifele
      // se calculează pe data facturării (sau „acum”, dacă nu s-a facturat încă — vezi computeTarifStats),
      // nu pe createdAt, deci un dosar vechi, nefacturat, trebuie luat în calcul indiferent când a fost creat.
      fetchAllDosare(workspaceId),
    ]).then(([curDosare, prevDosare, allDosare]) => {
      if (cancelled) return
      setCurrent(computeDosarStats(curDosare))
      setPrevious(prevDosare ? computeDosarStats(prevDosare) : null)
      setTarifCur(computeTarifStats(allDosare, bounds))
      setTarifPrev(period === 'total' ? null : computeTarifStats(allDosare, prevBounds))
      if (samiAdiEnabled) {
        // Sumarul lunar (CAA reală, Barou) se raportează la luna FACTURĂRII, nu
        // la `createdAt` ca restul cardurilor — un dosar deschis în august dar
        // facturat în octombrie contează pentru octombrie aici (vezi
        // dataEfectivaFacturare).
        const facturate = allDosare.filter(d => d.facturat)
        const facturateInPerioada = bounds
          ? facturate.filter(d => {
            const dt = dataEfectivaFacturare(d)
            return dt && dt >= bounds[0] && dt < bounds[1]
          })
          : facturate
        setSumarLunar(computeSumarLunar(facturateInPerioada, facturareConfig))
      }
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [workspaceId, period, year, month0, facturareConfig, samiAdiEnabled, refreshKey])

  const cur = current ?? EMPTY_STATS
  const tarif = tarifCur ?? EMPTY_TARIF_STATS
  const ron = formatRon

  const renderTrend = (delta: number, up: boolean, hasPrevious: boolean) => (
    <div className="stat-tile-trend" style={{ color: hasPrevious ? trendColor(delta, up) : 'transparent' }}>
      {hasPrevious
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
      <div className={`dosar-top-row${samiAdiEnabled ? '' : ' dosar-top-row--generic'}`}>
        <div className="stat-tile">
          <div className="stat-tile-label">Număr dosare</div>
          <div className="stat-tile-value">
            {ron(cur.facturate)} <span className="stat-tile-value-total">/ {ron(cur.totalDosare)}</span>
          </div>
          <div className="stat-tile-secondary">facturate / total</div>
          {renderTrend(cur.facturate - (previous?.facturate ?? 0), true, previous !== null)}
        </div>

        <div className="stat-tile">
          <div className="stat-tile-label">Tarife aplicate clienților</div>
          <div className="stat-tile-value">{ron(tarif.tarifClientFacturat)} RON <span className="stat-tile-tag">facturat</span></div>
          <div className="stat-tile-secondary">Dintr-un total de {ron(tarif.tarifClientTotal)} RON</div>
          {renderTrend(tarif.tarifClientFacturat - (tarifPrev?.tarifClientFacturat ?? 0), true, tarifPrev !== null)}
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
