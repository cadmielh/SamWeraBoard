import { describe, it, expect } from 'vitest'
import { choiceFromSuggestion, choicesToTags, manualTag, personTag, summarize, tagForChoice } from './blanks'
import type { BlankSuggestion } from './api'

const sug = (o: Partial<BlankSuggestion>): BlankSuggestion => ({
  id: 0, scope: 'manual', field: null, confidence: 'low', before: '', after: '', label: 'Nr. hotărârii', tag: '{{CAMP_NR_HOTARARII}}', ...o,
})

describe('etichetele rezultate din alegeri (oglinda blanks.py)', () => {
  it('persoană: nume complet, aport, părți sociale și câmpuri obișnuite', () => {
    expect(personTag('ASOCIAT', 2, 'NUME_COMPLET')).toBe('{{ASOCIAT_2_NUME}} {{ASOCIAT_2_PRENUME}}')
    expect(personTag('ADMINISTRATOR', 1, 'CNP')).toBe('{{ADMINISTRATOR_1_CNP}}')
    expect(personTag('ASOCIAT', 3, 'CAPITAL_SOCIAL')).toBe('{{CAPITAL_SOCIAL_ASOCIAT_3}}')
    expect(personTag('ASOCIAT', 1, 'PARTI_SOCIALE')).toBe('{{PARTI_SOCIALE_ASOCIAT_1}}')
    expect(personTag('ASOCIAT', 1, 'SERIE_ACT')).toBe('{{ASOCIAT_1_SERIE_ACT}}')
  })

  it('câmp manual: litere mari fără diacritice, separate prin „_”', () => {
    expect(manualTag('Nr. hotărârii')).toBe('{{CAMP_NR_HOTARARII}}')
    expect(manualTag('Durata mandatului până la')).toBe('{{CAMP_DURATA_MANDATULUI_PANA_LA}}')
    expect(manualTag('  ')).toBe('{{CAMP_VALOARE}}')
    expect(manualTag('x'.repeat(80)).length).toBeLessThanOrEqual('{{CAMP_}}'.length + 40)
  })

  it('societate, persoană, manual, neschimbat', () => {
    expect(tagForChoice({ kind: 'company', field: 'SOCIETATE_SEDIU' })).toBe('{{SOCIETATE_SEDIU}}')
    expect(tagForChoice({ kind: 'person', role: 'ASOCIAT', n: 0, field: 'CNP' })).toBe('{{ASOCIAT_1_CNP}}')      // numărul minim e 1
    expect(tagForChoice({ kind: 'manual', label: 'Suma chiriei' })).toBe('{{CAMP_SUMA_CHIRIEI}}')
    expect(tagForChoice({ kind: 'keep' })).toBeNull()
  })

  it('alegerea inițială urmează propunerea serverului', () => {
    expect(choiceFromSuggestion(sug({ scope: 'company', field: 'SOCIETATE_CIF' }))).toEqual({ kind: 'company', field: 'SOCIETATE_CIF' })
    expect(choiceFromSuggestion(sug({ scope: 'person', field: 'CNP', role: 'ADMINISTRATOR', person: 2 }))).toEqual({ kind: 'person', role: 'ADMINISTRATOR', n: 2, field: 'CNP' })
    expect(choiceFromSuggestion(sug({}))).toEqual({ kind: 'manual', label: 'Nr. hotărârii' })
  })

  it('doar locurile cu etichetă ajung la server', () => {
    expect(choicesToTags({ 0: { kind: 'keep' }, 1: { kind: 'company', field: 'DATA_AZI' }, 2: { kind: 'manual', label: 'Suma' } }))
      .toEqual({ 1: '{{DATA_AZI}}', 2: '{{CAMP_SUMA}}' })
  })

  it('rezumat: câte sunt de verificat', () => {
    expect(summarize([sug({ confidence: 'high' }), sug({ confidence: 'medium' }), sug({ confidence: 'low' })])).toEqual({ total: 3, toCheck: 2, recognized: 1 })
  })
})
