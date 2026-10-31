import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./firebase', () => ({ auth: { currentUser: null } }))

import { assertWritable, billingAccess, setWriteAccess, toDate } from './billing'
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
