import { useState, useRef, useCallback, useEffect } from 'react'

export interface DropdownPosition {
  top: number
  left: number
  width?: number
}

interface Options {
  /** Gap în px sub elementul-declanșator. Implicit 4. */
  gap?: number
  /** Dacă e setat, `left` e limitat ca dropdown-ul (cu această lățime) să rămână în viewport. */
  clampWidth?: number
  /** Dacă e true, lățimea dropdown-ului urmărește lățimea elementului-declanșator. */
  matchTriggerWidth?: boolean
  /** 'reposition' recalculează poziția la scroll/resize; 'close' (implicit) închide dropdown-ul. */
  onScroll?: 'reposition' | 'close'
}

/**
 * Poziționare + deschidere/închidere + click-în-afară pentru dropdown-urile cu
 * `position: fixed` calculată din `getBoundingClientRect()` a unui element-declanșator
 * (folosit de combobox-ul de căutare clienți și de meniurile de filtru pe coloană).
 */
export function usePositionedDropdown<T extends HTMLElement = HTMLDivElement>({
  gap = 4, clampWidth, matchTriggerWidth, onScroll = 'close',
}: Options = {}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<DropdownPosition | null>(null)
  const containerRef = useRef<T | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const reposition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    let left = rect.left
    if (clampWidth != null) {
      left = Math.max(8, Math.min(rect.left, window.innerWidth - clampWidth - 8))
    }
    setPosition({ top: rect.bottom + gap, left, width: matchTriggerWidth ? rect.width : undefined })
  }, [gap, clampWidth, matchTriggerWidth])

  const openAt = useCallback((trigger: HTMLElement) => {
    triggerRef.current = trigger
    reposition()
    setOpen(true)
  }, [reposition])

  const close = useCallback(() => { setOpen(false); setPosition(null) }, [])

  useEffect(() => {
    if (!open) return

    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onMouseDown)

    if (onScroll === 'reposition') {
      window.addEventListener('scroll', reposition, true)
      window.addEventListener('resize', reposition)
      return () => {
        document.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('scroll', reposition, true)
        window.removeEventListener('resize', reposition)
      }
    }

    const onWindowScroll = () => close()
    window.addEventListener('scroll', onWindowScroll, { passive: true, capture: true })
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', onWindowScroll, { capture: true })
    }
  }, [open, onScroll, reposition, close])

  return { open, position, containerRef, openAt, close }
}
