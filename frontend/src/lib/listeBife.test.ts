import { describe, it, expect } from 'vitest'
import { denumireAct, felLista, joinSi, listaActe, textLista, OPERATIUNI } from './listeBife'

describe('liste din bife', () => {
  it('recunoaște câmpurile după nume', () => {
    expect(felLista('{{CAMP_OPERATIUNE}}')).toBe('operatiune')
    expect(felLista('{{CAMP_LISTA_ACTELOR}}')).toBe('acte')
    expect(felLista('{{CAMP_PRET}}')).toBeNull()
  })

  it('compune textul în ordinea listei, cu „și” la final', () => {
    expect(joinSi(['a'])).toBe('a')
    expect(joinSi(['a', 'b', 'c'])).toBe('a, b și c')
    expect(textLista(OPERATIUNI, ['altceva', 'cesiune părți sociale', 'schimbare sediu social']))
      .toBe('schimbare sediu social, cesiune părți sociale și altceva')
  })

  it('variantele aceluiași act au o singură denumire generică', () => {
    const nume = ['Act Constitutiv', 'Hotărâre AGA', 'Decizia Asociatului Unic', 'Hotararea AGA sau Decizia Asociatului Unic',
      'Declarație Beneficiari Reali', 'Declaratie beneficiar(i) real(i)', 'Anexa 2a - Cerere înregistrare ONRC (PJ)',
      'Anexa 2b - Cerere înregistrare ONRC (PFA, II, IF)', 'Contract de Comodat (Sediu Social)',
      'Contract_comodat_sediu_social_sau_punct_de_lucru', 'Contract comodat autoturism',
      'Contract cesiune contract prestari servicii ACTUS CONSULT SRL']
    expect(listaActe(nume, false, 'Actus Consult')).toEqual([
      'actul constitutiv', 'hotărârea adunării generale a asociaților', 'declarația privind beneficiarii reali',
      'cererea de înregistrare la Registrul Comerțului', 'contractul de comodat pentru sediu',
      'contractul de comodat pentru autoturism', 'contract cesiune contract prestari servicii',
    ])
    expect(denumireAct('Hotărâre AGA', true)).toBe('decizia asociatului unic')
  })
})
