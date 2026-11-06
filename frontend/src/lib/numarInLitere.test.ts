import { describe, it, expect } from 'vitest'
import { numarInLitere } from './numarInLitere'

describe('numarInLitere', () => {
  it.each([
    [1, 'unu'], [2, 'doi'], [10, 'zece'], [12, 'doisprezece'], [14, 'paisprezece'], [16, 'șaisprezece'],
    [20, 'douăzeci'], [21, 'douăzeci și unu'], [25, 'douăzeci și cinci'], [50, 'cincizeci'], [99, 'nouăzeci și nouă'],
    [100, 'o sută'], [150, 'o sută cincizeci'], [200, 'două sute'], [500, 'cinci sute'], [999, 'nouă sute nouăzeci și nouă'],
    [1000, 'o mie'], [2000, 'două mii'], [12000, 'douăsprezece mii'], [20000, 'douăzeci de mii'],
    [21000, 'douăzeci și una de mii'], [100000, 'o sută de mii'], [1250, 'o mie două sute cincizeci'],
  ])('%i → %s', (n, text) => {
    expect(numarInLitere(n)).toBe(text)
  })

  it('în afara intervalului sau neîntreg: gol', () => {
    expect(numarInLitere(-1)).toBe('')
    expect(numarInLitere(2.5)).toBe('')
    expect(numarInLitere(1_000_000)).toBe('')
  })
})
