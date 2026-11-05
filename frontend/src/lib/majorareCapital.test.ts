import { describe, it, expect } from 'vitest'
import { calculeazaMajorareMulti } from './majorareCapital'
import { findClauseSpec } from './clauseFieldSpecs'
import type { Persoana } from '../types'

const asociat = (nume: string, prenume: string, cota: string) => ({ nume, prenume, cotaParticipare: cota }) as Persoana
const asociati = [asociat('POPESCU', 'ION', '50%'), asociat('IONESCU', 'ANA', '50%'), asociat('MARIN', 'DAN', '0%')]

describe('majorare de capital cu mai mulți asociați', () => {
  it('capitalul nou e suma aporturilor peste capitalul actual, iar cotele se recalculează pentru toți', () => {
    // 200 RON = 20 părți (10 + 10); aport 100 + 200 → 500 RON = 50 părți
    const r = calculeazaMajorareMulti(asociati.slice(0, 2), 200, [
      { nume: 'POPESCU ION', aport: 100 }, { nume: 'IONESCU ANA', aport: 200 },
    ], 10)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.capitalNou).toBe(500)
    expect(r.partiNoiTotal).toBe(50)
    expect(r.aporturi).toEqual([
      { nume: 'POPESCU ION', aport: 100, partiAport: 10, cotaNoua: 40 },
      { nume: 'IONESCU ANA', aport: 200, partiAport: 20, cotaNoua: 60 },
    ])
  })

  it('asociații fără aport își păstrează părțile, dar cota le scade', () => {
    const r = calculeazaMajorareMulti(asociati.slice(0, 2), 200, [{ nume: 'POPESCU ION', aport: 200 }], 10)
    expect(r.ok && r.structura).toEqual([
      { nume: 'POPESCU ION', partiNoi: 30, cotaNoua: 75 },
      { nume: 'IONESCU ANA', partiNoi: 10, cotaNoua: 25 },
    ])
  })

  it('folosește valoarea părții sociale a clientului', () => {
    const r = calculeazaMajorareMulti(asociati.slice(0, 2), 200, [{ nume: 'POPESCU ION', aport: 5 }], 1)
    expect(r.ok && r.aporturi[0].partiAport).toBe(5)
  })

  it('semnalează rândurile incomplete, dublate sau aporturile care nu se împart în părți întregi', () => {
    expect(calculeazaMajorareMulti(asociati, 200, [], 10)).toMatchObject({ ok: false })
    expect(calculeazaMajorareMulti(asociati, 200, [{ nume: '', aport: 100 }], 10)).toMatchObject({ ok: false, error: /Alege asociatul/ })
    expect(calculeazaMajorareMulti(asociati, 200, [{ nume: 'POPESCU ION', aport: 0 }], 10)).toMatchObject({ ok: false, error: /aportul/ })
    expect(calculeazaMajorareMulti(asociati, 200, [{ nume: 'POPESCU ION', aport: 15 }], 10)).toMatchObject({ ok: false, error: /nu se împarte exact/ })
    expect(calculeazaMajorareMulti(asociati, 200, [
      { nume: 'POPESCU ION', aport: 10 }, { nume: 'POPESCU ION', aport: 10 },
    ], 10)).toMatchObject({ ok: false, error: /de două ori/ })
  })
})

describe('varianta clauzei de majorare, după șablon', () => {
  it('Hotărârea AGA (bloc {{#APORTURI}}) primește formularul cu mai mulți asociați', () => {
    const aga = ['{{CAPITAL_SOCIAL_NOU}}', '{{PARTI_SOCIALE_NOI}}', '{{NUME}}', '{{APORT}}', '{{PARTI_APORT}}', '{{COTA_PARTICIPARE}}']
    expect(findClauseSpec('MAJORARE_CAPITAL_SOCIAL', aga)?.widget).toBe('majorareCapitalMulti')
  })

  it('Decizia asociatului unic păstrează formularul cu un singur aportator', () => {
    const decizie = ['{{ASOCIAT_APORT_NUME}}', '{{CAPITAL_SOCIAL_NOU}}', '{{PARTI_SOCIALE_NOI}}', '{{ASOCIAT_APORT_COTA_PARTICIPARE}}']
    expect(findClauseSpec('MAJORARE_CAPITAL_SOCIAL', decizie)?.widget).toBe('majorareCapital')
  })
})
