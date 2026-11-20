import { lazy } from 'react'

// Paginile se descarcă separat (nu toate la prima deschidere). Funcțiile de import sunt păstrate aici ca
// meniul să le poată porni din timp, la trecerea cu mouse-ul peste legătură: la clic, codul e deja descărcat.
const loaders = {
  '/dosare': () => import('./pages/DosarePage'),
  '/sarcini': () => import('./pages/SarciniPage'),
  '/extragere': () => import('./pages/GenerareDocumentePage'),
  '/setari': () => import('./pages/SetariPage'),
  '/super-admin': () => import('./pages/SuperAdminPage'),
  '/workspace/setup': () => import('./pages/WorkspaceSetupPage'),
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
