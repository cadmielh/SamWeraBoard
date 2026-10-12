// Conversii între formatul românesc (DD.MM.YYYY, folosit în documente și extragerea OCR)
// și formatul ISO (YYYY-MM-DD, cerut de <input type="date">).

const RO_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function roDateToISO(s: string): string {
  const m = RO_DATE_RE.exec(s.trim())
  if (!m) return ''
  const [, d, mo, y] = m
  return `${y}-${mo}-${d}`
}

export function isoDateToRo(s: string): string {
  const m = ISO_DATE_RE.exec(s.trim())
  if (!m) return ''
  const [, y, mo, d] = m
  return `${d}.${mo}.${y}`
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
