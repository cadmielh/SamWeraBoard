import { lazy } from 'react'

// Paginile se descarcă separat (nu toate la prima deschidere). Funcțiile de import sunt păstrate aici ca
// meniul să le poată porni din timp, la trecerea cu mouse-ul peste legătură: la clic, codul e deja descărcat.
// După un deploy, fișierele vechi ale paginilor nu mai există: cine avea aplicația deschisă ar primi o eroare la
// prima navigare. Atunci reîncărcăm pagina o dată (codul nou se descarcă); a doua eroare la rând se arată normal.
const RELOAD_KEY = 'cabinio-chunk-reload'
function withReload<T>(load: () => Promise<T>): () => Promise<T> {
  return () => load().then(
    m => { try { sessionStorage.removeItem(RELOAD_KEY) } catch { /* fără stocare: nimic de curățat */ } return m },
    err => {
      // Fără sessionStorage nu putem ține minte reîncărcarea, deci nu reîncărcăm (ar putea intra în buclă).
      const already = (() => {
        try { const v = sessionStorage.getItem(RELOAD_KEY) === '1'; sessionStorage.setItem(RELOAD_KEY, '1'); return v } catch { return true }
      })()
      if (!already) window.location.reload()
      throw err
    },
  )
}

const loaders = {
  '/dosare': withReload(() => import('./pages/DosarePage')),
  '/sarcini': withReload(() => import('./pages/SarciniPage')),
  '/extragere': withReload(() => import('./pages/GenerareDocumentePage')),
  '/setari': withReload(() => import('./pages/SetariPage')),
  '/super-admin': withReload(() => import('./pages/SuperAdminPage')),
  '/workspace/setup': withReload(() => import('./pages/WorkspaceSetupPage')),
} as const

export const DosarePage = lazy(loaders['/dosare'])
export const SarciniPage = lazy(loaders['/sarcini'])
export const GenerareDocumentePage = lazy(loaders['/extragere'])
export const SetariPage = lazy(loaders['/setari'])
export const SuperAdminPage = lazy(loaders['/super-admin'])
export const WorkspaceSetupPage = lazy(loaders['/workspace/setup'])

/** Pornește descărcarea paginii de la `path` (ex. „/setari/plan”); browserul o păstrează, deci apelurile repetate nu costă. */
export function preloadRoute(path: string) {
  const key = (Object.keys(loaders) as (keyof typeof loaders)[]).find(k => path === k || path.startsWith(`${k}/`))
  if (key) void loaders[key]().catch(() => { /* rețea: pagina se încarcă oricum la clic */ })
}

/** După prima afișare, când browserul n-are altceva de făcut, descarcă în fundal paginile principale. */
export function preloadMainRoutesWhenIdle() {
  const run = () => ['/dosare', '/sarcini', '/extragere', '/setari'].forEach(preloadRoute)
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 5000 })
  else setTimeout(run, 2500)
}
