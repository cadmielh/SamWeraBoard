import type { BlankSuggestion } from './api'

/** Alegerea utilizatorului pentru un loc liber dintr-un document fără etichete. Oglinda logicii din blanks.py
 * (person_tag, manual_tag). `role`: nu doar ASOCIAT/ADMINISTRATOR — orice calitate juridică găsită din
 * context sau propusă de AI (COMODANT, REPREZENTANT_LEGAL…), vezi BlankSuggestion din lib/api.ts. */
export type BlankChoice =
  | { kind: 'keep' }
  | { kind: 'company'; field: string }
  | { kind: 'person'; role: string; n: number; field: string }
  | { kind: 'manual'; label: string }

/** Textul din etichetă → parte de etichetă {{CAMP_…}}: litere mari fără diacritice, separate prin „_”. */
export function manualTag(label: string): string {
  const w = label.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `{{CAMP_${(w || 'VALOARE').slice(0, 40)}}}`
}

export function personTag(role: string, n: number, field: string): string {
  if (field === 'NUME_COMPLET') return `{{${role}_${n}_NUME}} {{${role}_${n}_PRENUME}}`
  if (field === 'CAPITAL_SOCIAL') return `{{CAPITAL_SOCIAL_ASOCIAT_${n}}}`
  if (field === 'PARTI_SOCIALE') return `{{PARTI_SOCIALE_ASOCIAT_${n}}}`
  return `{{${role}_${n}_${field}}}`
}

/** Eticheta rezultată din alegere; null = locul liber rămâne neschimbat. */
export function tagForChoice(c: BlankChoice): string | null {
  switch (c.kind) {
    case 'keep': return null
    case 'company': return `{{${c.field}}}`
    case 'person': return personTag(c.role, Math.max(1, Math.floor(c.n) || 1), c.field)
    case 'manual': return manualTag(c.label)
  }
}

/** Alegerea inițială = propunerea serverului. */
export function choiceFromSuggestion(s: BlankSuggestion): BlankChoice {
  if (s.scope === 'company' && s.field) return { kind: 'company', field: s.field }
  if (s.scope === 'person' && s.field) return { kind: 'person', role: s.role ?? 'ASOCIAT', n: s.person ?? 1, field: s.field }
  return { kind: 'manual', label: s.label }
}

export interface BlankSummary { total: number; toCheck: number; recognized: number }

export function summarize(blanks: BlankSuggestion[]): BlankSummary {
  const toCheck = blanks.filter(b => b.confidence !== 'high').length
  return { total: blanks.length, toCheck, recognized: blanks.length - toCheck }
}

/** Etichetele finale pentru toate alegerile: {id: „{{CÂMP}}”} (fără locurile lăsate neschimbate). */
export function choicesToTags(choices: Record<number, BlankChoice>): Record<number, string> {
  const out: Record<number, string> = {}
  for (const [id, c] of Object.entries(choices)) {
    const tag = tagForChoice(c)
    if (tag) out[Number(id)] = tag
  }
  return out
}
