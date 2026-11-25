import { useEffect, useRef, useState } from 'react'
import Modal from '../Modal'
import BtnLabel from '../BtnLabel'
import { useApp } from '../../AppContext'
import { continutFisier, incarcaFisier, inlocuiesteContinut, type Fisier } from '../../lib/fisiere'
import {
  ETICHETA_FILTRU, aplicaFiltru, colturiImplicite, dimensiuneRezultat, indreapta, numeEditat, roteste, rotesteColturi,
  type Colturi, type Filtru, type Imagine,
} from '../../lib/editorPoza'
import '../../styles/editor.css'

/** Latura maximă a pozei ținute în memorie pentru editare (și a rezultatului salvat, prin LATURA_MAX_REZULTAT). */
const LATURA_SURSA = 3000
/** Previzualizarea rezultatului se calculează mai mic, ca schimbarea filtrului să fie imediată. */
const LATURA_PREVIZUALIZARE = 1200

async function incarcaImagine(blob: Blob): Promise<Imagine> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const k = Math.min(1, LATURA_SURSA / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k))
  c.height = Math.max(1, Math.round(bmp.height * k))
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const d = ctx.getImageData(0, 0, c.width, c.height)
  return { data: d.data, width: d.width, height: d.height }
}

function laBlob(im: Imagine, calitate = 0.9): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = im.width
  c.height = im.height
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(im.data), im.width, im.height), 0, 0)
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('jpeg'))), 'image/jpeg', calitate))
}

/** Editorul unei poze: colțurile actului (trase cu mouse-ul sau cu degetul), rotire, filtru de scanare; salvarea înlocuiește
 * fișierul (originalul rămâne păstrat pe server) sau creează o copie „(editat)” alături. */
export default function EditorPoza({ fisier, onClose }: { fisier: Fisier; onClose: () => void }) {
  const { activeWorkspace, toast } = useApp()
  const [sursa, setSursa] = useState<Imagine | null>(null)
  const [vedere, setVedere] = useState<string | null>(null)          // URL-ul pozei afișate sub colțuri
  const [colturi, setColturi] = useState<Colturi | null>(null)
  const [filtru, setFiltru] = useState<Filtru>('scanare')
  const [mod, setMod] = useState<'decupare' | 'rezultat'>('decupare')
  const [rezultat, setRezultat] = useState<string | null>(null)
  const [eroare, setEroare] = useState('')
  const [salvez, setSalvez] = useState<'inlocuieste' | 'copie' | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tras = useRef<number | null>(null)
  const urls = useRef<string[]>([])
  useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), [])
  const url = (b: Blob) => { const u = URL.createObjectURL(b); urls.current.push(u); return u }

  useEffect(() => {
    let viu = true
    continutFisier(fisier.id, 'previzualizare')
      .then(incarcaImagine)
      .then(im => { if (viu) { setSursa(im); setColturi(colturiImplicite(im.width, im.height)) } })
      .catch(() => { if (viu) setEroare('Poza nu a putut fi deschisă pentru editare.') })
    return () => { viu = false }
  }, [fisier.id])

  // Poza afișată sub colțuri se regenerează doar când se schimbă sursa (la deschidere și la rotire).
  useEffect(() => {
    if (!sursa) return
    let viu = true
    laBlob(sursa, 0.85).then(b => { if (viu) setVedere(url(b)) }, () => {})
    return () => { viu = false }
  }, [sursa])

  // Rezultatul (mic) se recalculează la schimbarea colțurilor sau a filtrului, cât timp e afișat.
  useEffect(() => {
    if (mod !== 'rezultat' || !sursa || !colturi) return
    let viu = true
    const t = setTimeout(() => {
      const { w, h } = dimensiuneRezultat(colturi, LATURA_PREVIZUALIZARE)
      laBlob(aplicaFiltru(indreapta(sursa, colturi, w, h), filtru), 0.85).then(b => { if (viu) setRezultat(url(b)) }, () => {})
    }, 30)
    return () => { viu = false; clearTimeout(t) }
  }, [mod, sursa, colturi, filtru])

  const rotire = (sens: 'orar' | 'invers') => {
    if (!sursa || !colturi) return
    setColturi(rotesteColturi(colturi, sursa.width, sursa.height, sens))
    setSursa(roteste(sursa, sens))
  }

  const punctDin = (e: React.PointerEvent) => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m || !sursa) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: Math.min(sursa.width, Math.max(0, p.x)), y: Math.min(sursa.height, Math.max(0, p.y)) }
  }
  const muta = (e: React.PointerEvent) => {
    if (tras.current === null || !colturi) return
    const p = punctDin(e)
    if (!p) return
    const k = tras.current
    setColturi(colturi.map((c, i) => (i === k ? p : c)) as Colturi)
  }

  const salveaza = async (fel: 'inlocuieste' | 'copie') => {
    if (!sursa || !colturi) return
    setSalvez(fel)
    try {
      await new Promise(r => setTimeout(r, 20))              // butonul arată „se salvează” înainte de calcul
      const { w, h } = dimensiuneRezultat(colturi)
      const blob = await laBlob(aplicaFiltru(indreapta(sursa, colturi, w, h), filtru))
      if (fel === 'inlocuieste') {
        await inlocuiesteContinut(fisier.id, blob, numeEditat(fisier.nume))
        toast('Poza a fost înlocuită. Originalul rămâne păstrat: „Revino la original”, din meniul documentului.', 'ok')
      } else {
        if (!activeWorkspace || !fisier.clientId) throw new Error('Documentul nu mai aparține unui client.')
        await incarcaFisier({
          workspaceId: activeWorkspace.id, clientId: fisier.clientId, folderId: fisier.folderId, permiteDuplicat: true,
          file: new File([blob], numeEditat(fisier.nume), { type: 'image/jpeg' }),
        })
        toast(`Copia „${numeEditat(fisier.nume)}” a fost salvată lângă original.`, 'ok')
      }
      onClose()
    } catch (e) {
      toast((e as Error).message || 'Poza nu a putut fi salvată.', 'err')
    } finally {
      setSalvez(null)
    }
  }

  const raza = sursa ? Math.max(sursa.width, sursa.height) / 55 : 0
  const ocupat = salvez !== null

  return (
    <Modal onClose={onClose} className="ed-modal" ariaLabel="Editează poza">
      <div className="modal-head">
        <span className="modal-title">Editează · {fisier.nume}</span>
        <button className="modal-close" onClick={onClose} aria-label="Închide">×</button>
      </div>

      <div className="ed-bara">
        <div className="ed-grup" role="group" aria-label="Rotire">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => rotire('invers')} disabled={!sursa || ocupat} title="Rotește la stânga" aria-label="Rotește la stânga">↺</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => rotire('orar')} disabled={!sursa || ocupat} title="Rotește la dreapta" aria-label="Rotește la dreapta">↻</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!sursa || ocupat}
            onClick={() => { if (sursa) setColturi(colturiImplicite(sursa.width, sursa.height)); setMod('decupare') }}>Toată poza</button>
        </div>
        <div className="ed-grup ed-filtre" role="radiogroup" aria-label="Aspect">
          {(Object.keys(ETICHETA_FILTRU) as Filtru[]).map(f => (
            <button key={f} type="button" role="radio" aria-checked={filtru === f} disabled={!sursa || ocupat}
              className={`ed-filtru${filtru === f ? ' is-activ' : ''}`} onClick={() => { setFiltru(f); setMod('rezultat') }}>
              {ETICHETA_FILTRU[f]}
            </button>
          ))}
        </div>
        <div className="ed-grup ed-moduri" role="tablist" aria-label="Vedere">
          <button type="button" role="tab" aria-selected={mod === 'decupare'} className={`ed-mod${mod === 'decupare' ? ' is-activ' : ''}`}
            onClick={() => setMod('decupare')} disabled={!sursa}>Colțuri</button>
          <button type="button" role="tab" aria-selected={mod === 'rezultat'} className={`ed-mod${mod === 'rezultat' ? ' is-activ' : ''}`}
            onClick={() => setMod('rezultat')} disabled={!sursa}>Rezultat</button>
        </div>
      </div>

      <div className="ed-scena">
        {eroare ? <p className="ed-mesaj">{eroare}</p>
          : !sursa || !colturi || !vedere ? <p className="ed-mesaj" role="status">Se deschide poza…</p>
            : mod === 'decupare' ? (
              <svg ref={svgRef} className="ed-svg" viewBox={`0 0 ${sursa.width} ${sursa.height}`} preserveAspectRatio="xMidYMid meet"
                onPointerMove={muta} onPointerUp={() => { tras.current = null }} onPointerCancel={() => { tras.current = null }}>
                <image href={vedere} x={0} y={0} width={sursa.width} height={sursa.height} />
                {/* tot ce e în afara actului se întunecă */}
                <path className="ed-umbra" fillRule="evenodd"
                  d={`M0 0H${sursa.width}V${sursa.height}H0Z M${colturi.map(c => `${c.x} ${c.y}`).join(' L')}Z`} />
                <polygon className="ed-contur" points={colturi.map(c => `${c.x},${c.y}`).join(' ')} style={{ strokeWidth: raza / 4 }} />
                {colturi.map((c, i) => (
                  <g key={i} className="ed-colt" onPointerDown={e => { tras.current = i; (e.target as Element).setPointerCapture?.(e.pointerId) }}>
                    <circle cx={c.x} cy={c.y} r={raza * 2.2} className="ed-colt-zona" />
                    <circle cx={c.x} cy={c.y} r={raza} className="ed-colt-punct" style={{ strokeWidth: raza / 3 }} />
                  </g>
                ))}
              </svg>
            ) : rezultat ? <img className="ed-rezultat" src={rezultat} alt="Rezultatul editării" />
              : <p className="ed-mesaj" role="status">Se pregătește…</p>}
      </div>
      <p className="ed-indiciu doc-meta">
        {mod === 'decupare'
          ? 'Trage cele 4 cercuri pe colțurile actului: masa și fundalul dispar, iar actul se îndreaptă chiar dacă poza e făcută din unghi.'
          : '„Scanare” albește hârtia și scoate umbrele, păstrând culorile (ștampile, semnături); „Alb-negru” arată ca o fotocopie.'}
      </p>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose} disabled={ocupat}>Renunță</button>
        <button className="btn btn-outline-primary" onClick={() => void salveaza('copie')} disabled={!sursa || ocupat}>
          <BtnLabel busy={salvez === 'copie'} dark>Salvează ca fișier nou</BtnLabel>
        </button>
        <button className="btn btn-primary" onClick={() => void salveaza('inlocuieste')} disabled={!sursa || ocupat}
          title="Originalul rămâne păstrat și poate fi readus din meniul documentului">
          <BtnLabel busy={salvez === 'inlocuieste'}>Înlocuiește</BtnLabel>
        </button>
      </div>
    </Modal>
  )
}
