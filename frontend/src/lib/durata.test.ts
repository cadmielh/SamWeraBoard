import { describe, it, expect } from 'vitest'
import {
  durataText, durataFraza, durataAni, durataComuna, dataExpirare, dataConsultarePrelungire, inceputMandat,
  stareMandat, stareDurataSocietate, avertizareMandat, mandatImplicit, tipuriMandat, normalizeDurata,
  termeneClient, termeneUrgente, confirmaAprobarea, type Durata, type Mandat,
} from './durata'
import { EMPTY_PERSOANA } from './clienti'
import termeneFixture from '../../../tests/fixtures/termene.json'

const ani = (n: string): Durata => ({ tip: 'ani', ani: n, data: '' })
const pana = (data: string): Durata => ({ tip: 'data', ani: '', data })
const nedet: Durata = { tip: 'nedeterminata', ani: '', data: '' }
const mandat = (durata: Durata, over: Partial<Mandat> = {}): Mandat => ({ durata, inceput: 'data', dataNumire: '', ...over })

describe('textele duratei', () => {
  it('durataText: nedeterminată, ani (cu „de” de la 20 în sus), dată; gol cât e incomplet', () => {
    expect(durataText('nedeterminata', '', '')).toBe('nedeterminată')
    expect(durataText('ani', '1', '')).toBe('de un an')
    expect(durataText('ani', '10', '')).toBe('de 10 ani')
    expect(durataText('ani', '19', '')).toBe('de 19 ani')
    expect(durataText('ani', '20', '')).toBe('de 20 de ani')
    expect(durataText('ani', '99', '')).toBe('de 99 de ani')
    expect(durataText('ani', '101', '')).toBe('de 101 ani')
    expect(durataText('ani', '', '')).toBe('')
    expect(durataText('data', '', '31.12.2030')).toBe('până la data de 31.12.2030')
    expect(durataText('data', '', ' ')).toBe('')
  })

  it('durataFraza: frază întreagă, pentru „Durata … este …”', () => {
    expect(durataFraza(nedet)).toBe('pe durată nedeterminată')
    expect(durataFraza(ani('1'))).toBe('pe o perioadă de un an')
    expect(durataFraza(ani('4'))).toBe('pe o perioadă de 4 ani')
    expect(durataFraza(ani('99'))).toBe('pe o perioadă de 99 de ani')
    expect(durataFraza(pana('31.12.2035'))).toBe('până la data de 31.12.2035')
    expect(durataFraza(ani(''))).toBe('')
    expect(durataFraza(undefined)).toBe('')
  })

  it('durataAni: doar la tipul „ani”, fără zerouri în față', () => {
    expect(durataAni(ani('04'))).toBe('4')
    expect(durataAni(nedet)).toBe('')
    expect(durataAni(pana('31.12.2035'))).toBe('')
  })

  it('normalizeDurata golește câmpurile altui tip', () => {
    expect(normalizeDurata({ tip: 'data', ani: '4', data: '01.01.2030' })).toEqual(pana('01.01.2030'))
    expect(normalizeDurata({ tip: 'nedeterminata', ani: '4', data: 'x' })).toEqual(nedet)
  })
})

describe('expirarea', () => {
  it('termen în ani: ziua corespunzătoare; 29 februarie → ultima zi a lui februarie', () => {
    expect(dataExpirare(ani('4'), '15.01.2027')).toBe('15.01.2031')
    expect(dataExpirare(ani('1'), '29.02.2028')).toBe('28.02.2029')
    expect(dataExpirare(ani('4'), '29.02.2028')).toBe('29.02.2032')
  })

  it('fără început cunoscut sau nedeterminată → gol; „până la” nu depinde de început', () => {
    expect(dataExpirare(ani('4'), '')).toBe('')
    expect(dataExpirare(nedet, '15.01.2027')).toBe('')
    expect(dataExpirare(pana('31.12.2035'), '')).toBe('31.12.2035')
    expect(dataExpirare(pana('31.02.2035'), '')).toBe('')
  })

  it('consultarea asociaților: cu 3 luni înainte de expirare (art. 227 alin. 2)', () => {
    expect(dataConsultarePrelungire('31.05.2030')).toBe('28.02.2030')
    expect(dataConsultarePrelungire('15.01.2031')).toBe('15.10.2030')
  })

  it('începutul mandatului: data aprobării dosarului / a numirii, gol cât nu se știe', () => {
    expect(inceputMandat(mandat(ani('4'), { inceput: 'aprobare' }))).toBe('')
    expect(inceputMandat(mandat(ani('4'), { inceput: 'aprobare', dataNumire: '10.03.2027' }))).toBe('10.03.2027')
    expect(inceputMandat(mandat(ani('4'), { dataNumire: '07.11.2026' }))).toBe('07.11.2026')
  })
})

describe('starea termenelor', () => {
  const azi = new Date(2026, 10, 7)

  it('mandat: nedeterminat, în așteptare, curând, expirat, activ', () => {
    expect(stareMandat(undefined).stare).toBe('incomplet')
    expect(stareMandat(mandat(nedet), azi).stare).toBe('nedeterminat')
    expect(stareMandat(mandat(ani('4'), { inceput: 'aprobare' }), azi)).toEqual({ stare: 'asteptare', motiv: 'aprobare' })
    expect(stareMandat(mandat(ani('4')), azi)).toEqual({ stare: 'asteptare', motiv: 'numire' })
    expect(stareMandat(mandat(ani('4'), { dataNumire: '01.01.2023' }), azi))
      .toEqual({ stare: 'curand', expira: '01.01.2027', zile: 55 })
    expect(stareMandat(mandat(pana('06.11.2026')), azi)).toMatchObject({ stare: 'expirat', zile: -1 })
    expect(stareMandat(mandat(ani('4'), { dataNumire: '07.11.2026' }), azi)).toMatchObject({ stare: 'activ', expira: '07.11.2030' })
  })

  it('durata societății curge de la înmatriculare', () => {
    expect(stareDurataSocietate(undefined).stare).toBe('incomplet')
    expect(stareDurataSocietate(nedet).stare).toBe('nedeterminat')
    expect(stareDurataSocietate(ani('10'), undefined, azi)).toEqual({ stare: 'asteptare', motiv: 'inmatriculare' })
    expect(stareDurataSocietate(ani('10'), '01.02.2017', azi)).toMatchObject({ stare: 'curand', expira: '01.02.2027' })
  })
})

describe('reguli pe formă juridică', () => {
  it('SA: fără „nedeterminată”, implicit 4 ani; SRL: nedeterminată', () => {
    expect(tipuriMandat('SA')).toEqual(['ani', 'data'])
    expect(tipuriMandat('SRL')).toEqual(['nedeterminata', 'ani', 'data'])
    expect(mandatImplicit('SA').durata).toEqual(ani('4'))
    expect(mandatImplicit('SRL')).toEqual({ durata: nedet, inceput: 'aprobare', dataNumire: '' })
  })

  it('avertizare peste 4 ani doar la SA', () => {
    expect(avertizareMandat('SRL', mandat(ani('99')))).toBe('')
    expect(avertizareMandat('SA', mandat(ani('4')))).toBe('')
    expect(avertizareMandat('SA', mandat(ani('5')))).toMatch(/4 ani/)
    expect(avertizareMandat('SA', mandat(nedet))).toMatch(/4 ani/)
    expect(avertizareMandat('SA', mandat(pana('08.11.2030'), { dataNumire: '07.11.2026' }))).toMatch(/4 ani/)
    expect(avertizareMandat('SA', mandat(pana('07.11.2030'), { dataNumire: '07.11.2026' }))).toBe('')
    // Fără început cunoscut, o dată fixă nu se poate verifica — nu se avertizează pe ghicite
    expect(avertizareMandat('SA', mandat(pana('07.11.2040')))).toBe('')
  })
})

describe('durata comună a administratorilor', () => {
  const admin = (m?: Mandat) => ({ ...EMPTY_PERSOANA, ...(m ? { mandat: m } : {}) })
  it('aceeași la toți → ea; diferită sau lipsă la unul → null', () => {
    expect(durataComuna([admin(mandat(ani('4'))), admin(mandat(ani('04'), { inceput: 'aprobare' }))])).toEqual(ani('4'))
    expect(durataComuna([admin(mandat(ani('4'))), admin(mandat(nedet))])).toBeNull()
    expect(durataComuna([admin(mandat(ani('4'))), admin()])).toBeNull()
    expect(durataComuna([])).toBeNull()
  })
})

describe('termenele urmărite pentru un client', () => {
  const azi = new Date(2026, 10, 7)
  const admin = (nume: string, m: Mandat) => ({ ...EMPTY_PERSOANA, nume, prenume: 'ION', mandat: m })

  it('mandate, durata societății și consultarea asociaților cu 3 luni înainte; doar cele urgente, cele mai apropiate întâi', () => {
    const c = {
      tipClient: 'PJ' as const, dataInmatricularii: '01.02.2017', durataSocietate: ani('10'),
      administratori: [
        admin('POPA', mandat(ani('4'), { dataNumire: '01.01.2023' })),
        admin('DAN', mandat(nedet)),
        { ...EMPTY_PERSOANA, nume: 'FARA' },
      ],
    }
    expect(termeneClient(c, azi).map(t => [t.titlu, t.stare.stare])).toEqual([
      ['Mandat POPA ION', 'curand'],
      ['Mandat DAN ION', 'nedeterminat'],
      ['Durata societății', 'curand'],
      ['Consultarea asociaților privind prelungirea duratei', 'expirat'],
    ])
    expect(termeneUrgente(c, azi).map(t => t.titlu)).toEqual([
      'Consultarea asociaților privind prelungirea duratei', 'Mandat POPA ION', 'Durata societății',
    ])
  })

  it('PF și clienții fără durate: nimic', () => {
    expect(termeneClient({ tipClient: 'PF', administratori: [] })).toEqual([])
    expect(termeneClient({ tipClient: 'PJ', administratori: [{ ...EMPTY_PERSOANA }] })).toEqual([])
  })
})

describe('confirmarea aprobării dosarului', () => {
  it('mandatele „din prezent” fără dată primesc data aprobării; cele cu dată și cele „de la o dată anume” rămân', () => {
    const asteapta = { ...EMPTY_PERSOANA, mandat: mandat(nedet, { inceput: 'aprobare' }) }
    const cuData = { ...EMPTY_PERSOANA, mandat: mandat(ani('4'), { inceput: 'aprobare', dataNumire: '01.03.2026' }) }
    const altaData = { ...EMPTY_PERSOANA, mandat: mandat(ani('4')) }
    const faraMandat = { ...EMPTY_PERSOANA }
    const [a, b, c, d] = confirmaAprobarea([asteapta, cuData, altaData, faraMandat], '15.06.2026')
    expect(a.mandat?.dataNumire).toBe('15.06.2026')
    expect([b, c, d]).toEqual([cuData, altaData, faraMandat])
    expect(confirmaAprobarea([asteapta], '31.02.2026')[0]).toBe(asteapta)
  })
})

// Aceleași exemple sunt verificate și de serverul de alerte (alerte.py, tests/test_alerte.py): cele două
// implementări ale termenelor nu au voie să dea rezultate diferite.
describe('paritate cu serverul de alerte (tests/fixtures/termene.json)', () => {
  const [z, l, a] = termeneFixture.azi.split('.').map(Number)
  const azi = new Date(a, l - 1, z)
  it.each(termeneFixture.mandate)('mandat: $titlu', ({ mandat, asteptat }) => {
    expect(stareMandat((mandat ?? undefined) as Mandat | undefined, azi)).toEqual(asteptat)
  })
  it.each(termeneFixture.durate)('durata societății: $titlu', ({ durata, dataInmatricularii, asteptat }) => {
    expect(stareDurataSocietate((durata ?? undefined) as Durata | undefined, dataInmatricularii, azi)).toEqual(asteptat)
  })
})
