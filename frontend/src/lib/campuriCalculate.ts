// Câmpuri manuale (CAMP_…) care nu se mai scriu de mână, ci se calculează din alte câmpuri manuale ale aceluiași
// document, după nume — regulă generică, pentru orice șablon care urmează convenția:
//  - CAMP_X_IN_LITERE / CAMP_X_LITERE ← CAMP_X (număr întreg), în litere: „5 (cinci) ani”;
//  - CAMP_DATA_SFARSIT_X ← data de început + durata (CAMP_DURATA_X_ANI / CAMP_DURATA_X_LUNI, sau CAMP_DURATA_ANI…), la
//    data aniversară (aceeași zi și lună). Data de început: CAMP_DATA_INCEPUT_X completat, altfel ziua generării
//    ({{DATA_CURENTA}}). Se potrivesc după sufixul X (CONTRACT, INCHIRIERE…); fără sufix comun, durata fără sufix
//    sau singura durată din document.
// Un șablon fără aceste perechi rămâne exact ca înainte: câmpurile lui se cer în continuare de mână.
import { numarInLitere } from './numarInLitere'

const inner = (ph: string) => ph.replace(/^\{\{CAMP_|\}\}$/g, '')
const tag = (name: string) => `{{CAMP_${name}}}`

/** Câmpul din care se calculează `ph` (doar dacă există în document), sau null dacă `ph` se completează de mână. */
function sursaLitere(ph: string, manualFields: string[]): string | null {
  const m = inner(ph).match(/^(.+?)_(?:IN_)?LITERE$/)
  return m && manualFields.includes(tag(m[1])) ? tag(m[1]) : null
}
/** Sufixul după un prefix: DATA_SFARSIT_CONTRACT → „CONTRACT”, DATA_SFARSIT → „”, alt câmp → null. */
const sufix = (ph: string, prefix: string): string | null => {
  const m = inner(ph).match(new RegExp(`^${prefix}(?:_(.+))?$`))
  return m ? m[1] ?? '' : null
}
const sufixSfarsit = (ph: string) => sufix(ph, 'DATA_SFARSIT')
const isDataSfarsit = (ph: string) => sufixSfarsit(ph) != null
const sufixInceput = (ph: string) => sufix(ph, 'DATA_INCEPUT')

interface Durata { ani?: string; luni?: string }
/** Duratele documentului după sufix: CAMP_DURATA_INCHIRIERE_ANI → „INCHIRIERE”, CAMP_DURATA_ANI → „”. */
function durate(manualFields: string[]): Map<string, Durata> {
  const out = new Map<string, Durata>()
  for (const ph of manualFields) {
    const m = inner(ph).match(/^DURATA(?:_(.+))?_(ANI|LUNI)$/)
    if (!m) continue
    const d = out.get(m[1] ?? '') ?? {}
    d[m[2] === 'ANI' ? 'ani' : 'luni'] = ph
    out.set(m[1] ?? '', d)
  }
  return out
}
/** Durata potrivită unei date de sfârșit cu sufixul `x`. */
function durataPentru(x: string, toate: Map<string, Durata>): Durata | null {
  return toate.get(x) ?? toate.get('') ?? (toate.size === 1 ? [...toate.values()][0] : null)
}
/** Data de început potrivită (câmpul), sau undefined: atunci se pornește de azi. */
function inceputPentru(x: string, manualFields: string[]): string | undefined {
  const inceputuri = manualFields.filter(ph => sufixInceput(ph) != null)
  return inceputuri.find(ph => sufixInceput(ph) === x) ?? inceputuri.find(ph => sufixInceput(ph) === '')
    ?? (inceputuri.length === 1 ? inceputuri[0] : undefined)
}

/** Câmpurile calculate dintre cele manuale ale documentului, cu sursa lor (pentru eticheta „din …”). */
export function campuriCalculate(manualFields: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const toate = durate(manualFields)
  for (const ph of manualFields) {
    const src = sursaLitere(ph, manualFields)
    const d = isDataSfarsit(ph) ? durataPentru(sufixSfarsit(ph)!, toate) : null
    if (src) out.set(ph, [src])
    else if (d) out.set(ph, [d.ani, d.luni].filter((x): x is string => !!x))
  }
  return out
}

const numarIntreg = (v: string | undefined): number | null => {
  const s = (v ?? '').trim()
  return /^\d+$/.test(s) ? Number(s) : null
}

const pad = (n: number) => String(n).padStart(2, '0')
const roDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
function parseRoDate(s: string | undefined): Date | null {
  const m = (s ?? '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return d.getDate() === Number(m[1]) ? d : null
}

/** Data aniversară după `luni` luni; 29 februarie trece pe ultima zi a lunii când anul nu e bisect. */
export function dataAniversara(start: Date, luni: number): Date {
  const y = start.getFullYear(), m = start.getMonth() + luni
  const zileInLuna = new Date(y, m + 1, 0).getDate()
  return new Date(y, m, Math.min(start.getDate(), zileInLuna))
}

/** Valorile calculate, din valorile manuale curente (`{{CAMP_…}}` → text); goale când sursa lipsește. */
export function valoriCalculate(manualFields: string[], values: Record<string, string>, azi = new Date()): Record<string, string> {
  const out: Record<string, string> = {}
  const toate = durate(manualFields)
  for (const [ph, [src]] of campuriCalculate(manualFields)) {
    if (!isDataSfarsit(ph)) {
      const n = numarIntreg(values[src])
      out[ph] = n == null ? '' : numarInLitere(n)
      continue
    }
    const x = sufixSfarsit(ph)!
    const { ani, luni } = durataPentru(x, toate)!
    const inceput = inceputPentru(x, manualFields)
    const start = parseRoDate(inceput ? values[inceput] : undefined) ?? azi
    const nAni = ani ? numarIntreg(values[ani]) : null
    const nLuni = luni ? numarIntreg(values[luni]) : null
    out[ph] = nAni == null && nLuni == null ? '' : roDate(dataAniversara(start, (nAni ?? 0) * 12 + (nLuni ?? 0)))
  }
  return out
}
