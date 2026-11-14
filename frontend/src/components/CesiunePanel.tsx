import type { Persoana } from '../types'
import type { CesiuneCalcul, UltimaCesiune } from '../lib/cesiune'
import { formatProcent } from '../lib/cesiune'

const LABELS: [string, string][] = [
  ['{{NR_PARTI_CEDATE}}', 'Părți cedate'], ['{{CAPITAL_CEDAT}}', 'Capital cedat (Lei)'], ['{{PROCENT_CEDAT}}', 'Procent cedat'],
  ['{{PARTI_SOCIALE_COOPTAT}}', 'Părțile cesionarului după cesiune'], ['{{CAPITAL_COOPTAT}}', 'Capitalul cesionarului (Lei)'],
  ['{{PROCENT_COOPTAT}}', 'Procentul cesionarului'],
]

interface Props {
  cedent: Persoana | null
  cesionar: Persoana | null
  parti: string
  onParti: (v: string) => void
  calc: CesiuneCalcul
  /** Nota cesiunii deja aplicate fișei (vezi lib/cesiune.notaAplicata); null dacă nu e cazul. */
  nota: UltimaCesiune | null
  dinFisa: boolean
  onDinFisa: (v: boolean) => void
}

const numeDe = (p: Persoana) => `${p.nume} ${p.prenume}`.trim()

/** Cesiunea de părți sociale: se introduce doar numărul de părți, restul se calculează din fișa firmei. */
export default function CesiunePanel({ cedent, cesionar, parti, onParti, calc, nota, dinFisa, onDinFisa }: Props) {
  const { totalParti, cedentParti, cesionarParti, values, error } = calc
  const info = (p: number) => `${p} părți, ${formatProcent(totalParti ? p / totalParti * 100 : 0)}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', marginBottom: '.375rem' }}>
      <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Cesiune părți sociale</div>
      {!cedent || !cesionar ? (
        <div style={{ fontSize: '.8rem', color: 'var(--s500)' }}>Alege cedentul și cesionarul; părțile, capitalul și procentele se calculează din fișa firmei.</div>
      ) : (
        <>
          <div style={{ fontSize: '.85rem', display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
            <span>Cedent: <strong>{numeDe(cedent)}</strong>{cedentParti != null && ` — deține ${info(cedentParti)}`}</span>
            <span>Cesionar: <strong>{numeDe(cesionar)}</strong> — {cesionarParti > 0 ? `asociat, deține ${info(cesionarParti)}` : 'asociat nou'}</span>
          </div>
          {nota && (
            <div style={{ fontSize: '.8rem', background: 'var(--warn-bg, rgba(245,158,11,.12))', borderRadius: 'var(--r-sm)', padding: '.4rem .55rem' }}>
              Fișa a fost deja actualizată după această cesiune ({new Date(nota.data).toLocaleDateString('ro-RO')}, {nota.parti} părți).{' '}
              {dinFisa ? 'Se calculează din fișa actuală. ' : 'Se calculează din situația dinainte de cesiune. '}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onDinFisa(!dinFisa)}>
                {dinFisa ? 'Folosește situația dinainte' : 'Calculează din fișa actuală'}
              </button>
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="cesiune-parti">Număr de părți sociale cedate</label>
            <div style={{ display: 'flex', gap: '.375rem' }}>
              <input id="cesiune-parti" className="field-input" inputMode="numeric" value={parti}
                onChange={e => onParti(e.target.value.replace(/\D/g, ''))} />
              {cedentParti != null && cedentParti > 0 && (
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onParti(String(cedentParti))}>
                  Toate ({cedentParti})
                </button>
              )}
            </div>
          </div>
          {error && <div style={{ fontSize: '.8rem', color: 'var(--danger, #dc2626)' }}>{error}</div>}
          {Object.keys(values).length > 0 && (
            <div style={{ fontSize: '.85rem', color: 'var(--s500)', display: 'flex', flexDirection: 'column', gap: '.1rem' }}>
              {LABELS.map(([ph, label]) => <span key={ph}>{label}: <strong>{values[ph]}</strong></span>)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
