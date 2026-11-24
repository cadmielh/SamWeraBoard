import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { hasCurrentConsent } from '../lib/legal'
import { NOUTATI, deAnuntat, noutatiVizibile, useNoutatiVazute, type Noutate } from '../lib/noutati'
import { formatDateRo } from '../lib/dates'
import Modal from './Modal'

const INTARZIERE_MS = 1200          // după ce s-a așezat pagina, nu în timpul încărcării
const REINCERCARE_MS = 4000         // altă fereastră deschisă: încercăm din nou mai târziu

/** Fereastra „Ce e nou”: anunțurile nevăzute (vezi lib/noutati.ts), o singură dată. Apare doar după acceptarea
 * termenilor, niciodată peste altă fereastră sau peste ghidul „Primii pași” deschis; „Am înțeles” sau butonul unei noutăți le marchează ca văzute. */
export function NoutatiFereastra() {
  const { user, activeWorkspace, userRole, hasFeature, ghid } = useApp()
  const navigate = useNavigate()
  const { vazute, marcheaza } = useNoutatiVazute(user.uid)
  const [deschisa, setDeschisa] = useState(false)

  const consimtamant = !!activeWorkspace && hasCurrentConsent(activeWorkspace.consent)
  const creatLa = user.metadata.creationTime ?? ''
  const lista = useMemo(() => vazute && consimtamant
    ? deAnuntat(NOUTATI, { hasFeature, rol: userRole }, vazute, creatLa ? new Date(creatLa) : null)
    : [], [vazute, consimtamant, hasFeature, userRole, creatLa])

  // Nu peste ghidul „Primii pași” deschis (un cont nou are deja destule de citit): apare după ce îl închide.
  const ghidDeschis = !!ghid?.activ && !!ghid.deschis
  useEffect(() => {
    if (!lista.length || deschisa || ghidDeschis) return
    let t: ReturnType<typeof setTimeout>
    const incearca = () => {
      if (document.querySelector('.modal-backdrop')) { t = setTimeout(incearca, REINCERCARE_MS); return }
      setDeschisa(true)
    }
    t = setTimeout(incearca, INTARZIERE_MS)
    return () => clearTimeout(t)
  }, [lista.length, deschisa, ghidDeschis])

  if (!deschisa || !lista.length) return null
  const inchide = (cale?: string) => {
    void marcheaza(lista.map(n => n.id)).catch(() => { /* reapare la următoarea deschidere */ })
    setDeschisa(false)
    if (cale) navigate(cale)
  }

  return (
    <Modal onClose={() => inchide()} className="noutati-modal" ariaLabel="Ce e nou în Cabinio">
      <div className="modal-head">
        <span className="modal-title">✨ Ce e nou în Cabinio</span>
        <button className="modal-close" onClick={() => inchide()} aria-label="Închide">×</button>
      </div>
      <div className="modal-body noutati-lista">
        {lista.map(n => <NoutateRand key={n.id} n={n} onActiune={cale => inchide(cale)} />)}
        <p className="noutati-istoric">Toate noutățile rămân în Setări › Noutăți.</p>
      </div>
      <div className="modal-footer">
        <button className="btn btn-primary" onClick={() => inchide()}>Am înțeles</button>
      </div>
    </Modal>
  )
}

function NoutateRand({ n, onActiune, cuData }: { n: Noutate; onActiune: (cale: string) => void; cuData?: boolean }) {
  return (
    <article className="noutate">
      <span className="noutate-icon" aria-hidden>{n.icon}</span>
      <div className="noutate-corp">
        <h3 className="noutate-titlu">{n.titlu}</h3>
        {cuData && <div className="noutate-data">{formatDateRo(new Date(`${n.data}T12:00:00`))}</div>}
        <p className="noutate-text">{n.text}</p>
        {n.actiune && (
          <button type="button" className="btn btn-outline-primary btn-sm noutate-actiune" onClick={() => onActiune(n.actiune!.cale)}>
            {n.actiune.label} →
          </button>
        )}
      </div>
    </article>
  )
}

/** Setări › Noutăți: istoricul anunțurilor care privesc utilizatorul în cabinetul activ. */
export function NoutatiIstoric() {
  const { userRole, hasFeature } = useApp()
  const navigate = useNavigate()
  const lista = noutatiVizibile(NOUTATI, { hasFeature, rol: userRole })
  return (
    <div className="card">
      <div className="card-body noutati-lista">
        {lista.length === 0 && <div className="card-sub" style={{ marginTop: 0 }}>Nicio noutate deocamdată.</div>}
        {lista.map(n => <NoutateRand key={n.id} n={n} cuData onActiune={cale => navigate(cale)} />)}
      </div>
    </div>
  )
}
