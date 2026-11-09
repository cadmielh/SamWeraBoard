import { describe, it, expect } from 'vitest'
import { campuriSchimbate, mesajCompletare, CAMPURI_BULETIN } from './campuriAuto'

describe('câmpurile completate din ANAF', () => {
  it('doar cele schimbate; adresa și listele comparate după conținut; statusurile fiscale nu contează', () => {
    const inainte = { denumire: 'ALFA SRL', nrRegistrul: '', sediuSocial: { judet: 'Cluj' }, caenSecundare: [], platitorTva: false }
    const dupa = { ...inainte, nrRegistrul: 'J12/1/2020', sediuSocial: { judet: 'Cluj' }, caenSecundare: [{ cod: '6220' }], platitorTva: true, dataInmatricularii: '01.02.2020' }
    expect(campuriSchimbate(inainte, dupa)).toEqual(['nrRegistrul', 'dataInmatricularii', 'caenSecundare'])
  })

  it('mesajul spune câte, la singular și plural', () => {
    expect(mesajCompletare(0)).toMatch(/coincid/)
    expect(mesajCompletare(1)).toBe('Un câmp completat din ANAF — verifică-l.')
    expect(mesajCompletare(9)).toBe('9 câmpuri completate din ANAF — verifică-le.')
    expect(mesajCompletare(3, 'buletin')).toBe('3 câmpuri completate din buletin — verifică-le.')
  })

  it('buletin: câmpurile persoanei; calitatea și cota nu țin de buletin', () => {
    const inainte = { calitate: 'Asociat', cotaParticipare: '50%', nume: 'POPA', prenume: '', cnp: '' }
    const dupa = { ...inainte, calitate: 'Altul', prenume: 'ANA', cnp: '1960515012349' }
    expect(campuriSchimbate(inainte, dupa, CAMPURI_BULETIN)).toEqual(['cnp', 'prenume'])
  })
})
