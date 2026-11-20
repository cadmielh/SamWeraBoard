import { describe, it, expect } from 'vitest'
import { campuriCalculate, dataAniversara, valoriCalculate } from './campuriCalculate'
import { campuriAutoturism, completariAutoturism, judetDinNumar, verificaVin } from './autoturism'

const comodat = ['{{CAMP_DURATA_ANI}}', '{{CAMP_DURATA_ANI_IN_LITERE}}', '{{CAMP_DATA_SFARSIT_CONTRACT}}']
const azi = new Date(2026, 10, 21)

describe('câmpuri manuale calculate', () => {
  it('literele și data de sfârșit vin din durată', () => {
    expect([...campuriCalculate(comodat).keys()]).toEqual(['{{CAMP_DURATA_ANI_IN_LITERE}}', '{{CAMP_DATA_SFARSIT_CONTRACT}}'])
    expect(valoriCalculate(comodat, { '{{CAMP_DURATA_ANI}}': '5' }, azi)).toEqual({
      '{{CAMP_DURATA_ANI_IN_LITERE}}': 'cinci', '{{CAMP_DATA_SFARSIT_CONTRACT}}': '21.11.2031',
    })
    expect(valoriCalculate(comodat, { '{{CAMP_DURATA_ANI}}': '' }, azi)['{{CAMP_DATA_SFARSIT_CONTRACT}}']).toBe('')
  })

  it('se potrivesc după sufix: închirierea, cu data de început completată', () => {
    const f = ['{{CAMP_DATA_INCEPUT_INCHIRIERE}}', '{{CAMP_DATA_SFARSIT_INCHIRIERE}}', '{{CAMP_DURATA_INCHIRIERE_ANI}}']
    expect(campuriCalculate(f).get('{{CAMP_DATA_SFARSIT_INCHIRIERE}}')).toEqual(['{{CAMP_DURATA_INCHIRIERE_ANI}}'])
    expect(valoriCalculate(f, { '{{CAMP_DATA_INCEPUT_INCHIRIERE}}': '01.12.2026', '{{CAMP_DURATA_INCHIRIERE_ANI}}': '3' }, azi))
      .toEqual({ '{{CAMP_DATA_SFARSIT_INCHIRIERE}}': '01.12.2029' })
  })

  it('fără sursă în document, câmpul rămâne de completat de mână', () => {
    expect(campuriCalculate(['{{CAMP_PRET_IN_LITERE}}', '{{CAMP_DATA_SFARSIT_CONTRACT}}']).size).toBe(0)
  })

  it('pornește de la data de început completată și trece 29 februarie pe 28', () => {
    const f = ['{{CAMP_DATA_INCEPUT_CONTRACT}}', '{{CAMP_DURATA_LUNI}}', '{{CAMP_DATA_SFARSIT_CONTRACT}}']
    expect(valoriCalculate(f, { '{{CAMP_DATA_INCEPUT_CONTRACT}}': '31.01.2027', '{{CAMP_DURATA_LUNI}}': '1' })['{{CAMP_DATA_SFARSIT_CONTRACT}}']).toBe('28.02.2027')
    const d = dataAniversara(new Date(2028, 1, 29), 12)
    expect([d.getDate(), d.getMonth()]).toEqual([28, 1])
  })
})

describe('autoturism', () => {
  it('grupează câmpurile vehiculului doar când există unul clar', () => {
    const f = ['{{CAMP_MARCA_AUTOTURISM}}', '{{CAMP_CULOARE}}', '{{CAMP_SERIE_SASIU_VIN}}', '{{CAMP_NUMAR_CERTIFICAT_INMATRICULARE}}',
      '{{CAMP_NUMAR_INMATRICULARE}}', '{{CAMP_VALOARE_AUTOTURISM_EURO}}', '{{CAMP_DURATA_ANI}}']
    const a = campuriAutoturism(f)
    expect([...a.keys()]).toEqual(f.slice(0, 6))
    expect(a.get('{{CAMP_NUMAR_CERTIFICAT_INMATRICULARE}}')!.label).toBe('Nr. certificat de înmatriculare')
    expect(a.get('{{CAMP_VALOARE_AUTOTURISM_EURO}}')!.label).toBe('Valoarea autoturismului (EURO)')
    expect(campuriAutoturism(['{{CAMP_CULOARE}}', '{{CAMP_MARCA}}']).size).toBe(0)
  })

  it('județul S.R.P.C.I.V. din numărul de înmatriculare', () => {
    expect(judetDinNumar('cj 12 abc')).toBe('Cluj')
    expect(judetDinNumar('B-123-ABC')).toBe('București')
    expect(judetDinNumar('B 012345')).toBe('București')
    expect(judetDinNumar('MAI 1234')).toBeNull()
    const f = ['{{CAMP_NUMAR_INMATRICULARE}}', '{{CAMP_SRPCIV}}']
    expect(completariAutoturism(f, '{{CAMP_NUMAR_INMATRICULARE}}', 'IS 07 XYZ')).toEqual({ '{{CAMP_SRPCIV}}': 'Iași' })
    expect(completariAutoturism(f, '{{CAMP_CULOARE}}', 'IS')).toEqual({})
  })

  it('verifică seria de șasiu', () => {
    expect(verificaVin('WVWZZZ1JZXW000001')).toBeNull()
    expect(verificaVin('WVWZZZ1JZXW00001')).toMatch(/17 caractere/)
    expect(verificaVin('WVWZZZ1JZXW00000O')).toMatch(/I, O sau Q/)
  })
})
