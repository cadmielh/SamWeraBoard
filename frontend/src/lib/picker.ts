/** Google Picker: fereastra oficială Google prin care utilizatorul alege fișiere/foldere din Drive.
 *
 * Alegerea prin Picker (cu `setAppId`) acordă aplicației acces la fișierul ales sub permisiunea `drive.file`,
 * fără să vedem restul Drive-ului. Cere o cheie API (Picker) și numărul proiectului Google Cloud:
 * `VITE_GOOGLE_API_KEY` și `VITE_GOOGLE_APP_ID` (vezi docs/google-drive.md). */
import type { DriveItem } from './drive'

interface PickerDoc { id: string; name: string; mimeType: string }
interface PickerResponse { action: string; docs?: PickerDoc[] }
interface DocsViewLike {
  setMimeTypes(m: string): DocsViewLike
  setSelectFolderEnabled(v: boolean): DocsViewLike
  setIncludeFolders(v: boolean): DocsViewLike
  setFileIds(ids: string): DocsViewLike
  setMode(m: unknown): DocsViewLike
  setParent(id: string): DocsViewLike
  setOwnedByMe(v: boolean): DocsViewLike
}
interface PickerBuilderLike {
  setAppId(id: string): PickerBuilderLike
  setOAuthToken(t: string): PickerBuilderLike
  setDeveloperKey(k: string): PickerBuilderLike
  setLocale(l: string): PickerBuilderLike
  setTitle(t: string): PickerBuilderLike
  addView(v: DocsViewLike): PickerBuilderLike
  setCallback(cb: (r: PickerResponse) => void): PickerBuilderLike
  build(): { setVisible(v: boolean): void }
}
export interface PickerNamespace {
  ViewId: { DOCS: unknown; FOLDERS: unknown; DOCUMENTS: unknown }
  DocsViewMode: { LIST: unknown }
  Action: { PICKED: string; CANCEL: string }
  DocsView: new (viewId?: unknown) => DocsViewLike
  PickerBuilder: new () => PickerBuilderLike
}
interface PickerWindow {
  gapi?: { load(name: string, opts: { callback: () => void; onerror?: () => void }): void }
  google?: { picker?: PickerNamespace }
}

export interface PickerConfig { apiKey: string; appId: string }

export const DEFAULT_PICKER_CONFIG: PickerConfig = {
  apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? '',
  appId: import.meta.env.VITE_GOOGLE_APP_ID ?? '',
}

export function pickerConfigured(cfg: PickerConfig = DEFAULT_PICKER_CONFIG): boolean {
  return !!(cfg.apiKey && cfg.appId)
}

export class PickerNotConfigured extends Error {
  constructor() {
    super('Alegerea din Google Drive nu este configurată. Încarcă fișierul de pe dispozitiv sau cere administratorului aplicației să o activeze.')
    this.name = 'PickerNotConfigured'
  }
}

let loading: Promise<void> | null = null

/** Încarcă biblioteca Google Picker (o singură dată). */
export function loadPicker(): Promise<void> {
  const w = window as unknown as PickerWindow
  if (w.google?.picker) return Promise.resolve()
  if (loading) return loading
  loading = new Promise<void>((resolve, reject) => {
    const fail = () => { loading = null; reject(new Error('Nu s-a putut încărca Google Picker. Verifică conexiunea și reîncearcă.')) }
    const s = document.createElement('script')
    s.src = 'https://apis.google.com/js/api.js'
    s.async = true
    s.onload = () => (window as unknown as PickerWindow).gapi!.load('picker', { callback: () => resolve(), onerror: fail })
    s.onerror = fail
    document.head.appendChild(s)
  })
  return loading
}

type ViewBuilder = (g: PickerNamespace) => DocsViewLike | DocsViewLike[]

async function open(
  token: string, title: string, buildView: ViewBuilder, cfg: PickerConfig,
): Promise<DriveItem | null> {
  if (!pickerConfigured(cfg)) throw new PickerNotConfigured()
  await loadPicker()
  const g = (window as unknown as PickerWindow).google!.picker!
  return new Promise<DriveItem | null>(resolve => {
    const builder = new g.PickerBuilder()
      .setAppId(cfg.appId)               // necesar ca alegerea să acorde acces sub `drive.file`
      .setOAuthToken(token)
      .setDeveloperKey(cfg.apiKey)
      .setLocale('ro')
      .setTitle(title)
    const views = buildView(g)
    for (const v of Array.isArray(views) ? views : [views]) builder.addView(v)
    const picker = builder
      .setCallback((r: PickerResponse) => {
        if (r.action === g.Action.PICKED && r.docs?.[0]) {
          const d = r.docs[0]
          resolve({ id: d.id, name: d.name, mimeType: d.mimeType })
        } else if (r.action === g.Action.CANCEL) {
          resolve(null)
        }
      })
      .build()
    picker.setVisible(true)
  })
}

const IMAGE_OR_PDF = 'image/jpeg,image/png,image/webp,application/pdf'

/** Alege un act de identitate (imagine sau PDF) pentru OCR. */
export function pickIdDocument(token: string, cfg: PickerConfig = DEFAULT_PICKER_CONFIG) {
  return open(token, 'Alege actul de identitate', g => new g.DocsView(g.ViewId.DOCS).setMimeTypes(IMAGE_OR_PDF).setMode(g.DocsViewMode.LIST), cfg)
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Alege folderul în care se salvează documentele generate. Prima filă e „Drive-ul meu”, de unde se intră folder cu folder
 * (ca în Drive); a doua arată folderele partajate cu tine. Vederea plată „Foldere” (toate, amestecate) nu se mai folosește. */
export function pickFolder(token: string, cfg: PickerConfig = DEFAULT_PICKER_CONFIG) {
  return open(token, 'Alege folderul de destinație', g => [
    new g.DocsView(g.ViewId.DOCS).setParent('root').setIncludeFolders(true).setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME).setMode(g.DocsViewMode.LIST),
    new g.DocsView(g.ViewId.DOCS).setOwnedByMe(false).setIncludeFolders(true).setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME).setMode(g.DocsViewMode.LIST),
  ], cfg)
}

/** Alege un șablon Google Docs. */
export function pickGoogleDoc(token: string, cfg: PickerConfig = DEFAULT_PICKER_CONFIG) {
  return open(token, 'Alege șablonul Google Docs', g => new g.DocsView(g.ViewId.DOCUMENTS), cfg)
}

/** Cere din nou acces la un fișier anume (utilizator care nu l-a ales încă, ex. șablon partajat între colegi). */
export function pickAgain(fileId: string, token: string, cfg: PickerConfig = DEFAULT_PICKER_CONFIG) {
  return open(token, 'Confirmă accesul la fișier', g => new g.DocsView(g.ViewId.DOCS).setFileIds(fileId), cfg)
}
