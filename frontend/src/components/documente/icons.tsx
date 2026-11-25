import { ETICHETA_FAMILIE, familie } from '../../lib/fisiere'

export function IconFolder({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="doc-ico-folder">
      <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l2 2h7A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z" fill="currentColor" />
    </svg>
  )
}

/** Iconița unui fișier: foaie cu colț îndoit și eticheta tipului (PDF, IMG, DOC…), colorată pe familie. */
export function IconFisier({ mime }: { mime: string }) {
  const fam = familie(mime)
  return (
    <span className={`doc-ico-file doc-ico-file--${fam}`} aria-hidden>
      <svg width="20" height="24" viewBox="0 0 20 24"><path d="M3 1h9l6 6v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="currentColor" opacity=".14" stroke="currentColor" strokeWidth="1.2" /><path d="M12 1v6h6" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
      <span className="doc-ico-tag">{ETICHETA_FAMILIE[fam]}</span>
    </span>
  )
}

export function IconDescarca({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" />
    </svg>
  )
}

export function IconIncarca({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M2.5 13.5h11" />
    </svg>
  )
}

/** Cerere de documente: un plic cu o săgeată spre interior (clientul trimite actele). */
export function IconCerere({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6v6.5h11V6" />
      <path d="M2.5 6 8 9.5 13.5 6" />
      <path d="M8 1.5v4M6.3 3.8 8 5.5l1.7-1.7" />
    </svg>
  )
}

export function IconFolderNou({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.6 1.6h6.2a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" /><path d="M8 7.5v4M6 9.5h4" />
    </svg>
  )
}

/** Săgeată dublă pentru restrângerea (spre dreapta) sau extinderea (spre stânga) coloanei de documente. */
export function IconRestrange({ directie, size = 16 }: { directie: 'stanga' | 'dreapta'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={directie === 'stanga' ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M4 4l4 4-4 4M8.5 4l4 4-4 4" />
    </svg>
  )
}

/** Direcția sortării: săgeată cu bare în scară (crescător: de la scurt la lung). */
export function IconDirectie({ desc, size = 16 }: { desc: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={desc ? 'M4 3v10M1.8 10.8 4 13l2.2-2.2' : 'M4 13V3M1.8 5.2 4 3l2.2 2.2'} />
      <path d={desc ? 'M9 4h6M9 8h4M9 12h2' : 'M9 4h2M9 8h4M9 12h6'} />
    </svg>
  )
}

export function IconCautare({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden className="doc-ico-cautare">
      <circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" />
    </svg>
  )
}
