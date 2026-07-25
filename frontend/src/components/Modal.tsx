import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  onClose: () => void
  children: React.ReactNode
  className?: string
  ariaLabel?: string
  /** Stiluri inline suplimentare pentru cutia modalului (peste `.modal-box`) — pentru modale cu aspect custom. */
  boxStyle?: React.CSSProperties
  /** Stiluri inline suplimentare pentru fundal (peste `.modal-backdrop`). */
  backdropStyle?: React.CSSProperties
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(el => el.offsetParent !== null)
}

/**
 * Backdrop + focus-trap + Escape-to-close comune tuturor modalelor din aplicație.
 * Randează în portal pe `document.body` ca să nu depindă de poziționarea/`transform`-ul
 * ancestorilor din arborele React (ex. rânduri virtualizate).
 */
export default function Modal({ onClose, children, className, ariaLabel, boxStyle, backdropStyle }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const focusables = boxRef.current ? getFocusable(boxRef.current) : []
    ;(focusables[0] ?? boxRef.current)?.focus()
    return () => { previouslyFocused.current?.focus?.() }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Tab' && boxRef.current) {
        const focusables = getFocusable(boxRef.current)
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" style={backdropStyle} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div
        ref={boxRef}
        className={`modal-box${className ? ` ${className}` : ''}`}
        style={boxStyle}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
