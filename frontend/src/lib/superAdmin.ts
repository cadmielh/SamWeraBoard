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

/** Credite gratuite (`amount` > 0, valabile 12 luni) sau ajustare negativă (ex. după o rambursare). */
export const adminCredits = (workspaceId: string, amount: number, reason: string) =>
  apiJson<{ billing: WorkspaceBilling }>('POST', `/admin/workspaces/${workspaceId}/billing/credits`, { amount, reason })

// ── Încasări (tabloul din super admin) ───────────────────────────────────────
export interface PaymentRow {
  id: string
  kind: 'subscription' | 'credits' | 'refund' | 'dispute'
  workspaceId: string
  workspaceName: string
  billingName: string
  cui: string
  stripeCustomerId: string | null
  at: string | null
  /** Bani (RON × 100); negativ la rambursări. */
  amount: number
  currency: string | null
  interval?: 'month' | 'year' | null
  periodStart?: string | null
  periodEnd?: string | null
  stripeNumber?: string | null
  pack?: string
  credits?: number
  status?: string
  reason?: string
  invoice?: { status: string | null; number: string | null; at: string | null }
  /** Din tranzacția de sold Stripe (bani): brut, comisionul Stripe și net; lipsesc până se pot citi. */
  gross?: number
  fee?: number
  net?: number
  feeCurrency?: string | null
  /** Defalcarea comisionului de la Stripe (ex. stripe_fee); lipsește la plățile citite înainte de această versiune. */
  feeDetails?: { type: string | null; amount: number; description: string | null }[]
}

/** `feesUnavailable`: cheia Stripe nu are drept de citire pe tranzacții, deci comisioanele lipsesc. */
export const adminBillingPayments = () =>
  apiJson<{ rows: PaymentRow[]; feesUnavailable: boolean }>('GET', '/admin/billing/payments')

/** Comision Stripe din afara plăților: Stripe Billing (reținut periodic) sau taxa unei dispute. `amount` în bani. */
export interface AccountFee {
  id: string
  at: string | null
  category: 'billing' | 'dispute' | 'stripe'
  amount: number
  currency: string | null
  description: string | null
}

/** Pentru intervalul [from, to), date AAAA-LL-ZZ (ora României); fără ele, tot istoricul. */
export const adminStripeFees = (from?: string, to?: string) => {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  return apiJson<{ items: AccountFee[]; unavailable: boolean }>('GET', `/admin/billing/stripe-fees${q.size ? `?${q}` : ''}`)
}

/** Factura emisă manual în SmartBill: `number` = seria și numărul; `null` o demarchează. */
export const adminMarkInvoiced = (row: PaymentRow, number: string | null) =>
  apiJson<{ ok: boolean; invoice: NonNullable<PaymentRow['invoice']> }>(
    'POST', `/admin/billing/payments/${row.workspaceId}/${row.kind}/${row.id}/invoice`, { number })

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

// ── Activitatea cabinetelor (din jurnalul de acces; vezi activity_api.py) ─────

/** O zi din seria de activitate a unui cabinet (ora României). */
export interface ActivityDay { day: string; documents: number; scans: number; activeUsers: number }

export interface WorkspaceActivity {
  series: ActivityDay[]
  /** Ultima acțiune a unui om din cabinet (oricând în ultimele ~13 luni), ISO. */
  lastEventAt: string | null
  /** Utilizatori distincți cu acțiuni în fereastră. */
  activeUsers: number
  clients: number
  dosare: number
}

/** Serverul calculează statisticile o dată pe zi și le păstrează; `refresh` le recalculează acum (citește tot jurnalul). */
export const adminActivity = (days = 90, refresh = false) =>
  apiJson<{ days: number; today: string; computedAt: string; workspaces: Record<string, WorkspaceActivity> }>(
    'GET', `/admin/activity?days=${days}${refresh ? '&refresh=1' : ''}`)

export type EngagementKey = 'nou' | 'activ' | 'incetineste' | 'inactiv'
export interface Engagement { key: EngagementKey; label: string; daysSince: number | null }

/** Cât de folosit e cabinetul: după ultima acțiune a unui om din el (generări, scanări, accesări, invitații…). */
export function engagementOf(a: WorkspaceActivity | undefined, createdAt: Date | null, now: Date = new Date()): Engagement {
  const last = a?.lastEventAt ? new Date(a.lastEventAt) : null
  const daysSince = last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null
  const ageDays = createdAt ? (now.getTime() - createdAt.getTime()) / 86_400_000 : Infinity
  if (ageDays <= 3 && (daysSince === null || daysSince <= 3)) return { key: 'nou', label: 'Nou', daysSince }
  if (daysSince !== null && daysSince <= 3) return { key: 'activ', label: 'Activ', daysSince }
  if (daysSince !== null && daysSince <= 13) return { key: 'incetineste', label: 'Încetinește', daysSince }
  return { key: 'inactiv', label: 'Inactiv', daysSince }
}

/** Totalurile unei serii (ultimele `days` zile din ea). */
export function activityTotals(series: ActivityDay[], days: number) {
  const s = series.slice(-days)
  return {
    activeDays: s.filter(d => d.activeUsers > 0).length,
    documents: s.reduce((n, d) => n + d.documents, 0),
    scans: s.reduce((n, d) => n + d.scans, 0),
  }
}
