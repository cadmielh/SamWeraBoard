// Cotă de participare — calcul implicit egal proporțional între asociați,
// folosit oriunde se adaugă/lipsește o cotă și trebuie un default rezonabil.
export function equalShare(n: number): string {
  if (n <= 0) return ''
  const val = Math.round((100 / n) * 100) / 100
  return `${Number.isInteger(val) ? val : val.toFixed(2)}%`
}
