import { describe, it, expect } from 'vitest'
import { withEmptyFieldMarks, withOptionalFieldMarks, isDeclaratieTemplate, EMPTY_FIELD_MARK } from './declaratieActivitateFiller'

const PH = ['{{DECLARANT_NUME}}', '{{DECLARANT_SC}}', '{{SEDIU_ET}}', '{{SEDIU_TEL}}', '{{SOCIETATE_NR_REG}}', '{{CAEN}}', '{{ADRESA}}', '{{NR_CRT}}']

describe('withEmptyFieldMarks', () => {
  it('pune „-” în locul câmpurilor simple goale sau lipsă (nu lasă eticheta brută)', () => {
    const out = withEmptyFieldMarks(PH, { '{{DECLARANT_NUME}}': 'Popescu', '{{DECLARANT_SC}}': '', '{{SEDIU_TEL}}': '   ' })
    expect(out['{{DECLARANT_NUME}}']).toBe('Popescu')
    for (const k of ['{{DECLARANT_SC}}', '{{SEDIU_ET}}', '{{SEDIU_TEL}}', '{{SOCIETATE_NR_REG}}']) expect(out[k]).toBe(EMPTY_FIELD_MARK)
  })

  it('nu atinge câmpurile din tabelele repetitive: celulele lor goale rămân goale', () => {
    const rows = { SEDII_SECUNDARE: [{ NR_CRT: '1', ADRESA: 'Str. X', CAEN: '4711' }, { NR_CRT: '', ADRESA: '', CAEN: '4719' }] }
    const out = withEmptyFieldMarks(PH, {}, rows)
    for (const k of ['{{CAEN}}', '{{ADRESA}}', '{{NR_CRT}}']) expect(out[k]).toBeUndefined()
    expect(out['{{SEDIU_ET}}']).toBe(EMPTY_FIELD_MARK)
  })

  it('nu modifică obiectul primit', () => {
    const input = { '{{DECLARANT_NUME}}': 'Popescu' }
    withEmptyFieldMarks(PH, input)
    expect(input).toEqual({ '{{DECLARANT_NUME}}': 'Popescu' })
  })
})

describe('isDeclaratieTemplate', () => {
  it('recunoaște șablonul de bază, copiile lui și documentele proprii cu aceleași etichete', () => {
    expect(isDeclaratieTemplate({ key: 'declaratie_activitate' })).toBe(true)
    expect(isDeclaratieTemplate({ sourceKey: 'declaratie_activitate' })).toBe(true)
    expect(isDeclaratieTemplate({ placeholders: ['{{DECLARANT_NUME}}', '{{SEDIU_LOCALITATE}}', '{{X}}'] })).toBe(true)
  })
  it('nu confundă alte șabloane', () => {
    expect(isDeclaratieTemplate({ key: 'act_constitutiv' })).toBe(false)
    expect(isDeclaratieTemplate({ placeholders: ['{{DECLARANT_NUME}}'] })).toBe(false)
    expect(isDeclaratieTemplate({})).toBe(false)
  })
})

describe('withOptionalFieldMarks (celelalte șabloane, inclusiv cele proprii)', () => {
  const PH = ['{{ASOCIAT_1_NUME}}', '{{ASOCIAT_1_BL}}', '{{ASOCIAT_3_BL}}', '{{SEDIU_ET}}', '{{SOCIETATE_NR_REG}}', '{{SOCIETATE_CIF}}', '{{CNP}}', '{{#ASOCIATI}}', '{{CAEN_TEL}}']

  it('pune „-” doar la etichetele tipic opționale goale; cele obligatorii rămân vizibile', () => {
    const out = withOptionalFieldMarks(PH, { '{{ASOCIAT_1_NUME}}': 'Ion', '{{SOCIETATE_CIF}}': 'RO123' }, { ASOCIATI: [{ CAEN_TEL: '' }] })
    expect(out['{{ASOCIAT_1_BL}}']).toBe(EMPTY_FIELD_MARK)
    expect(out['{{SEDIU_ET}}']).toBe(EMPTY_FIELD_MARK)
    expect(out['{{SOCIETATE_NR_REG}}']).toBe(EMPTY_FIELD_MARK)
    expect(out['{{SOCIETATE_CIF}}']).toBe('RO123')
    expect(out['{{CNP}}']).toBeUndefined()                       // obligatoriu: rămâne etichetă, semn că lipsesc date
    expect(out['{{#ASOCIATI}}']).toBeUndefined()                 // marcajele de bloc nu se ating
    expect(out['{{CAEN_TEL}}']).toBeUndefined()                  // câmp dintr-un grup repetitiv
  })

  it('nu creează poziții inexistente: pentru un al treilea asociat care nu există serverul șterge paragraful', () => {
    const out = withOptionalFieldMarks(PH, { '{{ASOCIAT_1_NUME}}': 'Ion' })
    expect(out['{{ASOCIAT_3_BL}}']).toBeUndefined()
  })
})
