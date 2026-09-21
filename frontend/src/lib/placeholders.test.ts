import { describe, it, expect } from 'vitest'
import { buildReplacements } from './placeholders'
import type { Client } from '../types'

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
