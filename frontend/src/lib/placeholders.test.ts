import { describe, it, expect } from 'vitest'
import { buildReplacements, buildRepeatGroups, checkReadiness, joinNames, isManualPlaceholder, manualLabel } from './placeholders'
import type { Client, Persoana } from '../types'

const client = (over: Partial<Client>): Partial<Client> => ({
  tipClient: 'PJ', caenCod: '7020', caenDescriere: 'Activități de consultanță', caenSecundare: [], asociati: [], administratori: [], ...over,
})
const build = (c: Partial<Client>) => buildReplacements({ idFields: null, client: c as Client, scannedPersons: [] })

describe('coduri CAEN pentru clauza „Actualizare cod CAEN REV3”', () => {
  it('principalul și secundarele apar doar ca coduri, pe o linie', () => {
    const r = build(client({ caenSecundare: [
      { cod: '4100', descriere: 'Construcții' }, { cod: '4311', descriere: 'Demolări' }, { cod: '7311', descriere: 'Publicitate' },
    ] }))
    expect(r['{{CAEN_PRINCIPAL_COD}}']).toBe('7020')
    expect(r['{{CAEN_SECUNDARE_COD}}']).toBe('4100, 4311, 7311')
    expect(r['{{CAEN_1}}']).toContain('Activități')            // formatul „cod - descriere” rămâne neschimbat
  })

  it('fără CAEN secundare: „-”; fără CAEN principal: gol (rămâne de completat)', () => {
    expect(build(client({}))['{{CAEN_SECUNDARE_COD}}']).toBe('-')
    expect(build(client({ caenCod: '' }))['{{CAEN_PRINCIPAL_COD}}']).toBe('')
  })
})

describe('etichete pentru șabloane importate din documente cu locuri libere', () => {
  const p = (o: Partial<Persoana>): Persoana => ({
    calitate: 'Asociat', cotaParticipare: '50%', cnp: '', nume: '', prenume: '', serie_numar: '', data_nasterii: '', locul_nasterii: '',
    cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...o,
  })
  const c = client({
    sediuSocial: { judet: 'Timiș', localitate: 'Timișoara', strada: 'Exemplu', numar: '1', bloc: '', scara: '', etaj: '', apartament: '', detaliiAdresa: '' } as never,
    capitalSocial: 200,
    asociati: [p({ nume: 'Ionescu', prenume: 'Maria', serie_numar: 'CJ 123456' }), p({ nume: 'Popescu', prenume: 'Ion' })],
    administratori: [p({ nume: 'Popescu', prenume: 'Ion' })],
  })
  const r = build(c)

  it('județul sediului, seria și numărul actului separat, listele de nume', () => {
    expect(r['{{SOCIETATE_JUDET}}']).toBe('Timiș')
    expect(r['{{ASOCIAT_1_SERIE_ACT}}']).toBe('CJ')
    expect(r['{{ASOCIAT_1_NR_ACT}}']).toBe('123456')
    expect(r['{{ASOCIATI_LISTA}}']).toBe('Ionescu Maria și Popescu Ion')
    expect(r['{{ADMINISTRATORI_LISTA}}']).toBe('Popescu Ion')
    expect(r['{{CAPITAL_SOCIAL_ASOCIAT_1}}']).toBe('100')
  })

  it('joinNames: unul, doi, trei sau niciunul', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames([p({ nume: 'A', prenume: 'a' })])).toBe('A a')
    expect(joinNames([p({ nume: 'A' }), p({ nume: 'B' }), p({ nume: 'C' })])).toBe('A, B și C')
  })

  it('câmpuri manuale {{CAMP_…}}: recunoscute și cu titlu citibil', () => {
    expect(isManualPlaceholder('{{CAMP_NR_HOTARARE}}')).toBe(true)
    expect(isManualPlaceholder('{{CAMPUL}}')).toBe(false)
    expect(isManualPlaceholder('{{ASOCIAT_1_NUME}}')).toBe(false)
    expect(manualLabel('{{CAMP_NR_HOTARARE}}')).toBe('Nr hotarare')
  })
})

describe('buildRepeatGroups — {{#ASOCIATI}}/{{#ADMINISTRATORI}}, pentru șabloane cu bloc repetitiv', () => {
  const p = (o: Partial<Persoana>): Persoana => ({
    calitate: 'Asociat', cotaParticipare: '50%', cnp: '', nume: '', prenume: '', serie_numar: '', data_nasterii: '', locul_nasterii: '',
    cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...o,
  })

  it('SERIE și NR_ACT sunt despărțite ca la pozițiile numerotate (Serie & Nr. CI e un singur câmp în fișă)', () => {
    const c = client({ asociati: [p({ nume: 'Ionescu', prenume: 'Maria', serie_numar: 'AR 123456' })], administratori: [] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.ASOCIATI[0].SERIE_ACT).toBe('AR')
    expect(groups.ASOCIATI[0].NR_ACT).toBe('123456')
    expect(groups.ASOCIATI[0].SERIE_NUMAR).toBe('AR 123456')     // forma combinată rămâne disponibilă și ea
  })

  it('alias retro-compatibil: un șablon convertit înainte de redenumirea SERIE → SERIE_ACT tot se completează', () => {
    const c = client({ asociati: [p({ nume: 'Ionescu', prenume: 'Maria', serie_numar: 'AR 123456' })], administratori: [] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.ASOCIATI[0].SERIE).toBe('AR')                  // tag-ul vechi {{SERIE}} din bloc repetitiv deja convertit
    const r = buildReplacements({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(r['{{ASOCIAT_1_SERIE}}']).toBe('AR')                  // tag-ul vechi {{ASOCIAT_1_SERIE}} din poziții numerotate
    expect(r['{{ASOCIAT_1_SERIE_ACT}}']).toBe('AR')               // și forma nouă rămâne disponibilă
  })

  it('la fel și pentru administratori', () => {
    const c = client({ asociati: [], administratori: [p({ nume: 'Popescu', prenume: 'Ion', serie_numar: 'TM 654321' })] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.ADMINISTRATORI[0].SERIE_ACT).toBe('TM')
    expect(groups.ADMINISTRATORI[0].NR_ACT).toBe('654321')
  })

  it('serie lipsă: câmpurile despărțite rămân goale, nu apar erori', () => {
    const c = client({ asociati: [p({ nume: 'X', serie_numar: '' })], administratori: [] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.ASOCIATI[0].SERIE_ACT).toBe('')
    expect(groups.ASOCIATI[0].NR_ACT).toBe('')
  })
})

describe('SOCIETATE_SEDIU_FARA_JUDET — pentru șabloane cu județul cerut separat („sediul în ……, jud. ……”)', () => {
  it('conține tot ce are SOCIETATE_SEDIU, în afară de județ', () => {
    const c = client({ sediuSocial: { judet: 'Timiș', localitate: 'Timișoara', strada: 'Exemplu', numar: '1', bloc: '', scara: '', etaj: '', apartament: '' } })
    const r = buildReplacements({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(r['{{SOCIETATE_SEDIU}}']).toBe('Timiș, Timișoara, Str. Exemplu, nr. 1')
    expect(r['{{SOCIETATE_SEDIU_FARA_JUDET}}']).toBe('Timișoara, Str. Exemplu, nr. 1')
    expect(r['{{SOCIETATE_SEDIU_FARA_JUDET}}']).not.toContain('Timiș,')
  })

  it('fără sediu completat: gol, fără eroare', () => {
    const r = buildReplacements({ idFields: null, client: client({}) as Client, scannedPersons: [] })
    expect(r['{{SOCIETATE_SEDIU_FARA_JUDET}}']).toBe('')
  })
})

describe('checkReadiness recunoaște {{SERIE_ACT}}/{{NR_ACT}} ca fiind câmpuri per-persoană dintr-un bloc repetitiv', () => {
  const p = (o: Partial<Persoana>): Persoana => ({
    calitate: 'Asociat', cotaParticipare: '', cnp: '', nume: '', prenume: '', serie_numar: '', data_nasterii: '', locul_nasterii: '',
    cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...o,
  })
  const groups = buildRepeatGroups({
    idFields: null, scannedPersons: [],
    client: client({ asociati: [p({ nume: 'A', serie_numar: 'AR 111111' }), p({ nume: 'B', serie_numar: 'TM 222222' })] }) as Client,
  })

  it('completat la toate persoanele: nu apare ca lipsă (bug reprodus: rămânea mereu „lipsă”)', () => {
    const { filled, missing } = checkReadiness(['{{SERIE_ACT}}', '{{NR_ACT}}'], {}, groups)
    expect(filled).toEqual(['{{SERIE_ACT}}', '{{NR_ACT}}'])
    expect(missing).toEqual([])
  })

  it('lipsă la o singură persoană: rămâne raportat ca „lipsă” (corect)', () => {
    const cu_una_goala = buildRepeatGroups({
      idFields: null, scannedPersons: [],
      client: client({ asociati: [p({ nume: 'A', serie_numar: 'AR 111111' }), p({ nume: 'B', serie_numar: '' })] }) as Client,
    })
    const { missing } = checkReadiness(['{{SERIE_ACT}}', '{{NR_ACT}}'], {}, cu_una_goala)
    expect(missing).toEqual(['{{SERIE_ACT}}', '{{NR_ACT}}'])
  })
})
