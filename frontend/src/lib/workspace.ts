import { useState, useEffect, useCallback } from 'react'
import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, updateDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import { apiJson } from './api'
import { TOS_VERSION, DPA_VERSION } from './legal'
import type { FacturareConfig, Workspace, WorkspaceRole } from '../types'
import type { FeatureKey } from './features'

export interface PendingInvitation {
  id: string
  workspaceName: string
  role: WorkspaceRole
  invitedByEmail: string
}

export interface WorkspaceInvite {
  id: string
  email: string
  role: WorkspaceRole
}

/** Scrie flag-ul de feature pe un workspace, indiferent dacă apelantul e
 * membru al lui — permisă super adminilor pe orice workspace (vezi
 * `isSuperAdmin()` din firestore.rules, scopat strict la câmpul `features`).
 * Funcție simplă, fără state de hook, ca să poată fi folosită atât din
 * `useWorkspace` (workspace-urile proprii) cât și din pagina de super admin
 * (toate workspace-urile). */
export async function writeWorkspaceFeature(workspaceId: string, key: FeatureKey, enabled: boolean): Promise<void> {
  await updateDoc(doc(db, 'workspaces', workspaceId), { [`features.${key}`]: enabled })
}

/** Toate workspace-urile din aplicație — doar pentru super admini (vezi
 * regula `allow read: if isSuperAdmin()` pe `workspaces/{wid}`), folosită de
 * pagina de super admin pentru vizibilitate completă, nu doar pe workspace-urile
 * proprii. */
export async function listAllWorkspaces(): Promise<Workspace[]> {
  const snap = await getDocs(collection(db, 'workspaces'))
  return snap.docs.map(d => ({ ...d.data(), id: d.id } as Workspace))
}

export function useWorkspace(uid: string | null) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [loading, setLoading] = useState(true)
  // Încărcarea a eșuat (rețea, permisiuni): NU înseamnă „nu ai spații de lucru” și nu trebuie să ducă la ecranul de creare.
  const [loadError, setLoadError] = useState(false)

  const loadWorkspaces = useCallback(async () => {
    if (!uid) { setWorkspaces([]); setActiveWorkspaceState(null); setIsSuperAdmin(false); return }
    setLoading(true)
    setLoadError(false)
    try {
      const q = query(collection(db, 'workspaces'), where(`members.${uid}.role`, 'in', ['admin', 'member', 'viewer']))
      const snap = await getDocs(q)
      const list: Workspace[] = snap.docs.map(d => ({ ...d.data(), id: d.id } as Workspace))
      setWorkspaces(list)

      // Profilul utilizatorului (workspace activ, super admin) se citește separat: dacă eșuează,
      // spațiile de lucru deja încărcate rămân disponibile.
      let activeId: string | undefined
      let superAdmin = false
      try {
        const userDoc = await getDoc(doc(db, 'users', uid))
        activeId = userDoc.data()?.activeWorkspaceId as string | undefined
        superAdmin = userDoc.data()?.isSuperAdmin === true
      } catch (e) {
        console.error('useWorkspace user profile error', e)
      }
      setActiveWorkspaceState(list.find(w => w.id === activeId) ?? list[0] ?? null)
      setIsSuperAdmin(superAdmin)
    } catch (e) {
      console.error('useWorkspace load error', e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [uid])

  // Încarcă spațiile de lucru ale utilizatorului la mount / schimbare uid.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadWorkspaces() }, [loadWorkspaces])

  const setActiveWorkspace = useCallback(async (workspace: Workspace) => {
    setActiveWorkspaceState(workspace)
    if (uid) {
      await setDoc(doc(db, 'users', uid), { activeWorkspaceId: workspace.id }, { merge: true })
    }
  }, [uid])

  /** Creează un workspace prin API (serverul înregistrează consimțământul la
   * T&C + DPA). Clienții nu pot crea workspace-uri direct în Firestore. */
  const createWorkspace = useCallback(async (name: string) => {
    const { id } = await apiJson<{ id: string }>('POST', '/workspaces', {
      name,
      consent: { tos: TOS_VERSION, dpa: DPA_VERSION },
    })
    await loadWorkspaces()
    return id
  }, [loadWorkspaces])

  /** Adminul acceptă versiunea curentă a termenilor și DPA pentru un workspace (ex. unul migrat). */
  const acceptConsent = useCallback(async (workspaceId: string) => {
    await apiJson('POST', `/workspaces/${workspaceId}/consent`, { tos: TOS_VERSION, dpa: DPA_VERSION })
    await loadWorkspaces()
  }, [loadWorkspaces])

  const inviteMember = useCallback(async (workspaceId: string, email: string, role: WorkspaceRole) => {
    await apiJson('POST', `/workspaces/${workspaceId}/invites`, { email: email.trim().toLowerCase(), role })
  }, [])

  const listWorkspaceInvites = useCallback(
    (workspaceId: string) => apiJson<WorkspaceInvite[]>('GET', `/workspaces/${workspaceId}/invites`), [])

  const revokeInvite = useCallback(async (workspaceId: string, inviteId: string) => {
    await apiJson('DELETE', `/workspaces/${workspaceId}/invites/${inviteId}`)
  }, [])

  const removeMember = useCallback(async (workspaceId: string, memberUid: string) => {
    await apiJson('DELETE', `/workspaces/${workspaceId}/members/${memberUid}`)
    await loadWorkspaces()
  }, [loadWorkspaces])

  const changeMemberRole = useCallback(async (workspaceId: string, memberUid: string, role: WorkspaceRole) => {
    await apiJson('PATCH', `/workspaces/${workspaceId}/members/${memberUid}`, { role })
    await loadWorkspaces()
  }, [loadWorkspaces])

  const renameWorkspace = useCallback(async (workspaceId: string, newName: string) => {
    await updateDoc(doc(db, 'workspaces', workspaceId), { name: newName })
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, name: newName } : w))
    setActiveWorkspaceState(prev => prev?.id === workspaceId ? { ...prev, name: newName } : prev)
  }, [])

  const updateFacturareConfig = useCallback(async (workspaceId: string, config: FacturareConfig) => {
    await updateDoc(doc(db, 'workspaces', workspaceId), { facturareConfig: config })
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, facturareConfig: config } : w))
    setActiveWorkspaceState(prev => prev?.id === workspaceId ? { ...prev, facturareConfig: config } : prev)
  }, [])

  const setWorkspaceFeature = useCallback(async (workspaceId: string, key: FeatureKey, enabled: boolean) => {
    await writeWorkspaceFeature(workspaceId, key, enabled)
    const patch = (w: Workspace): Workspace => ({ ...w, features: { ...w.features, [key]: enabled } })
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? patch(w) : w))
    setActiveWorkspaceState(prev => prev?.id === workspaceId ? patch(prev) : prev)
  }, [])

  /** Invitațiile în așteptare pentru e-mailul utilizatorului. Nu se acceptă
   * niciodată automat — utilizatorul vede cine l-a invitat și decide. */
  const loadInvitations = useCallback(async () => {
    if (!uid) { setInvitations([]); return }
    try {
      setInvitations(await apiJson<PendingInvitation[]>('GET', '/invitations'))
    } catch {
      setInvitations([])
    }
  }, [uid])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadInvitations() }, [loadInvitations])

  const acceptInvitation = useCallback(async (id: string) => {
    await apiJson('POST', `/invitations/${id}/accept`)
    await Promise.all([loadWorkspaces(), loadInvitations()])
  }, [loadWorkspaces, loadInvitations])

  const declineInvitation = useCallback(async (id: string) => {
    await apiJson('POST', `/invitations/${id}/decline`)
    await loadInvitations()
  }, [loadInvitations])

  return {
    workspaces,
    activeWorkspace,
    isSuperAdmin,
    invitations,
    loading,
    loadError,
    setActiveWorkspace,
    createWorkspace,
    acceptConsent,
    inviteMember,
    listWorkspaceInvites,
    revokeInvite,
    removeMember,
    changeMemberRole,
    renameWorkspace,
    updateFacturareConfig,
    setWorkspaceFeature,
    acceptInvitation,
    declineInvitation,
    reload: loadWorkspaces,
  }
}
