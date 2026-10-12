import { describe, it, expect } from 'vitest'
import { parseIsoDateLocal } from './dates'

describe('parseIsoDateLocal — yyyy-mm-dd ca dată LOCALĂ, nu UTC', () => {
  it('parsează corect anul/luna/ziua, indiferent de fusul orar al mediului de test', () => {
    const d = parseIsoDateLocal('2026-01-15')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(0)
  })

  it('null/undefined/string gol/format invalid → null', () => {
    expect(parseIsoDateLocal(null)).toBeNull()
    expect(parseIsoDateLocal(undefined)).toBeNull()
    expect(parseIsoDateLocal('')).toBeNull()
    expect(parseIsoDateLocal('15.01.2026')).toBeNull()
  })
})
