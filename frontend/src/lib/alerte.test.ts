import { describe, it, expect, vi } from 'vitest'

vi.mock('./firebase', () => ({ db: {} }))

import {
  areFiltruDeLaCine,
  filtreazaVizibile, filtreazaAmanate, contorNoi, areUrgente, sorteazaNotificari, dinFirestore, preferinteDinFirestore,
  cuIgnorat, faraIgnorat, cuTipActiv, cuSursa, faraModificari, opresteTip, dataScurta, dataAlerta, felSursa, areIgnorarePersoana, amanarePana, MAX_IGNORATE,
} from './alerte'
import { PREFERINTE_IMPLICITE, type Notificare, type PreferinteAlerte } from './alerteCatalog'

const NOW = new Date(2026, 10, 13, 10, 0)

const alerta = (over: Partial<Notificare> = {}): Notificare => ({
  id: 'u1__x', uid: 'u1', cheie: 'x', cheieBaza: 'x', cod: 'mandat_expira', sursa: 'client:c1', severitate: 'atentie',
  prag: '30', titlu: 'T', detaliu: 'D', link: '/', clientId: 'c1', dosarId: null, sarcinaId: null, responsabilUid: null,
  termen: null, eveniment: false, creatLa: null, actualizatLa: null, vazut: false, amanatPana: null, rezolvat: false,
  rezolvatLa: null, ...over,
})
const prefs = (over: Partial<PreferinteAlerte> = {}): PreferinteAlerte => ({ ...PREFERINTE_IMPLICITE, ...over })
const ctx = { now: NOW }

describe('filtreazaVizibile', () => {
  it('ascunde alertele rezolvate; tipul și „de la cine” le aplică serverul, nu browserul', () => {
    const l = [
      alerta({ id: 'a' }),
      alerta({ id: 'b', cod: 'dosar_blocat', sursa: 'dosar:d1', responsabilUid: 'u2' }),
      alerta({ id: 'c', rezolvat: true }),
    ]
    expect(filtreazaVizibile(l, prefs({ tipuri: { mandat_expira: { activ: false } } }), ctx).map(n => n.id)).toEqual(['a', 'b'])
  })

  it('ignorate: după sursă (tot clientul) sau după cheieBaza (doar persoana)', () => {
    const l = [
      alerta({ id: 'a', sursa: 'client:c1', cheieBaza: 'ci_expira:client:c1:p1' }),
      alerta({ id: 'b', sursa: 'client:c1', cheieBaza: 'ci_expira:client:c1:p2' }),
      alerta({ id: 'c', sursa: 'client:c2', cheieBaza: 'ci_expira:client:c2:p3' }),
    ]
    expect(filtreazaVizibile(l, prefs({ ignorate: ['client:c1'] }), ctx).map(n => n.id)).toEqual(['c'])
    expect(filtreazaVizibile(l, prefs({ ignorate: ['ci_expira:client:c1:p1'] }), ctx).map(n => n.id)).toEqual(['b', 'c'])
  })

  it('amânate: ascunse până trece data; apar în fila „Amânate”', () => {
    const l = [
      alerta({ id: 'a', amanatPana: new Date(2026, 10, 14) }),
      alerta({ id: 'b', amanatPana: new Date(2026, 10, 12) }),
    ]
    expect(filtreazaVizibile(l, prefs(), ctx).map(n => n.id)).toEqual(['b'])
    expect(filtreazaAmanate(l, prefs(), ctx).map(n => n.id)).toEqual(['a'])
    // O alertă amânată, dar ignorată, nu apare nici la „Amânate”.
    expect(filtreazaAmanate(l, prefs({ ignorate: ['client:c1'] }), ctx)).toEqual([])
  })
})

describe('contorNoi și areUrgente', () => {
  const l = [
    alerta({ id: 'a', vazut: true, severitate: 'urgent' }),
    alerta({ id: 'b', severitate: 'atentie' }),
    alerta({ id: 'c', severitate: 'urgent', amanatPana: new Date(2026, 10, 20) }),
    alerta({ id: 'd', severitate: 'urgent', cod: 'ci_expira' }),
  ]

  it('numără doar alertele vizibile și nevăzute', () => {
    expect(contorNoi(l, prefs(), ctx)).toBe(2)
    expect(contorNoi(l, prefs({ ignorate: ['x'] }), ctx)).toBe(0)
  })

  it('urgent doar dacă printre cele noi e una urgentă', () => {
    expect(areUrgente(l, prefs(), ctx)).toBe(true)
    expect(areUrgente(l.filter(n => n.id !== 'd'), prefs(), ctx)).toBe(false)
  })
})

describe('sortare și conversie', () => {
  it('severitate, apoi termen crescător (fără termen la final), apoi cele mai noi', () => {
    const l = [
      alerta({ id: 'info', severitate: 'info' }),
      alerta({ id: 'fara', severitate: 'urgent', termen: null, creatLa: new Date(2026, 10, 1) }),
      alerta({ id: 'fara-nou', severitate: 'urgent', termen: null, creatLa: new Date(2026, 10, 5) }),
      alerta({ id: 'tarziu', severitate: 'urgent', termen: '2026-12-01' }),
      alerta({ id: 'curand', severitate: 'urgent', termen: '2026-11-20' }),
      alerta({ id: 'atentie', severitate: 'atentie', termen: '2026-11-14' }),
    ]
    expect(sorteazaNotificari(l).map(n => n.id)).toEqual(['curand', 'tarziu', 'fara-nou', 'fara', 'atentie', 'info'])
  })

  it('dinFirestore: Timestamp → Date, valori sigure pentru câmpurile lipsă', () => {
    const ts = { toDate: () => new Date(2026, 0, 2) }
    const n = dinFirestore('u1__k', { uid: 'u1', cheie: 'k', cod: 'plata_esuata', severitate: 'ciudat', creatLa: ts, amanatPana: null, vazut: 1 })
    expect(n.creatLa).toEqual(new Date(2026, 0, 2))
    expect(n.amanatPana).toBeNull()
    expect(n.severitate).toBe('info')
    expect(n.cheieBaza).toBe('k')
    expect(n.vazut).toBe(false)
    expect(n.responsabilUid).toBeNull()
  })

  it('preferinteDinFirestore: document lipsă sau în forma veche = implicite', () => {
    expect(preferinteDinFirestore(undefined)).toEqual(PREFERINTE_IMPLICITE)
    expect(preferinteDinFirestore({ oprite: ['a'], sursaDosare: 'ale_mele', responsabili: ['u2'], ignorate: 'x' }))
      .toEqual({ tipuri: {}, surse: {}, ignorate: [] })
  })

  it('preferinteDinFirestore: curăță tipurile, sursele și ignorările', () => {
    expect(preferinteDinFirestore({
      tipuri: { ci_expira: { activ: false, praguri: [30, 30, 'x', 999] }, nu_exista: { activ: true }, dosar_asignat: 'da', mandat_expira: { activ: 1 } },
      surse: { dosare: { sursa: 'responsabili', responsabili: ['u2', 'u2', 4] }, sarcini: { sursa: 'altceva' }, clienti: { sursa: 'toate' } },
      ignorate: ['client:c1', 'client:c1', 7],
    })).toEqual({
      tipuri: { ci_expira: { activ: false, praguri: [365, 30] } },
      surse: { dosare: { sursa: 'responsabili', responsabili: ['u2'] } },
      ignorate: ['client:c1'],
    })
  })
})

describe('modificări ale preferințelor', () => {
  it('cuIgnorat / faraIgnorat, fără dubluri, cu limită', () => {
    const p = cuIgnorat(prefs(), 'client:c1')
    expect(p.ignorate).toEqual(['client:c1'])
    expect(cuIgnorat(p, 'client:c1')).toBe(p)
    expect(faraIgnorat(p, 'client:c1').ignorate).toEqual([])
    const plin = prefs({ ignorate: Array.from({ length: MAX_IGNORATE }, (_, i) => `client:${i}`) })
    const dupa = cuIgnorat(plin, 'client:nou')
    expect(dupa.ignorate).toHaveLength(MAX_IGNORATE)
    expect(dupa.ignorate[0]).toBe('client:1')
    expect(dupa.ignorate.at(-1)).toBe('client:nou')
  })

  it('cuTipActiv: pornește/oprește; la tipurile obligatorii și codurile necunoscute nu schimbă nimic', () => {
    const p = cuTipActiv(prefs(), 'member', 'ci_expira', true)
    expect(p.tipuri).toEqual({ ci_expira: { activ: true } })
    expect(cuTipActiv(p, 'member', 'ci_expira', false).tipuri.ci_expira).toEqual({ activ: false })
    const baza = prefs()
    expect(cuTipActiv(baza, 'viewer', 'acces_citire', false)).toBe(baza)
    expect(cuTipActiv(baza, 'admin', 'plata_esuata', false)).toBe(baza)
    expect(cuTipActiv(baza, 'admin', 'nu_exista', false)).toBe(baza)
  })

  it('cuSursa și faraModificari (ignorările rămân)', () => {
    const p = cuSursa(prefs({ ignorate: ['client:c1'], tipuri: { ci_expira: { activ: false } } }), 'sarcini', 'responsabili', ['u2'])
    expect(p.surse.sarcini).toEqual({ sursa: 'responsabili', responsabili: ['u2'] })
    expect(faraModificari(p)).toEqual({ tipuri: {}, surse: {}, ignorate: ['client:c1'] })
  })

  it('opresteTip pe un tip obligatoriu nu scrie nimic', async () => {
    // db e un obiect gol (mock): o scriere reală ar eșua, deci rezolvarea arată că nu s-a încercat nicio scriere.
    await expect(opresteTip('w1', 'u1', prefs(), 'admin', 'trial_expira')).resolves.toBeUndefined()
    await expect(opresteTip('w1', 'u1', prefs(), 'viewer', 'acces_citire')).resolves.toBeUndefined()
    // Contraproba: la un tip care se poate opri, încearcă scrierea (și eșuează pe db-ul fals).
    await expect(opresteTip('w1', 'u1', prefs(), 'admin', 'ci_expira')).rejects.toThrow()
  })
})

describe('texte', () => {
  it('dataScurta: azi, mâine, ieri, altfel zi + lună (cu anul dacă diferă)', () => {
    expect(dataScurta(new Date(2026, 10, 13, 23), NOW)).toBe('azi')
    expect(dataScurta(new Date(2026, 10, 14), NOW)).toBe('mâine')
    expect(dataScurta(new Date(2026, 10, 12), NOW)).toBe('ieri')
    expect(dataScurta(new Date(2026, 11, 12), NOW)).toBe('12 dec.')
    expect(dataScurta(new Date(2027, 2, 1), NOW)).toBe('1 mar. 2027')
  })

  it('dataAlerta: termenul, altfel data apariției', () => {
    expect(dataAlerta(alerta({ termen: '2026-12-12' }), NOW)).toBe('12 dec.')
    expect(dataAlerta(alerta({ creatLa: new Date(2026, 10, 12, 9) }), NOW)).toBe('ieri')
    expect(dataAlerta(alerta(), NOW)).toBe('')
  })

  it('felSursa, areIgnorarePersoana, amanarePana', () => {
    expect(felSursa('client:abc')).toBe('client')
    expect(felSursa('sarcina:s1')).toBe('sarcina')
    expect(felSursa('cabinet')).toBeNull()
    expect(areIgnorarePersoana('ci_expira')).toBe(true)
    expect(areIgnorarePersoana('mandat_fara_data')).toBe(true)
    expect(areIgnorarePersoana('durata_expira')).toBe(false)
    expect(amanarePana(1, NOW)).toEqual(new Date(2026, 10, 14, 8))
    expect(amanarePana(7, NOW)).toEqual(new Date(2026, 10, 20, 8))
  })
})

describe('areFiltruDeLaCine', () => {
  it('pentru orice rol, dacă are cel puțin un alt coleg care nu e vizualizator', () => {
    expect(areFiltruDeLaCine('admin', 'u1', { u1: { role: 'admin' } })).toBe(false)
    expect(areFiltruDeLaCine('admin', 'u1', { u1: { role: 'admin' }, v: { role: 'viewer' } })).toBe(false)
    expect(areFiltruDeLaCine('admin', 'u1', { u1: { role: 'admin' }, m: { role: 'member' } })).toBe(true)
    expect(areFiltruDeLaCine('member', 'u1', { u1: { role: 'member' }, a: { role: 'admin' } })).toBe(true)
    expect(areFiltruDeLaCine('member', 'u1', { u1: { role: 'member' }, v: { role: 'viewer' } })).toBe(false)
    expect(areFiltruDeLaCine('viewer', 'u1', { u1: { role: 'viewer' }, m: { role: 'member' } })).toBe(true)
    expect(areFiltruDeLaCine(null, 'u1', { u1: { role: 'member' }, m: { role: 'member' } })).toBe(false)
  })
})
