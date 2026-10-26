// Conversii între formatul românesc (DD.MM.YYYY, folosit în documente și extragerea OCR)
// și formatul ISO (YYYY-MM-DD, cerut de <input type="date">).

const RO_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Nr. de zile din lună (1-indexată, ca în zz.ll.aaaa) — ține cont de anii bisecți
 * (`new Date(year, month, 0)` e ultima zi a lunii `month`, pentru că luna lui JS e 0-indexată). */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate()
}

/** Verifică nu doar formatul zz.ll.aaaa, ci și plauzibilitatea reală a datei — luna 1-12 și
 * ziua existentă efectiv în lună (29.02 valid doar în anii bisecți, nu există 31.04 etc.). */
export function isValidRoDate(s: string): boolean {
  const m = RO_DATE_RE.exec(s.trim())
  if (!m) return false
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month, year)
}

export function roDateToISO(s: string): string {
  if (!isValidRoDate(s)) return ''
  const m = RO_DATE_RE.exec(s.trim())!
  const [, d, mo, y] = m
  return `${y}-${mo}-${d}`
}

/**
 * Mesaj de eroare pentru ziua/luna/anul tastate până acum (parțial sau complet) în DateFieldInput.
 * Zi/lună evident greșite (zz>31, ll>12 sau 00) se semnalează imediat ce segmentul respectiv e
 * complet — fără să aștepte restul datei; plauzibilitatea completă (zile-în-lună, ani bisecți,
 * ex. 30.02 sau 31.04) abia după ce s-au scris toate cele 8 cifre. Returnează null dacă nu e
 * (încă) nimic de semnalat.
 */
export function roDateInputError(value: string): string | null {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  const day = Number(digits.slice(0, 2) || '0')
  const month = Number(digits.slice(2, 4) || '0')
  if (digits.length >= 2 && (day < 1 || day > 31)) return 'Zi invalidă'
  if (digits.length >= 4 && (month < 1 || month > 12)) return 'Lună invalidă'
  if (digits.length === 8) {
    const year = Number(digits.slice(4, 8))
    const max = daysInMonth(month, year)
    if (day > max) return `Luna ${month} are ${max} de zile`
  }
  return null
}

/** true dacă textul RO introdus NU e gol dar nu reprezintă o dată completă/validă —
 * folosit pentru a bloca salvarea, nu doar afișarea erorii de tastare (`roDateInputError`,
 * care nu semnalează un câmp pur și simplu neterminat, doar unul cu zi/lună clar greșite). */
export function isIncompleteOrInvalidRoDate(ro: string): boolean {
  return ro.trim() !== '' && !roDateToISO(ro)
}

export function isoDateToRo(s: string): string {
  const m = ISO_DATE_RE.exec(s.trim())
  if (!m) return ''
  const [, y, mo, d] = m
  return `${d}.${mo}.${y}`
}

/**
 * Scheletul complet „zz.ll.aaaa", cu cifrele deja introduse suprapuse peste literele
 * corespunzătoare — același efect vizual ca la `input[type=date]` nativ, care arată
 * „zz/ll/aaaa" cu segmentele suprascrise pe măsură ce se tastează. Vezi DateFieldInput.
 */
export function roDateInputMask(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  const day = (digits.slice(0, 2) + 'zz').slice(0, 2)
  const month = (digits.slice(2, 4) + 'll').slice(0, 2)
  const year = (digits.slice(4, 8) + 'aaaa').slice(0, 4)
  return `${day}.${month}.${year}`
}

/**
 * Reconstituie textul canonic „zz.ll.aaaa" (cu punctele la locul lor, vezi comentariul de la
 * începutul fișierului) dintr-un buffer de 0-8 cifre — DateFieldInput trebuie să propage prin
 * `onChange` mereu acest format, nu cifrele brute: `roDateToISO`/`isValidRoDate`/`splitDigitBoxes`
 * (anexa1Filler.ts etc.) cer punctele literal, iar fără ele un text complet și corect tastat
 * (ex. „15042026") n-ar fi niciodată recunoscut ca dată validă — exact bug-ul găsit la verificarea
 * manuală a fix-ului de validare la salvare: o dată completă, corect tastată, era blocată la
 * Salvare pentru că `roDateToISO` nu o putea parsa deloc, nu doar o dată cu adevărat incompletă. */
export function roDigitsToPartialDate(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`
}

/** Poziția din șirul-schelet (10 caractere) unde ar trebui pus cursorul, imediat după
 * ultima cifră reală introdusă — sare peste punctele fixe de la pozițiile 2 și 5. */
export function roDateInputCaretPos(digitCount: number): number {
  const table = [0, 1, 3, 4, 6, 7, 8, 9, 10]
  return table[Math.min(Math.max(digitCount, 0), 8)]
}

/**
 * Inversul lui `roDateInputCaretPos` — mapează poziția cursorului din șirul-schelet (de
 * exemplu, luată de unde a dat click utilizatorul) la indexul cifrei (0-7) pe care ar
 * suprascrie/șterge-o o tastare la poziția respectivă, sau 8 dincolo de ultima cifră
 * (poziție de adăugare). Punctele (pozițiile 2 și 5) nu sunt editabile, așa că se rotunjesc
 * înainte, spre cifra următoare.
 */
export function roDateInputSlotAtCaret(caretPos: number): number {
  const normalized = caretPos === 2 ? 3 : caretPos === 5 ? 6 : caretPos
  const starts = [0, 1, 3, 4, 6, 7, 8, 9, 10]
  const idx = starts.indexOf(normalized)
  return idx === -1 ? 8 : idx
}

/** Formatează un obiect Date ca DD.MM.YYYY (nu ne bazăm pe toLocaleDateString('ro-RO'),
 * ca formatul să fie identic peste tot în aplicație, indiferent de locale-ul browserului). */
export function formatDateRo(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}

/** Parsează un string ISO simplu `yyyy-mm-dd` (fără oră — dataAdmiterii/dataPlanificare,
 * introduse manual din picker, nu din Firestore Timestamp) ca dată LOCALĂ, nu UTC.
 * `new Date('2026-01-15')` (fără oră) e interpretat de JS ca UTC midnight — comparat cu
 * limite construite local (`new Date(y,m,d)`, ca în periodBounds), poate cădea în ziua
 * greșită lângă frontiere, în funcție de fusul orar al browserului. */
export function parseIsoDateLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const m = ISO_DATE_RE.exec(iso.trim())
  if (!m) return null
  const [, y, mo, d] = m
  return new Date(Number(y), Number(mo) - 1, Number(d))
}

/**
 * Câmpurile "createdAt"/"completedAt" sunt tipate `string | null` dar, la
 * runtime, conțin un Firestore `Timestamp` (obiect cu `.toDate()`/`.seconds`)
 * imediat după citirea din Firestore — devin string ISO doar în starea
 * optimistă locală, între scriere și confirmare. `.slice()`/`new Date(str)`
 * pe valoarea brută ar crăpa pe Timestamp-uri reale; această funcție
 * normalizează ambele forme.
 */
export function toDateSafe(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate()
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    return new Date((value as { seconds: number }).seconds * 1000)
  }
  return null
}
