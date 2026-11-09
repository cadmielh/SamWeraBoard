import type { Client, Persoana } from '../types'
import { isValidRoDate } from './dates'

/** Durata societății și mandatul administratorilor (Legea 31/1990): durata e element obligatoriu al actului
 * constitutiv (art. 7 lit. h la SRL, art. 8 lit. j la SA); la SRL asociații fixează și durata mandatului (art. 77
 * alin. 1, aplicabil prin art. 197 alin. 3), fără limită maximă; la SA mandatul nu poate depăși 4 ani. */

export type DurataTip = 'nedeterminata' | 'ani' | 'data'

/** O durată aleasă de utilizator. `ani` (întreg, ca text) contează doar la tipul „ani”, `data` (zz.ll.aaaa) doar la
 * „data” — celelalte rămân goale, ca documentul Firestore să nu țină valori fără sens. */
export interface Durata {
  tip: DurataTip
  ani: string
  data: string
}

/** Mandatul unui administrator. „Din prezent” (`aprobare`) curge, juridic, de la aprobarea dosarului la ONRC —
 * înmatricularea, la o firmă nouă, sau înregistrarea mențiunii, la una existentă —, dată aflată abia după aprobare:
 * `dataNumire` rămâne goală până atunci (în așteptare, fără scadență). „De la o dată anume” (`data`): data e știută
 * de la început (ex. data hotărârii). */
export interface Mandat {
  durata: Durata
  inceput: 'aprobare' | 'data'
  dataNumire: string
}

export const DURATA_NEDETERMINATA: Durata = { tip: 'nedeterminata', ani: '', data: '' }

/** Limita legală a mandatului la SA; la SRL nu există una. */
export const MANDAT_SA_MAX_ANI = 4

/** Sub acest număr de zile până la expirare, termenul se semnalează în fișă și în lista de clienți. */
export const ZILE_AVERTIZARE = 90

/** Câte luni înainte de expirarea duratei societății trebuie consultați asociații despre prelungire (art. 227 alin. 2). */
export const LUNI_CONSULTARE_PRELUNGIRE = 3

const esteSA = (formaJuridica?: string) => formaJuridica === 'SA'

/** Variantele oferite pentru mandat: la SA mandatul e mereu pe durată determinată. */
export function tipuriMandat(formaJuridica?: string): DurataTip[] {
  return esteSA(formaJuridica) ? ['ani', 'data'] : ['nedeterminata', 'ani', 'data']
}

/** Mandatul unui administrator nou: nedeterminat la SRL, 4 ani la SA, din prezent (de la aprobarea dosarului). */
export function mandatImplicit(formaJuridica?: string): Mandat {
  return {
    durata: esteSA(formaJuridica) ? { tip: 'ani', ani: String(MANDAT_SA_MAX_ANI), data: '' } : { ...DURATA_NEDETERMINATA },
    inceput: 'aprobare',
    dataNumire: '',
  }
}

/** Dosarul a fost aprobat la `data` (ex. înmatricularea, la ieșirea din „în înființare”): mandatele „din prezent” încă
 * fără dată o primesc pe aceasta; cele care au deja o dată rămân neatinse. */
export function confirmaAprobarea(admini: Persoana[], data: string): Persoana[] {
  if (!isValidRoDate(data)) return admini
  return admini.map(p => p.mandat?.inceput === 'aprobare' && !p.mandat.dataNumire.trim()
    ? { ...p, mandat: { ...p.mandat, dataNumire: data.trim() } }
    : p)
}

/** Golește câmpurile care nu aparțin tipului ales (ex. anii rămași după trecerea pe „până la o dată”). */
export function normalizeDurata(d: Durata): Durata {
  return { tip: d.tip, ani: d.tip === 'ani' ? d.ani : '', data: d.tip === 'data' ? d.data : '' }
}

/** Forma scurtă, după „ca fiind …” / „durata este …”: „nedeterminată” / „de 10 ani” / „de 25 de ani” / „până la data
 * de …”. „de” înaintea lui „ani” de la 20 în sus (și la 100, 120…), ca în română; gol cât timp alegerea e incompletă. */
export function durataText(tip: DurataTip, ani: string, data: string): string {
  if (tip === 'nedeterminata') return 'nedeterminată'
  if (tip === 'data') return data.trim() ? `până la data de ${data.trim()}` : ''
  const n = Number(ani)
  if (!Number.isInteger(n) || n <= 0) return ''
  if (n === 1) return 'de un an'
  return n % 100 === 0 || n % 100 >= 20 ? `de ${n} de ani` : `de ${n} ani`
}

export const durataScurta = (d?: Durata | null): string => d ? durataText(d.tip, d.ani, d.data) : ''

/** Forma de frază întreagă: „pe durată nedeterminată” / „pe o perioadă de 10 ani” / „până la data de 31.12.2035”. */
export function durataFraza(d?: Durata | null): string {
  const scurt = durataScurta(d)
  if (!d || !scurt) return ''
  if (d.tip === 'nedeterminata') return 'pe durată nedeterminată'
  return d.tip === 'ani' ? `pe o perioadă ${scurt}` : scurt
}

/** Numărul de ani, doar la tipul „ani” (altfel gol — un șablon care cere anii n-are ce scrie la o durată nedeterminată). */
export const durataAni = (d?: Durata | null): string => d?.tip === 'ani' && durataScurta(d) ? String(Number(d.ani)) : ''

export const durateEgale = (a: Durata, b: Durata): boolean =>
  a.tip === b.tip && (a.tip !== 'ani' || Number(a.ani) === Number(b.ani)) && (a.tip !== 'data' || a.data.trim() === b.data.trim())

/** Durata comună a tuturor administratorilor, sau null dacă diferă ori lipsește la vreunul. */
export function durataComuna(admini: Persoana[]): Durata | null {
  const first = admini[0]?.mandat?.durata
  if (!first || !admini.every(p => p.mandat && durateEgale(p.mandat.durata, first))) return null
  return first
}

const RO = /^(\d{2})\.(\d{2})\.(\d{4})$/
const pad = (n: number) => String(n).padStart(2, '0')

export function roToDate(s: string): Date | null {
  if (!isValidRoDate(s)) return null
  const [, d, m, y] = RO.exec(s.trim())!
  return new Date(Number(y), Number(m) - 1, Number(d))
}

export const dateToRo = (d: Date): string => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`

/** Termen în ani/luni (Cod civil, art. 2552): se împlinește în ziua corespunzătoare din ultima lună; dacă ea nu are o
 * asemenea zi (29 februarie, 31 ale lunii), în ultima zi a lunii. */
function adaugaLuni(start: Date, luni: number): Date {
  const target = new Date(start.getFullYear(), start.getMonth() + luni, 1)
  const ultimaZi = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(start.getDate(), ultimaZi))
}

/** Data expirării (zz.ll.aaaa) sau gol: nedeterminată, ori „ani” fără dată de început cunoscută. */
export function dataExpirare(d: Durata | undefined | null, inceput: string): string {
  if (!d) return ''
  if (d.tip === 'data') return isValidRoDate(d.data) ? d.data.trim() : ''
  if (d.tip !== 'ani' || !durataAni(d)) return ''
  const start = roToDate(inceput)
  return start ? dateToRo(adaugaLuni(start, 12 * Number(d.ani))) : ''
}

/** Termenul până la care trebuie consultați asociații despre prelungirea duratei societății. */
export function dataConsultarePrelungire(expirare: string): string {
  const exp = roToDate(expirare)
  return exp ? dateToRo(adaugaLuni(exp, -LUNI_CONSULTARE_PRELUNGIRE)) : ''
}

/** Data de început a mandatului, sau gol dacă nu se știe încă (dosar neaprobat, numire fără dată). */
export function inceputMandat(m: Mandat): string {
  return isValidRoDate(m.dataNumire) ? m.dataNumire.trim() : ''
}

export type StareTermen =
  | { stare: 'nedeterminat' }
  /** Durata e aleasă, dar data de început nu se știe încă — fără scadență până la confirmare. */
  | { stare: 'asteptare'; motiv: 'inmatriculare' | 'aprobare' | 'numire' }
  | { stare: 'incomplet' }
  | { stare: 'activ' | 'curand' | 'expirat'; expira: string; zile: number }

function stareDupaExpirare(expira: string, from: Date): StareTermen {
  const azi = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const zile = Math.round((roToDate(expira)!.getTime() - azi.getTime()) / 86_400_000)
  return { stare: zile < 0 ? 'expirat' : zile <= ZILE_AVERTIZARE ? 'curand' : 'activ', expira, zile }
}

export function stareMandat(m: Mandat | undefined, from: Date = new Date()): StareTermen {
  if (!m || !durataScurta(m.durata)) return { stare: 'incomplet' }
  if (m.durata.tip === 'nedeterminata') return { stare: 'nedeterminat' }
  const expira = dataExpirare(m.durata, inceputMandat(m))
  if (expira) return stareDupaExpirare(expira, from)
  return { stare: 'asteptare', motiv: m.inceput === 'aprobare' ? 'aprobare' : 'numire' }
}

/** Durata societății curge de la înmatriculare. */
export function stareDurataSocietate(d: Durata | undefined, dataInmatricularii?: string, from: Date = new Date()): StareTermen {
  if (!d || !durataScurta(d)) return { stare: 'incomplet' }
  if (d.tip === 'nedeterminata') return { stare: 'nedeterminat' }
  const expira = dataExpirare(d, dataInmatricularii ?? '')
  return expira ? stareDupaExpirare(expira, from) : { stare: 'asteptare', motiv: 'inmatriculare' }
}

/** Starea unui termen (mandat, durata societății), pe înțelesul utilizatorului. */
export function termenText(s: StareTermen): string {
  switch (s.stare) {
    case 'nedeterminat': return 'Pe durată nedeterminată'
    case 'incomplet': return 'Necompletat'
    case 'asteptare': return s.motiv === 'aprobare' ? 'Din prezent — data se completează după aprobarea dosarului la ONRC'
      : s.motiv === 'inmatriculare' ? 'Curge de la înmatriculare — data se află după aprobarea dosarului' : 'Lipsește data numirii'
    case 'expirat': return `Expirat pe ${s.expira}`
    case 'curand': return `Expiră pe ${s.expira} (${s.zile === 0 ? 'astăzi' : s.zile === 1 ? 'mâine' : `în ${s.zile} zile`})`
    case 'activ': return `Expiră pe ${s.expira}`
  }
}

export interface TermenClient {
  titlu: string
  stare: StareTermen
}

/** Termenele urmărite pentru o societate: mandatele administratorilor, durata societății și — la o durată determinată —
 * termenul până la care trebuie consultați asociații despre prelungire (art. 227 alin. 2). Doar cele cu o durată aleasă. */
export function termeneClient(c: Pick<Client, 'tipClient' | 'administratori' | 'durataSocietate' | 'dataInmatricularii'>, from: Date = new Date()): TermenClient[] {
  if (c.tipClient === 'PF') return []
  const out: TermenClient[] = (c.administratori ?? [])
    .filter(p => p.mandat)
    .map(p => ({ titlu: `Mandat ${`${p.nume} ${p.prenume}`.trim() || 'administrator'}`, stare: stareMandat(p.mandat, from) }))
  const durata = stareDurataSocietate(c.durataSocietate, c.dataInmatricularii, from)
  if (c.durataSocietate) out.push({ titlu: 'Durata societății', stare: durata })
  if ('expira' in durata) {
    const consultare = dataConsultarePrelungire(durata.expira)
    if (consultare) out.push({ titlu: 'Consultarea asociaților privind prelungirea duratei', stare: stareDupaExpirare(consultare, from) })
  }
  return out
}

/** Termenele care cer atenție (expiră în cel mult ZILE_AVERTIZARE zile sau au expirat), cele mai apropiate întâi. */
export function termeneUrgente(c: Parameters<typeof termeneClient>[0], from: Date = new Date()): TermenClient[] {
  return termeneClient(c, from)
    .filter(t => t.stare.stare === 'curand' || t.stare.stare === 'expirat')
    .sort((a, b) => ('zile' in a.stare ? a.stare.zile : 0) - ('zile' in b.stare ? b.stare.zile : 0))
}

/** Avertizare (nu blocare) pentru un mandat peste limita legală a SA. Mesajul e gol când nu e nimic de semnalat. */
export function avertizareMandat(formaJuridica: string | undefined, m: Mandat): string {
  if (!esteSA(formaJuridica)) return ''
  const limita = `La SA, mandatul administratorului nu poate depăși ${MANDAT_SA_MAX_ANI} ani.`
  if (m.durata.tip === 'nedeterminata') return limita
  if (m.durata.tip === 'ani') return Number(m.durata.ani) > MANDAT_SA_MAX_ANI ? limita : ''
  const start = inceputMandat(m)
  const maxim = start ? dataExpirare({ tip: 'ani', ani: String(MANDAT_SA_MAX_ANI), data: '' }, start) : ''
  const exp = roToDate(m.durata.data)
  return maxim && exp && exp > roToDate(maxim)! ? limita : ''
}
