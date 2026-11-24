import { describe, expect, it } from 'vitest'
import { GHID_DE_LA, INDICII_DOCUMENTE, PASI_GHID, ghidActiv, membruNou, pasiObligatorii, pasiPentruRol } from './ghidPornire'
import { clientDemo, cuCifraDeControl } from './clientDemo'
import { DENUMIRE_DEMO, esteClientDemo } from './demo'
import { isValidCNP } from './cnp'
import { isCotaTotalValid } from './cota'
import type { Workspace } from '../types'
import { NOUTATI } from './noutati'

describe('pașii ghidului', () => {
  it('administratorul vede și pașii de configurare a cabinetului', () => {
    expect(pasiPentruRol('admin', { alerte: true })).toHaveLength(PASI_GHID.length)
    expect(pasiPentruRol('member').some(p => p.doarAdmin)).toBe(false)
  })

  it('întâi datele clientului (buletin, apoi firmă după CUI), apoi generarea; scanarea și generarea recomandate', () => {
    expect(PASI_GHID.slice(0, 3).map(p => p.key)).toEqual(['scan', 'anaf', 'generare'])
    expect(PASI_GHID.filter(p => p.recomandat).map(p => p.key)).toEqual(['scan', 'generare'])
  })

  it('șablonul propriu și invitarea unui coleg sunt opționale: apar, dar nu condiționează terminarea (cabinet solo)', () => {
    const admin = pasiPentruRol('admin')
    for (const key of ['sablon', 'coleg']) {
      expect(admin.some(p => p.key === key)).toBe(true)
      expect(pasiObligatorii(admin).some(p => p.key === key)).toBe(false)
    }
  })

  it('pasul de alerte apare doar la cabinetele cu alertele pornite și e opțional', () => {
    expect(pasiPentruRol('member').some(p => p.key === 'alerte')).toBe(false)
    const cuAlerte = pasiPentruRol('member', { alerte: true })
    expect(cuAlerte.some(p => p.key === 'alerte')).toBe(true)
    expect(pasiObligatorii(cuAlerte).some(p => p.key === 'alerte')).toBe(false)
  })

  it('pasul de documente apare la toți, e opțional și are indiciile turului din „Ce e nou”', () => {
    const cuDocumente = pasiPentruRol('member')
    const pas = cuDocumente.find(p => p.key === 'documente')
    expect(pas?.indicii).toBe(INDICII_DOCUMENTE)
    expect(pasiObligatorii(cuDocumente).some(p => p.key === 'documente')).toBe(false)
    expect(NOUTATI.find(n => n.id === 'documente-clienti')?.tur?.pasi).toBe(INDICII_DOCUMENTE)
  })

  it('fiecare pas are cel puțin un indiciu', () => {
    for (const p of PASI_GHID) expect(p.indicii.length).toBeGreaterThan(0)
  })
})

describe('membruNou', () => {
  const ws = (addedAt: unknown) => ({ members: { u1: { role: 'member', email: '', displayName: '', addedAt } } }) as unknown as Workspace

  it('cei adăugați de la lansarea ghidului îl primesc deschis', () => {
    expect(membruNou(ws({ toDate: () => new Date(`${GHID_DE_LA}T10:00:00`) }), 'u1')).toBe(true)
    expect(membruNou(ws('2027-01-05T00:00:00Z'), 'u1')).toBe(true)
  })

  it('cei de dinainte sau fără dată nu', () => {
    expect(membruNou(ws('2026-05-01T00:00:00Z'), 'u1')).toBe(false)
    expect(membruNou(ws(null), 'u1')).toBe(false)
    expect(membruNou(ws(null), 'altcineva')).toBe(false)
  })
})

describe('clientul demo', () => {
  it('are CNP-uri valide, ca documentele să aleagă corect variantele', () => {
    const c = clientDemo()
    for (const p of [...c.asociati, ...c.administratori]) expect(isValidCNP(p.cnp)).toBe(true)
    expect(cuCifraDeControl('180041240999')).toHaveLength(13)
  })

  it('e o firmă completă, marcată DEMO', () => {
    const c = clientDemo()
    expect(c.denumire).toBe(DENUMIRE_DEMO)
    expect(c.denumire).toContain('DEMO')
    expect(isCotaTotalValid(c.asociati.map(a => a.cotaParticipare))).toBe(true)
    expect(c.administratori).toHaveLength(1)
    expect(esteClientDemo(c)).toBe(true)
  })

  it('nu mai e demo după ce primește date reale', () => {
    expect(esteClientDemo({ ...clientDemo(), codFiscal: 'RO 99999999' })).toBe(true)
    expect(esteClientDemo({ ...clientDemo(), codFiscal: 'RO18547290' })).toBe(false)
    expect(esteClientDemo({ ...clientDemo(), denumire: 'FIRMA REALĂ SRL' })).toBe(false)
  })
})

describe('ghidActiv', () => {
  const acum = new Date('2027-03-01T12:00:00Z')
  const ws = (addedAt: string, billing: Record<string, unknown> = {}) =>
    ({ billing, members: { u1: { role: 'member', email: '', displayName: '', addedAt } } }) as unknown as Workspace

  it('activ cât cabinetul e în probă', () => {
    const proba = { accessUntil: '2027-03-10T00:00:00Z', trialEndsAt: '2027-03-10T00:00:00Z' }
    expect(ghidActiv(ws('2026-12-01T00:00:00Z', proba), 'u1', acum)).toBe(true)
  })

  it('după probă, doar pentru membrii intrați în ultimele 30 de zile', () => {
    const platit = { accessUntil: '2027-04-01T00:00:00Z', subscriptionStatus: 'active' }
    expect(ghidActiv(ws('2027-02-20T00:00:00Z', platit), 'u1', acum)).toBe(true)
    expect(ghidActiv(ws('2026-12-01T00:00:00Z', platit), 'u1', acum)).toBe(false)
  })
})
