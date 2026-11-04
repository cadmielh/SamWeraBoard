import { describe, expect, it } from 'vitest'
import { cetatenieAcord, cetatenieText } from './cetatenie'
import { persoanaToSingularMap } from './placeholders'
import { EMPTY_PERSOANA } from './clienti'

describe('cetățenia în textul actului', () => {
  it('după „cetățenia …”: adjectivul cu literă mică', () => {
    expect(cetatenieText('Română')).toBe('română')
    expect(cetatenieText('ROMÂNĂ')).toBe('română')
    expect(cetatenieText('Republica Moldova')).toBe('Republica Moldova')
    expect(cetatenieText('')).toBe('')
  })
  it('după „cetățean …”: acordat cu sexul persoanei', () => {
    expect(cetatenieAcord('Română', 'M')).toBe('român')
    expect(cetatenieAcord('Română', 'F')).toBe('română')
    expect(cetatenieAcord('moldoveană', 'M')).toBe('moldovean')
    expect(cetatenieAcord('Greacă', 'M')).toBe('grec')
    expect(cetatenieAcord('Română', null)).toBe('român')
    expect(cetatenieAcord('ROU', 'M')).toBe('ROU')
  })
  it('blocurile repetitive primesc ambele forme, după sexul din CNP', () => {
    const femeie = persoanaToSingularMap({ ...EMPTY_PERSOANA, cetatenia: 'Română', cnp: '2900101123456' })
    expect(femeie.CETATENIA).toBe('română')
    expect(femeie.CETATENIA_ACORD).toBe('română')
    const barbat = persoanaToSingularMap({ ...EMPTY_PERSOANA, cetatenia: 'Română', cnp: '1900101123456' })
    expect(barbat.CETATENIA_ACORD).toBe('român')
  })
})
