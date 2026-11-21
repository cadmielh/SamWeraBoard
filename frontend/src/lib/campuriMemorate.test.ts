import { describe, it, expect } from 'vitest'
import { campuriDePastrat, detaliuBifa, eticheta, grupuriBifa, memorieDinGenerari, propagaManual, sePastreaza, valoriBifa } from './campuriMemorate'
import type { DocGeneration } from '../types'

const gen = (templateName: string, generatedAt: string, campuri: Record<string, string>) =>
  ({ templateId: 't', templateName, generatedAt, generatedBy: 'u', outputName: 'o', campuri }) as DocGeneration

describe('câmpuri manuale refolosite', () => {
  it('nu păstrează numerele și datele unui document, nici datele de identitate', () => {
    expect(sePastreaza('{{CAMP_PROPRIETAR_DENUMIRE}}')).toBe(true)
    expect(sePastreaza('{{CAMP_NUMAR_CONTRACT_INCHIRIERE}}')).toBe(false)
    expect(sePastreaza('{{CAMP_DATA_CONTRACT_INCHIRIERE}}')).toBe(false)
    expect(sePastreaza('{{CAMP_NR_CF}}')).toBe(true)
    expect(sePastreaza('{{CAMP_NUMAR_INMATRICULARE}}')).toBe(true)
    expect(sePastreaza('{{CAMP_PROPRIETAR_CNP}}')).toBe(false)
  })

  it('ia cea mai nouă valoare din istoric', () => {
    const m = memorieDinGenerari([
      gen('Contract vechi', '2026-10-01T00:00:00Z', { ADRESA_SPATIU: 'Str. Veche 1' }),
      gen('Contract nou', '2026-11-01T00:00:00Z', { ADRESA_SPATIU: 'Str. Nouă 2', NUMAR_CONTRACT_INCHIRIERE: '7' }),
    ])
    expect(m['{{CAMP_ADRESA_SPATIU}}']).toMatchObject({ value: 'Str. Nouă 2', templateName: 'Contract nou' })
    expect(m['{{CAMP_NUMAR_CONTRACT_INCHIRIERE}}']).toBeUndefined()
  })

  it('salvează doar câmpurile păstrabile completate, fără cele calculate', () => {
    const f = ['{{CAMP_ADRESA_SPATIU}}', '{{CAMP_DATA_SFARSIT_X}}', '{{CAMP_DURATA_ANI_IN_LITERE}}', '{{CAMP_PRET}}']
    expect(campuriDePastrat(f, { '{{CAMP_ADRESA_SPATIU}}': 'Str. 1', '{{CAMP_DURATA_ANI_IN_LITERE}}': 'doi', '{{CAMP_PRET}}': ' ' },
      ph => ph.includes('LITERE'))).toEqual({ ADRESA_SPATIU: 'Str. 1' })
  })

  it('trece valoarea în documentele bifate doar unde e gol sau era aceeași', () => {
    const tinte = [{ id: 'a', fields: ['{{CAMP_X}}'] }, { id: 'b', fields: ['{{CAMP_X}}'] }, { id: 'c', fields: ['{{CAMP_X}}'] }, { id: 'd', fields: [] }]
    const prev: Record<string, Record<string, string>> = { b: { '{{CAMP_X}}': 'Al' }, c: { '{{CAMP_X}}': 'altceva' } }
    const next = propagaManual(prev, 'a', { '{{CAMP_X}}': 'Alb' }, { '{{CAMP_X}}': 'Al' }, tinte, (id, ph) => prev[id]?.[ph] ?? '')
    expect(next.a['{{CAMP_X}}']).toBe('Alb')
    expect(next.b['{{CAMP_X}}']).toBe('Alb')          // sincronizat cât scrii
    expect(next.c['{{CAMP_X}}']).toBe('altceva')      // completat altfel: rămâne
    expect(next.d).toBeUndefined()
  })

  it('bifele: ☒ la varianta aleasă, nimic până la alegere', () => {
    const g = grupuriBifa(['{{BIFA_SCOP_PREDARE}}', '{{BIFA_SCOP_RESTITUIRE}}', '{{CAMP_X}}'])
    expect(g).toEqual([{ grup: 'SCOP', variante: ['PREDARE', 'RESTITUIRE'] }])
    expect(valoriBifa(g, {})).toEqual({})
    expect(valoriBifa(g, { SCOP: 'RESTITUIRE' })).toEqual({ '{{BIFA_SCOP_PREDARE}}': '☐', '{{BIFA_SCOP_RESTITUIRE}}': '☒' })
  })
  it('variantele cu mai multe cuvinte și câmpul de detaliu al variantei', () => {
    const g = grupuriBifa(['{{BIFA_DESTINATIE_SEDIU_SOCIAL}}', '{{BIFA_DESTINATIE_PUNCT_DE_LUCRU}}', '{{BIFA_DESTINATIE_ALTA}}'])
    expect(g).toEqual([{ grup: 'DESTINATIE', variante: ['SEDIU_SOCIAL', 'PUNCT_DE_LUCRU', 'ALTA'] }])
    expect(detaliuBifa('{{CAMP_ALTA_DESTINATIE}}', g)).toEqual({ grup: 'DESTINATIE', varianta: 'ALTA' })
    expect(valoriBifa(g, { DESTINATIE: 'SEDIU_SOCIAL' }, ['{{CAMP_ALTA_DESTINATIE}}'])['{{CAMP_ALTA_DESTINATIE}}']).toBe('______________')
    expect(valoriBifa(g, { DESTINATIE: 'ALTA' }, ['{{CAMP_ALTA_DESTINATIE}}'])['{{CAMP_ALTA_DESTINATIE}}']).toBeUndefined()
    expect(eticheta('ALTA')).toBe('Altă')
    expect(eticheta('SEDIU_SOCIAL')).toBe('Sediu social')
  })
})
