/** Un număr întreg în litere, ca în acte („10 (zece) lei”, „25 (douăzeci și cinci) lei”), de la 0 la 999 999.
 * Forma de masculin pentru unități (lei, de ex. „doi lei”); „o sută”/„o mie”, „două sute”/„două mii”, „de mii” de la 20.
 * Gol pentru valori în afara intervalului sau neîntregi — locul rămâne de completat, nu cu un text greșit. */
const UNITATI = ['zero', 'unu', 'doi', 'trei', 'patru', 'cinci', 'șase', 'șapte', 'opt', 'nouă']
const ZECE_NOUASPREZECE = ['zece', 'unsprezece', 'doisprezece', 'treisprezece', 'paisprezece', 'cincisprezece', 'șaisprezece',
  'șaptesprezece', 'optsprezece', 'nouăsprezece']
const ZECI = ['', '', 'douăzeci', 'treizeci', 'patruzeci', 'cincizeci', 'șaizeci', 'șaptezeci', 'optzeci', 'nouăzeci']

function subOSuta(n: number, feminin: boolean): string {
  if (n < 10) return feminin && n === 1 ? 'una' : feminin && n === 2 ? 'două' : UNITATI[n]
  if (n < 20) return feminin && n === 12 ? 'douăsprezece' : ZECE_NOUASPREZECE[n - 10]
  const z = ZECI[Math.floor(n / 10)], u = n % 10
  return u === 0 ? z : `${z} și ${subOSuta(u, feminin)}`
}

function subOMie(n: number, feminin: boolean): string {
  const s = Math.floor(n / 100), rest = n % 100
  const sute = s === 0 ? '' : s === 1 ? 'o sută' : s === 2 ? 'două sute' : `${UNITATI[s]} sute`
  if (rest === 0) return sute || 'zero'
  return [sute, subOSuta(rest, feminin)].filter(Boolean).join(' ')
}

export function numarInLitere(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return ''
  const mii = Math.floor(n / 1000), rest = n % 1000
  if (mii === 0) return subOMie(rest, false)
  // „mii” e feminin: „două mii”, „douăsprezece mii”, „douăzeci și una de mii”; „de” când ultimele două cifre fac ≥ 20 sau 0
  const ultime = mii % 100
  const partMii = mii === 1 ? 'o mie' : `${subOMie(mii, true)}${ultime === 0 || ultime >= 20 ? ' de' : ''} mii`
  return rest === 0 ? partMii : `${partMii} ${subOMie(rest, false)}`
}
