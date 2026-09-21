import { describe, it, expect } from 'vitest'
import { buildVariantContext, variantWarningMessage } from './variants'
import type { Client, Persoana } from '../types'

const person = (over: Partial<Persoana>): Persoana => ({
  calitate: 'Asociat', cotaParticipare: '', cnp: '', nume: '', prenume: '', serie_numar: '', data_nasterii: '', locul_nasterii: '',
  cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...over,
})
const client = (over: Partial<Client>): Partial<Client> => ({ tipClient: 'PJ', asociati: [], administratori: [], caenSecundare: [], ...over })

describe('buildVariantContext', () => {
  const c = client({
    asociati: [
      person({ nume: 'Popescu', prenume: 'Ion', cnp: '1900101123456' }),
      person({ nume: 'Ionescu', prenume: 'Maria', cnp: '2900101123456' }),
      person({ nume: 'Strain', prenume: 'John', cnp: '9900101123456', sex: 'M' }),   // străin: sexul ales manual
      person({ nume: 'Mascat', prenume: 'Ana', cnp: '', pid: 'p1', cnpMasked: '•••••••••3456' }),   // CNP încă necitit din vault
    ],
    administratori: [person({ nume: 'Popescu', prenume: 'Ion', cnp: '1900101123456' })],
  })

  it('sexul fiecărei persoane, numărul de asociați/administratori și tipul clientului', () => {
    const { ctx } = buildVariantContext({ client: c, replacements: {} })
    expect(ctx.sex).toMatchObject({ ASOCIAT_1: 'M', ASOCIAT_2: 'F', ASOCIAT_3: 'M', ASOCIAT_4: null, ADMINISTRATOR_1: 'M' })
    expect(ctx.asociati).toBe(4)
    expect(ctx.administratori).toBe(1)
    expect(ctx.tip).toBe('PJ')
  })

  it('persoanele numite doar prin etichete proprii (clauze, declarant) se potrivesc după nume sau după CNP', () => {
    const { ctx, labels } = buildVariantContext({
      client: c,
      replacements: {
        '{{ADMINISTRATOR_NOU_NUME}}': 'Maria Ionescu',
        '{{ADMINISTRATOR_VECHI_NUME}}': 'Necunoscut Persoană',
        '{{DECLARANT_NUME}}': 'Altcineva', '{{DECLARANT_PRENUME}}': 'Elena', '{{DECLARANT_CNP}}': '2900101123456',
      },
    })
    expect(ctx.sex.ADMINISTRATOR_NOU).toBe('F')          // după nume
    expect(ctx.sex.ADMINISTRATOR_VECHI).toBeNull()       // necunoscut: serverul nu ghicește
    expect(ctx.sex.DECLARANT).toBe('F')                  // din CNP
    expect(labels.ADMINISTRATOR_NOU).toBe('Maria Ionescu')
  })

  it('un client PF: persoana singulară e titularul, iar numărul de asociați e 0', () => {
    const pf = client({ tipClient: 'PF', titular: person({ nume: 'Vasile', prenume: 'Dan', cnp: '5000101123456' }) })
    const { ctx } = buildVariantContext({ client: pf, replacements: {} })
    expect(ctx.sex['']).toBe('M')
    expect(ctx.tip).toBe('PF')
    expect(ctx.asociati).toBe(0)
  })

  it('fără client: tip necunoscut', () => {
    expect(buildVariantContext({ client: null, replacements: {} }).ctx.tip).toBeNull()
  })
})

describe('variantWarningMessage', () => {
  it('numește persoanele cu sex necunoscut', () => {
    const msg = variantWarningMessage(['ASOCIAT_4', 'X'], { ASOCIAT_4: 'Mascat Ana' })
    expect(msg).toContain('Mascat Ana')
    expect(msg).toContain('X')
    expect(msg).toContain('„Sex”')
  })
  it('fără avertismente: nimic de afișat', () => {
    expect(variantWarningMessage([], {})).toBeNull()
    expect(variantWarningMessage(undefined, {})).toBeNull()
  })
})
