import { Link } from 'react-router-dom'
import { LIMITA_CABINET, formatMarime, nivelSpatiu, useSpatiuDocumente } from '../../lib/fisiere'

/** Spațiul ocupat, discret, la finalul documentelor unui client: cât are clientul și cât are tot cabinetul din limită
 * (singurul loc cu mărimi, ca cele două cifre să nu se confunde; bara e a cabinetului). Spre limită textul devine
 * vizibil (galben, apoi roșu), ca utilizatorul să afle înainte ca încărcarea să fie refuzată. Un clic duce la
 * Setări › Documente (detalii și Arhiva). */
export default function SpatiuCabinet({ workspaceId, client }: { workspaceId: string | null; client: number }) {
  const spatiu = useSpatiuDocumente(workspaceId)
  if (!spatiu) return null
  const procent = Math.min(100, (spatiu.octeti / LIMITA_CABINET) * 100)
  const nivel = nivelSpatiu(procent)
  const text = procent >= 100 ? 'plin' : `${formatMarime(spatiu.octeti)} din ${formatMarime(LIMITA_CABINET)}`
  return (
    <Link to="/setari/documente" className={`doc-spatiu-mini${nivel}`}
      title="Spațiul folosit de documentele tuturor clienților din cabinet. Detalii în Setări › Documente.">
      <span className="doc-spatiu-mini-text">
        {client > 0 && <><span>Clientul: {formatMarime(client)}</span> · </>}<span>Cabinetul: {text}</span>
        {nivel && procent < 100 && <> · <span>{Math.round(procent)}%</span></>}
      </span>
      <span className={`doc-spatiu-bar doc-spatiu-bar--mini${nivel}`} role="meter" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(procent)} aria-label="Spațiul cabinetului folosit pentru documente">
        <span style={{ width: `${Math.max(procent, spatiu.octeti ? 1 : 0)}%` }} />
      </span>
    </Link>
  )
}
