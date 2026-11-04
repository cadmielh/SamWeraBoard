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

/** Cheile din `Workspace.templateOrder`: aceeași listă ține ordinea ambelor secțiuni. */
export const builtinOrderKey = (key: string) => `b:${key}`
export const ownOrderKey = (id: string) => `t:${id}`

/** Aplică ordinea stabilită de admin. Elementele care nu apar în ea (șabloane noi, adăugate după ultima
 * reordonare) vin primele, în ordinea lor obișnuită, ca un șablon tocmai adăugat să se vadă imediat. */
export function applyTemplateOrder<T>(items: T[], keyOf: (t: T) => string, order: string[] | undefined): T[] {
  if (!order?.length) return items
  const pos = new Map(order.map((k, i) => [k, i]))
  const unknown = items.filter(t => !pos.has(keyOf(t)))
  const known = items.filter(t => pos.has(keyOf(t))).sort((a, b) => pos.get(keyOf(a))! - pos.get(keyOf(b))!)
  return [...unknown, ...known]
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Căutarea după nume în listele de șabloane: fără diacritice și majuscule, toate cuvintele trebuie să apară
 * („hot aga” găsește „Hotărâre AGA”). O căutare goală se potrivește cu orice. */
export function matchesTemplateSearch(name: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  const n = fold(name)
  return words.every(w => n.includes(w))
}

/** Ce aduce legarea unui șablon livrat de un șablon de bază (`sourceKey`). Doar aceste chei schimbă ceva:
 * celelalte șabloane de bază au formularul construit tot din etichete. Cheile de asociați sunt cele din
 * ASOCIATI_COUNT_RULES (builtinTemplates.ts). */
const FORM_LINK_EFFECTS: Record<string, string> = {
  [ANEXA1_KEY]: 'Folosește formularul dedicat al Anexei 1, cu aceeași completare automată ca la șablonul de bază.',
  [BRX_KEY]: 'Folosește formularul dedicat al declarației de beneficiari reali, cu aceeași completare automată ca la șablonul de bază.',
  [DECLARATIE_ACTIVITATE_KEY]: 'Folosește formularul dedicat al declarației (activitate), cu aceeași completare automată ca la șablonul de bază.',
  decizie_asociat_unic: 'Formularul rămâne cel din etichete; șablonul apare la generare doar pentru clienții cu exact un asociat.',
  hotarare_aga: 'Formularul rămâne cel din etichete; șablonul apare la generare doar pentru clienții cu cel puțin doi asociați.',
}

export interface FormLinkOption { key: string; name: string; effect: string }

/** Opțiunile utile la livrare, în ordinea șabloanelor de bază. */
export function formLinkOptions(builtins: BuiltinTemplate[]): FormLinkOption[] {
  return builtins.filter(b => b.key in FORM_LINK_EFFECTS).map(b => ({ key: b.key, name: b.name, effect: FORM_LINK_EFFECTS[b.key] }))
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
