import { describe, it, expect } from 'vitest'
import { clientMatchesQuery } from './clienti'
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
