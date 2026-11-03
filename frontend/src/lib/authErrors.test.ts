import { describe, it, expect, vi, afterEach } from 'vitest'
import { authErrorMessage, passwordLoginEnabled, passwordMeetsRules, PASSWORD_REQUIREMENTS, resetErrorMessage } from './authErrors'

afterEach(() => { vi.unstubAllEnvs() })

describe('mesajele de autentificare', () => {
  it('parola greșită și contul inexistent primesc același mesaj', () => {
    const texts = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/user-disabled'].map(code => authErrorMessage({ code }))
    expect(new Set(texts).size).toBe(1)
  })

  it('o adresă deja folosită nu e confirmată direct', () => {
    expect(authErrorMessage({ code: 'auth/email-already-in-use' })).toContain('Dacă aveți deja cont')
  })

  it('o eroare necunoscută nu afișează detalii tehnice', () => {
    expect(authErrorMessage({ code: 'auth/internal-error', message: 'detaliu' })).toBe('Operațiunea nu a reușit. Reîncercați.')
    expect(authErrorMessage(null)).toBe('Operațiunea nu a reușit. Reîncercați.')
  })

  it('la resetare, un cont inexistent nu produce nicio eroare vizibilă', () => {
    expect(resetErrorMessage({ code: 'auth/user-not-found' })).toBeNull()
    expect(resetErrorMessage({ code: 'auth/too-many-requests' })).toContain('Prea multe')
  })
})

describe('regulile parolei', () => {
  it('acceptă o parolă care respectă toate cerințele', () => {
    expect(passwordMeetsRules('Parola!Buna2026')).toBe(true)
    expect(passwordMeetsRules('Parola-Buna-2026')).toBe(true)   // Firebase acceptă `-`, testat pe proiectul real
  })

  it.each([
    ['prea scurtă', 'Ab1!cdefghi'],
    ['fără literă mare', 'parola!buna2026'],
    ['fără literă mică', 'PAROLA!BUNA2026'],
    ['fără cifră', 'Parola!BunaFaraCifre'],
    ['fără caracter special', 'ParolaBuna20261'],
  ])('refuză o parolă %s', (_, password) => {
    expect(passwordMeetsRules(password)).toBe(false)
  })

  it('refuzul Firebase afișează toate cerințele', () => {
    expect(authErrorMessage({ code: 'auth/password-does-not-meet-requirements' })).toBe(PASSWORD_REQUIREMENTS)
  })
})

describe('activarea formularului', () => {
  it('e oprit implicit și pornește doar explicit', () => {
    vi.stubEnv('VITE_PASSWORD_LOGIN', '')
    expect(passwordLoginEnabled()).toBe(false)
    vi.stubEnv('VITE_PASSWORD_LOGIN', '1')
    expect(passwordLoginEnabled()).toBe(true)
  })
})
