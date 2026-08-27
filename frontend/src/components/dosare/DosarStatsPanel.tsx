import { useState, useEffect } from 'react'
import { fetchDosareByMonth, fetchDosareByRange, fetchAllDosare } from '../../lib/dosare'
import { computeDosarStats, METRIC_META, trendColor, type DosarMonthStats, type StatsPeriod } from '../../lib/dosareStats'
import type { Dosar } from '../../types'

interface Props {
  workspaceId: string
  period: StatsPeriod
  /** Lună/an navigate din header-ul DosarePage (navigatorul e afișat acolo,
   * lângă titlu). Pentru 'trimestru'/'an', luna/anul determină perioada din
   * care face parte; pentru 'total' sunt ignorate. */
  year: number
  month0: number
}

const TREND_SUFFIX: Record<StatsPeriod, string> = {
  luna: 'vs. luna trecută',
  trimestru: 'vs. trimestrul trecut',
  an: 'vs. anul trecut',
  total: '',
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

export default function DosarStatsPanel({ workspaceId, period, year, month0 }: Props) {
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState<DosarMonthStats | null>(null)
  const [previous, setPrevious] = useState<DosarMonthStats | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)

    const [currentFetch, previousFetch] = fetchForPeriod(workspaceId, period, year, month0)

    Promise.all([currentFetch, previousFetch ?? Promise.resolve(null)]).then(([curDosare, prevDosare]) => {
      if (cancelled) return
      setCurrent(computeDosarStats(curDosare))
      setPrevious(prevDosare ? computeDosarStats(prevDosare) : null)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [workspaceId, period, year, month0])

  return (
    <div style={{ marginTop: '.875rem', position: 'relative' }}>
      {loading && <span className="spin spin-dark" style={{ position: 'absolute', top: 0, right: 0 }} />}

      <div className="dosar-stats-grid">
        {METRIC_META.map(({ key, label, up, money }) => {
          const value = current?.[key] ?? 0
          const prevValue = previous?.[key] ?? 0
          const delta = value - prevValue
          return (
            <div key={key} className="stat-tile">
              <div className="stat-tile-label">{label}</div>
              <div className="stat-tile-value">{value.toLocaleString('ro-RO')}{money ? ' RON' : ''}</div>
              <div className="stat-tile-trend" style={{ color: previous ? trendColor(delta, up) : 'transparent' }}>
                {previous
                  ? <>{delta === 0 ? '—' : delta > 0 ? `▲ +${delta.toLocaleString('ro-RO')}` : `▼ ${delta.toLocaleString('ro-RO')}`}<span style={{ color: 'var(--s400)', fontWeight: 400 }}> {TREND_SUFFIX[period]}</span></>
                  : ' '}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
