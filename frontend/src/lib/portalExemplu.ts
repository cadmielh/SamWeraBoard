/** Exemplul portalului (`/p/exemplu`): pagina pe care o vede clientul, cu o cerere închipuită, ca cabinetul s-o încerce
 * înainte de a trimite primul link. Totul stă în memorie: nimic nu ajunge la server, iar la reîncărcare o ia de la capăt. */
import type { ActPortal, FisierTrimis, ParteCi, Portal } from './portal'

export const TOKEN_EXEMPLU = 'exemplu'

/** Adresa exemplului, cu numele cabinetului și al celui care cere, ca pagina să arate ca a lui. */
export function linkExemplu(cabinet: string, cerutDe: string): string {
  const q = new URLSearchParams()
  if (cabinet) q.set('cabinet', cabinet)
  if (cerutDe && !cerutDe.includes('@')) q.set('de', cerutDe)
  const s = q.toString()
  return `/p/${TOKEN_EXEMPLU}${s ? `?${s}` : ''}`
}

let portal: Portal | null = null
let urmator = 1

export function pornesteExemplu(cabinet: string, cerutDe: string, now: Date = new Date()): void {
  urmator = 1
  portal = {
    cabinet: cabinet || 'Cabinetul dumneavoastră',
    cerutDe,
    mesaj: 'Bună ziua, pentru înființarea firmei avem nevoie de actele de mai jos. Vă mulțumim!',
    expiraLa: new Date(now.getTime() + 14 * 86_400_000),
    stare: 'deschisa',
    acte: [
      { id: 'a1', eticheta: 'CI – Popescu Ion', tip: 'ci', stare: 'de_trimis', optional: false, fisiere: [] },
      { id: 'a2', eticheta: 'Dovada sediului', tip: 'dovada_sediu', stare: 'de_trimis', optional: false, fisiere: [] },
      { id: 'a3', eticheta: 'Certificat de căsătorie', tip: 'altul', stare: 'de_trimis', optional: true, fisiere: [] },
    ],
  }
}

function act(aid: string): ActPortal {
  const a = portal?.acte.find(x => x.id === aid)
  if (!a) throw new Error('Actul nu există')
  return a
}

const copie = (p: Portal): Portal => ({ ...p, acte: p.acte.map(a => ({ ...a, fisiere: [...a.fisiere] })) })

export async function citesteExemplu(): Promise<Portal> {
  if (!portal) pornesteExemplu('', '')
  return copie(portal as Portal)
}

/** Încărcarea închipuită: progresul curge în câteva zecimi de secundă, iar actul devine „primit”. */
export async function incarcaExemplu(aid: string, fisier: Blob, nume: string, onProgres?: (p: number) => void, parte?: ParteCi): Promise<FisierTrimis> {
  for (const p of [0.3, 0.7, 1]) {
    await new Promise(r => setTimeout(r, 150))
    onProgres?.(p)
  }
  const a = act(aid)
  const f: FisierTrimis = { id: `f${urmator++}`, nume, marime: fisier.size, ...(parte ? { parte } : {}) }
  a.fisiere.push(f)
  a.stare = 'primit'
  delete a.notaClient
  return f
}

export async function retrageExemplu(fid: string): Promise<void> {
  const a = portal?.acte.find(x => x.fisiere.some(f => f.id === fid))
  if (!a) return
  a.fisiere = a.fisiere.filter(f => f.id !== fid)
  if (!a.fisiere.length) a.stare = 'de_trimis'
}

export async function lipsaExemplu(aid: string, nota: string | null): Promise<void> {
  const a = act(aid)
  if (nota === null) { a.stare = 'de_trimis'; delete a.notaClient }
  else { a.stare = 'lipsa'; a.notaClient = nota }
}
