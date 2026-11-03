import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { apiJson } from './api'
import type { WorkspaceBilling } from '../types'

export interface SuperAdminGrant {
  email: string
  used: boolean
}

function encodeEmail(email: string) {
  return email.replace(/\./g, '_DOT_').replace(/@/g, '_AT_')
}

/** Listează grant-urile de super admin existente — vizibilă din pagina de
 * super admin, permisă de regula de `read` din firestore.rules (orice super
 * admin poate lista toate). */
export async function listSuperAdminGrants(): Promise<SuperAdminGrant[]> {
  const snap = await getDocs(collection(db, 'superAdminGrants'))
  return snap.docs.map(d => ({ email: d.data().email as string, used: d.data().used === true }))
}

/** Creează un grant de super admin pentru un email — mirror al inviteMember()
 * din workspace.ts, dar pentru rolul de aplicație, nu pentru un workspace. */
export async function grantSuperAdmin(email: string, grantedByUid: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  await setDoc(doc(db, 'superAdminGrants', encodeEmail(normalizedEmail)), {
    email: normalizedEmail,
    grantedBy: grantedByUid,
    grantedAt: serverTimestamp(),
    used: false,
  })
}

/** Retrage un grant încă nefolosit: o adresă greșită nu trebuie să rămână activă. */
export async function revokeSuperAdminGrant(email: string): Promise<void> {
  await deleteDoc(doc(db, 'superAdminGrants', encodeEmail(email.trim().toLowerCase())))
}

/** Apelat la fiecare autentificare (mirror checkAndJoinInvitations) — dacă
 * există un grant valid, în așteptare, pentru emailul acestui user, îl
 * promovează la super admin și marchează grant-ul ca folosit. Non-blocking:
 * majoritatea userilor nu au niciun grant, deci nu fac nimic aici. */
export async function applyPendingSuperAdminGrant(uid: string, email: string): Promise<void> {
  const grantRef = doc(db, 'superAdminGrants', encodeEmail(email.trim().toLowerCase()))
  const grantSnap = await getDoc(grantRef)
  if (!grantSnap.exists() || grantSnap.data().used === true) return
  await updateDoc(doc(db, 'users', uid), { isSuperAdmin: true })
  await setDoc(grantRef, { used: true }, { merge: true })
}

/** Poate utilizatorul curent crea un cabinet nou (înregistrare pe invitație)? */
export const fetchSignupStatus = () => apiJson<{ canCreate: boolean; mode: 'open' | 'invite' }>('GET', '/signup/status')

// ── Abonamente (super admin) — vezi billing_api.py ───────────────────────────
export const adminExtendTrial = (workspaceId: string, days: number) =>
  apiJson<{ billing: WorkspaceBilling }>('POST', `/admin/workspaces/${workspaceId}/billing/extend-trial`, { days })

/** Acces gratuit până la `until` (AAAA-LL-ZZ, sfârșitul zilei); `null` îl retrage. */
export const adminSetComp = (workspaceId: string, until: string | null, reason?: string) =>
  apiJson<{ billing: WorkspaceBilling }>('POST', `/admin/workspaces/${workspaceId}/billing/comp`, { until, reason })

export interface DeletionPreview { counts: Record<string, number>; subscription: boolean; graceDays: number }

export const adminDeletionPreview = (workspaceId: string) =>
  apiJson<DeletionPreview>('GET', `/admin/workspaces/${workspaceId}/deletion-preview`)

/** Programează ștergerea sau, cu `immediate`, o face definitiv acum; `confirm` = numele exact al cabinetului. */
export const adminDeleteWorkspace = (workspaceId: string, confirm: string, immediate = false) =>
  apiJson<{ ok: boolean; deleted: boolean; deleteAfter?: string }>('POST', `/admin/workspaces/${workspaceId}/delete`, { confirm, immediate })

export const adminRestoreWorkspace = (workspaceId: string) =>
  apiJson<{ ok: boolean }>('POST', `/admin/workspaces/${workspaceId}/restore`)

export interface AccountDeletion { uid: string; email: string | null; deleteAfter: string | null; workspaces: number }

export const listAccountDeletions = () => apiJson<AccountDeletion[]>('GET', '/admin/account-deletions')

export const adminRestoreAccount = (uid: string) => apiJson<{ ok: boolean }>('POST', `/admin/account-deletions/${uid}/restore`)

export const adminSyncBilling = (workspaceId: string) =>
  apiJson<{ billing: WorkspaceBilling }>('POST', `/admin/workspaces/${workspaceId}/billing/sync`)

/** Semnale per cabinet; `cuiSeenInWorkspace`: același CUI a mai avut o perioadă de probă în alt cabinet. */
export const adminBillingOverview = () =>
  apiJson<{ id: string; cuiSeenInWorkspace?: string | null }[]>('GET', '/admin/billing/overview')

export interface WorkspaceCreator {
  id: string
  email: string
}

/** Adrese aprobate să creeze cabinete noi (înregistrare pe invitație) — doar prin API. */
export const listWorkspaceCreators = () => apiJson<WorkspaceCreator[]>('GET', '/signup/creators')
export const addWorkspaceCreator = (email: string) =>
  apiJson<WorkspaceCreator>('POST', '/signup/creators', { email: email.trim().toLowerCase() })
export const removeWorkspaceCreator = (id: string) => apiJson('DELETE', `/signup/creators/${id}`)
