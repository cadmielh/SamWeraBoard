import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pickIdDocument, pickFolder, pickGoogleDoc, pickAgain, pickerConfigured, PickerNotConfigured, type PickerNamespace } from './picker'

const CFG = { apiKey: 'AIza-test', appId: '1000687240483' }

// Un „Google Picker” fals care înregistrează cum e configurat.
let built: { views: Record<string, unknown>[]; appId?: string; token?: string; key?: string; locale?: string; title?: string; cb?: (r: unknown) => void }
function installFakePicker() {
  built = { views: [] }
  class DocsView {
    cfg: Record<string, unknown> = {}
    constructor(id?: unknown) { this.cfg.viewId = id }
    setMimeTypes(m: string) { this.cfg.mime = m; return this }
    setSelectFolderEnabled(v: boolean) { this.cfg.selectFolder = v; return this }
    setIncludeFolders(v: boolean) { this.cfg.includeFolders = v; return this }
    setFileIds(ids: string) { this.cfg.fileIds = ids; return this }
    setMode(m: unknown) { this.cfg.mode = m; return this }
  }
  class PickerBuilder {
    setAppId(v: string) { built.appId = v; return this }
    setOAuthToken(v: string) { built.token = v; return this }
    setDeveloperKey(v: string) { built.key = v; return this }
    setLocale(v: string) { built.locale = v; return this }
    setTitle(v: string) { built.title = v; return this }
    addView(v: DocsView) { built.views.push(v.cfg); return this }
    setCallback(cb: (r: unknown) => void) { built.cb = cb; return this }
    build() { return { setVisible: (v: boolean) => { if (v) queueMicrotask(() => built.cb?.({ action: 'noop' })) } } }
  }
  const picker: PickerNamespace = {
    ViewId: { DOCS: 'DOCS', FOLDERS: 'FOLDERS', DOCUMENTS: 'DOCUMENTS' },
    DocsViewMode: { LIST: 'LIST' },
    Action: { PICKED: 'picked', CANCEL: 'cancel' },
    DocsView: DocsView as unknown as PickerNamespace['DocsView'],
    PickerBuilder: PickerBuilder as unknown as PickerNamespace['PickerBuilder'],
  }
  vi.stubGlobal('window', { google: { picker } })
}
const settle = () => new Promise(r => setTimeout(r, 0))

beforeEach(installFakePicker)
afterEach(() => { vi.unstubAllGlobals() })

describe('configurare', () => {
  it('cere ambele valori (cheie API și id-ul aplicației)', () => {
    expect(pickerConfigured(CFG)).toBe(true)
    expect(pickerConfigured({ apiKey: '', appId: '1' })).toBe(false)
    expect(pickerConfigured({ apiKey: 'k', appId: '' })).toBe(false)
  })
  it('nefiind configurat, refuză cu un mesaj clar (fără să deschidă nimic)', async () => {
    await expect(pickIdDocument('tok', { apiKey: '', appId: '' })).rejects.toBeInstanceOf(PickerNotConfigured)
    expect(built.views).toHaveLength(0)
  })
})

describe('deschiderea ferestrei', () => {
  it('trimite tokenul, cheia și appId (necesar pentru accesul drive.file) și restrânge la imagini/PDF', async () => {
    const p = pickIdDocument('ya29.tok', CFG)
    await settle()
    expect(built).toMatchObject({ appId: CFG.appId, token: 'ya29.tok', key: CFG.apiKey, locale: 'ro' })
    expect(built.views[0]).toMatchObject({ viewId: 'DOCS', mime: 'image/jpeg,image/png,image/webp,application/pdf' })
    built.cb!({ action: 'picked', docs: [{ id: 'f1', name: 'ci.jpg', mimeType: 'image/jpeg' }] })
    expect(await p).toEqual({ id: 'f1', name: 'ci.jpg', mimeType: 'image/jpeg' })
  })

  it('anularea întoarce null', async () => {
    const p = pickFolder('tok', CFG)
    await settle()
    built.cb!({ action: 'cancel' })
    expect(await p).toBeNull()
  })

  it('folderul: vedere de foldere cu selectarea folderelor activată', async () => {
    const p = pickFolder('tok', CFG)
    await settle()
    expect(built.views[0]).toMatchObject({ viewId: 'FOLDERS', selectFolder: true, includeFolders: true, mime: 'application/vnd.google-apps.folder' })
    built.cb!({ action: 'picked', docs: [{ id: 'fold1', name: 'Acte', mimeType: 'application/vnd.google-apps.folder' }] })
    expect((await p)?.id).toBe('fold1')
  })

  it('șablonul Google Docs și reconfirmarea accesului la un fișier anume', async () => {
    const p1 = pickGoogleDoc('tok', CFG)
    await settle()
    expect(built.views[0]).toMatchObject({ viewId: 'DOCUMENTS' })
    built.cb!({ action: 'cancel' })
    await p1

    installFakePicker()
    const p2 = pickAgain('tpl12345', 'tok', CFG)
    await settle()
    expect(built.views[0]).toMatchObject({ viewId: 'DOCS', fileIds: 'tpl12345' })
    built.cb!({ action: 'cancel' })
    await p2
  })
})
