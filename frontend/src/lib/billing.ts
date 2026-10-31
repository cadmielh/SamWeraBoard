import { apiJson, notifySubscriptionRequired } from './api'
import type { BillingTime, WorkspaceBilling } from '../types'

export { SUBSCRIPTION_REQUIRED_EVENT } from './api'

const DAY_MS = 86_400_000

export function toDate(v: BillingTime | undefined): Date | null {
  if (!v) return null
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return typeof v.toDate === 'function' ? v.toDate() : null
}

export type AccessReason = 'trial' | 'subscription' | 'past_due' | 'comp' | 'expired'

export interface BillingAccess {
  /** Acces complet: creare/modificare, scanare, AI, generare documente. */
  full: boolean
  reason: AccessReason
  accessUntil: Date | null
  /** Zile întregi rămase până la accessUntil (rotunjit în sus); null fără acces. */
  daysLeft: number | null
  hasSubscription: boolean
  cancelAtPeriodEnd: boolean
  interval: 'month' | 'year' | null
  currentPeriodEnd: Date | null
}

/** Oglinda lui billing.has_full_access (server) și billingOk (reguli Firestore): compară doar accessUntil. */
export function billingAccess(b: WorkspaceBilling | undefined, now: Date = new Date()): BillingAccess {
  const accessUntil = toDate(b?.accessUntil)
  const full = !!accessUntil && now.getTime() < accessUntil.getTime()
  const sub = b?.subscriptionStatus
  const compUntil = toDate(b?.compUntil)
  let reason: AccessReason = 'expired'
  if (full) {
    if (sub === 'past_due') reason = 'past_due'
    else if (sub === 'active' || sub === 'trialing') reason = 'subscription'
    else if (compUntil && compUntil.getTime() > now.getTime()) reason = 'comp'
    else reason = 'trial'
  }
  return {
    full,
    reason,
    accessUntil,
    daysLeft: full && accessUntil ? Math.ceil((accessUntil.getTime() - now.getTime()) / DAY_MS) : null,
    hasSubscription: !!b?.hasSubscription,
    cancelAtPeriodEnd: !!b?.cancelAtPeriodEnd,
    interval: b?.interval ?? null,
    currentPeriodEnd: toDate(b?.currentPeriodEnd),
  }
}

/** Tooltip pe butoanele de creare dezactivate în modul citire. */
export const READ_ONLY_TITLE = 'Cabinetul este în modul citire — activați abonamentul pentru a adăuga date'

export const READ_ONLY_MESSAGE =
  'Perioada de probă sau abonamentul cabinetului a expirat. Datele rămân disponibile pentru consultare și export; ' +
  'pentru a lucra din nou, activați abonamentul.'

// Acces la scriere pentru cabinetul activ, setat din AppLayout (ca setApiWorkspace). Toate scrierile Firestore
// din lib/clienti, dosare, sarcini, templates trec prin assertWritable: refuzul apare clar, înaintea regulilor.
let writable = true
export function setWriteAccess(value: boolean): void {
  writable = value
}

export function assertWritable(): void {
  if (writable) return
  notifySubscriptionRequired()
  throw Object.assign(new Error(READ_ONLY_MESSAGE), { code: 'subscription_required' })
}

// ── API ─────────────────────────────────────────────────────────────────────

export interface BillingDetails {
  tip: 'PJ' | 'PF'
  denumire: string
  cui: string
  regCom: string
  adresa: string
  localitate: string
  judet: string
  email: string
}

export interface BillingOverview {
  billing: WorkspaceBilling
  details: BillingDetails | null
  hasCustomer: boolean
  prices: { month: number; year: number }
}

export const getBilling = () => apiJson<BillingOverview>('GET', '/billing')

export const saveBillingDetails = (details: BillingDetails) =>
  apiJson<{ details: BillingDetails }>('PUT', '/billing/details', details)

/** Pornește Stripe Checkout (pagină găzduită de Stripe) și redirecționează browserul. */
export async function startCheckout(interval: 'month' | 'year'): Promise<void> {
  const { url } = await apiJson<{ url: string }>('POST', '/billing/checkout', { interval })
  window.location.assign(url)
}

/** Portalul Stripe: card, facturi de plată, schimbare lunar/anual, anulare. */
export async function openPortal(): Promise<void> {
  const { url } = await apiJson<{ url: string }>('POST', '/billing/portal')
  window.location.assign(url)
}

export const syncBilling = (sessionId?: string) =>
  apiJson<{ billing: WorkspaceBilling }>('POST', '/billing/sync', sessionId ? { sessionId } : {})

export function formatDate(d: Date | null): string {
  return d ? d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}
