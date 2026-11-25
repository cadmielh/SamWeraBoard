import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../Modal'
import BtnLabel from '../BtnLabel'
import { continutFisier, editabil, felPrevizualizare, formatMarime, type Fisier } from '../../lib/fisiere'
import { IconDescarca } from './icons'

const PdfViewer = lazy(() => import('./PdfViewer'))
const DocxViewer = lazy(() => import('./DocxViewer'))
const TextViewer = lazy(() => import('./TextViewer'))

interface Props {
  /** Fișierele prin care se poate naviga (←/→), în ordinea din listă; toate previzualizabile. */
  fisiere: Fisier[]
  start: number
  onClose: () => void
  onDownload: (f: Fisier) => Promise<void>
  /** Deschide editorul (decupare, îndreptare); doar pentru poze și doar dacă utilizatorul poate modifica. */
  onEdit?: (f: Fisier) => void
}

/** Previzualizarea imaginilor și a PDF-urilor (pdf.js, încărcat doar la nevoie). Conținutul vine decriptat de la server ca blob (cerere auditată, scop „previzualizare”)
 * și se afișează dintr-un URL local, eliberat la închidere. */
export default function FisierPreview({ fisiere, start, onClose, onDownload, onEdit }: Props) {
  const [index, setIndex] = useState(start)
  // Cererile pornite (o singură dată per document) și URL-urile create, eliberate la închiderea ferestrei.
  const cerute = useRef(new Set<string>())
  const urls = useRef<string[]>([])
  const montat = useRef(true)
  const [stari, setStari] = useState<Record<string, { url?: string; blob?: Blob; eroare?: string }>>({})
  const [pagini, setPagini] = useState<Record<string, number>>({})
  const [descarc, setDescarc] = useState(false)
  const f = fisiere[Math.min(index, fisiere.length - 1)]
  const fid = f?.id
  const fmime = f?.mime

  // Rezultatul ajunge în stare chiar dacă între timp s-a trecut la alt document (la întoarcere e deja gata); doar
  // închiderea ferestrei îl ignoră. Dependențele sunt id-ul și tipul, nu obiectul (care se recreează la fiecare snapshot).
  useEffect(() => {
    if (!fid || !fmime || cerute.current.has(fid)) return
    cerute.current.add(fid)
    // reîncercare după o eroare: mesajul vechi dispare, apare din nou „Se deschide…”
    setStari(s => {
      if (!s[fid]?.eroare) return s
      const rest = { ...s }
      delete rest[fid]
      return rest
    })
    continutFisier(fid, 'previzualizare')
      .then(blob => {
        // Tipul vine din metadate (lista albă a serverului), nu din răspuns: un blob nu devine niciodată HTML.
        const url = URL.createObjectURL(new Blob([blob], { type: fmime }))
        if (!montat.current) { URL.revokeObjectURL(url); return }
        urls.current.push(url)
        setStari(s => ({ ...s, [fid]: { url, blob } }))
      })
      .catch((e: Error) => {
        cerute.current.delete(fid)            // o eroare se poate reîncerca la întoarcerea pe document
        if (montat.current) setStari(s => ({ ...s, [fid]: { eroare: e.message } }))
      })
  }, [fid, fmime])

  useEffect(() => {
    montat.current = true
    const lista = urls.current
    return () => { montat.current = false; for (const u of lista) URL.revokeObjectURL(u) }
  }, [])

  useEffect(() => {
    const laTasta = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, fisiere.length - 1))
      if (e.key === 'ArrowLeft') setIndex(i => Math.max(i - 1, 0))
    }
    document.addEventListener('keydown', laTasta)
    return () => document.removeEventListener('keydown', laTasta)
  }, [fisiere.length])

  const laPagini = useCallback((n: number) => { if (fid) setPagini(p => ({ ...p, [fid]: n })) }, [fid])
  if (!f) return null
  const stare = stari[f.id]
  const nrPagini = pagini[f.id]
  const fel = felPrevizualizare(f.mime)
  const descarca = async () => {
    setDescarc(true)
    try { await onDownload(f) } finally { setDescarc(false) }
  }

  return (
    <Modal onClose={onClose} className="doc-preview" ariaLabel={`Previzualizare ${f.nume}`}>
      <div className="modal-head doc-preview-head">
        <div className="doc-preview-title">
          <span className="modal-title" title={f.nume}>{f.nume}</span>
          <span className="doc-meta">
            {formatMarime(f.marime)}
            {nrPagini ? ` · ${nrPagini} ${nrPagini === 1 ? 'pagină' : 'pagini'}` : ''}
            {fisiere.length > 1 ? ` · document ${index + 1} din ${fisiere.length}` : ''}
          </span>
        </div>
        <div className="doc-preview-actions">
          {fisiere.length > 1 && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIndex(i => i - 1)} disabled={index === 0} aria-label="Documentul anterior">←</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIndex(i => i + 1)} disabled={index >= fisiere.length - 1} aria-label="Documentul următor">→</button>
            </>
          )}
          {onEdit && (editabil(f.mime) || f.mime === 'application/pdf') && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(f)}
              title={f.mime === 'application/pdf' ? 'Rotește, mută sau șterge pagini' : 'Decupează, îndreaptă, albește fundalul'}>
              {f.mime === 'application/pdf' ? 'Pagini' : 'Editează'}
            </button>
          )}
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={descarca} disabled={descarc}>
            <BtnLabel busy={descarc} dark><IconDescarca size={15} /> Descarcă</BtnLabel>
          </button>
          <button className="modal-close" onClick={onClose} aria-label="Închide">×</button>
        </div>
      </div>
      <div className="doc-preview-body">
        {stare?.eroare && <div className="doc-preview-msg">{stare.eroare}</div>}
        {!stare && <div className="doc-preview-msg"><span className="spin spin-dark" /> Se deschide documentul…</div>}
        {stare?.url && fel === 'imagine' && <img className="doc-preview-img" src={stare.url} alt={f.nume} />}
        {stare?.blob && fel !== 'imagine' && (
          <Suspense fallback={<div className="doc-preview-msg"><span className="spin spin-dark" /> Se deschide documentul…</div>}>
            {fel === 'pdf' && <PdfViewer key={f.id} blob={stare.blob} onPagini={laPagini} />}
            {fel === 'word' && <DocxViewer key={f.id} blob={stare.blob} />}
            {fel === 'text' && <TextViewer key={f.id} blob={stare.blob} />}
          </Suspense>
        )}
      </div>
    </Modal>
  )
}
