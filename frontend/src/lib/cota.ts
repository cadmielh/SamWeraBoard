// Cotă de participare — calcul implicit egal proporțional între asociați,
// folosit oriunde se adaugă/lipsește o cotă și trebuie un default rezonabil.
export function equalShare(n: number): string {
  if (n <= 0) return ''
  const val = Math.round((100 / n) * 100) / 100
  return `${Number.isInteger(val) ? val : val.toFixed(2)}%`
}

/** Extrage valoarea numerică dintr-o cotă introdusă ca text (ex: "33.33%" → 33.33). */
export function parsePercent(s: string): number {
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(s)
  return m ? parseFloat(m[1].replace(',', '.')) : 0
}

/** Suma cotelor unei liste de asociați — ar trebui să fie mereu 100%. */
export function sumCota(values: string[]): number {
  return Math.round(values.reduce((sum, v) => sum + parsePercent(v), 0) * 100) / 100
}

/** Toleranță pentru rotunjiri (ex: 3 asociați egali → 33.33% × 3 = 99.99%, nu 100). */
export const COTA_TOLERANCE = 0.5

export function isCotaTotalValid(values: string[]): boolean {
  if (values.length === 0) return true
  return Math.abs(sumCota(values) - 100) <= COTA_TOLERANCE
}
