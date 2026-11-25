/** Portalul clientului (`/p/<token>`, fără cont): actele cerute de cabinet, încărcarea lor și retragerea unei încărcări
 * greșite. Vorbește doar cu rutele publice din cereri_api.py; nu folosește Firebase. Plan: docs/plan-documente-client.md. */
import { BASE, FILES_BASE } from './apiBase'
import type { StareAct, TipAct } from './cereri'

export interface FisierTrimis { id: string; nume: string; marime: number }

export interface ActPortal {
  id: string
  eticheta: string
  tip: TipAct
  stare: StareAct
  motiv?: string
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

export class EroarePortal extends Error {}

const STARI: StareAct[] = ['de_trimis', 'primit', 'acceptat', 'respins']

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
      fisiere: Array.isArray(a.fisiere)
        ? (a.fisiere as Record<string, unknown>[]).map(f => ({ id: String(f.id ?? ''), nume: String(f.nume ?? ''), marime: Number(f.marime) || 0 }))
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

/** Încărcarea unui fișier pentru un act, cu progresul (0–1); XHR, ca progresul să se vadă și pe date mobile. */
export function incarcaAct(token: string, aid: string, fisier: Blob, nume: string, onProgres?: (p: number) => void): Promise<FisierTrimis> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('fisier', fisier, nume)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url(FILES_BASE, token, `/acte/${encodeURIComponent(aid)}`))
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgres?.(e.loaded / e.total) }
    xhr.onerror = () => reject(new EroarePortal(mesajEroare(undefined, 0)))
    xhr.onload = () => {
      let j: Record<string, unknown> = {}
      try { j = JSON.parse(xhr.responseText) as Record<string, unknown> } catch { /* răspuns fără JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        const f = (j.fisier ?? {}) as Record<string, unknown>
        resolve({ id: String(f.id ?? ''), nume: String(f.nume ?? nume), marime: Number(f.marime) || fisier.size })
      } else if (j.error === 'link_inactiv') reject(new LinkInactiv())
      else reject(new EroarePortal(mesajEroare(j.error as string | undefined, xhr.status, xhr.getResponseHeader('Retry-After'))))
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

/** PDF-ul pleacă așa cum e. Pozele (inclusiv HEIC, unde browserul le poate citi) se micșorează și se trimit ca JPEG;
 * orientarea din cameră e aplicată de browser la desenare. O poză pe care browserul n-o poate citi pleacă neschimbată
 * (serverul decide), cu excepția HEIC, pe care serverul nu-l primește. */
export async function pregatesteFisier(f: File): Promise<{ blob: Blob; nume: string }> {
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
  return { blob, nume: numeJpg(f.name) }
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
}

/** Toate actele trimise sau primite: ecranul de final. */
export const totulTrimis = (p: Portal) =>
  p.stare === 'completa' || (p.acte.length > 0 && p.acte.every(a => a.stare === 'primit' || a.stare === 'acceptat'))
