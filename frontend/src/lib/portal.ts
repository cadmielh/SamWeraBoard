/** Portalul clientului (`/p/<token>`, fără cont): actele cerute de cabinet, încărcarea lor și retragerea unei încărcări
 * greșite. Vorbește doar cu rutele publice din cereri_api.py; nu folosește Firebase. Plan: docs/plan-documente-client.md. */
import { BASE, FILES_BASE } from './apiBase'
import type { StareAct, TipAct } from './cereri'

/** Fața sau verso-ul unui buletin (la cartea electronică). */
export type ParteCi = 'fata' | 'verso'

export interface FisierTrimis { id: string; nume: string; marime: number; parte?: ParteCi }

export interface ActPortal {
  id: string
  eticheta: string
  tip: TipAct
  stare: StareAct
  motiv?: string
  /** „Dacă există”: cererea se încheie și fără el. */
  optional: boolean
  /** Nota clientului, când a spus că nu are actul. */
  notaClient?: string
  /** Trimise și încă neverificate (doar nume și mărime). */
  fisiere: FisierTrimis[]
}

export interface Portal {
  cabinet: string
  /** Numele celui din cabinet care a creat cererea (poate lipsi). */
  cerutDe: string
  mesaj: string
  expiraLa: Date | null
  stare: 'deschisa' | 'completa'
  acte: ActPortal[]
}

/** Link greșit, expirat, anulat sau al unui cabinet inactiv: serverul nu spune care, pagina nici atât. */
export class LinkInactiv extends Error {}

export class EroarePortal extends Error {
  /** Codul de la server (ex. „duplicat”), când există. */
  readonly cod?: string
  constructor(mesaj: string, cod?: string) { super(mesaj); this.cod = cod }
}

const STARI: StareAct[] = ['de_trimis', 'primit', 'acceptat', 'respins', 'lipsa']

function portalDinJson(j: Record<string, unknown>): Portal {
  const acte = Array.isArray(j.acte) ? (j.acte as Record<string, unknown>[]) : []
  const expira = typeof j.expiraLa === 'string' ? new Date(j.expiraLa) : null
  return {
    cabinet: String(j.cabinet ?? ''),
    cerutDe: String(j.cerutDe ?? ''),
    mesaj: String(j.mesaj ?? ''),
    expiraLa: expira && !isNaN(expira.getTime()) ? expira : null,
    stare: j.stare === 'completa' ? 'completa' : 'deschisa',
    acte: acte.map(a => ({
      id: String(a.id ?? ''),
      eticheta: String(a.eticheta ?? ''),
      tip: (a.tip === 'ci' || a.tip === 'dovada_sediu' ? a.tip : 'altul') as TipAct,
      stare: STARI.includes(a.stare as StareAct) ? (a.stare as StareAct) : 'de_trimis',
      ...(typeof a.motiv === 'string' && a.motiv ? { motiv: a.motiv } : {}),
      optional: a.optional === true,
      ...(a.stare === 'lipsa' ? { notaClient: String(a.notaClient ?? '') } : {}),
      fisiere: Array.isArray(a.fisiere)
        ? (a.fisiere as Record<string, unknown>[]).map(f => ({
          id: String(f.id ?? ''), nume: String(f.nume ?? ''), marime: Number(f.marime) || 0,
          ...(f.parte === 'fata' || f.parte === 'verso' ? { parte: f.parte } : {}),
        }))
        : [],
    })),
  }
}

/** Mesajul pentru client (formal, fără detalii despre cabinet sau aplicație). */
export function mesajEroare(cod: string | undefined, status: number, retryAfter?: string | null): string {
  switch (cod) {
    case 'rate_limited': {
      const s = Number(retryAfter) || 60
      return `Prea multe încercări într-un timp scurt. Vă rugăm să reîncercați peste ${s < 90 ? `${s} de secunde` : `${Math.ceil(s / 60)} minute`}.`
    }
    case 'fisier_prea_mare': return 'Fișierul depășește 15 MB. Fotografiați actul sau alegeți un fișier mai mic.'
    case 'fisier_gol': return 'Fișierul este gol.'
    case 'heic': return 'Formatul pozei (HEIC) nu poate fi citit aici. Fotografiați actul direct din această pagină sau alegeți o poză JPEG.'
    case 'tip_nepermis_portal':
    case 'imagine_invalida': return 'Se pot trimite doar poze (JPEG, PNG) sau fișiere PDF.'
    case 'imagine_prea_mare': return 'Poza este prea mare. Fotografiați actul din nou, cu rezoluție obișnuită.'
    case 'pdf_parola': return 'PDF-ul este protejat cu parolă. Trimiteți-l fără parolă sau fotografiați actul.'
    case 'pdf_invalid': return 'PDF-ul nu poate fi citit. Salvați-l din nou sau fotografiați actul.'
    case 'pdf_risc': return 'PDF-ul conține elemente care nu sunt permise (cod, formulare sau fișiere atașate). Trimiteți o variantă scanată simplă sau o poză.'
    case 'duplicat': return 'Acest fișier a fost deja trimis.'
    case 'prea_multe_fisiere': return 'S-a atins numărul maxim de fișiere pentru această cerere. Contactați cabinetul.'
    case 'spatiu_depasit': return 'Cabinetul nu mai poate primi fișiere momentan. Contactați cabinetul.'
    case 'act_acceptat': return 'Cabinetul a primit deja acest act.'
    case 'cerere_completa': return 'Cabinetul a primit toate actele; nu mai e nevoie de altele.'
    case 'act_are_fisiere': return 'Ați trimis deja fișiere pentru acest act. Retrageți-le întâi, dacă actul e greșit.'
    case 'storage_unavailable': return 'Serviciul e temporar indisponibil. Vă rugăm să reîncercați în câteva minute.'
    default:
      return status === 0
        ? 'Nu există conexiune la internet. Verificați conexiunea și reîncercați.'
        : 'Trimiterea nu a reușit. Vă rugăm să reîncercați.'
  }
}

const url = (base: string, token: string, rest = '') => `${base}/portal/${encodeURIComponent(token)}${rest}`

async function raspuns(res: Response): Promise<Record<string, unknown>> {
  const j = await res.json().catch(() => ({})) as Record<string, unknown>
  if (res.ok) return j
  if (j.error === 'link_inactiv') throw new LinkInactiv()
  throw new EroarePortal(mesajEroare(j.error as string | undefined, res.status, res.headers.get('Retry-After')))
}

export async function citestePortal(token: string): Promise<Portal> {
  let res: Response
  try { res = await fetch(url(BASE, token), { cache: 'no-store' }) } catch { throw new EroarePortal(mesajEroare(undefined, 0)) }
  return portalDinJson(await raspuns(res))
}

export async function retrageFisier(token: string, fid: string): Promise<void> {
  let res: Response
  try { res = await fetch(url(BASE, token, `/fisiere/${encodeURIComponent(fid)}`), { method: 'DELETE' }) } catch {
    throw new EroarePortal(mesajEroare(undefined, 0))
  }
  await raspuns(res)
}

async function trimiteJson(token: string, rest: string, method: 'POST' | 'DELETE', body?: unknown): Promise<void> {
  let res: Response
  try {
    res = await fetch(url(BASE, token, rest), {
      method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
  } catch { throw new EroarePortal(mesajEroare(undefined, 0)) }
  await raspuns(res)
}

/** „Nu am acest act”, cu o notă opțională pentru cabinet; `anuleazaLipsa` revine (la fel și trimițând un fișier). */
export const marcheazaLipsa = (token: string, aid: string, nota: string) =>
  trimiteJson(token, `/acte/${encodeURIComponent(aid)}/lipsa`, 'POST', { nota })
export const anuleazaLipsa = (token: string, aid: string) =>
  trimiteJson(token, `/acte/${encodeURIComponent(aid)}/lipsa`, 'DELETE')

/** Pe date mobile o încărcare poate pica din rețea sau dintr-o eroare trecătoare a serverului: se reia de câteva ori,
 * cu pauze crescânde. Refuzurile (fișier nepotrivit, limită, link inactiv) nu se reiau. */
export const PAUZE_REINCERCARE = [1500, 4000]

const trecatoare = (status: number) => status === 0 || status === 502 || status === 503 || status === 504

export async function incarcaAct(
  token: string, aid: string, fisier: Blob, nume: string, onProgres?: (p: number) => void, parte?: ParteCi,
  pauze: number[] = PAUZE_REINCERCARE,
): Promise<FisierTrimis | null> {
  for (let i = 0; ; i++) {
    try {
      return await incarcaOdata(token, aid, fisier, nume, onProgres, parte)
    } catch (e) {
      // După o reîncercare, „duplicat” înseamnă că încercarea anterioară a ajuns, doar răspunsul s-a pierdut.
      if (i > 0 && e instanceof EroarePortal && e.cod === 'duplicat') return null
      if (!(e instanceof EroareTrecatoare) || i >= pauze.length) throw e instanceof EroareTrecatoare ? e.eroare : e
      onProgres?.(0)
      await new Promise(r => setTimeout(r, pauze[i]))
    }
  }
}

class EroareTrecatoare extends Error {
  readonly eroare: EroarePortal
  constructor(eroare: EroarePortal) { super(eroare.message); this.eroare = eroare }
}

/** Încărcarea unui fișier pentru un act, cu progresul (0–1); XHR, ca progresul să se vadă și pe date mobile. */
function incarcaOdata(token: string, aid: string, fisier: Blob, nume: string, onProgres?: (p: number) => void, parte?: ParteCi): Promise<FisierTrimis> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('fisier', fisier, nume)
    if (parte) fd.append('parte', parte)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url(FILES_BASE, token, `/acte/${encodeURIComponent(aid)}`))
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgres?.(e.loaded / e.total) }
    xhr.onerror = () => reject(new EroareTrecatoare(new EroarePortal(mesajEroare(undefined, 0))))
    xhr.onload = () => {
      let j: Record<string, unknown> = {}
      try { j = JSON.parse(xhr.responseText) as Record<string, unknown> } catch { /* răspuns fără JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        const f = (j.fisier ?? {}) as Record<string, unknown>
        resolve({ id: String(f.id ?? ''), nume: String(f.nume ?? nume), marime: Number(f.marime) || fisier.size, ...(parte ? { parte } : {}) })
      } else if (j.error === 'link_inactiv') reject(new LinkInactiv())
      else {
        const e = new EroarePortal(mesajEroare(j.error as string | undefined, xhr.status, xhr.getResponseHeader('Retry-After')), j.error as string | undefined)
        reject(trecatoare(xhr.status) ? new EroareTrecatoare(e) : e)
      }
    }
    xhr.send(fd)
  })
}

// ── Pregătirea fișierului pe telefon ──────────────────────────────────────────

export const MAX_BYTES = 15 * 1024 * 1024
/** Latura maximă a pozei trimise: actul rămâne lizibil, iar pe date mobile se trimit sute de KB, nu MB. */
export const LATURA_MAX = 2400

const esteHeic = (f: File) => /^image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)
const estePdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

/** Numele cu extensia `.jpg` (poza se trimite re-salvată ca JPEG). */
export function numeJpg(nume: string): string {
  const baza = nume.replace(/\.[^./\\]{1,5}$/, '').trim()
  return `${baza || 'poza'}.jpg`
}

function citesteImagine(f: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(u); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('imagine')) }
    img.src = u
  })
}

/** Ce se vede în poză, pe scurt: lumina (0–255) a celei mai luminoase părți și claritatea (varianța laplacianului pe
 * tonuri de gri). Lumina se ia din percentila 98, nu din medie: un act bine luminat, mic în cadru pe o masă închisă,
 * nu e o poză întunecată. */
export interface Calitate { intunecata: boolean; neclara: boolean }

/** Pragurile sunt alese pe partea de siguranță: o poză bună de act nu trebuie oprită; cea întunecată sau mișcată, da.
 * Calculul se face pe o variantă mică a pozei (latura de ANALIZA_LATURA), deci e rapid și pe telefoane vechi. */
export const ANALIZA_LATURA = 640
export const PRAG_LUMINA = 70
export const PRAG_CLARITATE = 40

export function analizeazaPoza(img: { data: ArrayLike<number>; width: number; height: number }): Calitate & { lumina: number; claritate: number } {
  const { data, width: w, height: h } = img
  const gri = new Float32Array(w * h)
  const hist = new Uint32Array(256)
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    gri[i] = g
    hist[Math.min(255, Math.round(g))]++
  }
  let lumina = 0
  for (let v = 0, acc = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= 0.98 * w * h) { lumina = v; break }
  }
  let n = 0, s1 = 0, s2 = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = gri[i - w] + gri[i + w] + gri[i - 1] + gri[i + 1] - 4 * gri[i]
      s1 += lap
      s2 += lap * lap
      n++
    }
  }
  const claritate = n ? s2 / n - (s1 / n) ** 2 : 0
  return { lumina, claritate, intunecata: lumina < PRAG_LUMINA, neclara: claritate < PRAG_CLARITATE }
}

function calitateaPozei(img: HTMLImageElement): Calitate | undefined {
  const k = Math.min(1, ANALIZA_LATURA / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.max(3, Math.round(img.naturalWidth * k))
  c.height = Math.max(3, Math.round(img.naturalHeight * k))
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined
  ctx.drawImage(img, 0, 0, c.width, c.height)
  try {
    const { intunecata, neclara } = analizeazaPoza(ctx.getImageData(0, 0, c.width, c.height))
    return { intunecata, neclara }
  } catch { return undefined }
}

/** PDF-ul pleacă așa cum e. Pozele (inclusiv HEIC, unde browserul le poate citi) se micșorează și se trimit ca JPEG;
 * orientarea din cameră e aplicată de browser la desenare. O poză pe care browserul n-o poate citi pleacă neschimbată
 * (serverul decide), cu excepția HEIC, pe care serverul nu-l primește. */
export async function pregatesteFisier(f: File): Promise<{ blob: Blob; nume: string; calitate?: Calitate }> {
  if (estePdf(f) || !(f.type.startsWith('image/') || esteHeic(f))) {
    if (f.size > MAX_BYTES) throw new EroarePortal(mesajEroare('fisier_prea_mare', 413))
    return { blob: f, nume: f.name }
  }
  let img: HTMLImageElement
  try { img = await citesteImagine(f) } catch {
    if (esteHeic(f)) throw new EroarePortal(mesajEroare('heic', 400))
    if (f.size > MAX_BYTES) throw new EroarePortal(mesajEroare('fisier_prea_mare', 413))
    return { blob: f, nume: f.name }
  }
  const k = Math.min(1, LATURA_MAX / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: f, nume: f.name }
  ctx.fillStyle = '#fff'                       // PNG transparent: fundal alb, nu negru
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85))
  if (!blob) return { blob: f, nume: f.name }
  if (blob.size > MAX_BYTES) throw new EroarePortal(mesajEroare('fisier_prea_mare', 413))
  return { blob, nume: numeJpg(f.name), calitate: calitateaPozei(img) }
}

// ── Textele paginii ───────────────────────────────────────────────────────────

/** Indicații de fotografiere, după tipul actului. */
export const INDICATII: Record<TipAct, string> = {
  ci: 'Fotografiați buletinul întreg în cadru, pe o suprafață închisă la culoare, fără bliț și fără reflexii. La cartea de identitate electronică trimiteți și verso.',
  dovada_sediu: 'Trimiteți toate paginile contractului (sau extrasul de carte funciară), câte o poză pe pagină sau un singur PDF.',
  altul: 'Fotografiați documentul întreg, cu textul lizibil, sau trimiteți-l ca PDF. Pentru mai multe pagini, câte o poză pe pagină.',
}

export const ETICHETA_STARE_PORTAL: Record<StareAct, string> = {
  de_trimis: 'De trimis',
  primit: 'Trimis',
  acceptat: 'Primit de cabinet',
  respins: 'De refăcut',
  lipsa: 'Nu îl aveți',
}

/** Actul nu mai așteaptă nimic de la client: trimis, primit sau declarat lipsă. */
export const rezolvat = (a: ActPortal) => a.stare === 'primit' || a.stare === 'acceptat' || a.stare === 'lipsa'

/** Ecranul de final: fiecare act obligatoriu e trimis sau declarat lipsă; cele opționale nu țin pagina deschisă. */
export const totulTrimis = (p: Portal) =>
  p.stare === 'completa' || (p.acte.length > 0 && p.acte.every(a => rezolvat(a) || (a.optional && a.stare === 'de_trimis')))
