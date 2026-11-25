import { useState } from 'react'
import Modal from '../Modal'
import BtnLabel from '../BtnLabel'
import { useApp } from '../../AppContext'
import { pregatesteTipar, type AspectTipar, type Fisier } from '../../lib/fisiere'
import { IconFisier } from './icons'
import '../../styles/editor.css'

const estePoza = (f: Fisier) => f.mime.startsWith('image/')

/** Ordinea propusă: fața înaintea verso-ului, restul ca în listă. */
function ordinePropusa(lista: Fisier[]): Fisier[] {
  const rang = (f: Fisier) => (/verso/i.test(f.nume) ? 1 : 0)
  return [...lista].sort((a, b) => rang(a) - rang(b))
}

/** Schița paginii A4 pentru fiecare aspect: dreptunghiurile arată unde ajunge fiecare document. */
function Schita({ aspect, n }: { aspect: AspectTipar; n: number }) {
  return (
    <svg className="tip-schita" viewBox="0 0 210 297" aria-hidden>
      <rect x={0.5} y={0.5} width={209} height={296} className="tip-foaie" />
      {aspect === 'unire'
        ? <>
          <rect x={20} y={20} width={170} height={8} className="tip-card" />
          {[40, 56, 72, 88, 104, 120].map(y => <rect key={y} x={20} y={y} width={150} height={5} className="tip-text" />)}
          <path d="M150 230h40v50h-40z" className="tip-card" />
          <path d="M165 215l-12 -12M165 215l-12 12M165 215h-45" className="tip-sageata" />
        </>
        : aspect === 'ci'
        ? Array.from({ length: Math.min(2, Math.max(1, n)) }, (_, i) => (
          <rect key={i} x={62} y={25 + i * 69} width={86} height={54} rx={3} className="tip-card" />
        ))
        : <rect x={10} y={10} width={190} height={277} className="tip-card" />}
    </svg>
  )
}

/** „Pregătește pentru tipar”: documentele alese, în ordinea dorită, într-un PDF A4 nou salvat lângă ele. */
export default function TiparModal({ fisiere, aspectInitial, onClose, onCreat }: {
  fisiere: Fisier[]
  aspectInitial?: AspectTipar
  onClose: () => void
  onCreat: (f: Fisier) => void
}) {
  const { toast } = useApp()
  const [ordine, setOrdine] = useState(() => ordinePropusa(fisiere))
  const doarPoze = ordine.every(estePoza)
  const ciPosibil = doarPoze && ordine.length >= 1 && ordine.length <= 2
  const [aspect, setAspect] = useState<AspectTipar>(aspectInitial ?? (ciPosibil ? 'ci' : 'pagina'))
  const [busy, setBusy] = useState(false)
  const aspectEfectiv: AspectTipar = aspect === 'ci' && !ciPosibil ? 'pagina' : aspect
  const nedecupate = ordine.filter(f => estePoza(f) && !f.editat)

  const muta = (i: number, d: -1 | 1) => setOrdine(o => {
    const n = [...o]
    ;[n[i], n[i + d]] = [n[i + d], n[i]]
    return n
  })
  const creeaza = async () => {
    setBusy(true)
    try {
      const f = await pregatesteTipar(ordine.map(x => x.id), aspectEfectiv)
      onCreat(f)
      onClose()
    } catch (e) {
      toast((e as Error).message || 'PDF-ul nu a putut fi creat.', 'err')
    } finally {
      setBusy(false)
    }
  }

  const optiuni: { cheie: AspectTipar; titlu: string; text: string; activ: boolean }[] = [
    { cheie: 'ci', titlu: 'Buletin față-verso', activ: ciPosibil,
      text: ciPosibil ? 'Pe o singură pagină, la mărimea reală a cardului, cu contur pentru decupare.' : 'Alege una sau două poze (fața și verso-ul).' },
    { cheie: 'pagina', titlu: 'Câte una pe pagină A4', activ: true,
      text: 'Fiecare poză cât mai mare pe o pagină A4; și paginile PDF-urilor se încadrează pe A4. Bun pentru tipar.' },
    { cheie: 'unire', titlu: 'Unește în PDF', activ: true,
      text: 'Un singur PDF, în ordinea aleasă: paginile PDF-urilor rămân neschimbate, pozele ajung pe câte o pagină A4.' },
  ]

  return (
    <Modal onClose={onClose} className="tip-modal" ariaLabel="Pregătește pentru tipar">
      <div className="modal-head">
        <span className="modal-title">{aspectEfectiv === 'unire' ? 'Unește în PDF' : 'Pregătește pentru tipar'}</span>
        <button className="modal-close" onClick={onClose} aria-label="Închide">×</button>
      </div>
      <div className="modal-body tip-corp">
        <div className="tip-aspecte" role="radiogroup" aria-label="Aspectul paginii">
          {optiuni.map(o => (
            <button key={o.cheie} type="button" role="radio" aria-checked={aspectEfectiv === o.cheie} disabled={!o.activ || busy}
              className={`tip-aspect${aspectEfectiv === o.cheie ? ' is-activ' : ''}`} onClick={() => setAspect(o.cheie)}>
              <Schita aspect={o.cheie} n={ordine.length} />
              <span className="tip-aspect-text">
                <strong>{o.titlu}</strong>
                <span className="doc-meta">{o.text}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="field-label">Ordinea</div>
        <ol className="tip-lista">
          {ordine.map((f, i) => (
            <li key={f.id}>
              <IconFisier mime={f.mime} />
              <span className="tip-nume">{f.nume}</span>
              {aspectEfectiv === 'ci' && <span className="chip chip-muted">{i === 0 ? 'față' : 'verso'}</span>}
              <span className="tip-mutari">
                <button type="button" className="doc-icon-btn" onClick={() => muta(i, -1)} disabled={i === 0 || busy} aria-label={`Mută „${f.nume}” mai sus`}>↑</button>
                <button type="button" className="doc-icon-btn" onClick={() => muta(i, 1)} disabled={i === ordine.length - 1 || busy} aria-label={`Mută „${f.nume}” mai jos`}>↓</button>
                {ordine.length > 1 && (
                  <button type="button" className="doc-icon-btn" onClick={() => setOrdine(o => o.filter(x => x.id !== f.id))} disabled={busy}
                    aria-label={`Scoate „${f.nume}”`}>×</button>
                )}
              </span>
            </li>
          ))}
        </ol>
        {nedecupate.length > 0 ? (
          <p className="tip-avertisment">
            {nedecupate.length === 1 ? `„${nedecupate[0].nume}” nu e decupată` : `${nedecupate.length} poze nu sunt decupate`}: pe hârtie
            apar cu tot cu fundalul (masa, mâna). Pentru o copie curată, închide fereastra și folosește întâi „Editează” din meniul pozei.
          </p>
        ) : (
          <p className="doc-meta">PDF-ul nou se salvează lângă documente; originalele rămân neschimbate.</p>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Renunță</button>
        <button className="btn btn-primary" onClick={() => void creeaza()} disabled={busy || !ordine.length}>
          <BtnLabel busy={busy}>Creează PDF-ul</BtnLabel>
        </button>
      </div>
    </Modal>
  )
}
