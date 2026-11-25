import { useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { linkEmail, linkWhatsApp, mesajCerere } from '../../lib/cereri'
import { formatDateRo } from '../../lib/dates'
import { IconCopiaza, IconEmail, IconMesaj, IconQr } from '../documente/icons'

/** Codul QR al linkului, ca SVG (fără HTML injectat): clientul aflat la birou îl scanează cu telefonul. */
function CodQr({ text }: { text: string }) {
  const { n, cale } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { n, cale: d }
  }, [text])
  return (
    <svg className="cer-qr" viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label="Cod QR pentru linkul cererii" shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={cale} fill="#000" />
    </svg>
  )
}

/** Linkul unei cereri și căile de trimitere: din telefonul sau mailul cabinetului (Cabinio nu trimite mesaje). */
export default function TrimiteLink({ link, expiraLa, cabinet, emailClient, onCopiat }: {
  link: string
  expiraLa: Date | null
  cabinet: string
  emailClient?: string
  onCopiat: (ce: 'link' | 'mesaj') => void
}) {
  const [qr, setQr] = useState(false)
  const mesaj = mesajCerere(cabinet, link, expiraLa)
  const copiaza = async (ce: 'link' | 'mesaj') => {
    try { await navigator.clipboard.writeText(ce === 'link' ? link : mesaj); onCopiat(ce) } catch { /* fără clipboard: textul rămâne selectabil */ }
  }

  return (
    <div className="cer-trimite">
      <div className="cer-link">
        <input className="field-input" readOnly value={link} aria-label="Linkul cererii" onFocus={e => e.currentTarget.select()} />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void copiaza('link')}><IconCopiaza /> Copiază linkul</button>
      </div>
      <div className="cer-canale">
        <a className="btn btn-outline-primary btn-sm" href={linkWhatsApp(mesaj)} target="_blank" rel="noopener noreferrer"><IconMesaj /> WhatsApp</a>
        <a className="btn btn-outline-primary btn-sm" href={linkEmail(emailClient ?? '', cabinet, mesaj)}><IconEmail /> E-mail</a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copiaza('mesaj')} title="Pentru SMS sau altă aplicație"><IconCopiaza /> Copiază mesajul</button>
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={qr} onClick={() => setQr(v => !v)}><IconQr /> {qr ? 'Ascunde codul QR' : 'Cod QR'}</button>
      </div>
      {qr && (
        <div className="cer-qr-zona">
          <CodQr text={link} />
          <span className="doc-meta">Clientul aflat la birou scanează codul cu camera telefonului.</span>
        </div>
      )}
      <p className="doc-meta cer-nota">
        {expiraLa ? `Linkul e valabil până pe ${formatDateRo(expiraLa)}. ` : ''}
        Oricine are linkul poate încărca acte pentru această cerere, dar nu poate vedea nimic din cabinet; trimite-l doar clientului.
      </p>
    </div>
  )
}
