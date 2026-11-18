import { describe, it, expect } from 'vitest'
import {
  buildAnexa2aDocxData, stareInitiala, verificari, avertismente, CATALOG_41, CATALOG_42,
} from './anexa2aFiller'
import { tribunalDinJudet, totalFile, persoanaDinFisa, persoanaDinBuletin, dateFacturare } from './onrcCommon'
import type { Anexa2aFormState } from './anexa2aFiller'
import type { Client, Persoana } from '../types'
import ETICHETE from './anexa2aFiller.placeholders.json'

const persoana = (nume: string, prenume: string, extra: Partial<Persoana> = {}): Persoana => ({
  calitate: '', cotaParticipare: '', cnp: '', nume, prenume, serie_numar: '', data_nasterii: '',
  locul_nasterii: '', cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...extra,
})

const CLIENT: Partial<Client> = {
  tipClient: 'PJ', denumire: 'EXEMPLU SRL', codFiscal: '12345678', nrRegistrul: 'J40/123/2020', email: 'office@exemplu.ro', telefon: '0700000000',
  sediuSocial: { localitate: 'București', strada: 'Lalelelor', numar: '5', bloc: '', scara: '', etaj: '', apartament: '', judet: 'București - Sector 3' },
  caenCod: '6201', caenDescriere: 'Activități de realizare a soft-ului la comandă',
  administratori: [persoana('Popescu', 'Ion', { cnp: '1800101400011', serie_numar: 'RX 123456', adresa: 'Mun. Cluj-Napoca, Str. Florilor nr. 2, jud. Cluj', cetatenia: 'Română' })],
  asociati: [],
}

const cu = (s: Anexa2aFormState, patch: Partial<Anexa2aFormState>): Anexa2aFormState => ({ ...s, ...patch })

describe('acoperirea etichetelor din document', () => {
  it('completează exact etichetele din șablon, niciuna goală (serverul ignoră valorile goale și ar lăsa eticheta în document)', () => {
    for (const s of [stareInitiala(null), stareInitiala(CLIENT), cu(stareInitiala(CLIENT), { puncte: [1, 2, 3, 4, 5, 6, 7, 8] })]) {
      const { replacements } = buildAnexa2aDocxData(s)
      expect(Object.keys(replacements).sort()).toEqual([...ETICHETE].sort())
      expect(Object.entries(replacements).filter(([, v]) => !v)).toEqual([])
    }
  })

  it('catalogurile 4.1/4.2 folosesc doar etichete care există în document', () => {
    const all = new Set<string>(ETICHETE)
    for (const el of [...CATALOG_41, ...CATALOG_42].flatMap(g => g.elemente)) {
      if (el.box) expect(all.has(`{{A2A_B_${el.box}}}`), el.id).toBe(true)
      for (const g of el.grupuri ?? []) for (const o of g.optiuni) expect(all.has(`{{A2A_${g.simbol}_${o.tag}}}`), o.tag).toBe(true)
      for (const t of el.texte ?? []) expect(all.has(`{{A2A_T_${t.tag}}}`), t.tag).toBe(true)
    }
  })
})

describe('precompletarea din fișă', () => {
  it('tribunalul e județul sediului fără sector, cu majuscule', () => {
    expect(tribunalDinJudet('București - Sector 3')).toBe('BUCUREȘTI')
    expect(tribunalDinJudet('Cluj')).toBe('CLUJ')
    expect(tribunalDinJudet(undefined)).toBe('')
  })

  it('firma, subsemnatul (singurul administrator) și obiectul CAEN', () => {
    const s = stareInitiala(CLIENT)
    expect(s.orcTribunal).toBe('BUCUREȘTI')
    expect(s.puncte).toEqual([4])
    expect(s.firma).toMatchObject({ firma: 'EXEMPLU SRL', cui: '12345678', nrReg: 'J40/123/2020', euid: 'ROONRC.J40/123/2020', loc: 'București', jud: 'București - Sector 3' })
    expect(s.sub).toMatchObject({ nume: 'Popescu', prenume: 'Ion', cnp: '1800101400011', actSeria: 'RX', actNr: '123456', cet: 'română' })
    expect(s.subCalitate).toBe('administrator')
    expect(s.s8Obiect).toBe('6201 - Activități de realizare a soft-ului la comandă')
  })

  it('client în înființare: punctul implicit e înmatricularea', () => {
    expect(stareInitiala({ ...CLIENT, inInfiintare: true }).puncte).toEqual([1])
  })

  it('persoanaDinFisa desparte domiciliul în câmpuri', () => {
    const p = persoanaDinFisa(CLIENT.administratori![0])
    expect(p.domLoc).toContain('Cluj-Napoca')
    expect(p.domStr).toContain('Florilor')
    expect(p.domNr).toBe('2')
    expect(p.domJud).toBe('Cluj')
  })
})

describe('buildAnexa2aDocxData', () => {
  it('bifează tipul cererii și punctul ales; celelalte puncte rămân punctate', () => {
    const { replacements: r } = buildAnexa2aDocxData(stareInitiala(CLIENT))
    expect(r['{{A2A_B_TIP_MENTIUNI}}']).toBe('☒')
    expect(r['{{A2A_B_TIP_INMATRICULARE}}']).toBe('☐')
    expect(r['{{A2A_B_S4}}']).toBe('☒')
    expect(r['{{A2A_S4_FIRMA}}']).toBe('EXEMPLU SRL')
    expect(r['{{A2A_S4_BL}}']).toBe('-')          // în punctul ales, un câmp gol = „-”
    expect(r['{{A2A_S1_FIRMA}}']).toMatch(/^\.+$/) // punctul 1 nu e ales: puncte
    expect(r['{{A2A_S6_FIRMA}}']).toMatch(/^\.+$/)
    expect(r['{{A2A_ORC_TRIBUNAL}}']).toBe('BUCUREȘTI')
  })

  it('4.1: caseta rândului, opțiunea aleasă și caseta-titlu se bifează; numărul gol rămâne punctat', () => {
    const s = cu(stareInitiala(CLIENT), {
      s41: {
        CAPITAL: { on: true, optiuni: ['41_MAJORARE'], texte: {} },
        TRANSMITERE: { on: true, optiuni: [], texte: {} },
        SUSPENDARE: { on: false, optiuni: ['41_RELUARE'], texte: {} },
      },
    })
    const { replacements: r } = buildAnexa2aDocxData(s)
    expect(r['{{A2A_B_41}}']).toBe('☒')
    expect(r['{{A2A_B_41_CAPITAL}}']).toBe('☒')
    expect(r['{{A2A_O_41_MAJORARE}}']).toBe('●')
    expect(r['{{A2A_O_41_REDUCERE}}']).toBe('○')
    expect(r['{{A2A_B_41_RELUARE}}']).toBe('☒')
    expect(r['{{A2A_B_41_SUSPENDARE}}']).toBe('☐')
    expect(r['{{A2A_T_41_TRANSMITERE_NR}}']).toMatch(/^\.+$/)
    expect(r['{{A2A_B_42}}']).toBe('☐')
  })

  it('o mențiune rămasă în stare nu apare dacă punctul 4 nu mai e ales', () => {
    const s = cu(stareInitiala(CLIENT), { puncte: [8], s41: { CAPITAL: { on: true, optiuni: ['41_MAJORARE'], texte: {} } } })
    const { replacements: r } = buildAnexa2aDocxData(s)
    expect(r['{{A2A_B_41_CAPITAL}}']).toBe('☐')
    expect(r['{{A2A_O_41_MAJORARE}}']).toBe('○')
    expect(r['{{A2A_B_41}}']).toBe('☐')
    expect(r['{{A2A_S8_OBIECT}}']).toContain('6201')
  })

  it('textul legat de o opțiune apare doar când opțiunea e aleasă', () => {
    const base = stareInitiala(CLIENT)
    const fara = buildAnexa2aDocxData(cu(base, { s41: { SEDII: { on: true, optiuni: ['41_SEDII_DESF'], texte: { '41_SEDII_INF_NR': '2' } } } })).replacements
    expect(fara['{{A2A_T_41_SEDII_INF_NR}}']).toMatch(/^\.+$/)
    const cuOpt = buildAnexa2aDocxData(cu(base, { s41: { SEDII: { on: true, optiuni: ['41_SEDII_INF'], texte: { '41_SEDII_INF_NR': '2' } } } })).replacements
    expect(cuOpt['{{A2A_T_41_SEDII_INF_NR}}']).toBe('2')
  })

  it('opisul: celulele goale sunt un spațiu, totalul e suma filelor', () => {
    const s = stareInitiala(CLIENT)
    s.opis.randuri[0] = { den: 'Hotărârea AGA nr. 1', nrData: '1/01.11.2026', file: '2' }
    s.opis.randuri[1] = { den: 'Act constitutiv actualizat', nrData: '', file: '5' }
    const { replacements: r } = buildAnexa2aDocxData(s)
    expect(r['{{A2A_OPIS_1_DEN}}']).toBe('Hotărârea AGA nr. 1')
    expect(r['{{A2A_OPIS_2_NRDATA}}']).toBe(' ')
    expect(r['{{A2A_OPIS_TOTAL}}']).toBe('7')
    expect(r['{{A2A_OPIS_7_DEN}}']).toBe(' ')
  })

  it('deponentul (XII) rămâne punctat dacă e chiar semnatarul', () => {
    const { replacements: r } = buildAnexa2aDocxData(stareInitiala(CLIENT))
    expect(r['{{A2A_DEP_NUME}}']).toMatch(/^\.+$/)
    expect(r['{{A2A_X_NUME}}']).toBe('Popescu Ion')
  })

  it('comunicarea (VII) preia implicit persoana de la IV', () => {
    const { replacements: r } = buildAnexa2aDocxData(stareInitiala(CLIENT))
    expect(r['{{A2A_COM_NUME}}']).toBe('Popescu')
    expect(r['{{A2A_COM_LOC}}']).toContain('Cluj-Napoca')
  })
})

describe('date de facturare și opis', () => {
  it('facturare pe firmă: denumire, CUI și sediul', () => {
    const f = dateFacturare(stareInitiala(CLIENT))
    expect(f.nume).toBe('EXEMPLU SRL')
    expect(f.cnpCui).toBe('12345678')
    expect(f.adresa).toBe('București, str. Lalelelor, nr. 5, jud. București - Sector 3')
  })

  it('totalFile ignoră rândurile fără număr', () => {
    expect(totalFile([{ file: '3' }, { file: '' }, { file: 'x' }, { file: '4' }])).toBe('7')
    expect(totalFile([{ file: '' }])).toBe('')
  })
})

describe('verificari', () => {
  it('starea precompletată e completă pentru o mențiune, după ce se alege ce se înscrie', () => {
    const s = stareInitiala(CLIENT)
    expect(verificari(s).filter(c => c.invalid).map(c => c.id)).toEqual(['s4-ceva'])
    const ok = cu(s, { s43: true })
    expect(verificari(ok).filter(c => c.invalid)).toEqual([])
  })

  it('fără client: cere tribunalul, subsemnatul și punctele', () => {
    const ids = verificari(stareInitiala(null)).filter(c => c.invalid).map(c => c.id)
    expect(ids).toEqual(expect.arrayContaining(['orc', 'sub-nume', 'sub-cnp', 'sub-calitate', 'puncte']))
  })

  it('cere câmpurile proprii fiecărui punct ales', () => {
    const s = cu(stareInitiala(CLIENT), { puncte: [2, 6, 7] })
    const ids = verificari(s).filter(c => c.invalid).map(c => c.id)
    expect(ids).toEqual(expect.arrayContaining(['s2-firma', 's2-puteri', 's6-tip', 's6-motiv', 's7-act', 's7-seva']))
    expect(ids).not.toContain('s4-ceva')
  })
})

describe('avertismente', () => {
  it('schimbarea sediului fără declarația 4.3', () => {
    const s = cu(stareInitiala(CLIENT), { s41: { SEDIU: { on: true, optiuni: [], texte: {} } } })
    expect(avertismente(s).join(' ')).toContain('4.3')
    expect(avertismente(cu(s, { s43: true }))).toEqual([])
  })
})

describe('persoanaDinBuletin', () => {
  it('completează ce s-a citit și păstrează restul (inclusiv țara și tipul actului)', () => {
    const prev = { ...persoanaDinFisa(persoana('Vechi', 'Nume')), actTip: 'Pașaport', domBl: 'B2', domTara: 'Moldova' }
    const out = persoanaDinBuletin(prev, {
      cnp: '2900202400022', nume: 'Avram', prenume: 'Elena', serie_numar: 'XB 654321', data_nasterii: '02.02.1990',
      locul_nasterii: '', cetatenia: 'Română', adresa: 'Mun. Iași, Str. Lungă nr. 7, jud. Iași', judet: 'Iași',
      emisa_de: 'SPCLEP Iași', valabila_de_la: '', valabila_pana_la: '02.02.2032',
    })
    expect(out).toMatchObject({ nume: 'Avram', prenume: 'Elena', cnp: '2900202400022', actSeria: 'XB', actNr: '654321',
      domLoc: 'Iași', domStr: 'Lungă', domNr: '7', domJud: 'Iași', cet: 'română', actValabil: '02.02.2032' })
    expect(out.domBl).toBe('B2')
    expect(out.actTip).toBe('Pașaport')
    expect(out.domTara).toBe('Moldova')
  })
})
