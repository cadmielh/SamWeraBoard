import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { clientDemoId } from './clientDemo'
import { withViewTransition } from './viewTransition'
import { pasiObligatorii, type GhidPornire as Ghid } from './ghidPornire'

/** Ghidul se arată doar celor care pot lucra efectiv (nu vizualizatorilor, nu cabinetelor în citire). */
export function useGhidVizibil(): Ghid | null {
  const { ghid, canEdit } = useApp()
  return canEdit && ghid.incarcat ? ghid : null
}

/** Progresul ține cont doar de pașii obligatorii; cei opționali apar în listă, dar nu țin ghidul deschis. */
export function progresGhid(ghid: Ghid): { facuti: number; total: number } {
  const pasi = pasiObligatorii(ghid.pasi)
  return { facuti: pasi.filter(p => ghid.facuti.has(p.key)).length, total: pasi.length }
}

/** Creează (sau regăsește) clientul demo și deschide generarea direct pe el. */
export function useClientDemo() {
  const { user, activeWorkspace, toast } = useApp()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const creeaza = async () => {
    if (!activeWorkspace || busy) return
    setBusy(true)
    try {
      const id = await clientDemoId(activeWorkspace.id, user.uid)
      toast('Clientul demo e gata. Alege un șablon și generează documentul.', 'ok')
      withViewTransition(() => navigate(`/extragere?clientId=${encodeURIComponent(id)}&mode=client`))
    } catch (e) {
      toast((e as Error).message || 'Clientul demo nu a putut fi creat', 'err')
    } finally {
      setBusy(false)
    }
  }
  return { creeaza, busy }
}
