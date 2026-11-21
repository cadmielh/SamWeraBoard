// Valorile câmpurilor manuale (CAMP_…) refolosite între documente:
//  - la aceeași generare: ce scrii într-un document trece în celelalte bifate care au același câmp, doar dacă acolo e
//    gol (sau avea aceeași valoare ca înainte, ca să rămână sincronizate cât scrii) — vezi propagaManual;
//  - între generări: se păstrează în istoricul de generări al clientului (docGenerations.campuri) și precompletează
//    data viitoare același câmp, la orice șablon. Nu se păstrează numerele și datele unui document anume (NUMAR_/NR_/
//    DATA_…, care diferă de la un document la altul), nici datele de identitate (CNP, serie/număr de act), care stau
//    doar în seiful criptat. Excepție: datele stabile ale unui bun (CF, înmatriculare).
import type { DocGeneration } from '../types'

const inner = (ph: string) => ph.replace(/^\{\{CAMP_|\}\}$/g, '')

export function sePastreaza(ph: string): boolean {
  const n = inner(ph)
  if (/CNP|SERIE_ACT|NR_ACT|NUMAR_ACT|SERIE_NUMAR|PASAPORT/.test(n)) return false
  if (/^(NUMAR|NR|DATA)_/.test(n)) return /(^|_)CF(_|$)|CADASTR|INMATRICUL/.test(n)
  return true
}

export interface ValoareMemorata { value: string; templateName: string; generatedAt: string }

/** {{CAMP_X}} → ultima valoare păstrată (generările vin de la cea mai nouă). */
export function memorieDinGenerari(gens: DocGeneration[]): Record<string, ValoareMemorata> {
  const out: Record<string, ValoareMemorata> = {}
  const noi = [...gens].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
  for (const g of noi) {
    for (const [name, value] of Object.entries(g.campuri ?? {})) {
      const ph = `{{CAMP_${name}}}`
      if (!(ph in out) && value && sePastreaza(ph)) out[ph] = { value, templateName: g.templateName, generatedAt: g.generatedAt }
    }
  }
  return out
}

/** Ce se salvează la generare: câmpurile manuale completate, păstrabile, fără cele calculate (`exclude`). */
export function campuriDePastrat(fields: string[], values: Record<string, string>, exclude: (ph: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const ph of fields) {
    const v = values[ph]?.trim()
    if (v && sePastreaza(ph) && !exclude(ph)) out[inner(ph)] = v
  }
  return out
}

/** Valorile schimbate într-un document, trecute în celelalte documente bifate care au același câmp: doar unde acolo
 * e gol sau egal cu valoarea de dinainte din documentul sursă. `curent(id, ph)` = valoarea afișată acum. */
export function propagaManual(
  prev: Record<string, Record<string, string>>, sursa: string, schimbari: Record<string, string>,
  vechi: Record<string, string>, tinte: { id: string; fields: string[] }[], curent: (id: string, ph: string) => string,
): Record<string, Record<string, string>> {
  const next = { ...prev, [sursa]: { ...prev[sursa], ...schimbari } }
  for (const { id, fields } of tinte) {
    if (id === sursa) continue
    for (const [ph, v] of Object.entries(schimbari)) {
      if (!fields.includes(ph)) continue
      const c = curent(id, ph)
      if (!c || c === (vechi[ph] ?? '')) next[id] = { ...next[id], [ph]: v }
    }
  }
  return next
}

/** Alegerile din bife: {{BIFA_GRUP_VARIANTA}} → grupuri cu variantele lor, în ordinea din document. Grupul e un singur
 * cuvânt, varianta poate avea mai multe (BIFA_DESTINATIE_SEDIU_SOCIAL → DESTINATIE / SEDIU_SOCIAL). */
export function grupuriBifa(placeholders: string[]): { grup: string; variante: string[] }[] {
  const out = new Map<string, string[]>()
  for (const ph of placeholders) {
    const m = ph.match(/^\{\{BIFA_([A-Z0-9]+)_([A-Z0-9_]+)\}\}$/)
    if (m) out.set(m[1], [...(out.get(m[1]) ?? []), m[2]])
  }
  return [...out].filter(([, v]) => v.length >= 2).map(([grup, variante]) => ({ grup, variante }))
}

/** Câmpul de detaliu al unei variante: {{CAMP_<VARIANTA>_<GRUP>}} (ex. CAMP_ALTA_DESTINATIE pentru BIFA_DESTINATIE_ALTA) —
 * se cere doar când varianta e aleasă; altfel rămâne linie de completat. */
export function detaliuBifa(ph: string, grupuri: { grup: string; variante: string[] }[]): { grup: string; varianta: string } | null {
  const n = ph.replace(/^\{\{CAMP_|\}\}$/g, '')
  for (const { grup, variante } of grupuri) for (const v of variante) if (n === `${v}_${grup}`) return { grup, varianta: v }
  return null
}
export const LINIE_NECOMPLETATA = '______________'

/** Valorile bifelor: ☒ la varianta aleasă, ☐ la celelalte; nimic cât nu s-a ales (documentul cere o alegere). Câmpurile
 * de detaliu (`detalii`) ale variantelor nealese primesc o linie de completat. */
export function valoriBifa(grupuri: { grup: string; variante: string[] }[], alese: Record<string, string>, detalii: string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { grup, variante } of grupuri) {
    if (!alese[grup]) continue
    for (const v of variante) out[`{{BIFA_${grup}_${v}}}`] = v === alese[grup] ? '☒' : '☐'
  }
  for (const ph of detalii) {
    const d = detaliuBifa(ph, grupuri)
    if (d && alese[d.grup] && alese[d.grup] !== d.varianta) out[ph] = LINIE_NECOMPLETATA
  }
  return out
}

const DIACRITICE: Record<string, string> = { alta: 'altă', destinatie: 'destinație' }
/** „SCOP” → „Scop”, „SEDIU_SOCIAL” → „Sediu social”, „ALTA” → „Altă”. */
export const eticheta = (s: string) => {
  const w = s.toLowerCase().split('_').map(x => DIACRITICE[x] ?? x).join(' ')
  return w[0].toUpperCase() + w.slice(1)
}
