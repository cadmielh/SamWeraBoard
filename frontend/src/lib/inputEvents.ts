import type { WheelEvent } from 'react'

/** Comportament implicit de browser pe `<input type="number">`: dacă e
 * focusat, scroll-ul cu rotița îi schimbă valoarea în loc să deruleze
 * pagina — ușor de declanșat neintenționat (userul derulează pagina și
 * "nimerește" peste un câmp numeric deja focusat). blur() elimină focusul
 * înainte ca browserul să aplice scroll-ul ca modificare de valoare, iar
 * derularea paginii continuă normal. Se leagă pe onWheel: onWheel={blurNumberInputOnWheel}. */
export function blurNumberInputOnWheel(e: WheelEvent<HTMLInputElement>) {
  e.currentTarget.blur()
}
