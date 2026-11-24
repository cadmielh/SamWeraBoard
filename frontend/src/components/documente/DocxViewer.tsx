import { useEffect, useRef, useState } from 'react'

/** Previzualizare Word (.docx) cu docx-preview, încărcat doar la prima deschidere. Documentul e redat în pagină ca
 * elemente obișnuite (fără scripturi); stilurile lui rămân în container (clasa `docx`), imaginile vin ca date locale,
 * fonturile încorporate se ignoră (CSP-ul nu permite fonturi din blob), iar linkurile nu navighează nicăieri. */
export default function DocxViewer({ blob }: { blob: Blob }) {
  const ref = useRef<HTMLDivElement>(null)
  const [stare, setStare] = useState<'incarcare' | 'gata' | 'eroare'>('incarcare')

  useEffect(() => {
    let anulat = false
    ;(async () => {
      const { renderAsync } = await import('docx-preview')
      const el = ref.current
      if (anulat || !el) return
      el.replaceChildren()
      await renderAsync(blob, el, el, {
        className: 'docx', inWrapper: true, breakPages: true, ignoreFonts: true, useBase64URL: true,
        renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true, renderComments: false,
        experimental: false,
      })
      if (!anulat) setStare('gata')
    })().catch(() => { if (!anulat) setStare('eroare') })
    return () => { anulat = true }
  }, [blob])

  return (
    <div className="doc-docx-wrap">
      {stare === 'incarcare' && <div className="doc-preview-msg"><span className="spin spin-dark" /> Se deschide documentul…</div>}
      {stare === 'eroare' && <div className="doc-preview-msg">Documentul nu poate fi afișat aici. Descarcă-l pentru a-l deschide în Word.</div>}
      {/* Clicurile pe linkuri din document nu duc nicăieri: previzualizarea nu e un browser. */}
      <div ref={ref} className="doc-docx" hidden={stare === 'eroare'}
        onClickCapture={e => { if ((e.target as HTMLElement).closest('a')) e.preventDefault() }} />
    </div>
  )
}
