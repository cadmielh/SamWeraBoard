import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'FIREBASE-ID-TOKEN' } } }))
const driveUpload = vi.fn(async (_b: Blob, name: string) => ({ id: 'd1', name, webViewLink: 'https://drive.google.com/x' }))
const driveDownload = vi.fn()
vi.mock('./drive', async () => {
  const real = await vi.importActual<typeof import('./drive')>('./drive')
  return { ...real, driveUpload: (...a: unknown[]) => driveUpload(...(a as [Blob, string])), driveDownload: (...a: unknown[]) => driveDownload(...a) }
})
const pickAgain = vi.fn()
vi.mock('./picker', () => ({ pickAgain: (...a: unknown[]) => pickAgain(...a) }))

import { fillDocxFromBuiltinTemplate, fillDocxFromDriveTemplate, extractFile, apiErrorMessage, setApiWorkspace } from './api'
import { DriveError } from './drive'

type Call = { url: string; init: RequestInit }
let calls: Call[]
function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init) }))
}
const docx = (extra: Record<string, string> = {}) => new Response(new Blob(['DOCX']), { status: 200, headers: extra })

beforeEach(() => { vi.clearAllMocks(); setApiWorkspace('ws123') })
afterEach(() => { vi.unstubAllGlobals() })

describe('cereri către server', () => {
  it('trimit doar identitatea Firebase și workspace-ul — niciodată tokenul Google', async () => {
    mockFetch(() => docx())
    await fillDocxFromBuiltinTemplate('act_constitutiv', { CNP: '1' })
    const h = calls[0].init.headers as Record<string, string>
    expect(h).toEqual({ 'X-Firebase-Token': 'FIREBASE-ID-TOKEN', 'X-Workspace-Id': 'ws123' })
    expect(Object.keys(h).map(k => k.toLowerCase())).not.toContain('authorization')
  })

  it('OCR: raportează sursa doar pentru jurnal', async () => {
    mockFetch(() => new Response(JSON.stringify({ cnp: '' }), { status: 200 }))
    await extractFile(new File(['x'], 'ci.jpg'), 'drive')
    const fd = calls[0].init.body as FormData
    expect(fd.get('source')).toBe('drive')
    await extractFile(new File(['x'], 'ci.jpg'))
    expect((calls[1].init.body as FormData).get('source')).toBe('upload')
  })
})

describe('salvarea în Drive din browser', () => {
  it('fără Drive: întoarce doar fișierul, fără destinație și fără încărcare', async () => {
    mockFetch(() => docx({ 'Content-Disposition': 'attachment; filename=x.docx' }))
    const r = await fillDocxFromBuiltinTemplate('act_constitutiv', { A: 'b' }, null, 'x.docx')
    expect(r.blob).toBeInstanceOf(Blob)
    expect((calls[0].init.body as FormData).get('_destination')).toBeNull()
    expect(driveUpload).not.toHaveBeenCalled()
  })

  it('cu Drive: serverul primește doar „_destination=drive” (jurnal), iar încărcarea o face browserul, cu numele din antet', async () => {
    mockFetch(() => docx({ 'Content-Disposition': `attachment; filename=completat_Act%20Popescu.docx; filename*=UTF-8''completat_Act%20Popescu.docx` }))
    const r = await fillDocxFromBuiltinTemplate('act_constitutiv', { A: 'b' }, { token: 'ya29.google', folderId: 'folder12345' }, 'fallback.docx')
    expect((calls[0].init.body as FormData).get('_destination')).toBe('drive')
    expect(calls).toHaveLength(1)                                             // singura cerere către serverul nostru
    expect(driveUpload).toHaveBeenCalledTimes(1)
    const [, name, , folder, token] = driveUpload.mock.calls[0] as unknown[]
    expect(name).toBe('completat_Act Popescu.docx')
    expect(folder).toBe('folder12345')
    expect(token).toBe('ya29.google')
    expect(r).toEqual({ name: 'completat_Act Popescu.docx', link: 'https://drive.google.com/x' })
  })

  it('fără antet cu numele fișierului (CORS local) folosește numele dorit', async () => {
    mockFetch(() => docx())
    await fillDocxFromBuiltinTemplate('act_constitutiv', {}, { token: 't', folderId: null }, 'ales.docx')
    expect(driveUpload.mock.calls[0][1]).toBe('ales.docx')
  })
})

describe('șablon .docx din Drive', () => {
  const blob = new Blob(['TPL'])

  it('se descarcă în browser (cu tokenul Google) și doar conținutul ajunge la server ca șablon încărcat', async () => {
    driveDownload.mockResolvedValue({ blob, name: 'sablon', mimeType: 'application/octet-stream' })
    mockFetch(() => docx())
    await fillDocxFromDriveTemplate('tpl12345', { a: 'b' }, 'ya29.google', null)
    expect(driveDownload).toHaveBeenCalledWith('tpl12345', 'ya29.google')
    const fd = calls[0].init.body as FormData
    expect((fd.get('template') as File).name).toBe('sablon.docx')
    expect(fd.get('template_drive_id')).toBeNull()                            // serverul nu mai știe de Drive
  })

  it('dacă aplicația nu are acces (not_granted), cere confirmarea prin Picker și reîncearcă o dată', async () => {
    driveDownload
      .mockRejectedValueOnce(new DriveError('nu ai acces', 'not_granted', 404))
      .mockResolvedValueOnce({ blob, name: 'sablon.docx', mimeType: DOCX })
    pickAgain.mockResolvedValue({ id: 'tpl12345', name: 'sablon.docx', mimeType: DOCX })
    mockFetch(() => docx())
    await fillDocxFromDriveTemplate('tpl12345', {}, 'tok', null)
    expect(pickAgain).toHaveBeenCalledWith('tpl12345', 'tok')
    expect(driveDownload).toHaveBeenCalledTimes(2)
  })

  it('dacă utilizatorul refuză confirmarea, eroarea originală ajunge la el (fără bucle)', async () => {
    driveDownload.mockRejectedValue(new DriveError('nu ai acces', 'not_granted', 404))
    pickAgain.mockResolvedValue(null)
    mockFetch(() => docx())
    await expect(fillDocxFromDriveTemplate('tpl12345', {}, 'tok', null)).rejects.toMatchObject({ code: 'not_granted' })
    expect(driveDownload).toHaveBeenCalledTimes(1)
  })

  it('erorile de sesiune (auth) nu deschid Picker', async () => {
    driveDownload.mockRejectedValue(new DriveError('expirat', 'auth', 401))
    await expect(fillDocxFromDriveTemplate('tpl12345', {}, 'tok', null)).rejects.toMatchObject({ code: 'auth' })
    expect(pickAgain).not.toHaveBeenCalled()
  })
})
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('mesaje de eroare', () => {
  const res = (retry?: string) => new Response('{}', { status: 429, headers: retry ? { 'Retry-After': retry } : {} })
  it('limitare: spune peste cât timp se poate reîncerca', () => {
    expect(apiErrorMessage({ error: 'rate_limited' }, res('30'), 'x')).toContain('30 de secunde')
    expect(apiErrorMessage({ error: 'rate_limited' }, res('180'), 'x')).toContain('3 minute')
    expect(apiErrorMessage({ error: 'rate_limited' }, res(), 'x')).toContain('60 de secunde')
  })
  it('date personale nevalide și vault indisponibil: mesaje clare, nu coduri interne', () => {
    expect(apiErrorMessage({ error: 'invalid_person' }, res(), 'x')).toContain('format nevalid')
    expect(apiErrorMessage({ error: 'vault_unavailable' }, res(), 'x')).toContain('temporar indisponibil')
  })
  it('consimțământ lipsă și drepturi insuficiente', () => {
    expect(apiErrorMessage({ error: 'consent_required' }, res(), 'x')).toContain('accepte termenii')
    expect(apiErrorMessage({ error: 'Forbidden' }, res(), 'x')).toContain('drepturile necesare')
    expect(apiErrorMessage({ error: 'altceva' }, res(), 'x')).toBe('altceva')
    expect(apiErrorMessage(undefined, res(), 'implicit')).toBe('implicit')
  })
})
