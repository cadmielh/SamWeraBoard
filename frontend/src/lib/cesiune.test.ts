import { describe, it, expect } from 'vitest'
import type { Client, Persoana } from '../types'
import { calculCesiune, formatProcent, hasCesiune, notaAplicata, propunereCesiune } from './cesiune'

const persoana = (nume: string, cota: string, pid?: string): Persoana =>
  ({ calitate: 'Asociat', cotaParticipare: cota, cnp: '', nume, prenume: 'X', serie_numar: '', pid } as Persoana)
const ana = persoana('ANA', '60%', 'p-ana')
const dan = persoana('DAN', '40%', 'p-dan')
const nou = persoana('NOU', '')
const client = { capitalSocial: 1000, valoareParteSociala: 10, asociati: [ana, dan] } as Partial<Client>

describe('cesiunea de părți sociale', () => {
  it('formatează procentul cu virgulă, zecimale doar când e nevoie', () => {
    expect(formatProcent(60)).toBe('60%')
    expect(formatProcent(100 / 3)).toBe('33,33%')
    expect(formatProcent(12.5)).toBe('12,5%')
  })

  it('apare doar la documentele cu etichete de cesiune', () => {
    expect(hasCesiune(['{{SOCIETATE_DENUMIRE}}', '{{PROCENT_CEDAT}}'])).toBe(true)
    expect(hasCesiune(['{{SOCIETATE_DENUMIRE}}', '{{CAMP_PROCENT_CEDAT}}'])).toBe(false)
  })

  it('calculează din fișă: către asociat nou și către asociat existent', () => {
    expect(calculCesiune(client, ana, nou, 20).values).toEqual({
      '{{NR_PARTI_CEDATE}}': '20', '{{CAPITAL_CEDAT}}': '200', '{{PROCENT_CEDAT}}': '20%',
      '{{PARTI_SOCIALE_COOPTAT}}': '20', '{{CAPITAL_COOPTAT}}': '200', '{{PROCENT_COOPTAT}}': '20%',
    })
    const catreDan = calculCesiune(client, ana, dan, 20)
    expect(catreDan.cesionarParti).toBe(40)
    expect(catreDan.values['{{PARTI_SOCIALE_COOPTAT}}']).toBe('60')
    expect(catreDan.values['{{PROCENT_COOPTAT}}']).toBe('60%')
  })

  it('nu cedează mai mult decât are cedentul', () => {
    const c = calculCesiune(client, dan, ana, 41)
    expect(c.error).toBe('Cedentul are doar 40 părți sociale.')
    expect(c.values).toEqual({})
  })

  it('propune fișa de după cesiune și nota cu cotele de dinainte', () => {
    const p = propunereCesiune(ana, nou, 60, 100, new Date('2026-11-15T10:00:00Z'))
    const dupa = p.update!(client)
    expect(dupa.asociati!.map(a => [a.nume, a.cotaParticipare])).toEqual([['DAN', '40%'], ['NOU', '60%']])
    expect(dupa.ultimaCesiune).toEqual({ data: '2026-11-15T10:00:00.000Z', cedentPid: 'p-ana', parti: 60,
      inainte: [{ pid: 'p-ana', cota: '60%' }, { pid: 'p-dan', cota: '40%' }] })
  })

  it('după actualizare, aceeași cesiune se calculează din situația dinainte', () => {
    const dupa = { ...client, ...propunereCesiune(ana, nou, 60, 100, new Date('2026-11-15T10:00:00Z')).update!(client) }
    const nota = notaAplicata(dupa, ana, 60, new Date('2026-11-20T10:00:00Z'))
    expect(nota).not.toBeNull()
    const c = calculCesiune(dupa, ana, { ...nou, pid: 'p-nou' }, 60, nota!.inainte)
    expect(c.cedentParti).toBe(60)                  // ANA nu mai e în fișă, dar e în notă
    expect(c.values['{{PROCENT_COOPTAT}}']).toBe('60%')
    expect(notaAplicata(dupa, ana, 50, new Date('2026-11-20T10:00:00Z'))).toBeNull()   // altă cesiune
    expect(notaAplicata(dupa, ana, 60, new Date('2027-02-01T10:00:00Z'))).toBeNull()   // peste 60 de zile
  })
})
