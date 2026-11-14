// Cesiunea de părți sociale între un cedent și un cesionar (CEDENT_1_… / CESIONAR_1_…): din fișa firmei (capital,
// valoarea unei părți sociale, cotele asociaților) și numărul de părți cedate se calculează tot restul — capitalul și
// procentul cedate, apoi ce deține cesionarul după cesiune. Orice șablon sau clauză care folosește etichetele din
// CESIUNE_KEYS primește panoul (vezi CesiunePanel), fără vreo legătură cu un anumit șablon.
import type { Client, Persoana } from '../types'
import type { ClientPatchProposal } from './clauseFieldSpecs'
import type { ClientInput } from './clienti'
import { parsePercent, valoareParteSociala } from './cota'

/** Etichetele calculate. Numele vin din Hotărârea AGA (Dorothea), refolosite de contractul de cesiune. */
export const CESIUNE_KEYS = ['NR_PARTI_CEDATE', 'CAPITAL_CEDAT', 'PROCENT_CEDAT',
  'PARTI_SOCIALE_COOPTAT', 'CAPITAL_COOPTAT', 'PROCENT_COOPTAT'] as const
const CESIUNE_KEY_SET = new Set<string>(CESIUNE_KEYS)
export const isCesiuneField = (key: string): boolean => CESIUNE_KEY_SET.has(key)
/** Panoul apare doar când documentul are o etichetă de cesiune; cele fără rămân exact ca înainte. */
export const hasCesiune = (placeholders: string[] | undefined): boolean =>
  (placeholders ?? []).some(ph => isCesiuneField(ph.replace(/^\{\{|\}\}$/g, '')))

/** Nota salvată în fișă când se aplică o cesiune: cotele de dinainte, după `pid`-ul asociaților (fără alte date). */
export interface UltimaCesiune {
  data: string             // ISO
  cedentPid: string
  parti: number
  inainte: { pid: string; cota: string }[]
}
const VALABILITATE_NOTA_ZILE = 60

/** „60%”, „33,33%” — două zecimale doar când e nevoie, cu virgulă. */
export function formatProcent(p: number): string {
  const v = Math.round(p * 100) / 100
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, '').replace('.', ',')}%`
}
const formatLei = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','))

const samePerson = (a: Persoana, b: Persoana) =>
  (!!a.pid && a.pid === b.pid) || (`${a.nume} ${a.prenume}`.trim().toLowerCase() === `${b.nume} ${b.prenume}`.trim().toLowerCase())

/** Nota de cesiune aplicată, dacă privește ACEASTĂ cesiune (același cedent, aceleași părți) și e recentă. */
export function notaAplicata(client: Partial<Client> | null | undefined, cedent: Persoana | null, parti: number,
  now = new Date()): UltimaCesiune | null {
  const n = client?.ultimaCesiune
  if (!n || !cedent?.pid || n.cedentPid !== cedent.pid || n.parti !== parti) return null
  const zile = (now.getTime() - new Date(n.data).getTime()) / 86_400_000
  return zile >= 0 && zile <= VALABILITATE_NOTA_ZILE ? n : null
}

export interface CesiuneCalcul {
  /** {{ETICHETĂ}} → valoare, doar cele calculabile. */
  values: Record<string, string>
  totalParti: number
  cedentParti: number | null      // părțile cedentului înainte (null: cedentul nu e asociat)
  cesionarParti: number           // părțile cesionarului înainte (0 = asociat nou)
  error: string | null
}

/** `inainte`: cotele de dinainte din nota de cesiune aplicată (vezi notaAplicata), altfel cele din fișă. */
export function calculCesiune(client: Partial<Client> | null | undefined, cedent: Persoana | null, cesionar: Persoana | null,
  parti: number, inainte?: UltimaCesiune['inainte']): CesiuneCalcul {
  const capital = client?.capitalSocial ?? 0
  const valoare = valoareParteSociala(client)
  const totalParti = capital > 0 ? Math.round(capital / valoare) : 0
  const asociati = client?.asociati ?? []
  const cotaDe = (p: Persoana | null): number | null => {
    if (!p) return null
    const a = asociati.find(x => samePerson(x, p))
    if (inainte) {
      // După pid: un cedent care și-a cedat toate părțile nu mai e în fișă, dar e în nota de dinainte
      const pid = p.pid ?? a?.pid
      const v = pid ? inainte.find(x => x.pid === pid) : undefined
      // Cine nu apare în notă nu era asociat înainte (ex. cesionarul nou, intrat în fișă la actualizare)
      return v ? parsePercent(v.cota) : null
    }
    return a ? parsePercent(a.cotaParticipare) : null
  }
  const partiDin = (cota: number | null) => (cota == null ? null : Math.round(totalParti * cota / 100))
  const cedentParti = partiDin(cotaDe(cedent))
  const cesionarParti = partiDin(cotaDe(cesionar)) ?? 0
  const out: CesiuneCalcul = { values: {}, totalParti, cedentParti, cesionarParti, error: null }

  if (!totalParti) { out.error = 'Completează capitalul social în fișa clientului.'; return out }
  if (cedent && cedentParti == null) out.error = 'Cedentul ales nu e asociat al societății.'
  else if (cedent && cesionar && samePerson(cedent, cesionar)) out.error = 'Cedentul și cesionarul sunt aceeași persoană.'
  else if (parti > 0 && cedentParti != null && parti > cedentParti) out.error = `Cedentul are doar ${cedentParti} părți sociale.`
  if (!(parti > 0) || out.error) return out

  const dobandite = cesionarParti + parti
  out.values = {
    '{{NR_PARTI_CEDATE}}': String(parti),
    '{{CAPITAL_CEDAT}}': formatLei(parti * valoare),
    '{{PROCENT_CEDAT}}': formatProcent(parti / totalParti * 100),
    '{{PARTI_SOCIALE_COOPTAT}}': String(dobandite),
    '{{CAPITAL_COOPTAT}}': formatLei(dobandite * valoare),
    '{{PROCENT_COOPTAT}}': formatProcent(dobandite / totalParti * 100),
  }
  return out
}

/** Propunerea de actualizare a fișei după generare: cotele noi (cedentul fără părți iese dintre asociați, cesionarul nou
 * intră) și nota cesiunii aplicate, ca un document generat după actualizare să pornească tot din situația dinainte. */
export function propunereCesiune(cedent: Persoana, cesionar: Persoana, parti: number, totalParti: number,
  now = new Date()): ClientPatchProposal {
  const update = (current: Partial<ClientInput>): Partial<ClientInput> => {
    const asociati = current.asociati ?? []
    const partiDe = (a: Persoana) => Math.round(totalParti * parsePercent(a.cotaParticipare) / 100)
    const cota = (p: number) => formatProcent(p / totalParti * 100)
    let noi = asociati.flatMap(a => {
      if (samePerson(a, cedent)) {
        const ramase = partiDe(a) - parti
        return ramase > 0 ? [{ ...a, cotaParticipare: cota(ramase) }] : []
      }
      if (samePerson(a, cesionar)) return [{ ...a, cotaParticipare: cota(partiDe(a) + parti) }]
      return [a]
    })
    if (!asociati.some(a => samePerson(a, cesionar))) {
      noi = [...noi, { ...cesionar, calitate: 'Asociat', cotaParticipare: cota(parti) }]
    }
    const nota: UltimaCesiune = {
      data: now.toISOString(), cedentPid: cedent.pid ?? '', parti,
      inainte: asociati.filter(a => a.pid).map(a => ({ pid: a.pid!, cota: a.cotaParticipare })),
    }
    return { asociati: noi, ultimaCesiune: nota }
  }
  return {
    label: `Cesiune: ${parti} părți de la ${`${cedent.nume} ${cedent.prenume}`.trim()} către ${`${cesionar.nume} ${cesionar.prenume}`.trim()}`
      + ' — acceptă după ce ai generat contractul și hotărârea; actul constitutiv generează-l după actualizare',
    patch: {},
    update,
  }
}
