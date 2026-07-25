import type { Client } from '../types'

export interface Scadenta {
  cod: string
  titlu: string
  descriere: string
  urmatoarea: Date
}

function atDay(year: number, month0: number, day: number): Date {
  return new Date(year, month0, day)
}

/** Următoarea dată cu ziua `day` a lunii, începând de azi (inclusiv). */
function nextMonthlyDeadline(day: number, from: Date): Date {
  const candidate = atDay(from.getFullYear(), from.getMonth(), day)
  if (candidate >= from) return candidate
  return atDay(from.getFullYear(), from.getMonth() + 1, day)
}

/** Următoarea dată din lista [25 ian, 25 apr, 25 iul, 25 oct], începând de azi. */
function nextQuarterlyDeadline(from: Date): Date {
  const year = from.getFullYear()
  const candidates = [0, 3, 6, 9].map(m => atDay(year, m, 25))
  candidates.push(atDay(year + 1, 0, 25))
  return candidates.find(d => d >= from)!
}

/** Următoarea dată din lista [25 ian, 25 iul], începând de azi (perioadă semestrială). */
function nextSemestrialDeadline(from: Date): Date {
  const year = from.getFullYear()
  const candidates = [atDay(year, 0, 25), atDay(year, 6, 25), atDay(year + 1, 0, 25)]
  return candidates.find(d => d >= from)!
}

/** Termenul anual de depunere a situațiilor financiare (31 mai), pentru anul curent sau următor. */
function nextAnnualDeadline(month0: number, day: number, from: Date): Date {
  const candidate = atDay(from.getFullYear(), month0, day)
  if (candidate >= from) return candidate
  return atDay(from.getFullYear() + 1, month0, day)
}

/**
 * Calculează scadențele fiscale recurente pentru un client, pe baza câmpurilor
 * fiscale existente. Termene orientative (conform regulilor generale din Codul
 * Fiscal) — cazurile speciale (contribuabili mari, plătitori de accize etc.)
 * trebuie verificate separat.
 */
export function computeScadente(client: Client, from: Date = new Date()): Scadenta[] {
  const scadente: Scadenta[] = []

  if ((client.nrSalariati ?? 0) > 0) {
    scadente.push({
      cod: 'D112',
      titlu: 'D112 — declarație contribuții sociale și salarii',
      descriere: 'Lunar, până pe 25 ale lunii următoare, dacă societatea are salariați.',
      urmatoarea: nextMonthlyDeadline(25, from),
    })
  }

  if (client.platitorTva) {
    const perioada = client.periodaTva
    const urmatoareaTva =
      perioada === 'trimestriala' ? nextQuarterlyDeadline(from)
      : perioada === 'semestrial' ? nextSemestrialDeadline(from)
      : nextMonthlyDeadline(25, from)
    const frecventaLabel =
      perioada === 'trimestriala' ? 'trimestrial'
      : perioada === 'semestrial' ? 'semestrial'
      : 'lunar'

    scadente.push({
      cod: 'D300',
      titlu: 'D300 — decont de TVA',
      descriere: `Decont TVA, ${frecventaLabel}, până pe 25 ale lunii următoare perioadei de raportare.`,
      urmatoarea: urmatoareaTva,
    })
    scadente.push({
      cod: 'D394',
      titlu: 'D394 — declarație informativă TVA',
      descriere: `Declarație informativă privind livrările/achizițiile, ${frecventaLabel}, până pe 25 ale lunii următoare.`,
      urmatoarea: urmatoareaTva,
    })
  }

  if (client.regimFiscal === 'microintreprindere') {
    scadente.push({
      cod: 'IMPOZIT_MICRO',
      titlu: 'Impozit pe veniturile microîntreprinderilor',
      descriere: 'Trimestrial, până pe 25 ale lunii următoare încheierii trimestrului.',
      urmatoarea: nextQuarterlyDeadline(from),
    })
  }

  if (client.regimFiscal === 'impozit_profit') {
    scadente.push({
      cod: 'IMPOZIT_PROFIT_TRIM',
      titlu: 'Impozit pe profit (plată anticipată trimestrială)',
      descriere: 'Trimestrial, până pe 25 ale lunii următoare încheierii trimestrului.',
      urmatoarea: nextQuarterlyDeadline(from),
    })
    scadente.push({
      cod: 'D101',
      titlu: 'D101 — declarație anuală impozit pe profit',
      descriere: 'Anual, termen orientativ 25 iunie anul următor (pot exista termene diferite pentru cazuri speciale).',
      urmatoarea: nextAnnualDeadline(5, 25, from),
    })
  }

  if (!!client.formaJuridica || client.tipClient === 'PJ') {
    scadente.push({
      cod: 'BILANT',
      titlu: 'Situații financiare anuale (bilanț)',
      descriere: 'Anual, termen orientativ 31 mai (150 de zile de la închiderea exercițiului financiar calendaristic).',
      urmatoarea: nextAnnualDeadline(4, 31, from),
    })
  }

  return scadente.sort((a, b) => a.urmatoarea.getTime() - b.urmatoarea.getTime())
}
