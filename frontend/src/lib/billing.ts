import { apiJson, notifySubscriptionRequired } from './api'
import type { BillingTime, CreditLot, WorkspaceBilling } from '../types'

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

export type AccessReason = 'trial' | 'subscription' | 'past_due' | 'comp' | 'credits' | 'expired'

/** 'unlimited' = probă, acces gratuit sau abonament (nu se consumă credite). Oglinda billing.credit_mode. */
export type CreditMode = 'unlimited' | 'credits' | 'none'

export interface CreditsState {
  mode: CreditMode
  /** Credite valabile (din pachetele neexpirate). */
  balance: number
  /** Când expiră primele credite (pachetul care se consumă primul) și în câte zile. */
  firstExpiry: Date | null
  firstExpiryDays: number | null
  /** Sfârșitul celei mai târzii ferestre de firmă deschise. */
  coveredUntil: Date | null
}

/** Pachetele cu sold, încă valabile, în ordinea consumului — oglinda billing.live_lots. */
export function liveLots(b: WorkspaceBilling | undefined, now: Date = new Date()): (CreditLot & { expires: Date })[] {
  return (b?.credits?.lots ?? [])
    .map(l => ({ ...l, expires: toDate(l.expiresAt) }))
    .filter((l): l is CreditLot & { expires: Date } => l.remaining > 0 && !!l.expires && l.expires.getTime() > now.getTime())
    .sort((a, c) => a.expires.getTime() - c.expires.getTime())
}

export function creditsState(b: WorkspaceBilling | undefined, now: Date = new Date()): CreditsState {
  const lots = liveLots(b, now)
  const balance = lots.reduce((n, l) => n + l.remaining, 0)
  const coveredUntil = toDate(b?.credits?.coveredUntil)
  const unlimited = [b?.trialEndsAt, b?.compUntil].map(toDate).some(d => d && d.getTime() > now.getTime())
    || (!!b?.hasSubscription && !!toDate(b?.accessUntil) && toDate(b?.accessUntil)!.getTime() > now.getTime())
  const mode: CreditMode = unlimited ? 'unlimited'
    : balance > 0 || (!!coveredUntil && coveredUntil.getTime() > now.getTime()) ? 'credits' : 'none'
  const firstExpiry = lots[0]?.expires ?? null
  const firstExpiryDays = firstExpiry ? Math.ceil((firstExpiry.getTime() - now.getTime()) / DAY_MS) : null
  return { mode, balance, firstExpiry, firstExpiryDays, coveredUntil }
}

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
  credits: CreditsState
}

/** Oglinda lui billing.has_full_access (server) și billingOk (reguli Firestore): compară doar accessUntil. */
export function billingAccess(b: WorkspaceBilling | undefined, now: Date = new Date()): BillingAccess {
  const accessUntil = toDate(b?.accessUntil)
  const full = !!accessUntil && now.getTime() < accessUntil.getTime()
  const sub = b?.subscriptionStatus
  const compUntil = toDate(b?.compUntil)
  const trialEnd = toDate(b?.trialEndsAt)
  let reason: AccessReason = 'expired'
  if (full) {
    if (sub === 'past_due') reason = 'past_due'
    else if (sub === 'active' || sub === 'trialing') reason = 'subscription'
    else if (compUntil && compUntil.getTime() > now.getTime()) reason = 'comp'
    else if (trialEnd && trialEnd.getTime() > now.getTime()) reason = 'trial'
    else reason = 'credits'
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
    credits: creditsState(b, now),
  }
}

/** Tooltip pe butoanele de creare dezactivate în modul citire. */
export const READ_ONLY_TITLE = 'Cabinetul este în modul citire — alegeți un abonament sau un pachet de credite pentru a adăuga date'

export const READ_ONLY_MESSAGE =
  'Perioada de probă, abonamentul sau creditele cabinetului au expirat. Datele rămân disponibile pentru consultare și ' +
  'export; pentru a lucra din nou, alegeți un abonament sau un pachet de credite.'

export const CREDITS_EMPTY_MESSAGE =
  'Nu mai aveți credite pentru un client nou. Clienții pentru care ați consumat deja un credit rămân disponibili până la ' +
  'sfârșitul celor 30 de zile; pentru alți clienți, cumpărați un pachet de credite.'

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
  /** Vânzare doar către profesioniști: mereu 'PJ' (firmă, PFA, II, IF); 'PF' poate apărea doar în date vechi. */
  tip: 'PJ' | 'PF'
  /** Confirmarea expresă că achiziția se face în scopul activității profesionale (obligatorie la salvare). */
  professional?: boolean
  denumire: string
  cui: string
  regCom: string
  adresa: string
  localitate: string
  judet: string
  email: string
}

export type CreditPack = '10' | '30' | '50'

export interface BillingOverview {
  billing: WorkspaceBilling
  details: BillingDetails | null
  hasCustomer: boolean
  prices: { month: number; year: number }
  /** Prețurile abonamentelor noi de la `nextPricesFrom`; cine se abonează înainte își păstrează prețul. */
  nextPrices: { month: number; year: number } | null
  nextPricesFrom: string | null
  packs: Record<CreditPack, { credits: number; ron: number }>
  /** Prețurile pachetelor de la `nextPricesFrom` (până atunci, prețul de lansare). */
  nextPacks: Record<CreditPack, { credits: number; ron: number }> | null
}

export const getBilling = () => apiJson<BillingOverview>('GET', '/billing')

export const saveBillingDetails = (details: BillingDetails) =>
  apiJson<{ details: BillingDetails }>('PUT', '/billing/details', details)

/** Pornește Stripe Checkout (pagină găzduită de Stripe) și redirecționează browserul. */
export async function startCheckout(interval: 'month' | 'year'): Promise<void> {
  const { url } = await apiJson<{ url: string }>('POST', '/billing/checkout', { interval })
  window.location.assign(url)
}

/** Pachet de credite: Stripe Checkout cu plată unică. */
export async function startCreditsCheckout(pack: CreditPack): Promise<void> {
  const { url } = await apiJson<{ url: string }>('POST', '/billing/credits/checkout', { pack })
  window.location.assign(url)
}

export interface CreditLedgerEntry {
  id: string
  kind: 'purchase' | 'grant' | 'consume' | 'adjust'
  amount: number
  at: string | null
  uid?: string
  clientId?: string
  /** Denumirea actuală a clientului (lipsește dacă între timp a fost șters). */
  clientName?: string | null
  document?: string
  reason?: string
  expiresAt?: string
  coveredUntil?: string
}

export interface CreditsOverview {
  balance: number
  mode: CreditMode
  coveredUntil: string | null
  lots: { id: string; remaining: number; expiresAt: string }[]
  ledger: CreditLedgerEntry[]
}

export const getCredits = () => apiJson<CreditsOverview>('GET', '/billing/credits')

/** Ce se întâmplă la generarea pentru un client — pentru mesajul din pagina de generare. */
export interface CreditQuote {
  mode: 'unlimited' | 'included' | 'consume' | 'none'
  balance?: number
  coveredUntil?: string
}

export const creditQuote = (clientId?: string | null) =>
  apiJson<CreditQuote>('GET', `/billing/credits/quote${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`)

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
