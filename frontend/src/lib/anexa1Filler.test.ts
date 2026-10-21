import { describe, it, expect } from 'vitest'
import {
  splitDigitBoxes, buildAnexa1DocxData, declarantCandidatesAnexa1, isAnexa1Template,
  EMPTY_ANEXA1_STATE, ANEXA1_KEY,
} from './anexa1Filler'
import type { Anexa1FormState } from './anexa1Filler'
import type { Client, Persoana } from '../types'

const persoana = (nume: string, prenume: string): Persoana => ({
  calitate: '', cotaParticipare: '', cnp: '', nume, prenume, serie_numar: '', data_nasterii: '',
  locul_nasterii: '', cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '',
})

describe('splitDigitBoxes', () => {
  it('descompune o dată RO validă în 8 cifre, fără separatori', () => {
    const out = splitDigitBoxes('DLEP', '13.10.2026')
    expect(out).toEqual({
      '{{DLEP_1}}': '1', '{{DLEP_2}}': '3', '{{DLEP_3}}': '1', '{{DLEP_4}}': '0',
      '{{DLEP_5}}': '2', '{{DLEP_6}}': '0', '{{DLEP_7}}': '2', '{{DLEP_8}}': '6',
    })
  })

  it('dată goală/invalidă -> toate cele 8 placeholder-e primesc „ " (spațiu, nu string gol — /fill/docx elimină valorile falsy)', () => {
    for (const v of ['', 'abc', '13/10/2026']) {
      const out = splitDigitBoxes('DLEM', v)
      expect(Object.values(out)).toEqual([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '])
      expect(Object.keys(out)).toHaveLength(8)
    }
  })
})

describe('declarantCandidatesAnexa1', () => {
  it('PJ: administratorii firmei, deduplicați după nume', () => {
    const client: Partial<Client> = { tipClient: 'PJ', administratori: [persoana('Popescu', 'Ion'), persoana('Popescu', 'Ion'), persoana('Ionescu', 'Ana')] }
    const out = declarantCandidatesAnexa1(client)
    expect(out).toEqual([
      { label: 'Popescu Ion', numeComplet: 'Popescu Ion', functie: 'ADMINISTRATOR' },
      { label: 'Ionescu Ana', numeComplet: 'Ionescu Ana', functie: 'ADMINISTRATOR' },
    ])
  })

  it('PF: titularul, cu funcția „-” (nu există funcție de declarat)', () => {
    const client: Partial<Client> = { tipClient: 'PF', titular: persoana('Vasile', 'Maria') }
    expect(declarantCandidatesAnexa1(client)).toEqual([{ label: 'Vasile Maria', numeComplet: 'Vasile Maria', functie: '-' }])
  })

  it('fără client sau fără administratori/titular -> listă goală', () => {
    expect(declarantCandidatesAnexa1(undefined)).toEqual([])
    expect(declarantCandidatesAnexa1({ tipClient: 'PJ' })).toEqual([])
    expect(declarantCandidatesAnexa1({ tipClient: 'PF' })).toEqual([])
  })
})

describe('buildAnexa1DocxData', () => {
  // Cele 80 de placeholder-e găsite efectiv în șablonul .docx (vezi doc_filler.list_placeholders_in_docx) —
  // orice derapaj aici (un placeholder lipsă sau unul inventat, care n-are cum să ajungă în document) e un bug.
  const EXPECTED_KEYS = [
    '{{BIF_PERSOANA_JURIDICA}}', '{{BIF_PERSOANA_FIZICA}}', '{{CAMP_NR_CERERE}}', '{{CAMP_DATA_CERERE}}',
    '{{BIF_IMPOZIT_PROFIT}}', '{{BIF_PERIOADA_TRIM}}', '{{BIF_PERIOADA_ANUALA}}',
    '{{DECLARANT_NUME_COMPLET}}', '{{DECLARANT_FUNCTIE}}',
    '{{BIF_IMPOZIT_MICRO}}',
    '{{BIF_SALARIATI_SUB3}}', '{{BIF_VENIT_SUB100K}}', '{{BIF_SALARII_LUNARA}}', '{{BIF_SALARII_TRIMESTRIALA}}',
    '{{BIF_CAS}}', '{{BIF_CASS}}', '{{BIF_CAM}}',
    '{{BIF_TVA_SECTIUNE}}', '{{CAMP_CIFRA_AFACERI_TVA}}', '{{BIF_TVA_DEPASIRE_PLAFON}}', '{{BIF_TVA_OPTIUNE_PLAFON}}',
    '{{BIF_TVA_LUNARA}}', '{{BIF_TVA_TRIMESTRIALA}}', '{{BIF_TVA_LA_INCASARE}}',
    ...['DLEP', 'DLEM', 'DLES', 'DLECAS', 'DLECASS', 'DLECAM', 'DDEC'].flatMap(p => [1, 2, 3, 4, 5, 6, 7, 8].map(i => `{{${p}_${i}}}`)),
  ]

  it('completează exact cele 80 de placeholder-e ale șablonului, nici unul în plus sau în minus', () => {
    const { replacements } = buildAnexa1DocxData(EMPTY_ANEXA1_STATE, { tipClient: 'PJ' })
    expect(Object.keys(replacements).sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('Nr./Data cerere necompletate -> rămân punctate ca în formularul original, nu goale (se completează ulterior, la depunere)', () => {
    const { replacements } = buildAnexa1DocxData(EMPTY_ANEXA1_STATE, { tipClient: 'PJ' })
    expect(replacements['{{CAMP_NR_CERERE}}']).toBe('.'.repeat(15))
    expect(replacements['{{CAMP_DATA_CERERE}}']).toBe('.'.repeat(17))
  })

  it('Nr./Data cerere completate -> valoarea introdusă de user, nu punctele', () => {
    const state: Anexa1FormState = { ...EMPTY_ANEXA1_STATE, nrCerere: '12345', dataCerere: '13.10.2026' }
    const { replacements } = buildAnexa1DocxData(state, { tipClient: 'PJ' })
    expect(replacements['{{CAMP_NR_CERERE}}']).toBe('12345')
    expect(replacements['{{CAMP_DATA_CERERE}}']).toBe('13.10.2026')
  })

  it('tip entitate: derivat din client.tipClient, niciun câmp din UI', () => {
    expect(buildAnexa1DocxData(EMPTY_ANEXA1_STATE, { tipClient: 'PJ' }).replacements['{{BIF_PERSOANA_JURIDICA}}']).toBe('☒')
    expect(buildAnexa1DocxData(EMPTY_ANEXA1_STATE, { tipClient: 'PJ' }).replacements['{{BIF_PERSOANA_FIZICA}}']).toBe('☐')
    expect(buildAnexa1DocxData(EMPTY_ANEXA1_STATE, { tipClient: 'PF' }).replacements['{{BIF_PERSOANA_JURIDICA}}']).toBe('☐')
    expect(buildAnexa1DocxData(EMPTY_ANEXA1_STATE, { tipClient: 'PF' }).replacements['{{BIF_PERSOANA_FIZICA}}']).toBe('☒')
  })

  it('1 vs 2: alegere exclusivă profit/micro, niciodată amândouă bifate', () => {
    const profit = buildAnexa1DocxData({ ...EMPTY_ANEXA1_STATE, impozitTip: 'profit' }, { tipClient: 'PJ' }).replacements
    expect(profit['{{BIF_IMPOZIT_PROFIT}}']).toBe('☒')
    expect(profit['{{BIF_IMPOZIT_MICRO}}']).toBe('☐')
    const micro = buildAnexa1DocxData({ ...EMPTY_ANEXA1_STATE, impozitTip: 'micro' }, { tipClient: 'PJ' }).replacements
    expect(micro['{{BIF_IMPOZIT_PROFIT}}']).toBe('☐')
    expect(micro['{{BIF_IMPOZIT_MICRO}}']).toBe('☒')
  })

  it('1.2 perioada fiscală: exclusivitate trimestrială/anuală, doar când e ales 1 (profit)', () => {
    const trim = buildAnexa1DocxData({ ...EMPTY_ANEXA1_STATE, impozitTip: 'profit', perioadaProfit: 'trimestriala' }, { tipClient: 'PJ' }).replacements
    expect(trim['{{BIF_PERIOADA_TRIM}}']).toBe('☒')
    expect(trim['{{BIF_PERIOADA_ANUALA}}']).toBe('☐')
    const anuala = buildAnexa1DocxData({ ...EMPTY_ANEXA1_STATE, impozitTip: 'profit', perioadaProfit: 'anuala' }, { tipClient: 'PJ' }).replacements
    expect(anuala['{{BIF_PERIOADA_TRIM}}']).toBe('☐')
    expect(anuala['{{BIF_PERIOADA_ANUALA}}']).toBe('☒')
  })

  it('1.2 perioada fiscală: niciuna bifată când e ales 2 (micro) — secțiunea nu se aplică', () => {
    const micro = buildAnexa1DocxData({ ...EMPTY_ANEXA1_STATE, impozitTip: 'micro', perioadaProfit: 'trimestriala' }, { tipClient: 'PJ' }).replacements
    expect(micro['{{BIF_PERIOADA_TRIM}}']).toBe('☐')
    expect(micro['{{BIF_PERIOADA_ANUALA}}']).toBe('☐')
  })

  it('cutia de dată a tipului NEales rămâne goală (spațiu), doar a celui ales se completează', () => {
    const state: Anexa1FormState = { ...EMPTY_ANEXA1_STATE, impozitTip: 'micro', dataLuareEvidentaProfit: '01.02.2026', dataLuareEvidentaMicro: '13.10.2026' }
    const { replacements } = buildAnexa1DocxData(state, { tipClient: 'PJ' })
    for (let i = 1; i <= 8; i++) expect(replacements[`{{DLEP_${i}}}`]).toBe(' ')
    expect(replacements['{{DLEM_1}}']).toBe('1')
  })

  it('declarant: numele complet și funcția vin din candidatul ales (index în listă)', () => {
    const client: Partial<Client> = { tipClient: 'PJ', administratori: [persoana('Popescu', 'Ion')] }
    const state: Anexa1FormState = { ...EMPTY_ANEXA1_STATE, declarantIndex: 0 }
    const { replacements } = buildAnexa1DocxData(state, client)
    expect(replacements['{{DECLARANT_NUME_COMPLET}}']).toBe('Popescu Ion')
    expect(replacements['{{DECLARANT_FUNCTIE}}']).toBe('ADMINISTRATOR')
  })

  it('declarant neales -> câmpuri cu „ " (spațiu), nu string gol (altfel /fill/docx le-ar lăsa ca {{...}} vizibil)', () => {
    const { replacements } = buildAnexa1DocxData(EMPTY_ANEXA1_STATE, { tipClient: 'PJ' })
    expect(replacements['{{DECLARANT_NUME_COMPLET}}']).toBe(' ')
    expect(replacements['{{DECLARANT_FUNCTIE}}']).toBe(' ')
  })

  it('secțiunea opțională TVA: necompletată (tva=false) -> toate sub-opțiunile rămân neselectate/goale', () => {
    const { replacements } = buildAnexa1DocxData(EMPTY_ANEXA1_STATE, { tipClient: 'PJ' })
    expect(replacements['{{BIF_TVA_SECTIUNE}}']).toBe('☐')
    expect(replacements['{{CAMP_CIFRA_AFACERI_TVA}}']).toBe(' ')
    for (const k of ['{{BIF_TVA_DEPASIRE_PLAFON}}', '{{BIF_TVA_OPTIUNE_PLAFON}}', '{{BIF_TVA_LUNARA}}', '{{BIF_TVA_TRIMESTRIALA}}', '{{BIF_TVA_LA_INCASARE}}']) {
      expect(replacements[k]).toBe('☐')
    }
  })

  it('secțiunea opțională TVA: completată -> bifele corecte, exclusivitate regim/perioadă', () => {
    const state: Anexa1FormState = {
      ...EMPTY_ANEXA1_STATE, tva: true, cifraAfaceriTva: '150000', tvaRegim: 'optiune', tvaPerioada: 'lunara', tvaLaIncasare: true,
    }
    const { replacements } = buildAnexa1DocxData(state, { tipClient: 'PJ' })
    expect(replacements['{{BIF_TVA_SECTIUNE}}']).toBe('☒')
    expect(replacements['{{CAMP_CIFRA_AFACERI_TVA}}']).toBe('150000')
    expect(replacements['{{BIF_TVA_OPTIUNE_PLAFON}}']).toBe('☒')
    expect(replacements['{{BIF_TVA_DEPASIRE_PLAFON}}']).toBe('☐')
    expect(replacements['{{BIF_TVA_LUNARA}}']).toBe('☒')
    expect(replacements['{{BIF_TVA_TRIMESTRIALA}}']).toBe('☐')
    expect(replacements['{{BIF_TVA_LA_INCASARE}}']).toBe('☒')
  })

  it('cutiile de dată opționale (salarii, CAS/CASS/CAM) ignoră data dacă bifa e nebifată', () => {
    const state: Anexa1FormState = { ...EMPTY_ANEXA1_STATE, dataLuareEvidentaSalarii: '01.02.2026', impozitSalarii: false }
    const { replacements } = buildAnexa1DocxData(state, { tipClient: 'PJ' })
    for (let i = 1; i <= 8; i++) expect(replacements[`{{DLES_${i}}}`]).toBe(' ')
  })

  it('{{DDEC_1..8}} = data de azi, independent de starea formularului', () => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const d = new Date()
    const todayDigits = `${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}`.split('')
    const { replacements } = buildAnexa1DocxData(EMPTY_ANEXA1_STATE, { tipClient: 'PJ' })
    todayDigits.forEach((digit, i) => expect(replacements[`{{DDEC_${i + 1}}}`]).toBe(digit))
  })
})

describe('isAnexa1Template', () => {
  it('recunoaște șablonul de bază și copiile lui', () => {
    expect(isAnexa1Template({ key: ANEXA1_KEY })).toBe(true)
    expect(isAnexa1Template({ sourceKey: ANEXA1_KEY })).toBe(true)
  })
  it('nu confundă alte șabloane', () => {
    expect(isAnexa1Template({ key: 'act_constitutiv' })).toBe(false)
    expect(isAnexa1Template({})).toBe(false)
  })
})
