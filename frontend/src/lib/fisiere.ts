/** Documentele clienților: metadatele se citesc live din Firestore (`workspaces/{wid}/fisiere`, `foldere`), iar toate
 * modificările și conținutul trec prin API (fisiere_api.py), care criptează, verifică tipul și ține jurnalul de acces.
 * Plan și decizii: docs/plan-documente-client.md. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { collection, doc, getCountFromServer, onSnapshot, query, where, type DocumentData } from 'firebase/firestore'
import { db } from './firebase'
import { toDateSafe } from './dates'
import { FILES_BASE, apiErrorMessage, apiJson, authHeaders } from './api'

export const MAX_BYTES = 15 * 1024 * 1024
export const LIMITA_CABINET = 10 * 1024 * 1024 * 1024
export const MAX_ADANCIME = 6
/** Folderele create automat la fiecare client, dacă cabinetul nu și-a ales altele (Setări › Documente). */
export const FOLDERE_IMPLICITE = ['Acte identitate', 'Documente generate', 'Primite de la client']
export const MAX_FOLDERE_IMPLICITE = 10

export interface Fisier {
  id: string
  clientId: string | null
  folderId: string | null
  nume: string
  mime: string
  marime: number
  sursa: 'incarcat' | 'generat' | 'portal'
  stare: 'acceptat' | 'de_verificat'
  createdAt: Date | null
  createdBy: string
  arhivat: boolean
  /** Doar în Arhivă: clientul șters și calea folderului în care era fișierul. */
  clientNume?: string
  cale?: string
  arhivatLa?: Date | null
}

export interface Folder {
  id: string
  clientId: string
  parentId: string | null
  nume: string
  createdAt?: Date | null
}

export function fisierDinFirestore(id: string, d: DocumentData): Fisier {
  return {
    id,
    clientId: d.clientId ?? null,
    folderId: d.folderId ?? null,
    nume: String(d.nume ?? ''),
    mime: String(d.mime ?? ''),
    marime: Number(d.marime ?? 0),
    sursa: d.sursa ?? 'incarcat',
    stare: d.stare ?? 'acceptat',
    createdAt: toDateSafe(d.createdAt),
    createdBy: String(d.createdBy ?? ''),
    arhivat: d.arhivat === true,
    clientNume: d.clientNume,
    cale: d.cale,
    arhivatLa: toDateSafe(d.arhivatLa),
  }
}

function folderDinFirestore(id: string, d: DocumentData): Folder {
  return { id, clientId: String(d.clientId ?? ''), parentId: d.parentId ?? null, nume: String(d.nume ?? ''), createdAt: toDateSafe(d.createdAt) }
}

// ── Tipuri de fișiere ───────────────────────────────────────────────────────

export type Familie = 'pdf' | 'imagine' | 'word' | 'excel' | 'prezentare' | 'text' | 'semnat' | 'email' | 'altul'

const FAMILIE_MIME: Record<string, Familie> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'imagine', 'image/png': 'imagine', 'image/webp': 'imagine', 'image/gif': 'imagine',
  'image/tiff': 'imagine', 'image/heic': 'imagine',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.oasis.opendocument.text': 'word', 'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.oasis.opendocument.spreadsheet': 'excel', 'application/vnd.ms-excel': 'excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'prezentare',
  'application/vnd.ms-powerpoint': 'prezentare',
  'application/xml': 'text', 'text/plain': 'text', 'text/csv': 'text',
  'application/pkcs7-signature': 'semnat', 'application/pkcs7-mime': 'semnat',
  'application/vnd.ms-outlook': 'email',
}

export function familie(mime: string): Familie {
  return FAMILIE_MIME[mime] ?? 'altul'
}

/** Eticheta scurtă din iconița fișierului. */
export const ETICHETA_FAMILIE: Record<Familie, string> = {
  pdf: 'PDF', imagine: 'IMG', word: 'DOC', excel: 'XLS', prezentare: 'PPT', text: 'TXT', semnat: 'SIG', email: 'MSG', altul: 'FIȘ',
}

// Imaginile se afișează direct (img-src permite blob:), PDF-urile cu pdf.js (PdfViewer), documentele Word cu docx-preview
// (DocxViewer), textul și XML-ul ca text. Fără iframe: acela ar cere relaxarea CSP-ului și pe iPhone ar arăta o pagină.
export type FelPrevizualizare = 'imagine' | 'pdf' | 'word' | 'text'
const PREVIZUALIZARE: Record<string, FelPrevizualizare> = {
  'image/jpeg': 'imagine', 'image/png': 'imagine', 'image/webp': 'imagine', 'image/gif': 'imagine',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'text/plain': 'text', 'text/csv': 'text', 'application/xml': 'text',
}
export const felPrevizualizare = (mime: string): FelPrevizualizare | null => PREVIZUALIZARE[mime] ?? null
export const previzualizabil = (mime: string) => mime in PREVIZUALIZARE

/** Actele din care se pot extrage datele (OCR): aceleași tipuri ca la scanarea obișnuită. */
export const extractibil = (mime: string) => ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime)

/** Căutarea după nume: fără diacritice și fără deosebire de majuscule („stefanescu” găsește „Ștefănescu”). */
export function normalizeazaCautare(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('ro').trim()
}

/** Numele unui fișier lipit din clipboard: capturile vin ca „image.png”, deci primesc un nume cu data și ora. */
export function numeLipire(file: { name: string; type: string }, acum: Date): string {
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name)
  if (!generic) return file.name
  const ext = file.type === 'image/jpeg' ? 'jpg' : (file.type.split('/')[1] || 'png')
  const z = (n: number) => String(n).padStart(2, '0')
  return `Captură ${acum.getFullYear()}-${z(acum.getMonth() + 1)}-${z(acum.getDate())} ${z(acum.getHours())}.${z(acum.getMinutes())}.${z(acum.getSeconds())}.${ext}`
}

/** Extensiile acceptate de server (fisiere.detecteaza_tip); verificarea reală se face acolo, după conținut. */
export const EXTENSII = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'heic', 'heif', 'docx', 'doc', 'odt',
  'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'xml', 'txt', 'csv', 'p7s', 'p7m', 'msg'] as const
export const ACCEPT = EXTENSII.map(e => `.${e}`).join(',')

export function extensie(nume: string): string {
  const i = nume.lastIndexOf('.')
  return i > 0 ? nume.slice(i + 1).toLowerCase() : ''
}

/** Verificarea din browser, înainte de trimitere: evită un drum la server pentru erorile evidente. */
export function verificaLocal(f: { name: string; size: number }): string | null {
  if (f.size === 0) return 'Fișierul este gol.'
  if (f.size > MAX_BYTES) return `Fișierul are ${formatMarime(f.size)}; limita este 15 MB.`
  if (!(EXTENSII as readonly string[]).includes(extensie(f.name))) return 'Tip de fișier neacceptat.'
  return null
}

export function formatMarime(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const unitati = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let u = 0
  while (v >= 1024 && u < unitati.length - 1) { v /= 1024; u++ }
  const zecimale = v < 10 && u > 0 ? 1 : 0
  return `${v.toLocaleString('ro-RO', { maximumFractionDigits: zecimale, minimumFractionDigits: zecimale })} ${unitati[u]}`
}

// ── Foldere: arbore, cale, conținut ─────────────────────────────────────────

const cmpNume = (a: string, b: string) => a.localeCompare(b, 'ro', { sensitivity: 'base', numeric: true })

export function subfoldere(foldere: Folder[], parentId: string | null): Folder[] {
  return foldere.filter(f => f.parentId === parentId).sort((a, b) => cmpNume(a.nume, b.nume))
}

/** Calea de la rădăcină la folder (inclusiv), pentru firul de navigare. Un folder dispărut (șters de un coleg) = []. */
export function caleFolder(foldere: Folder[], id: string | null): Folder[] {
  const dupaId = new Map(foldere.map(f => [f.id, f]))
  const out: Folder[] = []
  let cur = id ? dupaId.get(id) : undefined
  while (cur && out.length <= MAX_ADANCIME) {
    out.unshift(cur)
    cur = cur.parentId ? dupaId.get(cur.parentId) : undefined
  }
  return out
}

export function descendenti(foldere: Folder[], id: string): Set<string> {
  const out = new Set([id])
  let adaugat = true
  while (adaugat) {
    adaugat = false
    for (const f of foldere) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); adaugat = true }
    }
  }
  return out
}

/** Câte fișiere și subfoldere se pierd la ștergerea unui folder (pentru mesajul de confirmare). */
export function continutRecursiv(foldere: Folder[], fisiere: Fisier[], id: string): { fisiere: number; foldere: number } {
  const tinta = descendenti(foldere, id)
  return { fisiere: fisiere.filter(f => f.folderId && tinta.has(f.folderId)).length, foldere: tinta.size - 1 }
}

/** Lista plată a arborelui, în ordinea afișării, cu nivelul fiecărui folder (pentru „Mută în…”). */
export function arbore(foldere: Folder[]): { folder: Folder; nivel: number }[] {
  const out: { folder: Folder; nivel: number }[] = []
  const viziteaza = (parent: string | null, nivel: number) => {
    if (nivel > MAX_ADANCIME) return
    for (const f of subfoldere(foldere, parent)) {
      out.push({ folder: f, nivel })
      viziteaza(f.id, nivel + 1)
    }
  }
  viziteaza(null, 0)
  return out
}

/** Înălțimea subarborelui (1 = folder fără subfoldere): un folder mutat nu poate depăși MAX_ADANCIME. */
export function inaltime(foldere: Folder[], id: string): number {
  return 1 + Math.max(0, ...subfoldere(foldere, id).map(f => inaltime(foldere, f.id)))
}

export type Sortare = 'nume' | 'tip' | 'marime' | 'data'

/** Direcția implicită a fiecărui criteriu: numele și tipul crescător, mărimea și data descrescător (cele mai mari/noi întâi). */
export const DESC_IMPLICIT: Record<Sortare, boolean> = { nume: false, tip: false, marime: true, data: true }

const ORDINE_FAMILII: Familie[] = ['pdf', 'imagine', 'word', 'excel', 'prezentare', 'text', 'semnat', 'email', 'altul']
const timp = (d: Date | null | undefined) => d?.getTime() ?? 0

/** Fișierele, după criteriu și direcție. La egalitate decide numele (mereu crescător), ca ordinea să fie stabilă. */
export function sorteazaFisiere(fisiere: Fisier[], dupa: Sortare, desc = DESC_IMPLICIT[dupa]): Fisier[] {
  const semn = desc ? -1 : 1
  const crit = (a: Fisier, b: Fisier): number => {
    switch (dupa) {
      case 'tip': return (ORDINE_FAMILII.indexOf(familie(a.mime)) - ORDINE_FAMILII.indexOf(familie(b.mime)))
        || cmpNume(extensie(a.nume), extensie(b.nume))
      case 'marime': return a.marime - b.marime
      case 'data': return timp(a.createdAt) - timp(b.createdAt)
      default: return cmpNume(a.nume, b.nume)
    }
  }
  return [...fisiere].sort((a, b) => semn * crit(a, b) || cmpNume(a.nume, b.nume))
}

/** Folderele (rămân deasupra fișierelor), după același criteriu: mărimea = totalul fișierelor din folder și subfoldere;
 * „tip” nu le deosebește, deci rămân după nume. */
export function sorteazaFoldere(lista: Folder[], toate: Folder[], fisiere: Fisier[], dupa: Sortare, desc = DESC_IMPLICIT[dupa]): Folder[] {
  const semn = desc ? -1 : 1
  const marime = new Map<string, number>()
  if (dupa === 'marime') {
    for (const d of lista) {
      const tinta = descendenti(toate, d.id)
      marime.set(d.id, fisiere.reduce((s, f) => s + (f.folderId && tinta.has(f.folderId) ? f.marime : 0), 0))
    }
  }
  const crit = (a: Folder, b: Folder): number => {
    switch (dupa) {
      case 'marime': return (marime.get(a.id) ?? 0) - (marime.get(b.id) ?? 0)
      case 'data': return timp(a.createdAt) - timp(b.createdAt)
      case 'nume': return cmpNume(a.nume, b.nume)
      default: return 0
    }
  }
  return [...lista].sort((a, b) => semn * crit(a, b) || cmpNume(a.nume, b.nume))
}

// ── Citire live ─────────────────────────────────────────────────────────────

const colFisiere = (wid: string) => collection(db, 'workspaces', wid, 'fisiere')
const colFoldere = (wid: string) => collection(db, 'workspaces', wid, 'foldere')

/** Fișierele și folderele unui client, în timp real (un coleg care încarcă ceva apare imediat). */
export function useDocumenteClient(workspaceId: string | null, clientId: string | null) {
  // Fiecare valoare e legată de cheia cabinet/client: la schimbarea clientului, datele vechi nu se afișează nicio clipă.
  const cheie = `${workspaceId}/${clientId}`
  const [fisiere, setFisiere] = useState<{ k: string; v: Fisier[] } | null>(null)
  const [foldere, setFoldere] = useState<{ k: string; v: Folder[] } | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId || !clientId) return
    const k = `${workspaceId}/${clientId}`
    const laEroare = () => setEroare(k)
    const u1 = onSnapshot(query(colFisiere(workspaceId), where('clientId', '==', clientId)),
      snap => setFisiere({ k, v: snap.docs.map(d => fisierDinFirestore(d.id, d.data())) }), laEroare)
    const u2 = onSnapshot(query(colFoldere(workspaceId), where('clientId', '==', clientId)),
      snap => setFoldere({ k, v: snap.docs.map(d => folderDinFirestore(d.id, d.data())) }), laEroare)
    return () => { u1(); u2() }
  }, [workspaceId, clientId])

  const error = eroare === cheie
  return {
    fisiere: fisiere?.k === cheie ? fisiere.v : [],
    foldere: foldere?.k === cheie ? foldere.v : [],
    loading: !error && (fisiere?.k !== cheie || foldere?.k !== cheie),
    error,
  }
}

export function useArhiva(workspaceId: string | null) {
  const [stare, setStare] = useState<{ wid: string; fisiere: Fisier[]; eroare: boolean } | null>(null)
  useEffect(() => {
    if (!workspaceId) return
    return onSnapshot(query(colFisiere(workspaceId), where('arhivat', '==', true)),
      snap => setStare({ wid: workspaceId, fisiere: snap.docs.map(d => fisierDinFirestore(d.id, d.data())), eroare: false }),
      () => setStare({ wid: workspaceId, fisiere: [], eroare: true }))
  }, [workspaceId])
  const curent = stare?.wid === workspaceId ? stare : null
  return { fisiere: curent?.fisiere ?? [], loading: !curent, error: !!curent?.eroare }
}

export function useSpatiuDocumente(workspaceId: string | null) {
  const [stare, setStare] = useState<{ wid: string; octeti: number; numar: number } | null>(null)
  useEffect(() => {
    if (!workspaceId) return
    return onSnapshot(doc(db, 'workspaces', workspaceId, 'contoare', 'fisiere'),
      snap => setStare({ wid: workspaceId, octeti: Math.max(0, Number(snap.data()?.octeti ?? 0)), numar: Math.max(0, Number(snap.data()?.numar ?? 0)) }),
      () => setStare({ wid: workspaceId, octeti: 0, numar: 0 }))
  }, [workspaceId])
  return stare?.wid === workspaceId ? stare : null
}

export const FOLDER_GENERATE = 'Documente generate'

export interface SetariDocumente {
  /** Folderele create automat la fiecare client. */
  foldereImplicite: string[]
  /** Folderul în care se păstrează copiile documentelor generate. */
  folderGenerate: string
}

/** Setările documentelor ale cabinetului (null cât se încarcă); lipsă = implicitele. */
export function useSetariDocumente(workspaceId: string | null): SetariDocumente | null {
  const [stare, setStare] = useState<{ wid: string; v: SetariDocumente } | null>(null)
  useEffect(() => {
    if (!workspaceId) return
    const implicite = { foldereImplicite: [...FOLDERE_IMPLICITE], folderGenerate: FOLDER_GENERATE }
    return onSnapshot(doc(db, 'workspaces', workspaceId, 'setari', 'documente'), snap => {
      const d = snap.data()
      setStare({ wid: workspaceId, v: {
        foldereImplicite: Array.isArray(d?.foldereImplicite)
          ? d.foldereImplicite.filter((x: unknown): x is string => typeof x === 'string') : implicite.foldereImplicite,
        folderGenerate: typeof d?.folderGenerate === 'string' && d.folderGenerate.trim() ? d.folderGenerate : FOLDER_GENERATE,
      } })
    }, () => setStare({ wid: workspaceId, v: implicite }))
  }, [workspaceId])
  return stare?.wid === workspaceId ? stare.v : null
}

/** Pentru întrebarea de la ștergerea clientului: are documente? */
export async function numarDocumenteClient(workspaceId: string, clientId: string): Promise<number> {
  const snap = await getCountFromServer(query(colFisiere(workspaceId), where('clientId', '==', clientId)))
  return snap.data().count
}

// ── API ─────────────────────────────────────────────────────────────────────

export interface EroareFisier extends Error {
  code?: string
  status?: number
  /** La `duplicat`: fișierul cu același conținut care există deja la client. */
  existent?: { id: string; nume: string; folderId: string | null }
  /** La `rate_limited`: secundele de așteptare cerute de server. */
  retryAfter?: number
}

function eroare(mesaj: string, code?: string, status?: number, extra?: Partial<EroareFisier>): EroareFisier {
  return Object.assign(new Error(mesaj), { code, status, ...extra })
}

/** Încărcare cu progres (XMLHttpRequest: `fetch` nu raportează progresul trimiterii). */
export async function incarcaFisier(
  p: {
    workspaceId: string; clientId: string; folderId: string | null; file: File; permiteDuplicat?: boolean
    /** `generate`: copia unui document generat, în folderul ales de cabinet (serverul îl găsește sau îl creează). */
    destinatie?: 'generate'
  },
  onProgress?: (fractie: number) => void,
  signal?: AbortSignal,
): Promise<Fisier> {
  // Cabinetul în care a fost pus fișierul în coadă, nu cel activ acum: coada continuă și după schimbarea cabinetului.
  const headers = { ...(await authHeaders()), 'X-Workspace-Id': p.workspaceId }
  // Anulat cât se obținea tokenul: un semnal deja anulat nu mai declanșează evenimentul, deci verificăm aici.
  if (signal?.aborted) throw eroare('Încărcare anulată.', 'abort')
  const fd = new FormData()
  fd.append('fisier', p.file, p.file.name)
  fd.append('clientId', p.clientId)
  if (p.folderId) fd.append('folderId', p.folderId)
  if (p.permiteDuplicat) fd.append('duplicat', 'permite')
  if (p.destinatie) fd.append('destinatie', p.destinatie)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${FILES_BASE}/fisiere`)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onerror = () => reject(eroare('Conexiunea s-a întrerupt. Verifică internetul și reîncearcă.', 'network'))
    xhr.onabort = () => reject(eroare('Încărcare anulată.', 'abort'))
    xhr.onload = () => {
      let data: { error?: string; fisier?: DocumentData & { id: string }; existent?: EroareFisier['existent'] } = {}
      try { data = JSON.parse(xhr.responseText || '{}') } catch { /* răspuns ne-JSON (ex. 413 de la proxy) */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.fisier) {
        resolve(fisierDinFirestore(data.fisier.id, data.fisier))
        return
      }
      const res = new Response(null, { status: xhr.status, headers: { 'Retry-After': xhr.getResponseHeader('Retry-After') ?? '' } })
      const code = data.error ?? (xhr.status === 413 ? 'fisier_prea_mare' : undefined)
      reject(eroare(apiErrorMessage({ error: code }, res, `Eroare ${xhr.status}`), code, xhr.status,
        { existent: data.existent, retryAfter: Number(xhr.getResponseHeader('Retry-After')) || undefined }))
    }
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(fd)
  })
}

export async function continutFisier(id: string, scop: 'descarcare' | 'previzualizare'): Promise<Blob> {
  const res = await fetch(`${FILES_BASE}/fisiere/${encodeURIComponent(id)}/continut?scop=${scop}`, { headers: await authHeaders() })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw eroare(apiErrorMessage(data as { error?: string }, res, `Eroare ${res.status}`), (data as { error?: string }).error, res.status)
  }
  return res.blob()
}

/** Salvează fișierul pe dispozitiv, cu numele lui din aplicație. */
export async function descarcaFisier(f: Pick<Fisier, 'id' | 'nume'>): Promise<void> {
  const blob = await continutFisier(f.id, 'descarcare')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = f.nume
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export const redenumesteFisier = (id: string, nume: string) => apiJson('PATCH', `/fisiere/${encodeURIComponent(id)}`, { nume })
export const mutaFisier = (id: string, folderId: string | null) => apiJson('PATCH', `/fisiere/${encodeURIComponent(id)}`, { folderId })
export const stergeFisier = (id: string, workspaceId?: string) =>
  apiJson('DELETE', `/fisiere/${encodeURIComponent(id)}`, undefined, workspaceId)

export const creeazaFolder = (clientId: string, parentId: string | null, nume: string) =>
  apiJson<{ folder: Folder }>('POST', '/foldere', { clientId, parentId, nume }).then(r => r.folder)
/** Creează folderele implicite ale cabinetului la client, o singură dată (serverul ține marcajul). */
export const initDocumenteClient = (clientId: string) =>
  apiJson<{ foldere: Folder[]; init: boolean }>('POST', `/clients/${encodeURIComponent(clientId)}/documente/init`)
export const salveazaSetariDocumente = (patch: Partial<SetariDocumente>) =>
  apiJson<Partial<SetariDocumente>>('PUT', '/fisiere/setari', patch)

/** Păstrează în documentele clientului o copie a unui document generat (în folderul ales de cabinet). */
export const pastreazaCopieGenerata = (workspaceId: string, clientId: string, blob: Blob, nume: string) =>
  incarcaFisier({ workspaceId, clientId, folderId: null, destinatie: 'generate',
    file: new File([blob], nume, { type: blob.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) })
export const redenumesteFolder = (id: string, nume: string) => apiJson('PATCH', `/foldere/${encodeURIComponent(id)}`, { nume })
export const mutaFolder = (id: string, parentId: string | null) => apiJson('PATCH', `/foldere/${encodeURIComponent(id)}`, { parentId })
export const stergeFolder = (id: string, recursiv: boolean, workspaceId?: string) =>
  apiJson('DELETE', `/foldere/${encodeURIComponent(id)}${recursiv ? '?recursiv=1' : ''}`, undefined, workspaceId)

// ── Ștergeri amânate („Anulează”) ───────────────────────────────────────────
// Elementele șterse dispar imediat din listă, dar cererea către server pleacă abia la expirarea notificării. Mulțimea
// trăiește în afara componentelor: un element rămâne ascuns și dacă utilizatorul deschide între timp alt client.

let ascunse = new Set<string>()
const ascultatoriAscunse = new Set<() => void>()

function seteazaAscunse(next: Set<string>) {
  ascunse = next
  ascultatoriAscunse.forEach(l => l())
}

export function ascundeTemporar(ids: string[]) {
  seteazaAscunse(new Set([...ascunse, ...ids]))
}

// Cât timp o ștergere așteaptă expirarea notificării, închiderea sau reîncărcarea paginii ar anula-o fără știrea
// utilizatorului: browserul cere confirmare (mesajul standard al browserului).
let stergeriInAsteptare = 0
const avertizeazaLaPlecare = (e: BeforeUnloadEvent) => { e.preventDefault() }

export function incepeStergereAmanata() {
  if (stergeriInAsteptare++ === 0) window.addEventListener('beforeunload', avertizeazaLaPlecare)
}

export function terminaStergereAmanata() {
  stergeriInAsteptare = Math.max(0, stergeriInAsteptare - 1)
  if (stergeriInAsteptare === 0) window.removeEventListener('beforeunload', avertizeazaLaPlecare)
}

export function reafiseaza(ids: string[]) {
  const next = new Set(ascunse)
  ids.forEach(id => next.delete(id))
  seteazaAscunse(next)
}

/** Starea curentă (pentru cod din afara React și pentru teste). */
export const ascunseAcum = (): ReadonlySet<string> => ascunse

/** Id-urile (fișiere și foldere) aflate în așteptarea ștergerii. */
export function useAscunse(): Set<string> {
  return useSyncExternalStore(l => { ascultatoriAscunse.add(l); return () => { ascultatoriAscunse.delete(l) } }, () => ascunse)
}
