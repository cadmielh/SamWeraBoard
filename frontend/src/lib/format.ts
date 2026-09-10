/** Format RON unic pentru zona Financiar (DosarView/DosarModal) și Sumarul
 * lunar — până la 2 zecimale, dar fără zecimale afișate cât timp valoarea e
 * întreagă (400 -> "400", 400.5 -> "400,5", 487.93 -> "487,93"). */
export function formatRon(v: number): string {
  return v.toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
