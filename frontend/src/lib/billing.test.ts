import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./firebase', () => ({ auth: { currentUser: null } }))

import { assertWritable, billingAccess, creditsState, planSummary, setWriteAccess, toDate } from './billing'
import { apiErrorMessage, SUBSCRIPTION_REQUIRED_EVENT } from './api'
import type { WorkspaceBilling } from '../types'

const NOW = new Date('2026-11-01T12:00:00Z')
const DAY = 86_400_000
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
const ts = (ms: number) => ({ toDate: () => new Date(NOW.getTime() + ms) })

function b(patch: Partial<WorkspaceBilling>): WorkspaceBilling {
  return {
    plan: 'standard', status: 'trialing', interval: null, accessUntil: null, trialEndsAt: null, compUntil: null,
    compReason: null, subscriptionStatus: null, currentPeriodEnd: null, graceUntil: null,
    cancelAtPeriodEnd: false, hasSubscription: false, ...patch,
  }
}

describe('billingAccess — oglinda lui billing.has_full_access', () => {
  it('fără billing (cabinet nemigrat) nu dă acces', () => {
    expect(billingAccess(undefined, NOW)).toMatchObject({ full: false, reason: 'expired', daysLeft: null })
  })
  it('probă: zile rămase rotunjite în sus, din Timestamp Firestore sau ISO', () => {
    expect(billingAccess(b({ accessUntil: ts(3.2 * DAY), trialEndsAt: ts(3.2 * DAY) }), NOW))
      .toMatchObject({ full: true, reason: 'trial', daysLeft: 4 })
    expect(billingAccess(b({ accessUntil: iso(DAY) }), NOW).daysLeft).toBe(1)
  })
  it('expiră exact la accessUntil', () => {
    expect(billingAccess(b({ accessUntil: iso(0) }), NOW).full).toBe(false)
    expect(billingAccess(b({ accessUntil: iso(1) }), NOW).full).toBe(true)
  })
  it('motivul: abonament, plată eșuată, acces gratuit', () => {
    expect(billingAccess(b({ accessUntil: iso(30 * DAY), subscriptionStatus: 'active', hasSubscription: true }), NOW).reason).toBe('subscription')
    expect(billingAccess(b({ accessUntil: iso(30 * DAY), subscriptionStatus: 'trialing', hasSubscription: true }), NOW).reason).toBe('subscription')
    expect(billingAccess(b({ accessUntil: iso(5 * DAY), subscriptionStatus: 'past_due' }), NOW).reason).toBe('past_due')
    expect(billingAccess(b({ accessUntil: iso(60 * DAY), compUntil: iso(60 * DAY) }), NOW).reason).toBe('comp')
  })
  it('toDate respinge valori nevalide', () => {
    expect(toDate('nu e dată')).toBeNull()
    expect(toDate(null)).toBeNull()
  })
})

describe('garda de scriere și fereastra de abonare', () => {
  afterEach(() => { setWriteAccess(true); vi.unstubAllGlobals() })

  it('assertWritable trece cu acces și refuză clar în modul citire', () => {
    const dispatch = vi.fn()
    vi.stubGlobal('window', { dispatchEvent: dispatch })
    setWriteAccess(true)
    expect(() => assertWritable()).not.toThrow()
    setWriteAccess(false)
    expect(() => assertWritable()).toThrow(/modul citire|expirat/)
    try { assertWritable() } catch (e) { expect((e as { code?: string }).code).toBe('subscription_required') }
    expect(dispatch).toHaveBeenCalled()
    expect((dispatch.mock.calls[0][0] as Event).type).toBe(SUBSCRIPTION_REQUIRED_EVENT)
  })

  it('un 402 de la API deschide fereastra de abonare', () => {
    const dispatch = vi.fn()
    vi.stubGlobal('window', { dispatchEvent: dispatch })
    const msg = apiErrorMessage({ error: 'subscription_required' }, new Response(null, { status: 402 }), 'x')
    expect(msg).toMatch(/abonamentul/i)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})

describe('credite — oglinda lui billing.credit_mode / credit_balance', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const lots = [
    { id: 'b', remaining: 5, expiresAt: iso(300 * DAY) },
    { id: 'a', remaining: 2, expiresAt: iso(20 * DAY) },
    { id: 'gol', remaining: 0, expiresAt: iso(400 * DAY) },
    { id: 'expirat', remaining: 9, expiresAt: iso(-DAY) },
  ]
  it('soldul ia doar pachetele valabile; prima expirare e a pachetului consumat primul', () => {
    const c = creditsState(b({ accessUntil: iso(300 * DAY), credits: { lots, coveredUntil: null } }), NOW)
    expect(c).toMatchObject({ mode: 'credits', balance: 7, firstExpiryDays: 20 })
  })
  it('motivul e „credite” după probă; în probă creditele nu se consumă', () => {
    const withCredits = b({ accessUntil: iso(300 * DAY), credits: { lots, coveredUntil: null } })
    expect(billingAccess(withCredits, NOW).reason).toBe('credits')
    const inTrial = { ...withCredits, trialEndsAt: iso(5 * DAY) }
    expect(billingAccess(inTrial, NOW).reason).toBe('trial')
    expect(creditsState(inTrial, NOW).mode).toBe('unlimited')
  })
  it('fără sold, fereastra de firmă deschisă ține modul „credite”', () => {
    const empty = b({ accessUntil: iso(10 * DAY), credits: { lots: [], coveredUntil: iso(10 * DAY) } })
    expect(creditsState(empty, NOW)).toMatchObject({ mode: 'credits', balance: 0 })
    expect(creditsState(empty, new Date(NOW.getTime() + 11 * DAY)).mode).toBe('none')
  })
  it('un refuz credits_required deschide fereastra cu mesajul despre credite', () => {
    const dispatch = vi.fn()
    vi.stubGlobal('window', { dispatchEvent: dispatch })
    const msg = apiErrorMessage({ error: 'credits_required' }, new Response(null, { status: 402 }), 'x')
    expect(msg).toMatch(/credite/)
    expect((dispatch.mock.calls[0][0] as CustomEvent).detail).toBe('credits')
  })
})

describe('planSummary — indicatorul planului din meniu și din Setări', () => {
  const lot = (remaining: number, days: number) => ({ id: `l${remaining}`, remaining, expiresAt: iso(days * DAY) })
  it('mod citire și plată eșuată cer atenție (roșu)', () => {
    expect(planSummary(billingAccess(b({}), NOW))).toMatchObject({ label: 'Mod citire', tone: 'bad' })
    expect(planSummary(billingAccess(b({ accessUntil: iso(5 * DAY), subscriptionStatus: 'past_due' }), NOW)))
      .toMatchObject({ label: 'Plată eșuată', tone: 'bad' })
  })
  it('proba: zilele rămase, galben în ultimele 3 zile', () => {
    expect(planSummary(billingAccess(b({ accessUntil: iso(9 * DAY), trialEndsAt: iso(9 * DAY) }), NOW)))
      .toMatchObject({ label: '9 zile de probă', tone: 'ok' })
    expect(planSummary(billingAccess(b({ accessUntil: iso(2 * DAY), trialEndsAt: iso(2 * DAY) }), NOW)).tone).toBe('warn')
    expect(planSummary(billingAccess(b({ accessUntil: iso(DAY), trialEndsAt: iso(DAY) }), NOW)).label).toBe('Ultima zi de probă')
  })
  it('credite: soldul, galben la cel mult 3', () => {
    const at = (lots: ReturnType<typeof lot>[]) => planSummary(billingAccess(b({ accessUntil: iso(300 * DAY), credits: { lots, coveredUntil: null } }), NOW))
    expect(at([lot(12, 300)])).toMatchObject({ label: '12 credite', tone: 'ok' })
    expect(at([lot(3, 300)]).tone).toBe('warn')
    expect(at([lot(1, 300)]).label).toBe('1 credit')
  })
  it('abonament activ sau anulat', () => {
    const sub = { accessUntil: iso(30 * DAY), subscriptionStatus: 'active' as const, hasSubscription: true, interval: 'year' as const, currentPeriodEnd: iso(30 * DAY) }
    expect(planSummary(billingAccess(b(sub), NOW))).toMatchObject({ label: 'Abonament anual', tone: 'ok' })
    expect(planSummary(billingAccess(b({ ...sub, cancelAtPeriodEnd: true }), NOW))).toMatchObject({ label: 'Abonament anulat', tone: 'warn' })
    const cuCredite = planSummary(billingAccess(b({ ...sub, cancelAtPeriodEnd: true,
      credits: { lots: [{ id: 'l', remaining: 30, expiresAt: iso(300 * DAY) }], coveredUntil: null } }), NOW))
    expect(cuCredite.sub).toMatch(/· 30 credite$/)
  })
})
