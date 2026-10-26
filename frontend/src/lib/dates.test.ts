import { describe, it, expect } from 'vitest'
import { isIncompleteOrInvalidRoDate, isValidRoDate, parseIsoDateLocal, roDateInputCaretPos, roDateInputError, roDateInputMask, roDateInputSlotAtCaret, roDateToISO, roDigitsToPartialDate } from './dates'

describe('parseIsoDateLocal — yyyy-mm-dd ca dată LOCALĂ, nu UTC', () => {
  it('parsează corect anul/luna/ziua, indiferent de fusul orar al mediului de test', () => {
    const d = parseIsoDateLocal('2026-01-15')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(0)
  })

  it('null/undefined/string gol/format invalid → null', () => {
    expect(parseIsoDateLocal(null)).toBeNull()
    expect(parseIsoDateLocal(undefined)).toBeNull()
    expect(parseIsoDateLocal('')).toBeNull()
    expect(parseIsoDateLocal('15.01.2026')).toBeNull()
  })
})

describe('roDigitsToPartialDate — DateFieldInput trebuie să propage prin onChange text cu puncte, nu cifre brute', () => {
  it('sub 3 cifre -> fără punct (nimic de delimitat încă)', () => {
    expect(roDigitsToPartialDate('')).toBe('')
    expect(roDigitsToPartialDate('1')).toBe('1')
    expect(roDigitsToPartialDate('15')).toBe('15')
  })

  it('3-4 cifre -> un singur punct, după zi', () => {
    expect(roDigitsToPartialDate('150')).toBe('15.0')
    expect(roDigitsToPartialDate('1504')).toBe('15.04')
  })

  it('5-8 cifre -> ambele puncte, zi.lună.an(parțial)', () => {
    expect(roDigitsToPartialDate('15042')).toBe('15.04.2')
    expect(roDigitsToPartialDate('15042026')).toBe('15.04.2026')
  })

  it('o dată completă, corect tastată, rezolvă corect prin roDateToISO — bug-ul real găsit la verificarea manuală: fără puncte, "15042026" nu era niciodată recunoscut ca dată validă', () => {
    const typed = roDigitsToPartialDate('15042026')
    expect(roDateToISO(typed)).toBe('2026-04-15')
    expect(isIncompleteOrInvalidRoDate(typed)).toBe(false)
  })

  it('ignoră orice non-cifră din input (apărare suplimentară, nu doar la emitere)', () => {
    expect(roDigitsToPartialDate('15.04.2026')).toBe('15.04.2026')
  })
})

describe('roDateInputMask — scheletul zz.ll.aaaa, cu cifrele introduse suprapuse peste litere', () => {
  it('arată scheletul complet gol când nu s-a scris nimic', () => {
    expect(roDateInputMask('')).toBe('zz.ll.aaaa')
  })

  it('suprascrie literele cu cifrele deja introduse, pe măsură ce se tastează', () => {
    expect(roDateInputMask('1')).toBe('1z.ll.aaaa')
    expect(roDateInputMask('15')).toBe('15.ll.aaaa')
    expect(roDateInputMask('15.0')).toBe('15.0l.aaaa')
    expect(roDateInputMask('15.03')).toBe('15.03.aaaa')
    expect(roDateInputMask('15.03.2')).toBe('15.03.2aaa')
    expect(roDateInputMask('15.03.2026')).toBe('15.03.2026')
  })

  it('ignoră punctele scrise de mână — contează doar cifrele, limitate la 8', () => {
    expect(roDateInputMask('15..03..2026..9999')).toBe('15.03.2026')
  })
})

describe('roDateInputCaretPos — poziția cursorului după ultima cifră introdusă, sărind peste puncte', () => {
  it('sare peste punctele fixe de la pozițiile 2 și 5', () => {
    expect(roDateInputCaretPos(0)).toBe(0)
    expect(roDateInputCaretPos(1)).toBe(1)
    expect(roDateInputCaretPos(2)).toBe(3)
    expect(roDateInputCaretPos(3)).toBe(4)
    expect(roDateInputCaretPos(4)).toBe(6)
    expect(roDateInputCaretPos(8)).toBe(10)
  })
})

describe('roDateInputSlotAtCaret — inversul lui roDateInputCaretPos, pentru editare la poziția de click', () => {
  it('mapează fiecare poziție de start de cifră la indexul ei', () => {
    expect(roDateInputSlotAtCaret(0)).toBe(0)
    expect(roDateInputSlotAtCaret(1)).toBe(1)
    expect(roDateInputSlotAtCaret(3)).toBe(2)
    expect(roDateInputSlotAtCaret(4)).toBe(3)
    expect(roDateInputSlotAtCaret(6)).toBe(4)
    expect(roDateInputSlotAtCaret(9)).toBe(7)
    expect(roDateInputSlotAtCaret(10)).toBe(8)
  })

  it('rotunjește înainte peste punctele needitabile (pozițiile 2 și 5)', () => {
    expect(roDateInputSlotAtCaret(2)).toBe(2)
    expect(roDateInputSlotAtCaret(5)).toBe(4)
  })
})

describe('isValidRoDate — plauzibilitatea reală a datei, nu doar formatul', () => {
  it('respinge ziua/luna din afara intervalului (32 la zi, 13 la lună)', () => {
    expect(isValidRoDate('32.01.2026')).toBe(false)
    expect(isValidRoDate('00.01.2026')).toBe(false)
    expect(isValidRoDate('15.13.2026')).toBe(false)
    expect(isValidRoDate('15.00.2026')).toBe(false)
  })

  it('respinge zile care nu există în luna respectivă (inclusiv ani bisecți)', () => {
    expect(isValidRoDate('31.04.2026')).toBe(false)
    expect(isValidRoDate('30.02.2026')).toBe(false)
    expect(isValidRoDate('29.02.2026')).toBe(false)
    expect(isValidRoDate('29.02.2024')).toBe(true)
  })

  it('acceptă date valide', () => {
    expect(isValidRoDate('15.03.2026')).toBe(true)
    expect(isValidRoDate('31.01.2026')).toBe(true)
  })
})

describe('roDateToISO — nu mai întoarce un ISO pentru o dată cu zi/lună implauzibile', () => {
  it('string gol pentru zi/lună din afara intervalului, chiar dacă formatul e corect', () => {
    expect(roDateToISO('32.13.2026')).toBe('')
    expect(roDateToISO('31.04.2026')).toBe('')
  })

  it('ISO corect pentru o dată validă', () => {
    expect(roDateToISO('15.03.2026')).toBe('2026-03-15')
  })
})

describe('roDateInputError — semnalează ziua/luna greșite imediat ce segmentul e complet', () => {
  it('semnalează ziua invalidă imediat după cele 2 cifre, fără să aștepte luna/anul', () => {
    expect(roDateInputError('32')).toBe('Zi invalidă')
    expect(roDateInputError('00')).toBe('Zi invalidă')
  })

  it('semnalează luna invalidă imediat după cele 2 cifre ale lunii', () => {
    expect(roDateInputError('1513')).toBe('Lună invalidă')
  })

  it('semnalează zilele inexistente abia după ce toate cele 8 cifre sunt scrise', () => {
    expect(roDateInputError('3104')).toBeNull()
    expect(roDateInputError('31042026')).toBe('Luna 4 are 30 de zile')
  })

  it('null pentru dată parțială plauzibilă sau completă validă', () => {
    expect(roDateInputError('')).toBeNull()
    expect(roDateInputError('15')).toBeNull()
    expect(roDateInputError('1503')).toBeNull()
    expect(roDateInputError('15032026')).toBeNull()
  })
})
