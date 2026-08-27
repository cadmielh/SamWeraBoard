import type { Dosar } from '../types'

export interface DosarMonthStats {
  totalDosare: number
  facturate: number
  nefacturate: number
  profitTotal: number
  profitFacturat: number
}

/** Profitul unui dosar — Tarif client − Taxe ONRC, ca formula din registrul xlsx. */
export function dosarProfit(d: Pick<Dosar, 'tarifClient' | 'taxeOnrc'>): number {
  return (d.tarifClient ?? 0) - (d.taxeOnrc ?? 0)
}

const EMPTY_STATS: DosarMonthStats = {
  totalDosare: 0, facturate: 0, nefacturate: 0, profitTotal: 0, profitFacturat: 0,
}

export type StatsPeriod = 'luna' | 'trimestru' | 'an' | 'total'

export const LUNI = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
]

// up=true înseamnă "o creștere e un lucru bun" pentru acea metrică — o
// creștere la Nefacturate e de fapt un semnal negativ, deci nu se colorează
// generic verde=sus/roșu=jos. Partajat între DosarStatsPanel și navigatorul
// de lună din header-ul DosarePage.
export const METRIC_META: { key: keyof DosarMonthStats; label: string; up: boolean; money?: boolean }[] = [
  { key: 'totalDosare', label: 'Total dosare', up: true },
  { key: 'facturate', label: 'Facturate', up: true },
  { key: 'nefacturate', label: 'Nefacturate', up: false },
  { key: 'profitTotal', label: 'Profit total', up: true, money: true },
  { key: 'profitFacturat', label: 'Profit facturat', up: true, money: true },
]

export function trendColor(delta: number, up: boolean): string {
  if (delta === 0) return 'var(--s400)'
  const isGood = (delta > 0) === up
  return isGood ? 'var(--g600)' : 'var(--r600)'
}

/** Reproduce exact formulele din xlsx (COUNTA/COUNTIFS/SUM/SUMIF), peste un
 * array de dosare deja preluat pentru o singură lună. */
export function computeDosarStats(dosare: Dosar[]): DosarMonthStats {
  if (dosare.length === 0) return EMPTY_STATS
  return dosare.reduce((acc, d) => {
    const profit = dosarProfit(d)
    acc.totalDosare += 1
    if (d.facturat) {
      acc.facturate += 1
      acc.profitFacturat += profit
    } else {
      acc.nefacturate += 1
    }
    acc.profitTotal += profit
    return acc
  }, { ...EMPTY_STATS })
}
