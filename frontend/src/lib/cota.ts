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

/** Valoarea nominală implicită a unei părți sociale — folosită când clientul n-are una setată (toți clienții vechi). */
export const VALOARE_PARTE_SOCIALA_DEFAULT = 10

/** Valoarea unei părți sociale a clientului (lei, număr întreg ≥ 1); 10 dacă lipsește sau e invalidă. */
export function valoareParteSociala(c: { valoareParteSociala?: number | null } | null | undefined): number {
  const v = c?.valoareParteSociala
  return v != null && Number.isInteger(v) && v >= 1 ? v : VALOARE_PARTE_SOCIALA_DEFAULT
}

/** Eroarea de afișat pentru valoarea părții sociale din formular ('' dacă e în regulă): număr întreg ≥ 1, iar
 * capitalul trebuie să se împartă exact în părți (nu există fracțiuni de parte socială). */
export function parteSocialaError(capitalSocial: number | null, valoare: number | null | undefined): string {
  if (valoare == null) return ''
  if (!Number.isInteger(valoare) || valoare < 1) return 'Valoarea unei părți sociale trebuie să fie un număr întreg de lei, cel puțin 1.'
  if (capitalSocial != null && capitalSocial > 0 && capitalSocial % valoare !== 0) {
    return `Capitalul de ${capitalSocial.toLocaleString('ro-RO')} lei nu se împarte exact în părți de ${valoare} lei.`
  }
  return ''
}
