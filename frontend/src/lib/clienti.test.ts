import { describe, it, expect } from 'vitest'
import { clientMatchesQuery, missingCompanyFields, missingRegistrationFields, resolveInfiintare, EMPTY_CLIENT, EMPTY_PERSOANA, type ClientInput } from './clienti'
import type { Client } from '../types'

const client = (over: Partial<Client>): Client => ({
  id: 'c1', tipClient: 'PJ',
  denumire: 'Alfa Construct SRL', denumireLower: 'alfa construct srl',
  codFiscal: 'RO12345678',
  ...over,
} as Client)

describe('clientMatchesQuery', () => {
  it('potrivește pe substring, nu doar pe prefix', () => {
    expect(clientMatchesQuery(client({}), 'construct')).toBe(true)
    expect(clientMatchesQuery(client({}), 'alfa')).toBe(true)
    expect(clientMatchesQuery(client({}), 'beta')).toBe(false)
  })

  it('potrivește și pe cod fiscal, cu sau fără RO', () => {
    expect(clientMatchesQuery(client({}), '12345678')).toBe(true)
    expect(clientMatchesQuery(client({}), 'ro12345678')).toBe(true)
    expect(clientMatchesQuery(client({ codFiscal: '12345678' }), '1234')).toBe(true)
  })

  it('cade pe denumire când documentul nu are denumireLower (import vechi)', () => {
    const vechi = client({ denumireLower: undefined as unknown as string })
    expect(clientMatchesQuery(vechi, 'construct')).toBe(true)
  })

  it('nu aruncă pentru câmpuri lipsă', () => {
    const gol = { id: 'c2', denumire: '' } as Client
    expect(() => clientMatchesQuery(gol, 'orice')).not.toThrow()
    expect(clientMatchesQuery(gol, 'orice')).toBe(false)
  })

  it('un query gol potrivește orice (lista nefiltrată)', () => {
    expect(clientMatchesQuery(client({}), '')).toBe(true)
  })
})

describe('firmă în curs de înființare', () => {
  const firma = {
    ...EMPTY_CLIENT, formaJuridica: 'SRL', capitalSocial: 200,
    sediuSocial: { ...EMPTY_CLIENT.sediuSocial, strada: 'Str. Exemplu', numar: '1', localitate: 'Cluj-Napoca', judet: 'Cluj' },
  }

  it('fără bifă, CUI-ul și J-ul sunt obligatorii', () => {
    expect(missingCompanyFields(firma)).toEqual(['CIF', 'nr. registrul comerțului'])
  })

  it('cu bifă, lipsa lor nu mai blochează salvarea', () => {
    expect(missingCompanyFields({ ...firma, inInfiintare: true })).toEqual([])
  })

  it('cu bifă, un CUI scris greșit tot e semnalat', () => {
    expect(missingCompanyFields({ ...firma, inInfiintare: true, codFiscal: 'RO12A' })).toEqual(['CIF'])
  })

  it('eticheta spune exact ce mai lipsește, doar pentru firmele în înființare', () => {
    expect(missingRegistrationFields({ inInfiintare: true, codFiscal: '', nrRegistrul: '' })).toEqual(['CUI', 'J'])
    expect(missingRegistrationFields({ inInfiintare: true, codFiscal: 'RO123', nrRegistrul: '' })).toEqual(['J'])
    expect(missingRegistrationFields({ inInfiintare: false, codFiscal: '', nrRegistrul: '' })).toEqual([])
  })

  it('bifa se scoate singură când s-au completat ambele, și la actualizare parțială', () => {
    expect(resolveInfiintare({ inInfiintare: true, codFiscal: 'RO123', nrRegistrul: 'J12/1/2026' }, null).inInfiintare).toBe(false)
    expect(resolveInfiintare({ inInfiintare: true, codFiscal: 'RO123', nrRegistrul: '' }, null).inInfiintare).toBe(true)
    const salvat = client({ inInfiintare: true, codFiscal: 'RO123', nrRegistrul: '' })
    expect(resolveInfiintare<Partial<ClientInput>>({ nrRegistrul: 'J12/1/2026' }, salvat).inInfiintare).toBe(false)
  })
})

describe('valoarea părții sociale la salvarea firmei', () => {
  const firma = {
    ...EMPTY_CLIENT, formaJuridica: 'SRL', codFiscal: 'RO123', nrRegistrul: 'J12/1/2026', capitalSocial: 205,
    sediuSocial: { ...EMPTY_CLIENT.sediuSocial, strada: 'Str. Exemplu', numar: '1', localitate: 'Cluj-Napoca', judet: 'Cluj' },
  }

  it('implicit 10 lei: un capital care nu se împarte exact e semnalat', () => {
    expect(EMPTY_CLIENT.valoareParteSociala).toBe(10)
    expect(missingCompanyFields(firma)).toEqual(['valoarea unei părți sociale'])
  })

  it('cu 1 leu pe parte, orice capital întreg e valid', () => {
    expect(missingCompanyFields({ ...firma, valoareParteSociala: 1 })).toEqual([])
  })
})

describe('ieșirea din înființare confirmă începutul mandatelor „din prezent”', () => {
  const admin = (dataNumire: string) => ({ ...EMPTY_PERSOANA, nume: 'POPA', mandat: { durata: { tip: 'nedeterminata' as const, ani: '', data: '' }, inceput: 'aprobare' as const, dataNumire } })
  it('cu data înmatriculării: mandatele fără dată o primesc', () => {
    const out = resolveInfiintare({ ...EMPTY_CLIENT, inInfiintare: true, codFiscal: 'RO1', nrRegistrul: 'J1', dataInmatricularii: '15.06.2026', administratori: [admin(''), admin('01.01.2026')] }, null)
    expect(out.inInfiintare).toBe(false)
    expect(out.administratori?.map(a => a.mandat?.dataNumire)).toEqual(['15.06.2026', '01.01.2026'])
  })
  it('fără data înmatriculării sau încă în înființare: mandatele rămân în așteptare', () => {
    const fara = resolveInfiintare({ ...EMPTY_CLIENT, inInfiintare: true, codFiscal: 'RO1', nrRegistrul: 'J1', administratori: [admin('')] }, null)
    expect(fara.administratori?.[0].mandat?.dataNumire).toBe('')
    const inca = resolveInfiintare({ ...EMPTY_CLIENT, inInfiintare: true, dataInmatricularii: '15.06.2026', administratori: [admin('')] }, null)
    expect(inca.administratori?.[0].mandat?.dataNumire).toBe('')
  })
})
