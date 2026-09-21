import { describe, it, expect } from 'vitest'
import { sexFromCnp, personSex } from './sex'

describe('sexFromCnp', () => {
  it('prima cifră: 1, 3, 5, 7 = M; 2, 4, 6, 8 = F', () => {
    for (const d of '1357') expect(sexFromCnp(`${d}900101123456`)).toBe('M')
    for (const d of '2468') expect(sexFromCnp(`${d}900101123456`)).toBe('F')
  })
  it('9 (străin fără rezidență), CNP lipsă sau invalid: necunoscut, nu se ghicește', () => {
    expect(sexFromCnp('9900101123456')).toBeNull()
    expect(sexFromCnp('')).toBeNull()
    expect(sexFromCnp(undefined)).toBeNull()
    expect(sexFromCnp('1900101')).toBeNull()
    expect(sexFromCnp('•••••••••3456')).toBeNull()      // CNP mascat: nu conține prima cifră
  })
  it('acceptă spații în jurul cifrelor', () => {
    expect(sexFromCnp(' 2900101123456 ')).toBe('F')
  })
})

describe('personSex', () => {
  it('alegerea explicită din fișă are prioritate față de CNP', () => {
    expect(personSex({ sex: 'M', cnp: '2900101123456' })).toBe('M')
    expect(personSex({ cnp: '2900101123456' })).toBe('F')
    expect(personSex({})).toBeNull()
    expect(personSex(null)).toBeNull()
  })
})
