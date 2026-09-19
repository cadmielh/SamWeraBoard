/** Operațiuni Google Drive/Docs făcute DIRECT din browser, cu tokenul Google al utilizatorului.
 *
 * Aplicația cere doar permisiunea `drive.file` (fișierele create de aplicație sau alese explicit de utilizator
 * prin Google Picker). Tokenul nu mai ajunge pe serverele noastre. Cu `drive.file`, un fișier la care aplicația
 * nu a primit acces răspunde 403/404: îl semnalăm ca `not_granted`, iar interfața cere alegerea lui din nou. */

const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const DOCS = 'https://docs.googleapis.com/v1'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const GOOGLE_APPS = 'application/vnd.google-apps.'

export type DriveErrorCode = 'auth' | 'not_granted' | 'other'

export class DriveError extends Error {
  readonly code: DriveErrorCode
  readonly status?: number
  constructor(message: string, code: DriveErrorCode, status?: number) {
    super(message)
    this.name = 'DriveError'
    this.code = code
    this.status = status
  }
}

export interface DriveItem { id: string; name: string; mimeType: string }

function toError(res: Response): DriveError {
  if (res.status === 401) return new DriveError('Sesiunea Google a expirat. Deconectează-te și autentifică-te din nou.', 'auth', 401)
  if (res.status === 403 || res.status === 404) {
    return new DriveError('Aplicația nu are acces la acest fișier. Alege-l din nou din Google Drive.', 'not_granted', res.status)
  }
  return new DriveError(`Google Drive a răspuns cu eroare (${res.status}).`, 'other', res.status)
}

async function gfetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } })
  if (!res.ok) throw toError(res)
  return res
}

/** Id-urile Google sunt alfanumerice cu `-` și `_`; refuzăm orice altceva (nu construim URL-uri din text liber). */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(id)) throw new DriveError('Identificator Google Drive invalid.', 'other')
  return id
}

export async function driveMeta(id: string, token: string): Promise<DriveItem> {
  const res = await gfetch(`${DRIVE}/files/${safeId(id)}?fields=id,name,mimeType&supportsAllDrives=true`, token)
  return await res.json() as DriveItem
}

/** Descarcă fișierul; documentele Google native (Docs, Slides, Sheets) se exportă în PDF. */
export async function driveDownload(id: string, token: string): Promise<{ blob: Blob; name: string; mimeType: string }> {
  const meta = await driveMeta(id, token)
  if (meta.mimeType.startsWith(GOOGLE_APPS)) {
    const res = await gfetch(`${DRIVE}/files/${safeId(id)}/export?mimeType=application%2Fpdf`, token)
    return { blob: await res.blob(), name: `${meta.name}.pdf`, mimeType: 'application/pdf' }
  }
  const res = await gfetch(`${DRIVE}/files/${safeId(id)}?alt=media&supportsAllDrives=true`, token)
  return { blob: await res.blob(), name: meta.name, mimeType: meta.mimeType }
}

/** Încarcă un fișier nou (creat de aplicație => permis de `drive.file`), opțional într-un folder ales prin Picker. */
export async function driveUpload(
  blob: Blob, name: string, mimeType: string, folderId: string | null, token: string,
): Promise<{ id: string; name: string; webViewLink: string }> {
  const boundary = `swb${crypto.randomUUID().replace(/-/g, '')}`
  const metadata: Record<string, unknown> = { name }
  if (folderId) metadata.parents = [safeId(folderId)]
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ])
  const res = await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`, token, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  const d = await res.json() as { id: string; name: string; webViewLink?: string }
  return { id: d.id, name: d.name, webViewLink: d.webViewLink ?? '' }
}

/** Completează un șablon Google Docs: copiază documentul și înlocuiește textele (fără să modifice originalul). */
export async function fillGoogleDoc(
  templateDocId: string, replacements: Record<string, string>, outputName: string | undefined, token: string,
): Promise<{ docId: string; link: string }> {
  const id = safeId(templateDocId)
  const titleRes = await gfetch(`${DOCS}/documents/${id}?fields=title`, token)
  const title = ((await titleRes.json()) as { title?: string }).title ?? id

  const copyRes = await gfetch(`${DRIVE}/files/${id}/copy?fields=id,webViewLink&supportsAllDrives=true`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: outputName || `Completat - ${title}` }),
  })
  const copy = await copyRes.json() as { id: string; webViewLink?: string }

  const requests = Object.entries(replacements)
    .filter(([, v]) => v)
    .map(([ph, val]) => ({ replaceAllText: { containsText: { text: ph, matchCase: true }, replaceText: val } }))
  if (requests.length > 0) {
    await gfetch(`${DOCS}/documents/${safeId(copy.id)}:batchUpdate`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
  }
  return { docId: copy.id, link: copy.webViewLink ?? '' }
}
