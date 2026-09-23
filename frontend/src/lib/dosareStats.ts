import type { Dosar, FacturareConfig } from '../types'
import { DEFAULT_FACTURARE_CONFIG } from '../types'
import { toDateSafe } from './dates'

export interface DosarMonthStats {
  totalDosare: number
  facturate: number
}

export interface TarifStats {
  tarifClientTotal: number
  tarifClientFacturat: number
}

export interface DosarFinanciar {
  cuvenitSami: number
  cuvenitAdi: number
  caa: number
  impozitProfit: number
  profitSami: number
  profitAdi: number
}

export type DosarFinanciarInput = Pick<Dosar, 'tarifClient' | 'taxeOnrc' | 'certificatConstatator' | 'esteClientAdi' | 'semnaturaElectronica'>

/** Split-ul profitului Sami/Adi pe un dosar — formulele din foaia „Dosare" a
 * fisiere_template/Facturare_Sami_Adi.xlsx (coloanele Cuvenit Sami/Adi, CAA,
 * Impozit profit, Profit Sami/Adi), plus regula nouă: split-ul cu Adi se
 * aplică DOAR dacă dosarul are semnătură electronică — altfel tot profitul
 * (minus costurile) rămâne la Sami. Pe dosarele semnate, clientul e facturat
 * integral de ADI, nu de Sami — de-aia Sami nu-și ia banii direct de la
 * client pe acele dosare, ci de la Adi (vezi deFacturatCatreAdi mai jos,
 * în computeSumarLunar): profitAdi e cât păstrează Adi pentru el (cota lui),
 * nu cât îi datorează lui Sami. CAA aici e mereu 14% fix (formula per
 * dosar din excel) — Sumarul lunar recalculează separat CAA reală, cu prag,
 * pe totalul lunii (vezi computeSumarLunar), fără legătură cu acest câmp. */
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
  totalDosare: 0, facturate: 0,
}

const EMPTY_TARIF_STATS: TarifStats = {
  tarifClientTotal: 0, tarifClientFacturat: 0,
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
 * folosite de cardul „Număr dosare” din DosarStatsPanel (dosarele create în
 * perioada respectivă). Profitul (Sami/Adi) e raportat exclusiv de Sumarul
 * lunar (vezi computeSumarLunar); tarifele, de computeTarifStats mai jos —
 * nu se mai duplică aici. */
export function computeDosarStats(dosare: Dosar[]): DosarMonthStats {
  if (dosare.length === 0) return EMPTY_STATS
  return dosare.reduce((acc, d) => {
    acc.totalDosare += 1
    if (d.facturat) acc.facturate += 1
    return acc
  }, { ...EMPTY_STATS })
}

/** Luna în care contează un dosar pentru cardul „Tarife aplicate clienților”:
 *  - facturat, cu dataFacturarii → luna facturării (ca Sumarul lunar — vezi dataEfectivaFacturare).
 *  - facturat, dar fără dataFacturarii (caz vechi, dinainte de introducerea câmpului) → luna creării, la
 *    fel ca Sumarul lunar — cele două carduri trebuie să fie de acord pentru același dosar.
 *  - nefacturat → LUNA CURENTĂ (nu data creării, spre deosebire de cardul „Număr dosare”) — rămâne mereu
 *    „de facturat acum”, indiferent cât de vechi e (cerință directă a utilizatorului). */
export function dataEfectivaTarif(d: Pick<Dosar, 'facturat' | 'dataFacturarii' | 'createdAt'>): Date {
  if (!d.facturat) return new Date()
  return dataEfectivaFacturare(d) ?? new Date()
}

/** Suma tarifelor (total + facturat) pentru cardul „Tarife aplicate clienților”, pe baza
 * dataEfectivaTarif — `dosare` trebuie să fie TOATE dosarele workspace-ului (nu doar cele create în
 * perioada afișată), fiindcă un dosar nefacturat contează mereu ca „acum”, indiferent de `createdAt`.
 * `bounds` = `null` pentru „Total” (nicio filtrare, se însumează tot). */
export function computeTarifStats(dosare: Dosar[], bounds: [Date, Date] | null): TarifStats {
  const inPeriod = bounds
    ? dosare.filter(d => { const dt = dataEfectivaTarif(d); return dt >= bounds[0] && dt < bounds[1] })
    : dosare
  if (inPeriod.length === 0) return EMPTY_TARIF_STATS
  return inPeriod.reduce((acc, d) => {
    const tarifClient = d.tarifClient ?? 0
    acc.tarifClientTotal += tarifClient
    if (d.facturat) acc.tarifClientFacturat += tarifClient
    return acc
  }, { ...EMPTY_TARIF_STATS })
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
  // Profitul din dosare, înainte de Barou/CAA (care sunt costuri comune ale
  // lunii, nu ale unui dosar anume) — doar cuvenitul minus ce se scade deja
  // per dosar (taxe ONRC/Certificat pentru Sami, impozitul pentru Adi).
  profitSamiDinDosare: number
  profitAdiDinDosare: number
  profitSamiOficial: number
  profitAdiOficial: number
  // Ce trebuie să ia SAMI de la ADI (nu invers): pe dosarele cu semnătură electronică, Adi facturează
  // clientul integral (nu Sami) — Sami își ia profitul lui facturându-l CĂTRE Adi. E partea din Profit
  // Sami care vine din acele dosare — distinct de profitAdi/profitAdiOficial, care e cota lui ADI din
  // cuvenit (banii pe care Adi îi păstrează pentru el, nu ce-i datorează lui Sami).
  // deFacturatCatreAdi = brut, înainte de Barou/CAA (ca profitSamiDinDosare); deFacturatCatreAdiOficial =
  // după partea proporțională a lui Sami din Barou + CAA reală, ca la Profit Sami/Adi.
  deFacturatCatreAdi: number
  deFacturatCatreAdiOficial: number
}

export interface SumarLunarStats {
  luni: SumarLunarMonth[]   // doar lunile cu cel puțin un dosar, ordonate cronologic
  totalVenit: number
  caaPerDosare: number
  caaReala: number
  barou: number
  impozitProfit: number
  taxeSuplimentare: number
  profitSamiDinDosare: number
  profitAdiDinDosare: number
  profitSamiOficial: number
  profitAdiOficial: number
  deFacturatCatreAdi: number
  deFacturatCatreAdiOficial: number
}

/** Luna în care contează un dosar facturat — pentru Sumarul lunar, și (via dataEfectivaTarif de mai sus)
 * pentru cardul „Tarife aplicate clienților”: data facturării, nu data creării (spre deosebire de cardul
 * „Număr dosare”, care rămâne pe `createdAt`). Un dosar marcat facturat înainte de introducerea acestui
 * câmp n-are `dataFacturarii` — cade pe `createdAt`, ca să nu dispară din calcul. */
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
      // cuvenitSami/taxeSuplimentare, dar restrânse la dosarele cu semnătură electronică — baza pentru „De
      // facturat către Adi”, calculată la fel ca profitSamiDinDosare (cuvenit minus taxe, FĂRĂ CAA-ul fix
      // per dosar), ca partea de CAA să nu se scadă de două ori odată cu CAA reală, mai jos. Și baza pentru
      // CAA reală — un dosar fără semnătură electronică nu are CAA deloc (nici per dosar, caa=0 mai sus —
      // vezi calculDosarFinanciar), deci nici CAA reală (cu prag) nu trebuie să-i includă tariful.
      let cuvenitSamiSemnat = 0, taxeSuplimentareSemnat = 0, venitSemnat = 0
      for (const d of ds) {
        const f = calculDosarFinanciar(d, config)
        totalVenit += d.tarifClient ?? 0
        cuvenitSami += f.cuvenitSami
        cuvenitAdi += f.cuvenitAdi
        caaPerDosare += f.caa
        const taxeDosar = (d.taxeOnrc ?? 0) + (d.certificatConstatator ?? 0)
        taxeSuplimentare += taxeDosar
        // De facturat către Adi = ce ia Sami DE LA Adi: pe dosarele semnate electronic, clientul e
        // facturat integral de Adi, nu de Sami — Sami își recuperează profitul facturându-l către Adi.
        if (d.semnaturaElectronica) {
          cuvenitSamiSemnat += f.cuvenitSami
          taxeSuplimentareSemnat += taxeDosar
          venitSemnat += d.tarifClient ?? 0
        }
      }
      const regim = regimCAA(venitSemnat, config)
      const caaReala = venitSemnat === 0 ? 0 : Math.max(config.caaMin, Math.min(config.caaProcent * venitSemnat, config.caaPlafon))
      const barou = totalVenit === 0 ? 0 : config.barouFix
      const impozitProfit = config.impozitProfitCota * cuvenitAdi
      const costuriComune = barou + caaReala
      const profitSamiDinDosare = cuvenitSami - taxeSuplimentare
      const profitAdiDinDosare = cuvenitAdi - impozitProfit
      // Barou+CAA se împart DOAR între partea semnată a lui Sami și Adi (venitSemnat), nu pe tot venitul lunii
      // — altfel un dosar nesemnat, fără nicio legătură cu Adi, i-ar dilua artificial partea de costuri (mai
      // mult venit la numitor, dar cuvenitul lui neschimbat) și i-ar umfla profitul. Partea nesemnată a lui
      // Sami rămâne neatinsă aici — el oricum plătește Barou/CAA integral, indiferent de mix, dar suma aia
      // vine în întregime din partea semnată a profitului lui (conservarea totalului tot se respectă, doar
      // mutată: ce nu-i revine lui Adi, cade pe Sami — vezi „Verificare (=0)” din foaia de calcul originală).
      const adiShareCosturi = venitSemnat === 0 ? 0 : (costuriComune * cuvenitAdi) / venitSemnat
      const samiShareCosturiSemnat = venitSemnat === 0 ? 0 : (costuriComune * cuvenitSamiSemnat) / venitSemnat
      const profitSamiOficial = profitSamiDinDosare - (costuriComune - adiShareCosturi)
      const profitAdiOficial = profitAdiDinDosare - adiShareCosturi
      const deFacturatCatreAdi = cuvenitSamiSemnat - taxeSuplimentareSemnat
      const deFacturatCatreAdiOficial = deFacturatCatreAdi - samiShareCosturiSemnat
      return { luna, totalVenit, cuvenitSami, cuvenitAdi, caaPerDosare, caaReala, regim, barou, impozitProfit, taxeSuplimentare, profitSamiDinDosare, profitAdiDinDosare, profitSamiOficial, profitAdiOficial, deFacturatCatreAdi, deFacturatCatreAdiOficial }
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
    profitSamiDinDosare: sum(m => m.profitSamiDinDosare),
    profitAdiDinDosare: sum(m => m.profitAdiDinDosare),
    profitSamiOficial: sum(m => m.profitSamiOficial),
    profitAdiOficial: sum(m => m.profitAdiOficial),
    deFacturatCatreAdi: sum(m => m.deFacturatCatreAdi),
    deFacturatCatreAdiOficial: sum(m => m.deFacturatCatreAdiOficial),
  }
}
