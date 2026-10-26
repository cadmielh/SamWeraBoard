import { describe, it, expect } from 'vitest'
import {
  reprezentantCandidatesBrx, buildBeneficiariRealiDocxData, isBeneficiariRealiTemplate,
  EMPTY_BRX_STATE, BRX_KEY, BRX_TIP_DECLARATIE_OPTIONS, BRX_TEMEI_OPTIONS,
} from './beneficiariRealiFiller'
import type { BeneficiariRealiFormState, BrxBeneficiarRow } from './beneficiariRealiFiller'
import type { Client, Persoana } from '../types'

const persoana = (nume: string, prenume: string, extra: Partial<Persoana> = {}): Persoana => ({
  calitate: '', cotaParticipare: '', cnp: '', nume, prenume, serie_numar: '', data_nasterii: '',
  locul_nasterii: '', cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '',
  ...extra,
})

describe('reprezentantCandidatesBrx', () => {
  it('administratorii firmei, deduplicați după nume', () => {
    const client: Partial<Client> = { administratori: [persoana('Popescu', 'Ion'), persoana('Popescu', 'Ion'), persoana('Ionescu', 'Ana')] }
    expect(reprezentantCandidatesBrx(client)).toEqual([
      { label: 'Popescu Ion', nume: 'Popescu', prenume: 'Ion' },
      { label: 'Ionescu Ana', nume: 'Ionescu', prenume: 'Ana' },
    ])
  })

  it('fără client sau fără administratori -> listă goală', () => {
    expect(reprezentantCandidatesBrx(undefined)).toEqual([])
    expect(reprezentantCandidatesBrx({})).toEqual([])
  })
})

describe('buildBeneficiariRealiDocxData', () => {
  const client: Partial<Client> = {
    administratori: [persoana('Popescu', 'Ion', { cnp: '1900101123456', serie_numar: 'VN-123456' })],
    asociati: [
      persoana('Ionescu', 'Ana', { cnp: '2900101123457', cotaParticipare: '50' }),
      persoana('Vasile', 'Maria', { cetatenia: 'franceză' }),
    ],
    nrRegistrul: 'J40/123/2026',
  }

  it('bifele de tip declarație — exact una activă, restul neselectate', () => {
    const { replacements } = buildBeneficiariRealiDocxData({ ...EMPTY_BRX_STATE, tipDeclaratie: 'anuala' }, client)
    for (const opt of BRX_TIP_DECLARATIE_OPTIONS) {
      expect(replacements[`{{${opt.tag}}}`]).toBe(opt.value === 'anuala' ? '✔' : '☐')
    }
  })

  it('reprezentant ales -> nume/serie/CNP din administratorul respectiv', () => {
    const { replacements } = buildBeneficiariRealiDocxData({ ...EMPTY_BRX_STATE, reprezentantIndex: 0 }, client)
    expect(replacements['{{REPREZENTANT_NUME}}']).toBe('Popescu')
    expect(replacements['{{REPREZENTANT_PRENUME}}']).toBe('Ion')
    expect(replacements['{{REPREZENTANT_NUME_COMPLET}}']).toBe('Popescu Ion')
    expect(replacements['{{REPREZENTANT_SERIE_ACT}}']).toBe('VN')
    expect(replacements['{{REPREZENTANT_NR_ACT}}']).toBe('123456')
    expect(replacements['{{REPREZENTANT_CNP}}']).toBe('1900101123456')
  })

  it('niciun reprezentant ales -> câmpurile rămân „ " (spațiu), nu string gol (altfel /fill/docx le-ar lăsa ca {{...}} vizibil)', () => {
    const { replacements } = buildBeneficiariRealiDocxData(EMPTY_BRX_STATE, client)
    expect(replacements['{{REPREZENTANT_NUME_COMPLET}}']).toBe(' ')
    expect(replacements['{{REPREZENTANT_CNP}}']).toBe(' ')
  })

  it('EUID: ROONRC. + nrRegistrul clientului', () => {
    const { replacements } = buildBeneficiariRealiDocxData(EMPTY_BRX_STATE, client)
    expect(replacements['{{SOCIETATE_EUID}}']).toBe('ROONRC.J40/123/2026')
  })

  it('beneficiar ales -> datele asociatului (CETATENIA cu fallback „română") + bifa de temei corectă', () => {
    const row: BrxBeneficiarRow = { asociatIndex: 0, temei: 'd2', descriere: 'ÎN MOD DIRECT' }
    const state: BeneficiariRealiFormState = { ...EMPTY_BRX_STATE, beneficiari: [row] }
    const { groups } = buildBeneficiariRealiDocxData(state, client)
    const item = groups.BENEFICIARI_REALI[0]
    expect(item.NUME).toBe('Ionescu')
    expect(item.PRENUME).toBe('Ana')
    expect(item.CNP).toBe('2900101123457')
    expect(item.CETATENIA).toBe('română')
    expect(item.DESCRIERE_CONTROL).toBe('ÎN MOD DIRECT')
    const d2Index = BRX_TEMEI_OPTIONS.findIndex(o => o.value === 'd2') + 1
    for (let i = 1; i <= BRX_TEMEI_OPTIONS.length; i++) {
      expect(item[`BIF_CONTROL_${i}`]).toBe(i === d2Index ? '✔' : '☐')
    }
  })

  it('beneficiar cu cetățenie proprie -> nu se aplică fallback-ul „română"', () => {
    const row: BrxBeneficiarRow = { asociatIndex: 1, temei: 'a1', descriere: '' }
    const state: BeneficiariRealiFormState = { ...EMPTY_BRX_STATE, beneficiari: [row] }
    const { groups } = buildBeneficiariRealiDocxData(state, client)
    expect(groups.BENEFICIARI_REALI[0].CETATENIA).toBe('franceză')
  })

  it('asociatIndex stale (clientul și-a schimbat lista de asociați după adăugarea rândului) -> rândul rămâne prezent, marcat explicit, nu gol/dispărut', () => {
    const row: BrxBeneficiarRow = { asociatIndex: 99, temei: 'a1', descriere: 'test' }
    const state: BeneficiariRealiFormState = { ...EMPTY_BRX_STATE, beneficiari: [row] }
    const { groups } = buildBeneficiariRealiDocxData(state, client)
    expect(groups.BENEFICIARI_REALI).toHaveLength(1)
    const item = groups.BENEFICIARI_REALI[0]
    expect(item.NUME).toBe('(asociat indisponibil)')
    // Restul cheilor din persoanaToSingularMap trebuie să existe (string gol), nu lipsă —
    // altfel placeholder-ele lor ar rămâne literal {{...}} în documentul generat.
    expect(item.CNP).toBe('')
    expect(item.DESCRIERE_CONTROL).toBe('test')
  })
})

describe('isBeneficiariRealiTemplate', () => {
  it('recunoaște șablonul de bază și copiile lui', () => {
    expect(isBeneficiariRealiTemplate({ key: BRX_KEY })).toBe(true)
    expect(isBeneficiariRealiTemplate({ sourceKey: BRX_KEY })).toBe(true)
  })
  it('nu confundă alte șabloane', () => {
    expect(isBeneficiariRealiTemplate({ key: 'anexa1_inregistrare_fiscala' })).toBe(false)
    expect(isBeneficiariRealiTemplate({})).toBe(false)
  })
})
