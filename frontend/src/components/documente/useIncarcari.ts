import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { incarcaFisier, verificaLocal, type EroareFisier } from '../../lib/fisiere'

export type StareIncarcare = 'asteptare' | 'incarcare' | 'pauza' | 'gata' | 'eroare' | 'duplicat'

export interface Incarcare {
  id: string
  file: File
  workspaceId: string
  clientId: string
  folderId: string | null
  stare: StareIncarcare
  progres: number
  mesaj?: string
  /** Eroare găsită în browser, înainte de trimitere (mărime, tip): reîncercarea n-ar schimba nimic. */
  local?: boolean
  /** La duplicat: unde există deja același conținut. */
  existent?: EroareFisier['existent']
  permiteDuplicat?: boolean
  /** Reluări automate după „prea multe cereri” (429). */
  reincercari?: number
}

const PARALEL = 3
const MAX_REINCERCARI = 5
const CURATARE_MS = 4000

// Coada trăiește în afara componentelor: încărcările continuă dacă utilizatorul deschide alt client sau altă pagină,
// iar la întoarcerea în fișă își vede progresul. Se pierde doar la reîncărcarea paginii (browserul oprește oricum cererile).
let items: Incarcare[] = []
const ascultatori = new Set<() => void>()
const controllers = new Map<string, AbortController>()
let seq = 0

function seteaza(next: Incarcare[]) {
  items = next
  ascultatori.forEach(l => l())
  porneste()
}

function patch(id: string, p: Partial<Incarcare>) {
  seteaza(items.map(it => it.id === id ? { ...it, ...p } : it))
}

function porneste() {
  const libere = PARALEL - items.filter(i => i.stare === 'incarcare').length
  const urmatoare = items.filter(i => i.stare === 'asteptare').slice(0, Math.max(0, libere))
  if (!urmatoare.length) return
  items = items.map(it => urmatoare.includes(it) ? { ...it, stare: 'incarcare', progres: 0, mesaj: undefined } : it)
  ascultatori.forEach(l => l())
  for (const it of urmatoare) {
    const ctrl = new AbortController()
    controllers.set(it.id, ctrl)
    incarcaFisier({ workspaceId: it.workspaceId, clientId: it.clientId, folderId: it.folderId, file: it.file, permiteDuplicat: it.permiteDuplicat },
      p => patch(it.id, { progres: p }), ctrl.signal)
      .then(() => patch(it.id, { stare: 'gata', progres: 1 }))
      .catch((e: EroareFisier) => {
        if (e.code === 'abort') return
        if (e.code === 'duplicat') patch(it.id, { stare: 'duplicat', existent: e.existent })
        else if (e.code === 'rate_limited' && (it.reincercari ?? 0) < MAX_REINCERCARI) {
          // Multe fișiere odată pot atinge limita de cereri: fișierul își reia singur locul în coadă după pauza cerută.
          patch(it.id, { stare: 'pauza', reincercari: (it.reincercari ?? 0) + 1 })
          setTimeout(() => { if (items.some(i => i.id === it.id && i.stare === 'pauza')) patch(it.id, { stare: 'asteptare' }) },
            (e.retryAfter ?? 2) * 1000)
        }
        else patch(it.id, { stare: 'eroare', mesaj: e.message })
      })
      .finally(() => controllers.delete(it.id))
  }
}

function subscribe(l: () => void) {
  ascultatori.add(l)
  return () => { ascultatori.delete(l) }
}

/** Coada de încărcare pentru un client: câte PARALEL fișiere odată (în toată aplicația), fiecare cu progresul și
 * eroarea lui. Erorile rămân până le închide utilizatorul; când totul a reușit, lista se golește după câteva secunde. */
export function useIncarcari(workspaceId: string | null, clientId: string) {
  const toate = useSyncExternalStore(subscribe, () => items)
  const ale = useMemo(() => toate.filter(i => i.workspaceId === workspaceId && i.clientId === clientId), [toate, workspaceId, clientId])

  const totulGata = ale.length > 0 && ale.every(i => i.stare === 'gata')
  useEffect(() => {
    if (!totulGata) return
    const ids = new Set(ale.map(i => i.id))
    const t = setTimeout(() => seteaza(items.filter(i => !(ids.has(i.id) && i.stare === 'gata'))), CURATARE_MS)
    return () => clearTimeout(t)
  }, [totulGata, ale])

  const adauga = useCallback((files: File[], folderId: string | null) => {
    if (!workspaceId) return
    seteaza([...items, ...files.map<Incarcare>(file => {
      const problema = verificaLocal(file)
      return { id: `u${++seq}`, file, workspaceId, clientId, folderId, progres: 0,
        stare: problema ? 'eroare' : 'asteptare', mesaj: problema ?? undefined, local: !!problema }
    })])
  }, [workspaceId, clientId])

  const reincearca = useCallback((id: string, permiteDuplicat = false) => {
    patch(id, { stare: 'asteptare', progres: 0, mesaj: undefined, existent: undefined, permiteDuplicat, reincercari: 0 })
  }, [])

  const renunta = useCallback((id: string) => {
    controllers.get(id)?.abort()
    seteaza(items.filter(i => i.id !== id))
  }, [])

  const inchideTerminate = useCallback(() => {
    const ids = new Set(ale.filter(i => i.stare === 'gata' || i.stare === 'eroare' || i.stare === 'duplicat').map(i => i.id))
    seteaza(items.filter(i => !ids.has(i.id)))
  }, [ale])

  return { items: ale, adauga, reincearca, renunta, inchideTerminate }
}

/** Doar pentru teste. */
export function _resetIncarcari() {
  for (const c of controllers.values()) c.abort()
  controllers.clear()
  items = []
}
