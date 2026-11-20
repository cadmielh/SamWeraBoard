import { useSyncExternalStore } from 'react'

/** Pragul de telefon: sub el, bara laterală e înlocuită de bara de jos (vezi styles/mobile.css). */
export const MOBILE_QUERY = '(max-width: 768px)'

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** Ecran de telefon — pentru ce nu se poate rezolva doar din CSS (altă componentă, alt comportament). */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE_QUERY).matches, () => false)
}
