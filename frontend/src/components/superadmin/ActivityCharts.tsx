import { useEffect, useRef, useState } from 'react'
import type { ActivityDay } from '../../lib/superAdmin'

const shortDay = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${d}.${String(m).padStart(2, '0')}`
}
const longDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'long' })

/** Valoarea „rotundă” imediat peste maxim (1, 2, 5, 10, 20…), pentru axa Y. */
function niceMax(v: number) {
  if (v <= 1) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 5, 10].map(k => k * p).find(n => n >= v) ?? 10 * p
}

/** Coloane pe zile, o singură serie: titlul spune ce e reprezentat, deci fără legendă.
 *  Hover/focus pe o coloană → detaliul zilei; sub grafic, aceleași date ca tabel. */
export function DailyBars({ title, data, value, unit, detail, summary }: {
  title: string
  /** Rezumatul din dreapta titlului; implicit, suma pe perioadă (nepotrivită pentru „activi pe zi”, unde se dă altceva). */
  summary?: string
  data: ActivityDay[]
  value: (d: ActivityDay) => number
  /** Unitatea la singular/plural, pentru tooltip și total („document”/„documente”). */
  unit: [string, string]
  /** Rânduri suplimentare în tooltip (ex. scanări, utilizatori). */
  detail?: (d: ActivityDay) => string[]
}) {
  const [hover, setHover] = useState<number | null>(null)
  // Lățimea reală a graficului: desenul se face în pixeli, deci coloanele și textul nu se umflă pe ecran lat.
  const plotRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(640)
  useEffect(() => {
    const el = plotRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = 150, PAD_L = 28, PAD_B = 22, PAD_T = 8
  const max = niceMax(Math.max(...data.map(value), 0))
  const band = (W - PAD_L) / data.length
  const barW = Math.min(16, Math.max(2, band - 2))
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / max)
  const total = data.reduce((n, d) => n + value(d), 0)
  const fmt = (n: number) => `${n} ${n === 1 ? unit[0] : unit[1]}`
  // Etichete pe axa X: prima zi, ultima și câteva între ele, fără să se suprapună.
  const every = Math.ceil(data.length / Math.max(3, Math.floor(W / 90)))
  const h = hover !== null ? data[hover] : null

  return (
    <figure className="act-chart">
      <figcaption>
        <span>{title}</span>
        <b>{summary ?? fmt(total)}</b>
      </figcaption>
      <div className="act-chart-plot" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${title}: ${summary ?? fmt(total)} în ${data.length} zile`} onMouseLeave={() => setHover(null)}>
          {[0, max / 2, max].map(t => (
            <g key={t}>
              <line x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} className="act-grid" />
              <text x={PAD_L - 6} y={y(t)} className="act-tick" textAnchor="end" dominantBaseline="middle">{Number.isInteger(t) ? t : ''}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const v = value(d)
            const x = PAD_L + i * band + (band - barW) / 2
            const top = y(v)
            const hgt = H - PAD_B - top
            const r = Math.min(4, barW / 2, hgt)
            return (
              <g key={d.day}>
                {/* Ținta de hover e toată banda zilei, mai mare decât coloana. */}
                <rect x={PAD_L + i * band} y={PAD_T} width={band} height={H - PAD_T - PAD_B} fill="transparent"
                  onMouseEnter={() => setHover(i)} />
                {v > 0 && (
                  <path className={`act-bar${hover === i ? ' act-bar--on' : ''}`}
                    d={`M${x},${H - PAD_B} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${H - PAD_B} Z`} />
                )}
                {(i % every === 0 || i === data.length - 1) && (
                  <text x={PAD_L + i * band + band / 2} y={H - 6} className="act-tick" textAnchor="middle">{shortDay(d.day)}</text>
                )}
              </g>
            )
          })}
          <line x1={PAD_L} x2={W} y1={H - PAD_B} y2={H - PAD_B} className="act-axis" />
        </svg>
        {h && hover !== null && (
          // Caseta stă în interiorul graficului (cardul taie ce iese din el), lângă coloană, fără s-o acopere:
          // în dreapta ei pentru zilele din prima jumătate, în stânga pentru celelalte.
          <div className="act-tip" role="status" style={(() => {
            const cx = PAD_L + hover * band + band / 2
            return cx < W / 2
              ? { left: cx + band / 2 + 6, top: PAD_T }
              : { left: cx - band / 2 - 6, top: PAD_T, transform: 'translateX(-100%)' }
          })()}>
            <b>{longDay(h.day)}</b>
            <span>{fmt(value(h))}</span>
            {detail?.(h).map(t => <span key={t}>{t}</span>)}
          </div>
        )}
      </div>
      <details className="act-table">
        <summary>Vezi ca tabel</summary>
        <table>
          <thead><tr><th>Ziua</th><th>{unit[1]}</th></tr></thead>
          <tbody>
            {data.filter(d => value(d) > 0).map(d => <tr key={d.day}><td>{longDay(d.day)}</td><td>{value(d)}</td></tr>)}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Mini-grafic într-un rând de listă: zilele cu activitate din ultimele 30, fără axe (detaliul e în panou). */
export function ActivitySpark({ data }: { data: ActivityDay[] }) {
  const max = Math.max(1, ...data.map(d => d.documents + d.scans))
  const active = data.filter(d => d.activeUsers > 0).length
  return (
    <span className="act-spark" title={`${active} ${active === 1 ? 'zi activă' : 'zile active'} din ultimele ${data.length}`}
      aria-label={`${active} zile active din ultimele ${data.length}`} role="img">
      {data.map(d => {
        const work = d.documents + d.scans
        // Zi cu oameni în aplicație dar fără documente/scanări: o linie joasă, ca să se vadă că au intrat.
        const h = work > 0 ? 3 + (work / max) * 15 : d.activeUsers > 0 ? 2 : 0
        return <i key={d.day} style={{ height: h }} className={work > 0 ? undefined : 'idle'} />
      })}
    </span>
  )
}
