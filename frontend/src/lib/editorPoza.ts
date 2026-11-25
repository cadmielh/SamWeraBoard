/** Editorul de poze al documentelor: decuparea pe 4 colțuri (cu îndreptarea perspectivei), rotirea și „efectul de
 * scanare”. Totul rulează în browser, pe pixeli (fără biblioteci și fără să trimitem poza altundeva); rezultatul se
 * încarcă apoi prin API, criptat, ca orice document. */

export interface Imagine { data: Uint8ClampedArray; width: number; height: number }
export interface Punct { x: number; y: number }
/** Colțurile actului, în ordinea: stânga-sus, dreapta-sus, dreapta-jos, stânga-jos. */
export type Colturi = [Punct, Punct, Punct, Punct]
export type Filtru = 'original' | 'scanare' | 'alb_negru'

export const ETICHETA_FILTRU: Record<Filtru, string> = { original: 'Original', scanare: 'Scanare', alb_negru: 'Alb-negru' }

/** Latura maximă a rezultatului: un act rămâne lizibil la tipar, iar fișierul rămâne mic. */
export const LATURA_MAX_REZULTAT = 2400

export const colturiImplicite = (w: number, h: number): Colturi =>
  [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]

const dist = (a: Punct, b: Punct) => Math.hypot(a.x - b.x, a.y - b.y)

/** Mărimea rezultatului: laturile cele mai lungi ale patrulaterului, micșorate cât să încapă în `max`. */
export function dimensiuneRezultat(c: Colturi, max = LATURA_MAX_REZULTAT): { w: number; h: number } {
  const w = Math.max(dist(c[0], c[1]), dist(c[3], c[2]))
  const h = Math.max(dist(c[0], c[3]), dist(c[1], c[2]))
  const k = Math.min(1, max / Math.max(w, h, 1))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** Omografia care duce pătratul unitate (u, v ∈ [0, 1]) pe patrulaterul dat (Heckbert, formă închisă). */
function patratLaPatrulater(c: Colturi): number[] {
  const [p0, p1, p2, p3] = c
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y
  let g = 0, h = 0
  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    if (Math.abs(det) < 1e-12) return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0]
    g = (dx3 * dy2 - dx2 * dy3) / det
    h = (dx1 * dy3 - dx3 * dy1) / det
  }
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h,
  ]
}

/** Actul „îndreptat”: fiecare pixel al dreptunghiului rezultat ia culoarea punctului corespunzător din poză
 * (interpolare biliniară). Funcționează și pentru o poză făcută din unghi. */
export function indreapta(src: Imagine, c: Colturi, w: number, h: number): Imagine {
  const [a, b, x0, d, e, y0, g, hh] = patratLaPatrulater(c)
  const out = new Uint8ClampedArray(w * h * 4)
  const sw = src.width, sh = src.height, s = src.data
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const z = g * u + hh * v + 1
      let px = (a * u + b * v + x0) / z - 0.5
      let py = (d * u + e * v + y0) / z - 0.5
      px = px < 0 ? 0 : px > sw - 1 ? sw - 1 : px
      py = py < 0 ? 0 : py > sh - 1 ? sh - 1 : py
      const ix = Math.floor(px), iy = Math.floor(py)
      const fx = px - ix, fy = py - iy
      const ix1 = ix + 1 < sw ? ix + 1 : ix, iy1 = iy + 1 < sh ? iy + 1 : iy
      const i00 = (iy * sw + ix) * 4, i10 = (iy * sw + ix1) * 4, i01 = (iy1 * sw + ix) * 4, i11 = (iy1 * sw + ix1) * 4
      const o = (y * w + x) * 4
      for (let k = 0; k < 3; k++) {
        const top = s[i00 + k] + (s[i10 + k] - s[i00 + k]) * fx
        const bot = s[i01 + k] + (s[i11 + k] - s[i01 + k]) * fx
        out[o + k] = top + (bot - top) * fy
      }
      out[o + 3] = 255
    }
  }
  return { data: out, width: w, height: h }
}

/** Rotire cu 90° (sens orar sau invers). */
export function roteste(src: Imagine, sens: 'orar' | 'invers'): Imagine {
  const { width: w, height: h, data } = src
  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [nx, ny] = sens === 'orar' ? [h - 1 - y, x] : [y, w - 1 - x]
      const i = (y * w + x) * 4, o = (ny * h + nx) * 4
      out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2]; out[o + 3] = data[i + 3]
    }
  }
  return { data: out, width: h, height: w }
}

/** Colțurile după rotirea imaginii (aceleași puncte ale actului, în noile coordonate). */
export function rotesteColturi(c: Colturi, w: number, h: number, sens: 'orar' | 'invers'): Colturi {
  const r = (p: Punct): Punct => (sens === 'orar' ? { x: h - p.y, y: p.x } : { x: p.y, y: w - p.x })
  const p = c.map(r) as Colturi
  // după rotire, ordinea colțurilor (stânga-sus, …) se mută cu o poziție
  return sens === 'orar' ? [p[3], p[0], p[1], p[2]] : [p[1], p[2], p[3], p[0]]
}

/** Luminozitatea hârtiei în fiecare zonă: în celule mici, media celui mai luminos bloc (textul nu o trage în jos),
 * apoi interpolată pe toată imaginea. Împărțind la ea, umbrele și lumina inegală dispar, iar hârtia devine albă. */
function fundal(gri: Float32Array, w: number, h: number): Float32Array {
  const celula = Math.max(8, Math.round(Math.max(w, h) / 40))
  const bloc = Math.max(2, Math.round(celula / 4))
  const cw = Math.ceil(w / celula), ch = Math.ceil(h / celula)
  const grila = new Float32Array(cw * ch)
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let best = 0
      for (let by = cy * celula; by < Math.min(h, (cy + 1) * celula); by += bloc) {
        for (let bx = cx * celula; bx < Math.min(w, (cx + 1) * celula); bx += bloc) {
          let s = 0, n = 0
          for (let y = by; y < Math.min(h, by + bloc); y++) for (let x = bx; x < Math.min(w, bx + bloc); x++) { s += gri[y * w + x]; n++ }
          if (n && s / n > best) best = s / n
        }
      }
      grila[cy * cw + cx] = Math.max(best, 1)
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const gy = Math.min(ch - 1, Math.max(0, (y + 0.5) / celula - 0.5))
    const y0 = Math.floor(gy), y1 = Math.min(ch - 1, y0 + 1), fy = gy - y0
    for (let x = 0; x < w; x++) {
      const gx = Math.min(cw - 1, Math.max(0, (x + 0.5) / celula - 0.5))
      const x0 = Math.floor(gx), x1 = Math.min(cw - 1, x0 + 1), fx = gx - x0
      const top = grila[y0 * cw + x0] + (grila[y0 * cw + x1] - grila[y0 * cw + x0]) * fx
      const bot = grila[y1 * cw + x0] + (grila[y1 * cw + x1] - grila[y1 * cw + x0]) * fx
      out[y * w + x] = top + (bot - top) * fy
    }
  }
  return out
}

/** „Scanare”: hârtia albă și uniformă, textul mai închis, culorile păstrate (ștampile, semnături albastre).
 * „Alb-negru”: ca o fotocopie. „Original”: neschimbat. */
export function aplicaFiltru(src: Imagine, f: Filtru): Imagine {
  if (f === 'original') return src
  const { width: w, height: h, data } = src
  const gri = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) gri[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  const bg = fundal(gri, w, h)
  const out = new Uint8ClampedArray(data.length)
  // curba de după normalizare: ce e aproape de hârtie devine alb, restul se întărește ușor
  const curba = (v: number) => {
    const t = Math.min(1, v / 0.92)
    return 255 * Math.pow(t, f === 'alb_negru' ? 2.2 : 1.6)
  }
  for (let i = 0; i < w * h; i++) {
    const k = 255 / bg[i]
    const o = i * 4
    if (f === 'alb_negru') {
      const v = curba(Math.min(1, (gri[i] * k) / 255))
      out[o] = out[o + 1] = out[o + 2] = v
    } else {
      // Lumina se normalizează complet (hârtia devine albă); diferența de culoare față de gri se amplifică doar puțin,
      // ca zonele colorate care nu sunt hârtie (o masă, fundalul pozei) să nu capete nuanțe țipătoare.
      const v = curba(Math.min(1, (gri[i] * k) / 255))
      const kc = Math.min(k, 1.25) * (v / 255 + 0.35) / 1.35
      for (let c = 0; c < 3; c++) out[o + c] = v + (data[o + c] - gri[i]) * kc
    }
    out[o + 3] = 255
  }
  return { data: out, width: w, height: h }
}

/** Numele copiei editate: „CI Ion.png” → „CI Ion (editat).jpg”. */
export function numeEditat(nume: string): string {
  const baza = nume.replace(/\.[^./\\]{1,5}$/, '').replace(/\s*\(editat\)$/i, '').trim()
  return `${baza || 'document'} (editat).jpg`
}
