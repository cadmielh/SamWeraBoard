import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { driveDownload, driveUpload, fillGoogleDoc, driveMeta, DriveError, DOCX_MIME } from './drive'

const TOKEN = 'ya29.test-token'
type Call = { url: string; init?: RequestInit }
let calls: Call[]
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return handler(url, init) }))
}
const auth = (c: Call) => (c.init?.headers as Record<string, string>).Authorization

beforeEach(() => { vi.unstubAllGlobals() })
afterEach(() => { vi.unstubAllGlobals() })

describe('descărcare', () => {
  it('un fișier obișnuit se descarcă cu alt=media, cu tokenul în antet', async () => {
    mockFetch(url => url.includes('alt=media') ? new Response('BYTES') : json({ id: 'abc123', name: 'ci.jpg', mimeType: 'image/jpeg' }))
    const r = await driveDownload('abc123', TOKEN)
    expect(r.name).toBe('ci.jpg')
    expect(r.mimeType).toBe('image/jpeg')
    expect(await r.blob.text()).toBe('BYTES')
    expect(calls.every(c => auth(c) === `Bearer ${TOKEN}`)).toBe(true)
  })

  it('un document Google nativ se exportă în PDF', async () => {
    mockFetch(url => url.includes('/export') ? new Response('PDF') : json({ id: 'doc123', name: 'Act', mimeType: 'application/vnd.google-apps.document' }))
    const r = await driveDownload('doc123', TOKEN)
    expect(r.name).toBe('Act.pdf')
    expect(r.mimeType).toBe('application/pdf')
    expect(calls.at(-1)!.url).toContain('/files/doc123/export?mimeType=application%2Fpdf')
  })
})

describe('erori', () => {
  it.each([[401, 'auth'], [403, 'not_granted'], [404, 'not_granted'], [500, 'other']])('HTTP %i → %s', async (status, code) => {
    mockFetch(() => new Response('{}', { status }))
    const err = await driveMeta('abc123', TOKEN).catch(e => e)
    expect(err).toBeInstanceOf(DriveError)
    expect(err.code).toBe(code)
  })

  it('refuză identificatori care nu arată a id Google (nu construiește URL-uri din text liber)', async () => {
    mockFetch(() => json({}))
    for (const bad of ['../etc/passwd', 'a/b/c', 'abc def', 'x', '', 'a?b=c&d']) {
      await expect(driveMeta(bad, TOKEN)).rejects.toBeInstanceOf(DriveError)
    }
    expect(calls).toHaveLength(0)                                   // nicio cerere nu a plecat
  })
})

describe('încărcare', () => {
  it('trimite multipart cu metadate (nume + folder) și conținut, și întoarce linkul', async () => {
    mockFetch(() => json({ id: 'new123', name: 'act.docx', webViewLink: 'https://drive.google.com/file/d/new123/view' }))
    const out = await driveUpload(new Blob(['DOCX-CONTENT']), 'act.docx', DOCX_MIME, 'folder12345', TOKEN)
    expect(out).toEqual({ id: 'new123', name: 'act.docx', webViewLink: 'https://drive.google.com/file/d/new123/view' })
    const c = calls[0]
    expect(c.url).toContain('/upload/drive/v3/files?uploadType=multipart')
    expect(c.init?.method).toBe('POST')
    expect((c.init?.headers as Record<string, string>)['Content-Type']).toMatch(/^multipart\/related; boundary=swb/)
    const body = await (c.init!.body as Blob).text()
    expect(body).toContain('"name":"act.docx"')
    expect(body).toContain('"parents":["folder12345"]')
    expect(body).toContain('DOCX-CONTENT')
    expect(body).toContain(DOCX_MIME)
  })

  it('fără folder nu trimite `parents` (rădăcina Drive)', async () => {
    mockFetch(() => json({ id: 'n1234', name: 'x.docx' }))
    const out = await driveUpload(new Blob(['x']), 'x.docx', DOCX_MIME, null, TOKEN)
    expect(out.webViewLink).toBe('')
    expect(await (calls[0].init!.body as Blob).text()).not.toContain('parents')
  })
})

describe('completarea unui șablon Google Docs', () => {
  it('copiază șablonul, înlocuiește textele doar în copie și întoarce linkul copiei', async () => {
    mockFetch((url, init) => {
      if (url.includes('/documents/tpl12345?fields=title')) return json({ title: 'Act constitutiv' })
      if (url.includes('/files/tpl12345/copy')) return json({ id: 'copy12345', webViewLink: 'https://docs.google.com/document/d/copy12345/edit' })
      if (url.includes('/documents/copy12345:batchUpdate')) return json({})
      throw new Error(`neașteptat: ${url} ${init?.method}`)
    })
    const out = await fillGoogleDoc('tpl12345', { '{{NUME}}': 'Popescu', '{{GOL}}': '' }, undefined, TOKEN)
    expect(out).toEqual({ docId: 'copy12345', link: 'https://docs.google.com/document/d/copy12345/edit' })

    const copy = calls.find(c => c.url.includes('/copy'))!
    expect(JSON.parse(copy.init!.body as string)).toEqual({ name: 'Completat - Act constitutiv' })
    const batch = calls.find(c => c.url.includes(':batchUpdate'))!
    expect(JSON.parse(batch.init!.body as string).requests).toEqual([
      { replaceAllText: { containsText: { text: '{{NUME}}', matchCase: true }, replaceText: 'Popescu' } },   // valorile goale nu se trimit
    ])
    expect(calls.some(c => c.url.includes('/documents/tpl12345:batchUpdate'))).toBe(false)                  // originalul nu se atinge
  })

  it('respectă numele dorit și nu apelează batchUpdate dacă nu e nimic de înlocuit', async () => {
    mockFetch(url => url.includes('fields=title') ? json({ title: 'T' }) : json({ id: 'copy99999', webViewLink: 'l' }))
    await fillGoogleDoc('tpl12345', {}, 'Numele meu', TOKEN)
    expect(JSON.parse(calls.find(c => c.url.includes('/copy'))!.init!.body as string).name).toBe('Numele meu')
    expect(calls.some(c => c.url.includes('batchUpdate'))).toBe(false)
  })

  it('un șablon la care aplicația nu are acces dă eroare `not_granted` (interfața cere alegerea lui)', async () => {
    mockFetch(() => new Response('{}', { status: 404 }))
    await expect(fillGoogleDoc('tpl12345', { a: 'b' }, undefined, TOKEN)).rejects.toMatchObject({ code: 'not_granted' })
  })
})
