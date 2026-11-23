import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Vizualizator PDF cu pdf.js, încărcat doar la prima previzualizare (biblioteca nu intră în pachetul principal).
 * Paginile se desenează pe canvas pe măsură ce intră în ecran, la lățimea containerului. Fără strat de text sau de
 * adnotări: linkurile, formularele și scripturile din PDF nu rulează. Merge la fel pe telefon (inclusiv iPhone, unde un
 * iframe ar arăta doar prima pagină) și nu cere relaxarea CSP-ului. */
export default function PdfViewer({ blob, onPagini }: { blob: Blob; onPagini?: (n: number) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [eroare, setEroare] = useState(false)
  const [latime, setLatime] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let anulat = false
    let doc: PDFDocumentProxy | null = null
    ;(async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, enableXfa: false }).promise
      if (anulat) { void doc.destroy(); return }
      setPdf(doc)
      onPagini?.(doc.numPages)
    })().catch(() => { if (!anulat) setEroare(true) })
    return () => { anulat = true; void doc?.destroy() }
  }, [blob, onPagini])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Paginile nu trec de 900px: pe ecrane late, textul rămâne la o mărime de citit.
    const ro = new ResizeObserver(([e]) => setLatime(Math.min(900, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className="doc-pdf">
      {eroare && <div className="doc-preview-msg">Documentul nu poate fi afișat aici. Descarcă-l pentru a-l deschide.</div>}
      {!eroare && !pdf && <div className="doc-preview-msg"><span className="spin spin-dark" /> Se deschide documentul…</div>}
      {pdf && latime > 0 && Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPagina key={i} pdf={pdf} numar={i + 1} latime={latime} />
      ))}
    </div>
  )
}

function PdfPagina({ pdf, numar, latime }: { pdf: PDFDocumentProxy; numar: number; latime: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [vizibila, setVizibila] = useState(false)
  const [raport, setRaport] = useState(1.414)          // înălțime / lățime; A4 până se citește pagina

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVizibila(true) }, { rootMargin: '150% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!vizibila) return
    let anulat = false
    let task: { cancel: () => void } | null = null
    void pdf.getPage(numar).then(page => {
      if (anulat) return
      const baza = page.getViewport({ scale: 1 })
      setRaport(baza.height / baza.width)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const vp = page.getViewport({ scale: (latime / baza.width) * dpr })
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      const t = page.render({ canvasContext: ctx, viewport: vp })
      task = t
      t.promise.catch(() => { /* anulată la schimbarea lățimii sau la închidere */ })
    })
    return () => { anulat = true; task?.cancel() }
  }, [pdf, numar, latime, vizibila])

  return (
    <canvas ref={canvasRef} className="doc-pdf-page" aria-label={`Pagina ${numar}`}
      style={{ width: latime, height: Math.round(latime * raport) }} />
  )
}
