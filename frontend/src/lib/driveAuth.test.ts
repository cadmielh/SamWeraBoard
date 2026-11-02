import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearDriveToken, DriveConnectError, DRIVE_SCOPE, ensureDriveToken, getDriveToken, setDriveLoginHint, setDriveToken } from './driveAuth'

type Cfg = {
  client_id: string; scope: string; login_hint?: string; prompt: string
  callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void
  error_callback: (e: { type?: string }) => void
}
let cfg: Cfg
let requests: number

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
  vi.stubEnv('VITE_GOOGLE_OAUTH_CLIENT_ID', 'client.apps.googleusercontent.com')
  requests = 0
  vi.stubGlobal('window', {
    google: { accounts: { oauth2: { initTokenClient: (c: Cfg) => { cfg = c; return { requestAccessToken: () => { requests++ } } } } } },
  })
  setDriveLoginHint('')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

const flush = () => new Promise(r => setTimeout(r))

describe('tokenul Drive', () => {
  it('tokenul de la login se folosește fără nicio fereastră', async () => {
    setDriveToken('login-token')
    await expect(ensureDriveToken()).resolves.toBe('login-token')
    expect(requests).toBe(0)
  })

  it('un token expirat sau fără expirare (sesiune veche) nu se mai folosește', () => {
    vi.useFakeTimers()
    setDriveToken('t', 120)
    expect(getDriveToken()).toBe('t')
    vi.advanceTimersByTime(61_000)
    expect(getDriveToken()).toBe('')
    sessionStorage.setItem('gat', 'vechi')
    sessionStorage.removeItem('gat_exp')
    expect(getDriveToken()).toBe('')
  })

  it('fără token cere doar `drive.file`, cu contul propus, și păstrează răspunsul', async () => {
    setDriveLoginHint('ana@ex.ro')
    const p = ensureDriveToken()
    await flush()
    expect(cfg).toMatchObject({ client_id: 'client.apps.googleusercontent.com', scope: DRIVE_SCOPE, login_hint: 'ana@ex.ro', prompt: '' })
    cfg.callback({ access_token: 'nou', expires_in: 3599 })
    await expect(p).resolves.toBe('nou')
    expect(getDriveToken()).toBe('nou')
  })

  it('cererile simultane deschid o singură fereastră', async () => {
    const a = ensureDriveToken()
    const b = ensureDriveToken()
    await flush()
    expect(requests).toBe(1)
    cfg.callback({ access_token: 'nou', expires_in: 3599 })
    await expect(Promise.all([a, b])).resolves.toEqual(['nou', 'nou'])
  })

  it.each([
    ['popup_failed_to_open', /pop-up/],
    ['popup_closed', /anulată/],
  ])('eroarea %s are mesaj clar, iar următoarea încercare pornește din nou', async (type, msg) => {
    const p = ensureDriveToken()
    await flush()
    cfg.error_callback({ type })
    await expect(p).rejects.toThrow(msg)
    const retry = ensureDriveToken()
    await flush()
    expect(requests).toBe(2)
    cfg.callback({ access_token: 'nou', expires_in: 3599 })
    await expect(retry).resolves.toBe('nou')
  })

  it('refuzul permisiunii nu salvează nimic', async () => {
    const p = ensureDriveToken()
    await flush()
    cfg.callback({ error: 'access_denied' })
    await expect(p).rejects.toBeInstanceOf(DriveConnectError)
    expect(getDriveToken()).toBe('')
  })

  it('fără client OAuth configurat dă eroare, fără fereastră', async () => {
    vi.stubEnv('VITE_GOOGLE_OAUTH_CLIENT_ID', '')
    await expect(ensureDriveToken()).rejects.toThrow(/nu este configurată/)
    expect(requests).toBe(0)
  })

  it('deconectarea șterge tokenul', () => {
    setDriveToken('t')
    clearDriveToken()
    expect(getDriveToken()).toBe('')
  })
})
