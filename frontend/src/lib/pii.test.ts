import { describe, it, expect, vi } from 'vitest'

// pii.ts importă ./api (care încarcă Firebase); testăm doar funcțiile pure.
vi.mock('./api', () => ({ apiJson: vi.fn() }))

import { sanitizeForSave, applyPii, clientNeedsReveal, maskCnp, maskSerie, normalizeCnp, normalizeSerie } from './pii'
import type { Client, Persoana } from '../types'

const P = (o: Partial<Persoana> = {}): Persoana => ({
  calitate: '', cotaParticipare: '', cnp: '', nume: 'A', prenume: '', serie_numar: '',
  data_nasterii: '', locul_nasterii: '', cetatenia: '', adresa: '', judet: '', emisa_de: '',
  valabila_de_la: '', valabila_pana_la: '', ...o,
})
const asClient = (o: Record<string, unknown>) => o as unknown as Client

describe('mascare', () => {
  it('CNP: doar ultimele 4 cifre', () => {
    expect(maskCnp('1800101221144')).toBe('•••••••••1144')
    expect(maskCnp('')).toBe('')
  })
  it('serie: păstrează literele și ultimele 2 cifre', () => {
    expect(maskSerie('MX 123456')).toBe('MX ••••56')
    expect(maskSerie('')).toBe('')
  })
})

describe('sanitizeForSave', () => {
  it('persoană nouă: valorile merg în vault, în document rămân doar pid + mască', () => {
    const { data, vault } = sanitizeForSave({ titular: P({ cnp: '1800101221144', serie_numar: 'MX 123456' }) }, null)
    const t = data.titular!
    expect(t.cnp).toBe('')
    expect(t.serie_numar).toBe('')
    expect(t.cnpMasked).toBe('•••••••••1144')
    expect(t.piiLoaded).toBeUndefined()
    expect(vault!.persons[t.pid!]).toEqual({ cnp: '1800101221144', serie_numar: 'MX 123456' })
  })

  it('persoană neîncărcată: nu atinge vault-ul și păstrează masca', () => {
    const existing = asClient({ asociati: [P({ pid: 'pid-aaaa-0001', cnpMasked: '•••••••••1144' })], administratori: [] })
    const { data, vault } = sanitizeForSave({ asociati: existing.asociati, administratori: [] }, existing)
    expect(vault).toBeNull()
    expect(data.asociati![0].cnpMasked).toBe('•••••••••1144')
  })

  it('persoană încărcată și golită: trimite golire explicită', () => {
    const p = P({ pid: 'pid-aaaa-0001', cnpMasked: '•••••••••1144', piiLoaded: true, cnp: '' })
    const { data, vault } = sanitizeForSave({ titular: p }, asClient({ titular: p }))
    expect(vault!.persons['pid-aaaa-0001']).toEqual({ cnp: '', serie_numar: '' })
    expect(data.titular!.cnpMasked).toBe('')
  })

  it('update parțial (ex. doar notițe) nu atinge nimic', () => {
    const existing = asClient({ titular: P({ pid: 'pid-aaaa-0001', cnpMasked: 'x' }) })
    expect(sanitizeForSave({ notite: 'ceva' }, existing).vault).toBeNull()
  })

  it('persoană scoasă din fișă: dispare din `keep` și se raportează la eliminare', () => {
    const existing = asClient({
      asociati: [P({ pid: 'pid-aaaa-0001', cnpMasked: 'x' }), P({ pid: 'pid-bbbb-0002', cnpMasked: 'y' })],
      administratori: [],
    })
    const { vault } = sanitizeForSave({ asociati: [existing.asociati[0]], administratori: [] }, existing)
    expect(vault!.keep).toEqual(['pid-aaaa-0001'])
    expect(vault!.persons).toEqual({})
  })

  it('update parțial cu fișă existentă: persoanele din câmpurile neatinse rămân în `keep`', () => {
    const existing = asClient({
      titular: P({ pid: 'pid-aaaa-0001', cnpMasked: 'x' }),
      membriIF: [P({ pid: 'pid-bbbb-0002', cnpMasked: 'y' })],
    })
    const upd = P({ pid: 'pid-aaaa-0001', cnpMasked: 'x', piiLoaded: true, cnp: '1900101221144' })
    const { vault } = sanitizeForSave({ titular: upd }, existing)
    expect(vault!.keep).toEqual(expect.arrayContaining(['pid-aaaa-0001', 'pid-bbbb-0002']))
  })

  it('fără fișă existentă și update parțial: nu trimite `keep` (nu șterge nimic)', () => {
    const upd = P({ pid: 'pid-aaaa-0001', piiLoaded: true, cnp: '1900101221144' })
    expect(sanitizeForSave({ titular: upd }, null).vault!.keep).toBeUndefined()
  })
})

describe('hidratare', () => {
  it('aduce valorile din vault și marchează persoana ca încărcată', () => {
    const c = asClient({ id: 'abc', titular: P({ pid: 'pid-aaaa-0001', cnpMasked: 'x' }), asociati: [], administratori: [] })
    expect(clientNeedsReveal(c)).toBe(true)
    const h = applyPii(c, { 'pid-aaaa-0001': { cnp: '1800101221144', serie_numar: 'MX 1' } })
    expect(h.titular!.cnp).toBe('1800101221144')
    expect(h.titular!.piiLoaded).toBe(true)
    expect(clientNeedsReveal(h)).toBe(false)
  })
})

describe('normalizare (seria scanată pe două linii)', () => {
  it('seria: liniile noi, taburile și spațiile multiple devin un singur spațiu', () => {
    expect(normalizeSerie('MX\n123456')).toBe('MX 123456')
    expect(normalizeSerie('  MX \t 123456\r\n ')).toBe('MX 123456')
    expect(normalizeSerie('MX 123456')).toBe('MX 123456')
    expect(normalizeSerie('')).toBe('')
    expect(normalizeSerie(undefined)).toBe('')
  })
  it('CNP: fără spații', () => {
    expect(normalizeCnp('1 800101 221144')).toBe('1800101221144')
    expect(normalizeCnp(null)).toBe('')
  })
  it('la salvare, vault-ul și masca primesc valori curate (seria nu mai conține linii noi)', () => {
    const { data, vault } = sanitizeForSave({ titular: P({ cnp: '1800101221144', serie_numar: 'MX\n123456' }) }, null)
    const t = data.titular!
    expect(vault!.persons[t.pid!].serie_numar).toBe('MX 123456')
    expect(t.serieMasked).toBe('MX ••••56')
    expect(t.serieMasked).not.toMatch(/\s{2,}|\n/)
  })
  it('la citire din vault, valorile mai vechi cu linii noi sunt curățate', () => {
    const c = asClient({ id: 'abc', titular: P({ pid: 'pid-aaaa-0001', cnpMasked: 'x' }), asociati: [], administratori: [] })
    // fetchPii normalizează; applyPii primește deja valori curate
    const h = applyPii(c, { 'pid-aaaa-0001': { cnp: normalizeCnp('1800101221144'), serie_numar: normalizeSerie('MX\n123456') } })
    expect(h.titular!.serie_numar).toBe('MX 123456')
  })
})
