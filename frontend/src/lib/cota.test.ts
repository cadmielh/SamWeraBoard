import { describe, it, expect } from 'vitest'
import { cotaCuProcent, parteSocialaError, valoareParteSociala, adaugaAsociat } from './cota'

describe('valoarea unei părți sociale', () => {
  it('implicit 10 lei, inclusiv pentru clienții fără valoare salvată', () => {
    expect(valoareParteSociala({})).toBe(10)
    expect(valoareParteSociala(null)).toBe(10)
    expect(valoareParteSociala({ valoareParteSociala: null })).toBe(10)
  })

  it('folosește valoarea clientului când e un întreg ≥ 1', () => {
    expect(valoareParteSociala({ valoareParteSociala: 1 })).toBe(1)
    expect(valoareParteSociala({ valoareParteSociala: 25 })).toBe(25)
    expect(valoareParteSociala({ valoareParteSociala: 2.5 })).toBe(10)
    expect(valoareParteSociala({ valoareParteSociala: 0 })).toBe(10)
  })

  it('cere un întreg ≥ 1 care împarte exact capitalul', () => {
    expect(parteSocialaError(200, 10)).toBe('')
    expect(parteSocialaError(205, 1)).toBe('')
    expect(parteSocialaError(205, 10)).toMatch(/nu se împarte exact/)
    expect(parteSocialaError(200, 2.5)).toMatch(/număr întreg/)
    expect(parteSocialaError(200, 0)).toMatch(/număr întreg/)
    expect(parteSocialaError(null, 10)).toBe('')
    expect(parteSocialaError(200, null)).toBe('')
  })
})

describe('cotaCuProcent', () => {
  it('adaugă „%” doar unui număr simplu', () => {
    expect(cotaCuProcent('50')).toBe('50%')
    expect(cotaCuProcent(' 33,33 ')).toBe('33,33%')
    expect(cotaCuProcent('50%')).toBe('50%')
    expect(cotaCuProcent('')).toBe('')
  })
})

describe('adaugaAsociat', () => {
  it('noul asociat primește partea egală; cei cu partea egală sau fără cotă se reîmpart; cotele alese rămân', () => {
    expect(adaugaAsociat([{ cotaParticipare: '100%' }], { cotaParticipare: '' }).map(a => a.cotaParticipare)).toEqual(['50%', '50%'])
    expect(adaugaAsociat([{ cotaParticipare: '70%' }, { cotaParticipare: '' }], { cotaParticipare: '' }).map(a => a.cotaParticipare))
      .toEqual(['70%', '33.33%', '33.33%'])
    expect(adaugaAsociat([{ cotaParticipare: '100%' }], { cotaParticipare: '20%' }).map(a => a.cotaParticipare)).toEqual(['50%', '20%'])
  })
})
