import type { MouseEvent } from 'react'
import { flushSync } from 'react-dom'

type VTDocument = Document & { startViewTransition?: (cb: () => void) => unknown }

/** Aplică schimbarea de ecran printr-o tranziție a browserului (View Transitions), unde e suportată.
 *  Fără suport sau cu „mișcare redusă” în sistem, schimbarea se face direct. */
export function withViewTransition(update: () => void) {
  const d = document as VTDocument
  if (!d.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { update(); return }
  d.startViewTransition(() => flushSync(update))
}

/** Clic simplu (fără Ctrl/Cmd/Shift, buton stâng): doar acesta se preia; restul (filă nouă etc.) rămâne la browser. */
export function isPlainClick(e: MouseEvent) {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}
