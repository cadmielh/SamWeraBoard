import { describe, expect, it, vi } from 'vitest'

vi.mock('./firebase', () => ({ db: {} }))

// Testele rulează în Node: o sesiune de tab simplă, în memorie.
const sesiune = new Map<string, string>()
vi.stubGlobal('sessionStorage', {
  getItem: (k: string) => sesiune.get(k) ?? null,
  setItem: (k: string, v: string) => { sesiune.set(k, v) },
  removeItem: (k: string) => { sesiune.delete(k) },
})

import { NOUTATI, deAnuntat, noutatiVizibile, opresteTur, pornesteTur, turAcum, urmatorulPasTur, type Noutate } from './noutati'

const N = (o: Partial<Noutate>): Noutate => ({ id: 'x', data: '2026-11-24', icon: '•', titlu: 'T', text: 't', ...o })
const lista = [
  N({ id: 'veche', data: '2026-10-01' }),
  N({ id: 'doc', feature: 'documente' }),
  N({ id: 'doc-admin', feature: 'documente', roluri: ['admin'] }),
]
const cu = (features: string[], rol: 'admin' | 'member' | 'viewer' | null) => ({ hasFeature: (k: string) => features.includes(k), rol })

describe('noutăți', () => {
  it('doar în cabinetele cu funcția pornită și pentru rolurile alese; cele mai noi primele', () => {
    expect(noutatiVizibile(lista, cu([], 'admin')).map(n => n.id)).toEqual(['veche'])
    expect(noutatiVizibile(lista, cu(['documente'], 'member')).map(n => n.id)).toEqual(['doc', 'veche'])
    expect(noutatiVizibile(lista, cu(['documente'], 'admin')).map(n => n.id)).toEqual(['doc', 'doc-admin', 'veche'])
  })
  it('fereastra: nevăzute și lansate după crearea contului', () => {
    const vazute = new Set(['doc'])
    expect(deAnuntat(lista, cu(['documente'], 'admin'), vazute, new Date('2026-01-01')).map(n => n.id)).toEqual(['doc-admin', 'veche'])
    // cont creat după lansarea noutății „veche”: nu o primește în fereastră
    expect(deAnuntat(lista, cu(['documente'], 'admin'), new Set(), new Date('2026-11-01')).map(n => n.id)).toEqual(['doc', 'doc-admin'])
  })
  it('funcția pornită mai târziu: anunțul apare atunci, nu e consumat cât timp era oprită', () => {
    const vazute = new Set<string>()
    expect(deAnuntat(lista, cu([], 'member'), vazute, new Date('2026-01-01')).map(n => n.id)).toEqual(['veche'])
    expect(deAnuntat(lista, cu(['documente'], 'member'), new Set(['veche']), new Date('2026-01-01')).map(n => n.id)).toEqual(['doc'])
  })
  it('lista reală: id-uri unice, date valide, acțiuni cu cale internă', () => {
    expect(new Set(NOUTATI.map(n => n.id)).size).toBe(NOUTATI.length)
    for (const n of NOUTATI) {
      expect(n.data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (n.actiune) expect(n.actiune.cale.startsWith('/')).toBe(true)
      if (n.tur) {
        expect(n.tur.ruta.startsWith('/')).toBe(true)
        expect(n.tur.pasi.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('turul „Arată-mi cum”', () => {
  it('pornește la primul pas, avansează și se încheie după ultimul', () => {
    const n = N({ id: 'tur', tur: { ruta: '/', pasi: [{ tinta: 'a', text: '1' }, { tinta: 'b', text: '2' }] } })
    pornesteTur(n)
    expect(turAcum()).toMatchObject({ index: 0 })
    urmatorulPasTur()
    expect(turAcum()).toMatchObject({ index: 1 })
    urmatorulPasTur()
    expect(turAcum()).toBeNull()
  })
  it('pasul curent se păstrează în sesiune (o reîncărcare nu pierde turul), iar la oprire se șterge', () => {
    const n = NOUTATI.find(x => x.tur)!
    pornesteTur(n)
    urmatorulPasTur()
    expect(JSON.parse(sessionStorage.getItem('cabinio:tur-noutate')!)).toEqual({ id: n.id, index: 1 })
    opresteTur()
    expect(sessionStorage.getItem('cabinio:tur-noutate')).toBeNull()
  })
  it('un anunț fără tur nu pornește nimic; „Închide” oprește oricând', () => {
    pornesteTur(N({ id: 'simplu' }))
    expect(turAcum()).toBeNull()
    pornesteTur(N({ id: 't', tur: { ruta: '/', pasi: [{ tinta: 'a', text: '1' }] } }))
    opresteTur()
    expect(turAcum()).toBeNull()
  })
})
