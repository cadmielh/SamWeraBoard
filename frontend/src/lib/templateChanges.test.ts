import { describe, expect, it } from 'vitest'
import type { BuiltinTemplate, WorkspaceMember } from '../types'
import { applyTemplateOrder, dedicatedFormKey, deliveryLabel, diffTemplate, formLinkOptions, hasChanges, matchesTemplateSearch, visibleBuiltins } from './templateChanges'
import { actorLabel, type AuditEntry } from './audit'

const builtin = (key: string, placeholders: string[] = []): BuiltinTemplate => ({
  key, version: 1, filename: `${key}.docx`, name: key, description: '', tipTemplate: 'PJ', outputNameTemplate: '',
  type: 'docx', placeholders, clauses: [], repeatGroups: [], pdfFields: [],
})

const BUILTINS = [builtin('act_constitutiv'), builtin('anexa1_inregistrare_fiscala', ['{{SOCIETATE_DENUMIRE}}', '{{CAEN_1}}'])]

describe('diffTemplate', () => {
  it('raportează câmpurile și articolele adăugate sau eliminate', () => {
    const c = diffTemplate(
      { placeholders: ['{{A}}', '{{B}}'], clauses: [{ tag: 'X', label: 'Cesiune', placeholders: [] }] },
      { placeholders: ['{{B}}', '{{C}}'], clauses: [{ tag: 'Y', label: 'Majorare', placeholders: [] }] },
      BUILTINS,
    )
    expect(c).toMatchObject({ added: ['{{C}}'], removed: ['{{A}}'], addedClauses: ['Majorare'], removedClauses: ['Cesiune'] })
    expect(hasChanges(c)).toBe(true)
  })

  it('fără schimbări de câmpuri, doar textul documentului', () => {
    expect(hasChanges(diffTemplate({ placeholders: ['{{A}}'] }, { placeholders: ['{{A}}'], clauses: [] }, BUILTINS))).toBe(false)
  })

  it('la un formular dedicat semnalează câmpurile pe care formularul nu le cere', () => {
    const c = diffTemplate(
      { placeholders: ['{{SOCIETATE_DENUMIRE}}'], sourceKey: 'anexa1_inregistrare_fiscala' },
      { placeholders: ['{{SOCIETATE_DENUMIRE}}', '{{CAMP_NOU}}'], clauses: [] },
      BUILTINS,
    )
    expect(c.dedicatedUnasked).toEqual(['{{CAMP_NOU}}'])
  })

  it('o declarație recunoscută după etichete își pierde formularul dacă etichetele dispar', () => {
    const decl = ['{{DECLARANT_NUME}}', '{{SEDIU_LOCALITATE}}']
    expect(dedicatedFormKey({ placeholders: decl })).toBe('declaratie_activitate')
    expect(diffTemplate({ placeholders: decl }, { placeholders: ['{{DECLARANT_NUME}}'], clauses: [] }, BUILTINS).dedicatedLost).toBe(true)
  })
})

describe('visibleBuiltins', () => {
  it('ascunde doar cheile alese; lipsa listei = toate vizibile', () => {
    expect(visibleBuiltins(BUILTINS, undefined)).toHaveLength(2)
    expect(visibleBuiltins(BUILTINS, ['act_constitutiv']).map(b => b.key)).toEqual(['anexa1_inregistrare_fiscala'])
  })
})

describe('deliveryLabel', () => {
  const members: Record<string, WorkspaceMember> = { ana: { role: 'member', email: 'ana@ex.ro', displayName: 'Ana Pop', addedAt: null } }
  const delivery = { by: 'sa', sourceTemplateId: 't1' }
  const at = { toDate: () => new Date(2026, 10, 3) }

  it('nimic pentru un șablon propriu; „Pregătit de Cabinio” pentru unul livrat nemodificat', () => {
    expect(deliveryLabel({}, members)).toBeNull()
    expect(deliveryLabel({ delivery, revision: 0 }, members)).toBe('Pregătit de Cabinio')
  })

  it('după înlocuirea fișierului arată cine și când l-a modificat', () => {
    expect(deliveryLabel({ delivery, revision: 1, updatedBy: 'ana', updatedAt: at }, members))
      .toBe('Pregătit de Cabinio · modificat de Ana Pop, 3 noiembrie 2026')
    expect(deliveryLabel({ delivery, revision: 2, updatedBy: 'plecat' }, members)).toBe('Pregătit de Cabinio · modificat de cabinet')
  })
})

describe('actorLabel', () => {
  const entry = (actorUid: string, meta: Record<string, unknown> = {}): AuditEntry =>
    ({ id: '1', ts: null, actorUid, action: 'template.deliver', target: 't', meta, ip: null })
  it('acțiunile furnizorului apar ca „Echipa Cabinio”, nu ca utilizator eliminat', () => {
    const nameOf = () => 'Utilizator eliminat'
    expect(actorLabel(entry('sa', { byProvider: true }), nameOf)).toBe('Echipa Cabinio')
    expect(actorLabel(entry('system'), nameOf)).toBe('Sistem')
    expect(actorLabel(entry('ana'), uid => uid)).toBe('ana')
  })
})

describe('formLinkOptions', () => {
  it('oferă doar șabloanele de bază care schimbă ceva, în ordinea lor', () => {
    const opts = formLinkOptions([builtin('act_constitutiv'), builtin('hotarare_aga'), builtin('contract_comodat'), builtin('anexa1_inregistrare_fiscala')])
    expect(opts.map(o => o.key)).toEqual(['hotarare_aga', 'anexa1_inregistrare_fiscala'])
    expect(opts.every(o => o.effect.length > 0)).toBe(true)
  })
})

describe('matchesTemplateSearch', () => {
  it('ignoră diacriticele și majusculele și cere toate cuvintele', () => {
    expect(matchesTemplateSearch('Hotărâre AGA', 'hot aga')).toBe(true)
    expect(matchesTemplateSearch('Declarație Beneficiari Reali', 'DECLARATIE')).toBe(true)
    expect(matchesTemplateSearch('Hotărâre AGA', 'hotarare comodat')).toBe(false)
  })
  it('o căutare goală se potrivește cu orice', () => {
    expect(matchesTemplateSearch('Act Constitutiv', '  ')).toBe(true)
  })
})

describe('applyTemplateOrder', () => {
  const items = ['a', 'b', 'c', 'd']
  it('fără ordine salvată, lista rămâne neschimbată', () => {
    expect(applyTemplateOrder(items, x => x, undefined)).toEqual(items)
  })
  it('respectă ordinea salvată; elementele noi vin primele, iar cheile vechi sunt ignorate', () => {
    expect(applyTemplateOrder(items, x => x, ['c', 'zzz', 'a', 'b'])).toEqual(['d', 'c', 'a', 'b'])
  })
})
