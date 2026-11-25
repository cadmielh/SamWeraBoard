import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import Modal from '../Modal'
import BtnLabel from '../BtnLabel'
import { useApp } from '../../AppContext'
import { continutFisier, rearanjeazaPagini, type Fisier } from '../../lib/fisiere'
import EditorPoza from './EditorPoza'
import IconPencil from '../IconPencil'
import '../../styles/editor.css'

interface Pagina { p: number; r: number }
const LATIME_MINIATURA = 150
const MAX_MINIATURI = 200
/** Lățimea la care se desenează o pagină pentru editare (lizibilă la tipar, fără să încarce telefonul). */
const LATIME_EDITARE = 1700

/** Paginile unui PDF: rotire, mutare, ștergere și editare ca poză (decupare, îndreptare, „scanare”, pentru paginile
 * fotografiate). Miniaturile se desenează în browser (pdf.js, ca la previzualizare); rezultatul îl face serverul din
 * PDF-ul original, deci paginile needitate rămân neschimbate (text, calitate). */
export default function PaginiPdf({ fisier, onClose }: { fisier: Fisier; onClose: () => void }) {
  const { toast } = useApp()
  const [miniaturi, setMiniaturi] = useState<(string | null)[]>([])
  const [pagini, setPagini] = useState<Pagina[] | null>(null)
  const [eroare, setEroare] = useState('')
  const [salvez, setSalvez] = useState<'inlocuieste' | 'copie' | null>(null)
  // Paginile editate ca poză: indexul paginii originale → poza rezultată (și miniatura ei).
  const [inlocuiri, setInlocuiri] = useState<Record<number, { blob: Blob; url: string }>>({})
  const [editez, setEditez] = useState<{ p: number; blob: Blob } | null>(null)
  const [pregatesc, setPregatesc] = useState<number | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const urlRef = useRef<string[]>([])
  useEffect(() => () => urlRef.current.forEach(u => URL.revokeObjectURL(u)), [])

  useEffect(() => {
    let anulat = false
    let doc: PDFDocumentProxy | null = null
    const urls: string[] = []
    ;(async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      const blob = await continutFisier(fisier.id, 'previzualizare')
      doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, enableXfa: false }).promise
      if (anulat) return
      docRef.current = doc
      const n = doc.numPages
      setPagini(Array.from({ length: n }, (_, p) => ({ p, r: 0 })))
      setMiniaturi(Array(n).fill(null))
      for (let i = 0; i < Math.min(n, MAX_MINIATURI) && !anulat; i++) {
        const pag = await doc.getPage(i + 1)
        const v1 = pag.getViewport({ scale: 1 })
        const vp = pag.getViewport({ scale: LATIME_MINIATURA / v1.width })
        const c = document.createElement('canvas')
        c.width = Math.ceil(vp.width)
        c.height = Math.ceil(vp.height)
        await pag.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
        const b = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.8))
        if (!b || anulat) continue
        const u = URL.createObjectURL(b)
        urls.push(u)
        setMiniaturi(m => m.map((x, k) => (k === i ? u : x)))
      }
    })().catch(() => { if (!anulat) setEroare('PDF-ul nu a putut fi deschis.') })
    return () => { anulat = true; void doc?.destroy(); urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [fisier.id])

  const schimbat = !!pagini && (pagini.length !== miniaturi.length || pagini.some((x, i) => x.p !== i || x.r % 360 !== 0)
    || Object.keys(inlocuiri).length > 0)

  /** Pagina desenată mare, ca poză, pentru editor. */
  const editeaza = async (p: number) => {
    const doc = docRef.current
    if (!doc) return
    setPregatesc(p)
    try {
      const inl = inlocuiri[p]
      if (inl) { setEditez({ p, blob: inl.blob }); return }
      const pag = await doc.getPage(p + 1)
      const v1 = pag.getViewport({ scale: 1 })
      const vp = pag.getViewport({ scale: LATIME_EDITARE / v1.width })
      const c = document.createElement('canvas')
      c.width = Math.ceil(vp.width)
      c.height = Math.ceil(vp.height)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      await pag.render({ canvasContext: ctx, viewport: vp }).promise
      const b = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.92))
      if (b) setEditez({ p, blob: b })
    } catch {
      toast('Pagina nu a putut fi pregătită pentru editare.', 'err')
    } finally {
      setPregatesc(null)
    }
  }
  const roteste = (i: number, d: number) => setPagini(l => l && l.map((x, k) => (k === i ? { ...x, r: (x.r + d + 360) % 360 } : x)))
  const muta = (i: number, d: -1 | 1) => setPagini(l => {
    if (!l) return l
    const n = [...l]
    ;[n[i], n[i + d]] = [n[i + d], n[i]]
    return n
  })
  const sterge = (i: number) => setPagini(l => l && l.filter((_, k) => k !== i))

  const salveaza = async (fel: 'inlocuieste' | 'copie') => {
    if (!pagini?.length) return
    setSalvez(fel)
    try {
      const f = await rearanjeazaPagini(fisier.id, pagini, fel === 'copie',
        Object.fromEntries(Object.entries(inlocuiri).filter(([p]) => pagini.some(x => x.p === Number(p))).map(([p, v]) => [p, v.blob])))
      toast(fel === 'copie' ? `„${f.nume}” a fost salvat lângă original.`
        : 'Paginile au fost salvate. Originalul rămâne păstrat: „Revino la original”, din meniul documentului.', 'ok')
      onClose()
    } catch (e) {
      toast((e as Error).message || 'Paginile nu au putut fi salvate.', 'err')
    } finally {
      setSalvez(null)
    }
  }
  const ocupat = salvez !== null

  return (
    <Modal onClose={onClose} className="ed-modal" ariaLabel="Paginile documentului">
      <div className="modal-head">
        <span className="modal-title">Pagini · {fisier.nume}</span>
        <button className="modal-close" onClick={onClose} aria-label="Închide">×</button>
      </div>
      <div className="pg-scena">
        {eroare ? <p className="doc-meta">{eroare}</p>
          : !pagini ? <p className="doc-meta" role="status">Se deschide documentul…</p>
            : (
              <ol className="pg-grila">
                {pagini.map((x, i) => (
                  <li key={x.p} className="pg-pagina">
                    <div className="pg-miniatura">
                      {inlocuiri[x.p] || miniaturi[x.p]
                        ? <img src={inlocuiri[x.p]?.url ?? miniaturi[x.p]!} alt={`Pagina ${x.p + 1}`} style={{ transform: `rotate(${x.r}deg)` }} />
                        : <span className="doc-meta">{x.p < MAX_MINIATURI ? '…' : `Pagina ${x.p + 1}`}</span>}
                    </div>
                    <div className="pg-eticheta">
                      {i + 1}{x.p !== i ? <span className="doc-meta"> (era {x.p + 1})</span> : null}
                      {inlocuiri[x.p] && <span className="chip chip-primary pg-editata">editată</span>}
                    </div>
                    <div className="pg-actiuni">
                      <button type="button" className="doc-icon-btn" onClick={() => muta(i, -1)} disabled={i === 0 || ocupat} aria-label={`Mută pagina ${i + 1} înainte`} title="Mută înainte">←</button>
                      <button type="button" className="doc-icon-btn" onClick={() => roteste(i, -90)} disabled={ocupat} aria-label={`Rotește pagina ${i + 1} la stânga`} title="Rotește la stânga">↺</button>
                      <button type="button" className="doc-icon-btn" onClick={() => roteste(i, 90)} disabled={ocupat} aria-label={`Rotește pagina ${i + 1} la dreapta`} title="Rotește la dreapta">↻</button>
                      <button type="button" className="doc-icon-btn" onClick={() => void editeaza(x.p)} disabled={ocupat || pregatesc !== null}
                        aria-label={`Editează pagina ${i + 1} ca poză`} title="Decupează, îndreaptă, albește (pentru pagini fotografiate)">
                        {pregatesc === x.p ? '…' : <IconPencil size={12} />}
                      </button>
                      <button type="button" className="doc-icon-btn" onClick={() => muta(i, 1)} disabled={i === pagini.length - 1 || ocupat} aria-label={`Mută pagina ${i + 1} după`} title="Mută după">→</button>
                      <button type="button" className="doc-icon-btn pg-sterge" onClick={() => sterge(i)} disabled={pagini.length === 1 || ocupat} aria-label={`Șterge pagina ${i + 1}`} title="Șterge pagina">×</button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
      </div>
      <p className="ed-indiciu doc-meta">
        Rotește paginile scanate strâmb, mută-le în ordinea corectă sau șterge-le pe cele în plus. Creionul deschide pagina în
        editorul de poze (decupare, îndreptare, scanare), pentru paginile fotografiate. Celelalte pagini rămân neschimbate.{schimbat && pagini ? ` Rezultat: ${pagini.length} ${pagini.length === 1 ? 'pagină' : 'pagini'}.` : ''}
      </p>
      <div className="modal-footer">
        {schimbat && (
          <button className="btn btn-ghost" disabled={ocupat}
            onClick={() => { setPagini(miniaturi.map((_, p) => ({ p, r: 0 }))); setInlocuiri({}) }}>Anulează modificările</button>
        )}
        <button className="btn btn-ghost" onClick={onClose} disabled={ocupat}>Renunță</button>
        <button className="btn btn-outline-primary" onClick={() => void salveaza('copie')} disabled={!schimbat || ocupat}>
          <BtnLabel busy={salvez === 'copie'} dark>Salvează ca fișier nou</BtnLabel>
        </button>
        <button className="btn btn-primary" onClick={() => void salveaza('inlocuieste')} disabled={!schimbat || ocupat}
          title="Originalul rămâne păstrat și poate fi readus din meniul documentului">
          <BtnLabel busy={salvez === 'inlocuieste'}>Înlocuiește</BtnLabel>
        </button>
      </div>
      {editez && (
        <EditorPoza fisier={fisier} continut={editez.blob} titlu={`Pagina ${editez.p + 1} · ${fisier.nume}`}
          onClose={() => setEditez(null)}
          onRezultat={b => {
            const u = URL.createObjectURL(b)
            urlRef.current.push(u)
            setInlocuiri(m => ({ ...m, [editez.p]: { blob: b, url: u } }))
          }} />
      )}
    </Modal>
  )
}
