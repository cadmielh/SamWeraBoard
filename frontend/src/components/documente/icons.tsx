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

const linie = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function IconCamera({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <path d="M2 5.5a1 1 0 0 1 1-1h2l1.2-1.8h3.6L11 4.5h2a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
      <circle cx="8" cy="8.5" r="2.4" />
    </svg>
  )
}

/** Mutarea în alt folder: folder cu săgeată. */
export function IconMuta({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.6 1.6h6.2a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
      <path d="M5.5 9.3h5M8.8 7.6l1.7 1.7-1.7 1.7" />
    </svg>
  )
}

export function IconCopiaza({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.3" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  )
}

/** Mesaj (WhatsApp, SMS): bulă de conversație. */
export function IconMesaj({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <path d="M8 2.5c3.3 0 6 2.2 6 5s-2.7 5-6 5c-.8 0-1.6-.1-2.3-.4L2.5 13.5l.9-2.7C2.5 9.9 2 8.8 2 7.5c0-2.8 2.7-5 6-5z" />
    </svg>
  )
}

export function IconEmail({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <rect x="2" y="3.5" width="12" height="9" rx="1.2" />
      <path d="m2.5 4.5 5.5 4 5.5-4" />
    </svg>
  )
}

export function IconQr({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <rect x="2" y="2" width="4.5" height="4.5" rx=".6" /><rect x="9.5" y="2" width="4.5" height="4.5" rx=".6" />
      <rect x="2" y="9.5" width="4.5" height="4.5" rx=".6" /><path d="M9.5 9.5h1.5v1.5M14 9.5v1.5M9.5 14h4.5v-1.5M12.5 12.5" />
    </svg>
  )
}

export function IconLink({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.9.9" />
      <path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.9-.9" />
    </svg>
  )
}

/** Trimiterea (din nou) a linkului: avion de hârtie. */
export function IconTrimite({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <path d="M14 2 7 9M14 2l-4.5 12L7 9 2 6.5z" />
    </svg>
  )
}

export function IconBifa({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} strokeWidth={2} aria-hidden>
      <path d="m3 8.5 3.2 3.2L13 5" />
    </svg>
  )
}

export function IconX({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} strokeWidth={1.9} aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

/** Prelungirea unui termen: ceas cu săgeată. */
export function IconPrelungeste({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <path d="M13.5 8A5.5 5.5 0 1 1 11.8 4" /><path d="M13.6 2.2v2.5h-2.5" /><path d="M8 5.2V8l1.8 1.2" />
    </svg>
  )
}

/** Extragerea datelor din act în fișă: actul cu raza de scanare. */
export function IconExtrage({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <path d="M4 6V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M4 10v3a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3M1.5 8h13" />
    </svg>
  )
}

export function IconTipar({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} strokeWidth={1.5} aria-hidden>
      <path d="M4.5 6V2.5h7V6M4.5 11.5h-2a1 1 0 0 1-1-1v-3.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-2" />
      <path d="M4.5 9.5h7v4h-7z" />
    </svg>
  )
}

/** Unirea mai multor documente într-unul: două foi care converg spre a treia. */
export function IconUneste({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} strokeWidth={1.5} aria-hidden>
      <path d="M2 2.5h4v4H2zM2 9.5h4v4H2zM10 6h4v4h-4zM6 4.5h1.5L10 8M6 11.5h1.5L10 8" />
    </svg>
  )
}

/** Decupare: cele două unghiuri ale unei rame de tăiere. */
export function IconDecupeaza({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...linie} aria-hidden>
      <path d="M4.5 1.5v10h10M1.5 4.5h10v10" />
    </svg>
  )
}
