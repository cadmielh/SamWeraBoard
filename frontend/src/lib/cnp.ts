// Portat din local_extractor.py (_validate_cnp) — trebuie ținut sincronizat cu acel fișier.
const CNP_WEIGHTS = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9]
const CNP_CENTURY: Record<number, string> = { 1: '19', 2: '19', 3: '18', 4: '18', 5: '20', 6: '20' }
// 7,8 = rezidenți străini (secol ambiguu), 9 = cetățeni străini — nevalidabile pe dată

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day)
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
}

/** Validare completă CNP: cifră de control (mod 11) + dată calendaristică reală embedded. */
export function isValidCNP(cnp: string): boolean {
  if (!/^\d{13}$/.test(cnp) || cnp[0] === '0') return false

  const digits = cnp.split('').map(Number)
  const total = digits.slice(0, 12).reduce((sum, d, i) => sum + d * CNP_WEIGHTS[i], 0)
  let check = total % 11
  if (check === 10) check = 1
  if (check !== digits[12]) return false

  const century = CNP_CENTURY[digits[0]]
  if (century) {
    const year = Number(century + cnp.slice(1, 3))
    const month = Number(cnp.slice(3, 5))
    const day = Number(cnp.slice(5, 7))
    if (!isValidCalendarDate(year, month, day)) return false
  }
  return true
}
