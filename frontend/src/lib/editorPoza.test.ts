import { describe, expect, it } from 'vitest'
import {
  aplicaFiltru, colturiImplicite, dimensiuneRezultat, indreapta, numeEditat, roteste, rotesteColturi, type Colturi, type Imagine,
} from './editorPoza'

const imagine = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): Imagine => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = f(x, y), i = (y * w + x) * 4
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
  }
  return { data, width: w, height: h }
}
const px = (im: Imagine, x: number, y: number) => Array.from(im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 3))

describe('îndreptarea', () => {
  it('cu colțurile întregii poze, rezultatul e aceeași poză', () => {
    const src = imagine(20, 10, (x, y) => [x * 10, y * 20, 0])
    const out = indreapta(src, colturiImplicite(20, 10), 20, 10)
    expect(px(out, 3, 4)).toEqual(px(src, 3, 4))
    expect(px(out, 19, 9)).toEqual(px(src, 19, 9))
  })
  it('decupează exact zona dintre colțuri (actul alb de pe masa neagră)', () => {
    const src = imagine(100, 100, (x, y) => (x >= 20 && x < 70 && y >= 30 && y < 60 ? [255, 255, 255] : [0, 0, 0]))
    const c: Colturi = [{ x: 20, y: 30 }, { x: 70, y: 30 }, { x: 70, y: 60 }, { x: 20, y: 60 }]
    const { w, h } = dimensiuneRezultat(c)
    expect([w, h]).toEqual([50, 30])
    const out = indreapta(src, c, w, h)
    for (const [x, y] of [[0, 0], [49, 0], [49, 29], [0, 29], [25, 15]]) expect(px(out, x, y)).toEqual([255, 255, 255])
  })
  it('patrulater înclinat (poză din unghi): colțul stânga-sus al rezultatului e colțul actului', () => {
    const src = imagine(200, 200, (x, y) => [x, y, 0])
    const c: Colturi = [{ x: 40, y: 50 }, { x: 160, y: 30 }, { x: 170, y: 170 }, { x: 30, y: 150 }]
    const out = indreapta(src, c, 100, 100)
    const [r, g] = px(out, 0, 0)
    expect(Math.abs(r - 40)).toBeLessThan(2)
    expect(Math.abs(g - 50)).toBeLessThan(2)
  })
  it('rezultatul nu depășește latura maximă', () => {
    expect(dimensiuneRezultat(colturiImplicite(6000, 3000), 2400)).toEqual({ w: 2400, h: 1200 })
  })
})

describe('rotirea', () => {
  it('orar și invers se anulează; colțurile urmează imaginea', () => {
    const src = imagine(3, 2, (x, y) => [x * 50, y * 100, 7])
    const r = roteste(src, 'orar')
    expect([r.width, r.height]).toEqual([2, 3])
    expect(px(r, 1, 0)).toEqual(px(src, 0, 0))               // stânga-sus ajunge dreapta-sus
    expect(Array.from(roteste(r, 'invers').data)).toEqual(Array.from(src.data))
    const c = rotesteColturi(colturiImplicite(3, 2), 3, 2, 'orar')
    expect(c).toEqual(colturiImplicite(2, 3))
    expect(rotesteColturi(colturiImplicite(3, 2), 3, 2, 'invers')).toEqual(colturiImplicite(2, 3))
  })
})

describe('efectul de scanare', () => {
  // hârtie gri, mai întunecată spre dreapta (umbră), cu o linie de text închisă
  const poza = imagine(160, 80, (x, y) => {
    const hartie = 190 - x * 0.5
    return y >= 38 && y < 42 && x > 10 && x < 150 ? [40, 40, 60] : [hartie, hartie, hartie]
  })
  it('hârtia devine albă peste tot, chiar și în umbră; textul rămâne închis', () => {
    const out = aplicaFiltru(poza, 'scanare')
    expect(px(out, 5, 10)[0]).toBeGreaterThan(245)
    expect(px(out, 155, 10)[0]).toBeGreaterThan(245)
    expect(px(out, 80, 40)[0]).toBeLessThan(90)
  })
  it('alb-negru: gri pe toate canalele; originalul e neschimbat', () => {
    const out = aplicaFiltru(poza, 'alb_negru')
    const [r, g, b] = px(out, 80, 40)
    expect(r).toBe(g); expect(g).toBe(b)
    expect(aplicaFiltru(poza, 'original')).toBe(poza)
  })
})

it('numele copiei editate', () => {
  expect(numeEditat('CI Ion.png')).toBe('CI Ion (editat).jpg')
  expect(numeEditat('CI Ion (editat).jpg')).toBe('CI Ion (editat).jpg')
})
