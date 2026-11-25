import { afterEach, describe, expect, it, vi } from 'vitest'
import { EroarePortal, LinkInactiv, citestePortal, mesajEroare, numeJpg, totulTrimis, type Portal } from './portal'

const raspunde = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))

afterEach(() => vi.unstubAllGlobals())

describe('citestePortal', () => {
  it('valori sigure din răspuns: tip și stare necunoscute devin implicite, motivul doar dacă există', async () => {
    raspunde(200, {
      cabinet: 'Cabinet Ionescu', cerutDe: 'Ana', mesaj: 'Mulțumim', expiraLa: '2026-12-09T10:00:00+00:00', stare: 'deschisa',
      acte: [
        { id: 'a1', eticheta: 'CI – Pop Ion', tip: 'ci', stare: 'respins', motiv: 'neclară', fisiere: [] },
        { id: 'a2', eticheta: 'Altceva', tip: 'ciudat', stare: 'x', fisiere: [{ id: 'f1', nume: 'a.pdf', marime: 10 }] },
      ],
    })
    const p = await citestePortal('tok')
    expect(p.cerutDe).toBe('Ana')
    expect(p.expiraLa?.toISOString()).toBe('2026-12-09T10:00:00.000Z')
    expect(p.acte.map(a => [a.tip, a.stare, a.motiv, a.fisiere.length])).toEqual([['ci', 'respins', 'neclară', 0], ['altul', 'de_trimis', undefined, 1]])
  })
  it('link inactiv și alte erori', async () => {
    raspunde(404, { error: 'link_inactiv' })
    await expect(citestePortal('tok')).rejects.toBeInstanceOf(LinkInactiv)
    raspunde(429, { error: 'rate_limited' })
    await expect(citestePortal('tok')).rejects.toBeInstanceOf(EroarePortal)
  })
})

describe('textele pentru client', () => {
  it('numele pozei re-salvate are extensia .jpg', () => {
    expect(numeJpg('IMG_0001.HEIC')).toBe('IMG_0001.jpg')
    expect(numeJpg('scan.v2.png')).toBe('scan.v2.jpg')
    expect(numeJpg('.png')).toBe('poza.jpg')
  })
  it('mesaje formale, fără coduri', () => {
    expect(mesajEroare('rate_limited', 429, '30')).toContain('30 de secunde')
    expect(mesajEroare('heic', 400)).toContain('HEIC')
    expect(mesajEroare(undefined, 0)).toContain('conexiune')
    expect(mesajEroare('ceva_nou', 500)).toBe('Trimiterea nu a reușit. Vă rugăm să reîncercați.')
  })
  it('ecranul de final: toate actele trimise sau cererea completă', () => {
    const p = (stari: string[], stare: Portal['stare'] = 'deschisa') =>
      ({ stare, acte: stari.map(s => ({ stare: s })) } as unknown as Portal)
    expect(totulTrimis(p(['primit', 'acceptat']))).toBe(true)
    expect(totulTrimis(p(['primit', 'respins']))).toBe(false)
    expect(totulTrimis(p([], 'completa'))).toBe(true)
  })
})
