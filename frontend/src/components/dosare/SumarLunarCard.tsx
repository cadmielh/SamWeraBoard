import type { SumarLunarStats } from '../../lib/dosareStats'
import { LUNI, REGIM_CAA_LABEL } from '../../lib/dosareStats'
import type { FacturareConfig } from '../../types'
import { formatRon as ron } from '../../lib/format'

interface Props {
  stats: SumarLunarStats
  facturareConfig: FacturareConfig
  expanded: boolean
  onToggleExpanded: () => void
}

function lunaLabel(luna: string): string {
  const [y, m] = luna.split('-')
  return `${LUNI[Number(m) - 1]} ${y}`
}

export default function SumarLunarCard({ stats, facturareConfig, expanded, onToggleExpanded }: Props) {
  const luniActive = stats.luni.filter(m => m.totalVenit > 0)
  const clickable = luniActive.length > 0
  const subtitlu = luniActive.length === 0
    ? 'nicio activitate facturabilă'
    : luniActive.length === 1
      ? lunaLabel(luniActive[0].luna)
      : `însumat pe ${luniActive.length} luni active`

  const deltaCaa = stats.caaReala - stats.caaPerDosare
  const explainText = `De ce diferă cifrele față de profiturile din dosare? Suma profiturilor din dosare este fără CAA și Taxa de Barou. Sumarul lunar aplică regula reală — CAA cu prag și Taxa de Barou fixă, împărțite proporțional între Sami și Adi după cât a cuvenit fiecăruia — cifra care contează la facturare.`

  const cardClass = `sumar-lunar-card${clickable ? ' sumar-lunar-card--clickable' : ''}`

  // Click-ul de restrângere/expandare nu se aplică peste "cardurile" din
  // interior (comparația CAA, tile-urile de profit oficial) — acolo etichetele
  // au propriul lor hover (tooltip cu explicația), pe care un toggle
  // neașteptat l-ar întrerupe.
  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.caa-compare, .sumar-lunar-profit-tile')) return
    onToggleExpanded()
  }

  return (
    <div
      className={cardClass}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? handleCardClick : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpanded() } }) : undefined}
    >
      <div className="sumar-lunar-head" data-tooltip={clickable ? (expanded ? 'Click pentru a restrânge' : 'Click pentru detalii') : undefined}>
        <div>
          <div className="sumar-lunar-title">Sumar lunar</div>
          <div className="sumar-lunar-sub">{subtitlu} — Conține atât taxa de Barou {ron(stats.barou)} RON fix/lună, cât și CAA calculat în funcție de pragurile stabilite.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          {luniActive.length === 1 && (
            <span className="regim-chip">Regim CAA: {REGIM_CAA_LABEL[luniActive[0].regim](facturareConfig)}</span>
          )}
          {clickable && <span className={`sumar-lunar-chevron${expanded ? ' sumar-lunar-chevron--up' : ''}`}>▾</span>}
        </div>
      </div>

      {luniActive.length === 0 && (
        <div className="sumar-lunar-empty">Niciun dosar cu tarif facturat în perioada selectată.</div>
      )}

      {luniActive.length > 0 && !expanded && (
        <div className="sumar-lunar-compact">
          <div className="sumar-lunar-compact-item">
            <span className="sumar-lunar-compact-label">CAA reală</span>
            <span className="sumar-lunar-compact-value">{ron(stats.caaReala)} RON</span>
            <span className={`caa-delta-pill${deltaCaa < 0 ? ' caa-delta-pill--down' : ''}`}>
              {deltaCaa >= 0 ? '+' : ''}{ron(deltaCaa)} vs. per dosar
            </span>
          </div>
          <div className="sumar-lunar-compact-item">
            <span className="sumar-lunar-compact-label">Profit Sami</span>
            <span className="sumar-lunar-compact-value" style={{ color: stats.profitSamiOficial >= 0 ? 'var(--g700)' : 'var(--r600)' }}>{ron(stats.profitSamiOficial)} RON</span>
          </div>
          <div className="sumar-lunar-compact-item">
            <span className="sumar-lunar-compact-label">De facturat către Adi</span>
            <span className="sumar-lunar-compact-value" style={{ color: stats.profitAdiOficial <= 0 ? 'var(--g700)' : 'var(--r600)' }}>{ron(stats.profitAdiOficial)} RON</span>
          </div>
        </div>
      )}

      {luniActive.length > 0 && expanded && (
        <div className="sumar-lunar-cards-row">
          <div className="caa-compare">
            <div className="caa-col">
              <span className="caa-label">CAA — sumă per dosare ({Math.round(facturareConfig.caaProcent * 1000) / 10}% fix)</span>
              <span className="caa-value caa-value--muted">{ron(stats.caaPerDosare)} RON</span>
            </div>
            <div className="caa-delta">
              <span className="caa-delta-arrow">→</span>
              <span className={`caa-delta-pill${deltaCaa < 0 ? ' caa-delta-pill--down' : ''}`}>
                {deltaCaa >= 0 ? '+' : ''}{ron(deltaCaa)} RON
              </span>
            </div>
            <div className="caa-col caa-col--right">
              <span className="caa-label">CAA reală (prag {ron(facturareConfig.caaMin)}–{ron(facturareConfig.caaPlafon)})</span>
              <span className="caa-value">{ron(stats.caaReala)} RON</span>
            </div>
          </div>

          <div className="sumar-lunar-profit-tile" data-tooltip={explainText}>
            <span className="sumar-lunar-profit-label">Profit Sami</span>
            <span className="sumar-lunar-profit-value" style={{ color: stats.profitSamiOficial >= 0 ? 'var(--g700)' : 'var(--r600)' }}>
              {ron(stats.profitSamiOficial)} RON
            </span>
            <span className="sumar-lunar-profit-before">din dosare, înainte de Barou/CAA: {ron(stats.profitSamiDinDosare)} RON</span>
          </div>
          <div className="sumar-lunar-profit-tile" data-tooltip={explainText}>
            <span className="sumar-lunar-profit-label">De facturat către Adi</span>
            <span className="sumar-lunar-profit-value" style={{ color: stats.profitAdiOficial <= 0 ? 'var(--g700)' : 'var(--r600)' }}>
              {ron(stats.profitAdiOficial)} RON
            </span>
            <span className="sumar-lunar-profit-before">din dosare, înainte de Barou/CAA: {ron(stats.profitAdiDinDosare)} RON</span>
          </div>
        </div>
      )}
    </div>
  )
}
