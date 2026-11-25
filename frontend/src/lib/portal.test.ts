import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EroarePortal, LinkInactiv, analizeazaPoza, citestePortal, incarcaAct, mesajEroare, numeJpg, totulTrimis, type Portal,
} from './portal'

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
    expect(totulTrimis(p(['primit', 'lipsa']))).toBe(true)                      // „nu am” e tot un răspuns
    const cuOptional = { stare: 'deschisa', acte: [{ stare: 'primit' }, { stare: 'de_trimis', optional: true }] } as unknown as Portal
    expect(totulTrimis(cuOptional)).toBe(true)
  })
})

describe('calitatea pozei', () => {
  const poza = (w: number, h: number, f: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = f(x, y), i = (y * w + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
    return { data, width: w, height: h }
  }
  it('text clar trece; aceeași imagine netedă e neclară; o poză întunecată e semnalată', () => {
    const clar = analizeazaPoza(poza(200, 120, (x, y) => ((x >> 1) + (y >> 2)) % 3 === 0 ? 30 : 220))
    expect(clar.neclara).toBe(false)
    expect(clar.intunecata).toBe(false)
    expect(analizeazaPoza(poza(200, 120, x => 100 + x / 4)).neclara).toBe(true)
    expect(analizeazaPoza(poza(200, 120, (x, y) => ((x >> 1) + (y >> 2)) % 3 === 0 ? 5 : 45)).intunecata).toBe(true)
  })
  it('un act luminos mic în cadru, pe fundal negru, nu e „întunecat”', () => {
    const r = analizeazaPoza(poza(200, 200, (x, y) => (x > 80 && x < 120 && y > 80 && y < 120 ? 230 : 10)))
    expect(r.intunecata).toBe(false)
  })
})

describe('reîncercarea încărcării', () => {
  class XhrFals {
    static raspunsuri: { status: number; body?: string; eroareRetea?: boolean }[] = []
    static apeluri = 0
    status = 0; responseText = ''; upload = { onprogress: null }
    onload: (() => void) | null = null; onerror: (() => void) | null = null
    open() {}
    getResponseHeader() { return null }
    send() {
      const r = XhrFals.raspunsuri[XhrFals.apeluri++]
      queueMicrotask(() => {
        if (r.eroareRetea) { this.onerror?.(); return }
        this.status = r.status; this.responseText = r.body ?? '{}'; this.onload?.()
      })
    }
  }
  const ok = { status: 201, body: JSON.stringify({ fisier: { id: 'f1', nume: 'a.jpg', marime: 3 } }) }
  it('rețea picată sau 503: reia; refuzul nu se reia', async () => {
    vi.stubGlobal('XMLHttpRequest', XhrFals)
    XhrFals.apeluri = 0
    XhrFals.raspunsuri = [{ status: 0, eroareRetea: true }, { status: 503 }, ok]
    await expect(incarcaAct('t', 'a1', new Blob(['x']), 'a.jpg', undefined, undefined, [0, 0])).resolves.toMatchObject({ id: 'f1' })
    expect(XhrFals.apeluri).toBe(3)
    XhrFals.apeluri = 0
    XhrFals.raspunsuri = [{ status: 409, body: JSON.stringify({ error: 'duplicat' }) }, ok]
    await expect(incarcaAct('t', 'a1', new Blob(['x']), 'a.jpg', undefined, undefined, [0, 0])).rejects.toThrow('deja trimis')
    expect(XhrFals.apeluri).toBe(1)
    XhrFals.apeluri = 0
    XhrFals.raspunsuri = [{ status: 0, eroareRetea: true }, { status: 0, eroareRetea: true }, { status: 0, eroareRetea: true }]
    await expect(incarcaAct('t', 'a1', new Blob(['x']), 'a.jpg', undefined, undefined, [0, 0])).rejects.toBeInstanceOf(EroarePortal)
    expect(XhrFals.apeluri).toBe(3)
  })
})
