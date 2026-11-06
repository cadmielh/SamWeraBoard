import type { ReactNode } from 'react'

interface Props {
  name: string
  count: number
  open: boolean
  onToggle: () => void
  /** Acțiunile din dreapta: redenumire/ștergere (biblioteca), „selectează tot din folder” (generare). */
  actions?: ReactNode
}

/** Antetul unui folder de șabloane — se deschide/închide la click; folosit în biblioteca de șabloane și la generare. */
export default function TemplateFolderHeader({ name, count, open, onToggle, actions }: Props) {
  return (
    <div className="tfolder">
      <button type="button" className="tfolder-toggle" onClick={onToggle} aria-expanded={open}>
        <span className={`tfolder-chevron${open ? ' tfolder-chevron--open' : ''}`} aria-hidden>›</span>
        <span aria-hidden>📁</span>
        <span className="tfolder-name">{name}</span>
        <span className="tfolder-count">{count}</span>
      </button>
      {actions}
    </div>
  )
}
