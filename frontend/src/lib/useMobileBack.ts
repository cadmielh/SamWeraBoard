import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useIsMobile } from './useIsMobile'

/**
 * Pe telefon, un ecran de detaliu (client, dosar) deschis peste listă primește o intrare în istoric:
 * gestul / butonul „înapoi” al telefonului îl închide, în loc să părăsească pagina.
 * Întoarce funcția pentru butonul „Înapoi” din aplicație (consumă aceeași intrare din istoric).
 * Pe desktop nu face nimic: filele rămân cum sunt.
 */
export function useMobileBack(open: boolean, onBack: () => void): () => void {
  const isMobile = useIsMobile()
  const pushed = useRef(false)
  const onBackRef = useRef(onBack)
  useLayoutEffect(() => { onBackRef.current = onBack })

  useEffect(() => {
    if (!isMobile || !open) return
    // Aceeași adresă și aceeași stare a routerului: doar un pas în plus în istoric.
    if (!pushed.current) { window.history.pushState(window.history.state, ''); pushed.current = true }
    const onPop = () => { pushed.current = false; onBackRef.current() }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [isMobile, open])

  // Închis din aplicație (ex. ștergere): pasul din istoric nu mai are rost.
  useEffect(() => {
    if (open || !pushed.current) return
    pushed.current = false
    window.history.back()
  }, [open])

  return useCallback(() => {
    if (pushed.current) window.history.back()
    else onBackRef.current()
  }, [])
}
