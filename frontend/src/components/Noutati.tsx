import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { hasCurrentConsent } from '../lib/legal'
import {
  MAX_IN_FEREASTRA, NOUTATI, deAnuntat, noutatiVizibile, opresteTur, pornesteTur, urmatorulPasTur, useNoutatiVazute,
  useTurNoutate, type Noutate,
} from '../lib/noutati'
import { formatDateRo } from '../lib/dates'
import Modal from './Modal'
import IndiciuEvidentiat from './IndiciuEvidentiat'

const INTARZIERE_MS = 1200          // după ce s-a așezat pagina, nu în timpul încărcării
const REINCERCARE_MS = 4000         // altă fereastră deschisă: încercăm din nou mai târziu

/** Fereastra „Ce e nou”: anunțurile nevăzute (vezi lib/noutati.ts), o singură dată; cel mult MAX_IN_FEREASTRA, restul
 * în Setări › Noutăți. Apare doar după acceptarea termenilor, niciodată peste altă fereastră sau peste ghidul „Primii
 * pași” deschis. Închiderea (sau orice buton) le marchează pe toate ca văzute. */
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

  // Nu peste ghidul „Primii pași” (panoul deschis sau o bulă „Arată-mi” activă) și nici în timpul unui tur: un cont
  // nou are deja destule de citit, iar o bulă activă înseamnă că utilizatorul tocmai face ceva.
  const tur = useTurNoutate()
  const ocupat = (!!ghid?.activ && (ghid.deschis || !!ghid.indiciu)) || !!tur
  useEffect(() => {
    if (!lista.length || deschisa || ocupat) return
    let t: ReturnType<typeof setTimeout>
    const incearca = () => {
      if (document.querySelector('.modal-backdrop')) { t = setTimeout(incearca, REINCERCARE_MS); return }
      setDeschisa(true)
    }
    t = setTimeout(incearca, INTARZIERE_MS)
    return () => clearTimeout(t)
  }, [lista.length, deschisa, ocupat])

  if (!deschisa || !lista.length) return null
  const afisate = lista.slice(0, MAX_IN_FEREASTRA)
  const inPlus = lista.length - afisate.length
  const inchide = (dupa?: () => void) => {
    void marcheaza(lista.map(n => n.id)).catch(() => { /* reapare la următoarea deschidere */ })
    setDeschisa(false)
    dupa?.()
  }

  return (
    <Modal onClose={() => inchide()} className="noutati-modal" ariaLabel="Ce e nou în Cabinio">
      <div className="modal-head">
        <span className="modal-title">✨ Ce e nou în Cabinio</span>
        <button className="modal-close" onClick={() => inchide()} aria-label="Închide">×</button>
      </div>
      <div className="modal-body noutati-lista">
        {afisate.map(n => (
          <NoutateRand key={n.id} n={n}
            onActiune={cale => inchide(() => navigate(cale))}
            onTur={() => inchide(() => { navigate(n.tur!.ruta); pornesteTur(n) })} />
        ))}
        <p className="noutati-istoric">
          {inPlus > 0
            ? <>Și încă {inPlus === 1 ? 'o noutate' : `${inPlus} noutăți`}: <button type="button" className="doc-link" onClick={() => inchide(() => navigate('/setari/noutati'))}>vezi toate</button>.</>
            : 'Toate noutățile rămân în Setări › Noutăți.'}
        </p>
      </div>
      <div className="modal-footer">
        <button className="btn btn-primary" onClick={() => inchide()}>Am înțeles</button>
      </div>
    </Modal>
  )
}

function NoutateRand({ n, onActiune, onTur, cuData }: {
  n: Noutate; onActiune: (cale: string) => void; onTur: () => void; cuData?: boolean
}) {
  return (
    <article className="noutate">
      <span className="noutate-icon" aria-hidden>{n.icon}</span>
      <div className="noutate-corp">
        <h3 className="noutate-titlu">{n.titlu}</h3>
        {cuData && <div className="noutate-data">{formatDateRo(new Date(`${n.data}T12:00:00`))}</div>}
        <p className="noutate-text">{n.text}</p>
        {(n.tur || n.actiune) && (
          <div className="noutate-actiuni">
            {n.tur && <button type="button" className="btn btn-primary btn-sm" onClick={onTur}>Arată-mi cum</button>}
            {n.actiune && (
              <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => onActiune(n.actiune!.cale)}>
                {n.actiune.label} →
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

/** Setări › Noutăți: istoricul anunțurilor care privesc utilizatorul în cabinetul activ (turul se poate relua). */
export function NoutatiIstoric() {
  const { userRole, hasFeature } = useApp()
  const navigate = useNavigate()
  const lista = noutatiVizibile(NOUTATI, { hasFeature, rol: userRole })
  return (
    <div className="card">
      <div className="card-body noutati-lista">
        {lista.length === 0 && <div className="card-sub" style={{ marginTop: 0 }}>Nicio noutate deocamdată.</div>}
        {lista.map(n => (
          <NoutateRand key={n.id} n={n} cuData onActiune={cale => navigate(cale)}
            onTur={() => { navigate(n.tur!.ruta); pornesteTur(n) }} />
        ))}
      </div>
    </div>
  )
}

/** Turul „Arată-mi cum” al unei noutăți: aceleași indicii ca ghidul „Primii pași”, cu „Următorul” și „Gata”. */
export function TurNoutate() {
  const tur = useTurNoutate()
  if (!tur?.noutate.tur) return null
  const pasi = tur.noutate.tur.pasi
  const ultimul = tur.index + 1 >= pasi.length
  return (
    <IndiciuEvidentiat
      titlu={tur.noutate.titlu} indicii={pasi} index={tur.index} ruta={tur.noutate.tur.ruta}
      onUrmator={urmatorulPasTur} onOpreste={opresteTur}
      actiuni={<>
        {!ultimul && <button type="button" className="btn btn-ghost btn-xs" onClick={opresteTur}>Închide</button>}
        <button type="button" className="btn btn-primary btn-xs" onClick={ultimul ? opresteTur : urmatorulPasTur}>
          {ultimul ? 'Gata' : 'Următorul'}
        </button>
      </>}
    />
  )
}
