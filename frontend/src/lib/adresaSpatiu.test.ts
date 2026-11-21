import { describe, it, expect } from 'vitest'
import type { Client } from '../types'
import { felAdresa, isAdresaSpatiu, normAdresa, optiuniAdresa, propunerePunctLucru } from './adresaSpatiu'
import { parseAdresa } from './adresa'

const client = { sediuSocial: parseAdresa('Jud. Arad, Mun. Arad, Str. Mare nr. 1'), puncteLucru: ['Arad, Str. Mică nr. 2'] } as Partial<Client>

describe('adresa spațiului', () => {
  it('recunoaște câmpurile de adresă ale spațiului', () => {
    expect(isAdresaSpatiu('{{CAMP_ADRESA_SPATIU}}')).toBe(true)
    expect(isAdresaSpatiu('{{CAMP_ADRESA_IMOBIL}}')).toBe(true)
    expect(isAdresaSpatiu('{{CAMP_PROPRIETAR_SEDIU}}')).toBe(false)
  })

  it('alege dintre sediul social și punctele de lucru, altfel e adresă nouă', () => {
    const o = optiuniAdresa(client)
    expect(o.map(x => x.fel)).toEqual(['sediu', 'punct'])
    expect(felAdresa(o[0].adresa, o)).toBe('sediu')
    expect(felAdresa(' arad, str. mică  nr. 2 ', o)).toBe('punct')
    expect(felAdresa('Timișoara, Str. Nouă 3', o)).toBe('noua')
    expect(felAdresa('', o)).toBeNull()
    expect(felAdresa('Arad, Strada Mica, numarul 2', o)).toBe('punct')
  })

  it('compară adresele fără diacritice, punctuație și prescurtări diferite', () => {
    expect(normAdresa('Str. Mică nr. 2, ap. 3')).toBe(normAdresa('strada mica 2 apartament 3'))
    expect(normAdresa('Jud. Arad, Mun. Arad')).toBe(normAdresa('Județul Arad, Municipiul Arad'))
    expect(normAdresa('Str. Mică nr. 2')).not.toBe(normAdresa('Str. Mică nr. 22'))
  })

  it('propune adresa nouă ca punct de lucru, o singură dată', () => {
    const p = propunerePunctLucru('Timișoara, Str. Nouă 3')
    expect(p.update!({ puncteLucru: ['A'] })).toEqual({ puncteLucru: ['A', 'Timișoara, Str. Nouă 3'] })
    expect(p.update!({ puncteLucru: ['timișoara, str. nouă 3'] })).toEqual({})
  })
})
