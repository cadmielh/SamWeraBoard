import { describe, expect, it } from 'vitest'
import { aceeasiPersoana, aplicaAct, cotaPropusa, cotaValida, diferente, etichetaTinta, intrari, listeNoi, tintaPropusa } from './actPersoana'
import type { IDFields } from './api'
import type { Client, Persoana } from '../types'

const P = (o: Partial<Persoana>): Persoana => ({
  calitate: '', cotaParticipare: '', cnp: '', nume: '', prenume: '', serie_numar: '', data_nasterii: '', locul_nasterii: '',
  cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...o,
})
const ACT: IDFields = {
  cnp: '1800101221144', nume: 'POPESCU', prenume: 'ION', serie_numar: 'TM 123456', data_nasterii: '01.01.1980',
  locul_nasterii: 'Timișoara', cetatenia: 'română', adresa: 'Str. Nouă 2', judet: 'Timiș', emisa_de: 'SPCLEP',
  valabila_de_la: '01.01.2024', valabila_pana_la: '01.01.2034',
}
const ion = P({ pid: 'p-ion', nume: 'Popescu', prenume: 'Ion', calitate: 'asociat', cotaParticipare: '60%', cnpMasked: '1•••••••••1144', adresa: 'Str. Veche 1' })
const ionAdmin = P({ pid: 'p-ion-adm', nume: 'Popescu', prenume: 'Ion', calitate: 'administrator', sex: 'M', cnpMasked: '•••••••••1144' })
const ana = P({ pid: 'p-ana', nume: 'Ionescu', prenume: 'Ana', calitate: 'asociat', cotaParticipare: '40%' })
const PJ: Partial<Client> = { tipClient: 'PJ', asociati: [ion, ana], administratori: [ionAdmin] }

describe('potrivire', () => {
  it('numele (fără diacritice și majuscule) și, când există, ultimele cifre ale CNP-ului trebuie să coincidă', () => {
    expect(aceeasiPersoana(ion, { cnp: '1800101221144', nume: 'POPESCU', prenume: 'ion' })).toBe(true)
    expect(aceeasiPersoana(ion, { cnp: '1800101221144', nume: 'X', prenume: 'Y' })).toBe(false)      // doar cifrele nu ajung
    expect(aceeasiPersoana(ion, { cnp: '1800101229999', nume: 'Popescu', prenume: 'Ion' })).toBe(false) // același nume, alt CNP
    expect(aceeasiPersoana(ana, { cnp: '', nume: 'IONESCU', prenume: 'ana' })).toBe(true)
    expect(aceeasiPersoana(ana, { cnp: '2900202334455', nume: 'Vasile', prenume: 'Maria' })).toBe(false)
  })
  it('ținta propusă: persoana găsită, altfel o persoană nouă potrivită tipului', () => {
    expect(tintaPropusa(PJ, ACT)).toEqual({ fel: 'existenta', lista: 'asociati', index: 0 })
    expect(tintaPropusa(PJ, { ...ACT, cnp: '2900202334455', nume: 'Vasile', prenume: 'Maria' })).toEqual({ fel: 'noua', lista: 'asociati' })
    expect(tintaPropusa({ tipClient: 'PF' }, ACT)).toEqual({ fel: 'noua', lista: 'titular' })
  })
  it('listele pentru persoane noi, după tipul clientului', () => {
    expect(listeNoi(PJ)).toEqual(['asociati', 'administratori'])
    expect(listeNoi({ tipClient: 'PF', subtipPF: 'IF', titular: ion })).toEqual(['membriIF'])
    expect(intrari(PJ).map(i => i.eticheta)).toEqual(['Ion Popescu (asociat)', 'Ana Ionescu (asociat)', 'Ion Popescu (administrator)'])
  })
})

describe('aplicaAct', () => {
  it('actualizează persoana în toate rolurile ei, păstrând rolul, cota, pid-ul și sexul; celelalte nu se ating', () => {
    const vault = { 'p-ion': { cnp: '1800101221144', serie_numar: 'TM 1' }, 'p-ion-adm': { cnp: '1800101221144', serie_numar: 'TM 1' } }
    const patch = aplicaAct(PJ, { fel: 'existenta', lista: 'asociati', index: 0 }, ACT, '', vault)
    expect(patch.asociati![0]).toMatchObject({ pid: 'p-ion', calitate: 'asociat', cotaParticipare: '60%', adresa: 'Str. Nouă 2', cnp: ACT.cnp, piiLoaded: true })
    expect(patch.asociati![1]).toBe(ana)
    expect(patch.administratori![0]).toMatchObject({ pid: 'p-ion-adm', calitate: 'administrator', sex: 'M', serie_numar: 'TM 123456' })
    expect(patch.titular).toBeUndefined()
  })
  it('adaugă o persoană nouă la sfârșitul listei alese, fără pid (vault-ul îi dă unul)', () => {
    const patch = aplicaAct(PJ, { fel: 'noua', lista: 'administratori' }, ACT)
    expect(patch.administratori).toHaveLength(2)
    expect(patch.administratori![1]).toMatchObject({ calitate: 'Administrator', nume: 'POPESCU', cnp: ACT.cnp })
    expect(patch.administratori![1].pid).toBeUndefined()
    expect(patch.asociati).toBeUndefined()
  })
  it('PF fără titular: titularul nou', () => {
    expect(aplicaAct({ tipClient: 'PF' }, { fel: 'noua', lista: 'titular' }, ACT).titular).toMatchObject({ nume: 'POPESCU' })
  })
})

describe('diferente', () => {
  it('arată doar câmpurile care se schimbă; CNP-ul și seria se compară prin variantele mascate', () => {
    const t = { fel: 'existenta', lista: 'asociati', index: 0 } as const
    const acelasi = { ...ACT, nume: 'Popescu', prenume: 'Ion', adresa: 'Str. Veche 1', data_nasterii: '', locul_nasterii: '', cetatenia: '',
      judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', serie_numar: '' }
    expect(diferente(PJ, t, acelasi)).toEqual([])                        // CNP: aceleași ultime 4 cifre ca varianta mascată
    expect(diferente(PJ, t, { ...acelasi, adresa: 'Str. Nouă 2', valabila_pana_la: '01.01.2034' })).toEqual(['adresa', 'valabil până la'])
    expect(diferente(PJ, t, { ...acelasi, cnp: '1800101229999' })).toEqual(['CNP'])
    expect(diferente(PJ, { fel: 'noua', lista: 'asociati' }, ACT)).toEqual([])
  })
  it('eticheta persoanei din mesaje', () => {
    expect(etichetaTinta(PJ, { fel: 'existenta', lista: 'administratori', index: 0 })).toBe('Ion Popescu (administrator)')
    expect(etichetaTinta(PJ, { fel: 'noua', lista: 'asociati' })).toBe('asociat nou')
  })
})

describe('tipul clientului', () => {
  it('la un PFA nu apar și nu se modifică „asociați” rămași în date; doar titularul', () => {
    const pfa: Partial<Client> = { tipClient: 'PF', subtipPF: 'PFA', titular: P({ pid: 't', nume: 'Popescu', prenume: 'Ion', calitate: 'Titular' }), asociati: [ion] }
    expect(intrari(pfa).map(i => i.eticheta)).toEqual(['Ion Popescu (titular)'])
    const patch = aplicaAct(pfa, { fel: 'existenta', lista: 'titular', index: 0 }, ACT)
    expect(patch.titular).toMatchObject({ pid: 't', adresa: 'Str. Nouă 2' })
    expect(patch.asociati).toBeUndefined()
  })
})

describe('asociat nou, ca la adăugarea manuală', () => {
  it('cota propusă e partea egală', () => {
    expect(cotaPropusa(PJ)).toBe('33.33%')
    expect(cotaPropusa({ tipClient: 'PJ', asociati: [] })).toBe('100%')
  })
  it('asociații cu partea egală trec la noua parte; cei cu cote alese rămân; calitatea „Asociat”', () => {
    const egali = [P({ pid: 'a', cotaParticipare: '50%' }), P({ pid: 'b', cotaParticipare: '50%' })]
    const patch = aplicaAct({ tipClient: 'PJ', asociati: egali }, { fel: 'noua', lista: 'asociati' }, ACT, '33.33%')
    expect(patch.asociati!.map(a => a.cotaParticipare)).toEqual(['33.33%', '33.33%', '33.33%'])
    expect(patch.asociati![2].calitate).toBe('Asociat')
    const alese = aplicaAct(PJ, { fel: 'noua', lista: 'asociati' }, ACT, '10')
    expect(alese.asociati!.map(a => a.cotaParticipare)).toEqual(['60%', '40%', '10%'])
  })
  it('validează cota', () => {
    expect(cotaValida('25')).toBe(true)
    expect(cotaValida('0')).toBe(false)
    expect(cotaValida('120')).toBe(false)
    expect(cotaValida('')).toBe(false)
  })
  it('administratorul nou are calitatea „Administrator”', () => {
    expect(aplicaAct(PJ, { fel: 'noua', lista: 'administratori' }, ACT).administratori![1].calitate).toBe('Administrator')
  })
})

describe('siguranța datelor la actualizare', () => {
  const tinta = { fel: 'existenta', lista: 'asociati', index: 0 } as const
  it('un câmp necitit de OCR nu șterge valoarea din fișă', () => {
    const patch = aplicaAct(PJ, tinta, { ...ACT, adresa: '', serie_numar: '', cnp: '' }, '', { 'p-ion': { cnp: '1800101221144', serie_numar: 'TM 111111' } })
    expect(patch.asociati![0]).toMatchObject({ adresa: 'Str. Veche 1', cnp: '1800101221144', serie_numar: 'TM 111111', valabila_pana_la: '01.01.2034' })
  })
  it('CNP citit, seria nu: seria actuală (din vault) se păstrează, nu se șterge', () => {
    const patch = aplicaAct(PJ, tinta, { ...ACT, serie_numar: '' }, '', { 'p-ion': { cnp: '1800101221144', serie_numar: 'TM 111111' } })
    expect(patch.asociati![0]).toMatchObject({ cnp: ACT.cnp, serie_numar: 'TM 111111', piiLoaded: true })
  })
  it('fără datele actuale din vault, CNP-ul și seria nu se ating (nu se trimit spre vault)', () => {
    const patch = aplicaAct(PJ, tinta, ACT)
    expect(patch.asociati![0].cnp).toBe('')
    expect(patch.asociati![0].piiLoaded).toBeUndefined()
    expect(patch.asociati![0].adresa).toBe('Str. Nouă 2')
  })
  it('tată și fiu cu același nume nu se actualizează împreună', () => {
    const tata = P({ pid: 'p-tata', nume: 'Popescu', prenume: 'Ion', calitate: 'Asociat', cnpMasked: '•••••••••1144' })
    const fiu = P({ pid: 'p-fiu', nume: 'Popescu', prenume: 'Ion', calitate: 'Administrator', cnpMasked: '•••••••••5555' })
    const c: Partial<Client> = { tipClient: 'PJ', asociati: [tata], administratori: [fiu] }
    const patch = aplicaAct(c, { fel: 'existenta', lista: 'administratori', index: 0 }, { ...ACT, cnp: '1990101225555' })
    expect(patch.administratori![0].pid).toBe('p-fiu')
    expect(patch.asociati).toBeUndefined()
  })
})
