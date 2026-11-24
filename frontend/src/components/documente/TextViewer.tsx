import { useEffect, useState } from 'react'

const MAX_CARACTERE = 1_000_000      // un fișier text mai mare se afișează trunchiat (restul, la descărcare)

/** Text, CSV sau XML (ex. e-Factura, declarații). UTF-8, cu Windows-1250 ca rezervă pentru fișierele românești vechi. */
export default function TextViewer({ blob }: { blob: Blob }) {
  const [text, setText] = useState<{ continut: string; trunchiat: boolean } | null>(null)

  useEffect(() => {
    let anulat = false
    void blob.arrayBuffer().then(buf => {
      let continut: string
      try {
        continut = new TextDecoder('utf-8', { fatal: true }).decode(buf)
      } catch {
        continut = new TextDecoder('windows-1250').decode(buf)
      }
      continut = continut.replace(/^\uFEFF/, '')
      if (!anulat) setText({ continut: continut.slice(0, MAX_CARACTERE), trunchiat: continut.length > MAX_CARACTERE })
    })
    return () => { anulat = true }
  }, [blob])

  if (!text) return <div className="doc-preview-msg"><span className="spin spin-dark" /> Se deschide documentul…</div>
  return (
    <div className="doc-text-wrap">
      <pre className="doc-text">{text.continut}</pre>
      {text.trunchiat && <div className="doc-preview-msg">Fișierul e prea mare pentru a fi afișat complet. Descarcă-l pentru restul.</div>}
    </div>
  )
}
