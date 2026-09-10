import type { Dosar, FacturareConfig } from '../types'
import { DEFAULT_FACTURARE_CONFIG } from '../types'
import { toDateSafe } from './dates'

export interface DosarMonthStats {
  totalDosare: number
  facturate: number
  tarifClientTotal: number
  tarifClientFacturat: number
  profitSamiTotal: number
  profitSamiFacturat: number
  profitAdiTotal: number
  profitAdiFacturat: number
}

export interface DosarFinanciar {
  cuvenitSami: number
  cuvenitAdi: number
  caa: number
  impozitProfit: number
  profitSami: number
  profitAdi: number
}

type DosarFinanciarInput = Pick<Dosar, 'tarifClient' | 'taxeOnrc' | 'certificatConstatator' | 'esteClientAdi' | 'semnaturaElectronica'>

/** Split-ul profitului Sami/Adi pe un dosar — formulele din foaia „Dosare" a
 * fisiere_template/Facturare_Sami_Adi.xlsx (coloanele Cuvenit Sami/Adi, CAA,
 * Impozit profit, Profit Sami/Adi), plus regula nouă: split-ul cu Adi se
 * aplică DOAR dacă dosarul are semnătură electronică — altfel tot profitul
 * (minus costurile) rămâne la Sami. */
export function calculDosarFinanciar(d: DosarFinanciarInput, config: FacturareConfig = DEFAULT_FACTURARE_CONFIG): DosarFinanciar {
  const valoare = d.tarifClient ?? 0
  const costuri = (d.taxeOnrc ?? 0) + (d.certificatConstatator ?? 0)

  if (!d.semnaturaElectronica || valoare === 0) {
    return { cuvenitSami: valoare, cuvenitAdi: 0, caa: 0, impozitProfit: 0, profitSami: valoare - costuri, profitAdi: 0 }
  }

  const cotaSami = d.esteClientAdi ? config.cotaSamiClientiAdi : config.cotaSamiClientiProprii
  const cuvenitSami = valoare * cotaSami
  const cuvenitAdi = valoare - cuvenitSami
  const caa = config.caaProcent * valoare
  const impozitProfit = config.impozitProfitCota * cuvenitAdi
  const profitSami = cuvenitSami - (caa * cuvenitSami) / valoare - costuri
  const profitAdi = cuvenitAdi - (caa * cuvenitAdi) / valoare - impozitProfit

  return { cuvenitSami, cuvenitAdi, caa, impozitProfit, profitSami, profitAdi }
}

const EMPTY_STATS: DosarMonthStats = {
  totalDosare: 0, facturate: 0, tarifClientTotal: 0, tarifClientFacturat: 0,
  profitSamiTotal: 0, profitSamiFacturat: 0, profitAdiTotal: 0, profitAdiFacturat: 0,
}

export type StatsPeriod = 'luna' | 'trimestru' | 'an' | 'total'

export const LUNI = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
]

export function trendColor(delta: number, up: boolean): string {
  if (delta === 0) return 'var(--s400)'
  const isGood = (delta > 0) === up
  return isGood ? 'var(--g600)' : 'var(--r600)'
}

/** Statistici pe un array de dosare deja preluat pentru o singură perioadă —
 * folosite de cele 4 carduri din DosarStatsPanel (Număr dosare, Tarife
 * aplicate clienților, Profit Sami, De facturat către Adi). */
export function computeDosarStats(dosare: Dosar[], config: FacturareConfig = DEFAULT_FACTURARE_CONFIG): DosarMonthStats {
  if (dosare.length === 0) return EMPTY_STATS
  return dosare.reduce((acc, d) => {
    const { profitSami, profitAdi } = calculDosarFinanciar(d, config)
    const tarifClient = d.tarifClient ?? 0
    acc.totalDosare += 1
    acc.tarifClientTotal += tarifClient
    acc.profitSamiTotal += profitSami
    acc.profitAdiTotal += profitAdi
    if (d.facturat) {
      acc.facturate += 1
      acc.tarifClientFacturat += tarifClient
      acc.profitSamiFacturat += profitSami
      acc.profitAdiFacturat += profitAdi
    }
    return acc
  }, { ...EMPTY_STATS })
}

// ── Sumar lunar — CAA reală (cu prag) + Barou, ca în foaia „Sumar Lunar" ────

export type RegimCAA = 'fix' | 'procent' | 'plafon'

export const REGIM_CAA_LABEL: Record<RegimCAA, (config: FacturareConfig) => string> = {
  fix: config => `fix ${config.caaMin.toLocaleString('ro-RO')} lei`,
  procent: config => `${Math.round(config.caaProcent * 1000) / 10}% din venit`,
  plafon: config => `plafon ${config.caaPlafon.toLocaleString('ro-RO')} lei`,
}

function regimCAA(venitLuna: number, config: FacturareConfig): RegimCAA {
  const procent = config.caaProcent * venitLuna
  if (procent <= config.caaMin) return 'fix'
  if (procent >= config.caaPlafon) return 'plafon'
  return 'procent'
}

export interface SumarLunarMonth {
  luna: string   // YYYY-MM
  totalVenit: number
  cuvenitSami: number
  cuvenitAdi: number
  caaPerDosare: number   // suma CAA 14% calculată per dosar (ce scad deja cardurile Profit Sami/Adi)
  caaReala: number       // CAA cu prag — MAX(caaMin, MIN(caaProcent × totalVenit, caaPlafon))
  regim: RegimCAA
  barou: number
  impozitProfit: number
  taxeSuplimentare: number   // Taxe ONRC + Certificat Constatator, toate dosarele lunii
  profitSamiOficial: number
  profitAdiOficial: number
}

export interface SumarLunarStats {
  luni: SumarLunarMonth[]   // doar lunile cu cel puțin un dosar, ordonate cronologic
  totalVenit: number
  caaPerDosare: number
  caaReala: number
  barou: number
  impozitProfit: number
  taxeSuplimentare: number
  profitSamiOficial: number
  profitAdiOficial: number
}

/** Luna în care contează un dosar facturat pentru Sumarul lunar — data
 * facturării, nu data creării (spre deosebire de cele 4 carduri de sus, care
 * rămân mereu pe `createdAt`). Un dosar marcat facturat înainte de introduce-
 * rea acestui câmp n-are `dataFacturarii` — cade pe `createdAt`, ca să nu
 * dispară din calcul. */
export function dataEfectivaFacturare(d: Pick<Dosar, 'dataFacturarii' | 'createdAt'>): Date | null {
  return toDateSafe(d.dataFacturarii) ?? toDateSafe(d.createdAt)
}

/** Sumarul lunar — reface exact formulele din foaia „Sumar Lunar" a xlsx-ului:
 * CAA cu prag (nu 14% fix ca per dosar) și Barou fix, împărțite proporțional
 * între Sami și Adi după cuvenitul fiecăruia. Pragul CAA e neliniar (MAX/MIN),
 * deci nu poate fi aplicat pe suma unei perioade întregi — dosarele sunt
 * grupate pe lună calendaristică (luna facturării — vezi dataEfectivaFacturare),
 * calculate independent, apoi însumate; pentru period='luna' e o singură lună.
 * Așteaptă doar dosare facturate (filtrate în DosarStatsPanel) — un dosar
 * nefacturat n-are nicio obligație reală de CAA/Barou încă. */
export function computeSumarLunar(dosare: Dosar[], config: FacturareConfig = DEFAULT_FACTURARE_CONFIG): SumarLunarStats {
  const byMonth = new Map<string, Dosar[]>()
  for (const d of dosare) {
    const dt = dataEfectivaFacturare(d)
    if (!dt) continue
    const luna = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    const list = byMonth.get(luna)
    if (list) list.push(d); else byMonth.set(luna, [d])
  }

  const luni: SumarLunarMonth[] = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([luna, ds]) => {
      let totalVenit = 0, cuvenitSami = 0, cuvenitAdi = 0, caaPerDosare = 0, taxeSuplimentare = 0
      for (const d of ds) {
        const f = calculDosarFinanciar(d, config)
        totalVenit += d.tarifClient ?? 0
        cuvenitSami += f.cuvenitSami
        cuvenitAdi += f.cuvenitAdi
        caaPerDosare += f.caa
        taxeSuplimentare += (d.taxeOnrc ?? 0) + (d.certificatConstatator ?? 0)
      }
      const regim = regimCAA(totalVenit, config)
      const caaReala = totalVenit === 0 ? 0 : Math.max(config.caaMin, Math.min(config.caaProcent * totalVenit, config.caaPlafon))
      const barou = totalVenit === 0 ? 0 : config.barouFix
      const impozitProfit = config.impozitProfitCota * cuvenitAdi
      const costuriComune = barou + caaReala
      const profitSamiOficial = totalVenit === 0 ? 0 : cuvenitSami - (costuriComune * cuvenitSami) / totalVenit - taxeSuplimentare
      const profitAdiOficial = totalVenit === 0 ? 0 : cuvenitAdi - (costuriComune * cuvenitAdi) / totalVenit - impozitProfit
      return { luna, totalVenit, cuvenitSami, cuvenitAdi, caaPerDosare, caaReala, regim, barou, impozitProfit, taxeSuplimentare, profitSamiOficial, profitAdiOficial }
    })

  const sum = (f: (m: SumarLunarMonth) => number) => luni.reduce((acc, m) => acc + f(m), 0)
  return {
    luni,
    totalVenit: sum(m => m.totalVenit),
    caaPerDosare: sum(m => m.caaPerDosare),
    caaReala: sum(m => m.caaReala),
    barou: sum(m => m.barou),
    impozitProfit: sum(m => m.impozitProfit),
    taxeSuplimentare: sum(m => m.taxeSuplimentare),
    profitSamiOficial: sum(m => m.profitSamiOficial),
    profitAdiOficial: sum(m => m.profitAdiOficial),
  }
}
