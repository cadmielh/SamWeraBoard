/** Tokenul Google Drive, separat de autentificarea în aplicație.
 *
 * Login-ul Google îl furnizează direct; altfel (sesiune nouă, token expirat, cont cu parolă) îl cere Google Identity
 * Services, cu aceeași permisiune `drive.file` și același client OAuth ca la login. Tokenul rămâne în browser, doar pe
 * durata tab-ului. `ensureDriveToken` se apelează dintr-o acțiune a utilizatorului: Google deschide o fereastră. */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const TOKEN_KEY = 'gat'
const EXPIRES_KEY = 'gat_exp'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const LOGIN_TOKEN_SECONDS = 3300   // Firebase nu spune cât durează tokenul de la login; Google dă o oră, păstrăm o marjă
const MARGIN_MS = 60_000

export class DriveConnectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DriveConnectError'
  }
}

interface TokenResponse { access_token?: string; expires_in?: number | string; error?: string }
interface TokenClient { requestAccessToken(): void }
interface GisWindow {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient(cfg: {
          client_id: string
          scope: string
          login_hint?: string
          prompt: string
          callback: (r: TokenResponse) => void
          error_callback: (e: { type?: string }) => void
        }): TokenClient
      }
    }
  }
}

let loginHint = ''
let loading: Promise<void> | null = null
let pending: Promise<string> | null = null

/** Contul Google propus în fereastra de conectare (e-mailul din aplicație, când e și cont Google). */
export function setDriveLoginHint(email: string) { loginHint = email }

export function setDriveToken(token: string, expiresInSeconds = LOGIN_TOKEN_SECONDS) {
  if (!token) return
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(EXPIRES_KEY, String(Date.now() + expiresInSeconds * 1000))
}

export function clearDriveToken() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(EXPIRES_KEY)
}

/** Tokenul curent, dacă mai e valabil; altfel șir gol. */
export function getDriveToken(): string {
  const expires = Number(sessionStorage.getItem(EXPIRES_KEY) ?? 0)
  return expires - MARGIN_MS > Date.now() ? sessionStorage.getItem(TOKEN_KEY) ?? '' : ''
}

function loadGis(): Promise<void> {
  if ((window as unknown as GisWindow).google?.accounts?.oauth2) return Promise.resolve()
  if (loading) return loading
  loading = new Promise<void>((resolve, reject) => {
    const fail = () => { loading = null; reject(new DriveConnectError('Nu s-a putut încărca conectarea la Google Drive. Verifică conexiunea și reîncearcă.')) }
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = fail
    document.head.appendChild(s)
  })
  return loading
}

function popupMessage(type?: string): string {
  if (type === 'popup_failed_to_open') return 'Browserul a blocat fereastra Google. Permite ferestrele pop-up pentru acest site și reîncearcă.'
  if (type === 'popup_closed') return 'Conectarea la Google Drive a fost anulată.'
  return 'Conectarea la Google Drive a eșuat. Reîncearcă.'
}

async function requestToken(): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? ''
  if (!clientId) throw new DriveConnectError('Conectarea la Google Drive nu este configurată pentru această aplicație.')
  await loadGis()
  const oauth2 = (window as unknown as GisWindow).google?.accounts?.oauth2
  if (!oauth2) throw new DriveConnectError(popupMessage())
  return new Promise<string>((resolve, reject) => {
    oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      login_hint: loginHint || undefined,
      prompt: '',
      callback: r => {
        if (r.error === 'access_denied') { reject(new DriveConnectError('Fără acordul tău, aplicația nu poate folosi Google Drive.')); return }
        if (r.error || !r.access_token) { reject(new DriveConnectError(popupMessage())); return }
        setDriveToken(r.access_token, Number(r.expires_in) || LOGIN_TOKEN_SECONDS)
        resolve(r.access_token)
      },
      error_callback: e => reject(new DriveConnectError(popupMessage(e.type))),
    }).requestAccessToken()
  })
}

/** Tokenul valabil sau, dacă nu există, conectarea la Google Drive. Cererile simultane împart aceeași fereastră. */
export function ensureDriveToken(): Promise<string> {
  const token = getDriveToken()
  if (token) return Promise.resolve(token)
  pending ??= requestToken().finally(() => { pending = null })
  return pending
}
