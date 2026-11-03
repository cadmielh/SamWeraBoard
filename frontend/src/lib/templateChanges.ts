import type { BuiltinTemplate, ClauseMeta, DocTemplate, WorkspaceMember } from '../types'
import { ANEXA1_KEY } from './anexa1Filler'
import { BRX_KEY } from './beneficiariRealiFiller'
import { DECLARATIE_ACTIVITATE_KEY, isDeclaratieTemplate } from './declaratieActivitateFiller'

/** Șabloanele de bază cu formular dedicat: formularul cere doar etichetele șablonului de bază
 * (oglinda DEDICATED_FORM_KEYS din templates_api.py). */
const DEDICATED_KEYS = [ANEXA1_KEY, BRX_KEY, DECLARATIE_ACTIVITATE_KEY]

/** Cheia formularului dedicat folosit de un șablon (după `sourceKey` sau, la declarație, după etichete), altfel null. */
export function dedicatedFormKey(tpl: { sourceKey?: string; placeholders?: string[] }): string | null {
  if (tpl.sourceKey && DEDICATED_KEYS.includes(tpl.sourceKey)) return tpl.sourceKey
  return isDeclaratieTemplate(tpl) ? DECLARATIE_ACTIVITATE_KEY : null
}

export interface TemplateChanges {
  added: string[]
  removed: string[]
  addedClauses: string[]
  removedClauses: string[]
  /** Etichete noi pe care formularul dedicat nu le cere: ar rămâne necompletate în documentul generat. */
  dedicatedUnasked: string[]
  /** Formularul dedicat folosit până acum nu se mai aplică (ex. declarația recunoscută după etichete). */
  dedicatedLost: boolean
}

const minus = (a: string[], b: string[]) => { const s = new Set(b); return a.filter(x => !s.has(x)) }

/** Ce se schimbă în formular dacă fișierul șablonului `prev` e înlocuit cu unul care are etichetele `next`. */
export function diffTemplate(
  prev: Pick<DocTemplate, 'placeholders' | 'clauses' | 'sourceKey'>,
  next: { placeholders: string[]; clauses: ClauseMeta[] },
  builtins: BuiltinTemplate[],
): TemplateChanges {
  const before = prev.placeholders ?? []
  const clauseLabels = (cs: ClauseMeta[] | undefined) => (cs ?? []).map(c => c.label || c.tag)
  const formBefore = dedicatedFormKey(prev)
  const formAfter = dedicatedFormKey({ sourceKey: prev.sourceKey, placeholders: next.placeholders })
  const base = formAfter ? builtins.find(b => b.key === formAfter) : undefined
  return {
    added: minus(next.placeholders, before),
    removed: minus(before, next.placeholders),
    addedClauses: minus(clauseLabels(next.clauses), clauseLabels(prev.clauses)),
    removedClauses: minus(clauseLabels(prev.clauses), clauseLabels(next.clauses)),
    dedicatedUnasked: base ? minus(next.placeholders, base.placeholders) : [],
    dedicatedLost: formBefore !== null && formAfter === null,
  }
}

export function hasChanges(c: TemplateChanges): boolean {
  return c.added.length + c.removed.length + c.addedClauses.length + c.removedClauses.length > 0 || c.dedicatedLost
}

/** Șabloanele de bază afișate la generare: toate, mai puțin cele ascunse de adminul cabinetului. */
export function visibleBuiltins(builtins: BuiltinTemplate[], hidden: string[] | undefined): BuiltinTemplate[] {
  if (!hidden?.length) return builtins
  const h = new Set(hidden)
  return builtins.filter(b => !h.has(b.key))
}

const formatDate = (d: Date) => d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })

/** Eticheta unui șablon livrat de Cabinio: „Pregătit de Cabinio”, iar după ce cabinetul a înlocuit fișierul,
 * „… · modificat de {nume}, {dată}”. null pentru un șablon creat de cabinet. */
export function deliveryLabel(tpl: Pick<DocTemplate, 'delivery' | 'revision' | 'updatedBy' | 'updatedAt'>,
  members: Record<string, WorkspaceMember> | undefined): string | null {
  if (!tpl.delivery) return null
  if (!tpl.revision || !tpl.updatedBy) return 'Pregătit de Cabinio'
  const m = members?.[tpl.updatedBy]
  const who = m ? (m.displayName || m.email) : 'cabinet'
  const when = tpl.updatedAt?.toDate ? `, ${formatDate(tpl.updatedAt.toDate())}` : ''
  return `Pregătit de Cabinio · modificat de ${who}${when}`
}
