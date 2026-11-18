import { describe, it, expect } from 'vitest'
import {
  buildAnexa2bDocxData, stareInitiala2b, verificari2b, avertismente2b, persoaneCandidatPF, CATALOG_21, CATALOG_22,
} from './anexa2bFiller'
import { dateFacturare } from './onrcCommon'
import type { Anexa2bFormState } from './anexa2bFiller'
import type { Client, Persoana } from '../types'
import ETICHETE from './anexa2bFiller.placeholders.json'

const persoana = (nume: string, prenume: string, extra: Partial<Persoana> = {}): Persoana => ({
  calitate: '', cotaParticipare: '', cnp: '', nume, prenume, serie_numar: '', data_nasterii: '',
  locul_nasterii: '', cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...extra,
})

const PFA: Partial<Client> = {
  tipClient: 'PF', subtipPF: 'PFA', denumire: 'POPESCU ION PERSOANĂ FIZICĂ AUTORIZATĂ', codFiscal: '44556677', nrRegistrul: 'F12/34/2021',
  sediuSocial: { localitate: 'Cluj-Napoca', strada: 'Florilor', numar: '2', bloc: '', scara: '', etaj: '', apartament: '', judet: 'Cluj' },
  caenCod: '6201', caenDescriere: 'Activități de realizare a soft-ului la comandă',
  caenSecundare: [{ cod: '6202', descriere: 'Consultanță în tehnologia informației' }],
  puncteLucru: [],
  titular: persoana('Popescu', 'Ion', { cnp: '1800101400011', serie_numar: 'CJ 123456', adresa: 'Mun. Cluj-Napoca, Str. Florilor nr. 2, jud. Cluj' }),
  asociati: [], administratori: [],
}

const IF: Partial<Client> = {
  ...PFA, subtipPF: 'IF', denumire: 'POPESCU ÎNTREPRINDERE FAMILIALĂ',
  membriIF: [persoana('Popescu', 'Maria', { cnp: '2800101400012' }), persoana('Popescu', 'Andrei'), persoana('Popescu', 'Elena')],
}

const cu = (s: Anexa2bFormState, patch: Partial<Anexa2bFormState>): Anexa2bFormState => ({ ...s, ...patch })

describe('acoperirea etichetelor din document', () => {
  it('completează exact etichetele din șablon, niciuna goală', () => {
    const toate = cu(stareInitiala2b(IF), { puncte: [1, 2, 3, 4, 5] })
    toate.vii = { ...toate.vii, moduri: ['INREGISTRARE', 'MODIFICARE'], on: { inreg: true, renuntare: true, completare: true } }
    for (const s of [stareInitiala2b(null), stareInitiala2b(PFA), stareInitiala2b({ ...IF, inInfiintare: true }), toate]) {
      const { replacements } = buildAnexa2bDocxData(s)
      expect(Object.keys(replacements).sort()).toEqual([...ETICHETE].sort())
      expect(Object.entries(replacements).filter(([, v]) => !v)).toEqual([])
    }
  })

  it('catalogurile 2.1/2.2 folosesc doar etichete care există în document', () => {
    const all = new Set<string>(ETICHETE)
    for (const el of [...CATALOG_21, ...CATALOG_22].flatMap(g => g.elemente)) {
      if (el.box) expect(all.has(`{{A2B_B_${el.box}}}`), el.id).toBe(true)
      for (const g of el.grupuri ?? []) for (const o of g.optiuni) expect(all.has(`{{A2B_${g.simbol}_${o.tag}}}`), o.tag).toBe(true)
      for (const t of el.texte ?? []) expect(all.has(`{{A2B_T_${t.tag}}}`), t.tag).toBe(true)
    }
  })
})

describe('precompletarea din fișă', () => {
  it('PFA: forma, titularul la IV, firma și punctul de mențiuni', () => {
    const s = stareInitiala2b(PFA)
    expect(s.entitate).toBe('PFA')
    expect(s.orcTribunal).toBe('CLUJ')
    expect(s.puncte).toEqual([2])
    expect(s.sub).toMatchObject({ nume: 'Popescu', prenume: 'Ion', cnp: '1800101400011', actSeria: 'CJ', actNr: '123456' })
    expect(s.subCalitate).toBe('persoană fizică autorizată')
    expect(s.firma).toMatchObject({ firma: PFA.denumire, cui: '44556677', nrReg: 'F12/34/2021', loc: 'Cluj-Napoca' })
    expect(s.vii.moduri).toEqual([])
    expect(s.vii.principal).toEqual({ cod: '6201', den: 'Activități de realizare a soft-ului la comandă' })
  })

  it('în înființare: înregistrare, cu obiectul de activitate din fișă', () => {
    const s = stareInitiala2b({ ...PFA, inInfiintare: true, puncteLucru: ['Cluj-Napoca, str. Morii nr. 1'] })
    expect(s.puncte).toEqual([1])
    expect(s.vii.moduri).toEqual(['INREGISTRARE'])
    expect(s.vii.on.inreg).toBe(true)
    expect(s.vii.liste.inreg[0]).toEqual({ cod: '6202', den: 'Consultanță în tehnologia informației' })
    expect(s.viii).toMatchObject({ inf: true, infText: 'Cluj-Napoca, str. Morii nr. 1' })
  })

  it('IF: reprezentantul la IV, primii doi membri la V', () => {
    const s = stareInitiala2b(IF)
    expect(s.subCalitate).toBe('reprezentant')
    expect(s.membri.map(m => m.p.prenume)).toEqual(['Maria', 'Andrei'])
    expect(s.membri.every(m => m.calitate === 'membru')).toBe(true)
    expect(avertismente2b(s, IF).some(w => w.includes('anexă (nota 2)'))).toBe(true)
  })

  it('candidații: titularul, apoi membrii IF', () => {
    expect(persoaneCandidatPF(IF).map(c => `${c.label}|${c.calitate}`)).toEqual([
      'Popescu Ion|reprezentant', 'Popescu Maria|membru', 'Popescu Andrei|membru', 'Popescu Elena|membru',
    ])
  })
})

describe('buildAnexa2bDocxData', () => {
  it('bifează forma și tipul cererii; punctele nealese rămân punctate', () => {
    const { replacements: r } = buildAnexa2bDocxData(stareInitiala2b(PFA))
    expect(r['{{A2B_B_ENT_PFA}}']).toBe('☒')
    expect(r['{{A2B_B_ENT_IF}}']).toBe('☐')
    expect(r['{{A2B_B_TIP_MENTIUNI}}']).toBe('☒')
    expect(r['{{A2B_B_S2}}']).toBe('☒')
    expect(r['{{A2B_S2_FIRMA}}']).toBe(PFA.denumire)
    expect(r['{{A2B_S2_EUID}}']).toBe('ROONRC.F12/34/2021')
    expect(r['{{A2B_S1_FIRMA}}']).toMatch(/^\.+$/)
    expect(r['{{A2B_S4_FIRMA}}']).toMatch(/^\.+$/)
  })

  it('membrii IF apar doar la întreprinderea familială', () => {
    const s = stareInitiala2b(IF)
    expect(buildAnexa2bDocxData(s).replacements['{{A2B_M1_PRENUME}}']).toBe('Maria')
    expect(buildAnexa2bDocxData(cu(s, { entitate: 'II' })).replacements['{{A2B_M1_PRENUME}}']).toMatch(/^\.+$/)
  })

  it('VII: tabelele se completează după modurile alese; „doar actualizare” lasă doar activitatea principală', () => {
    const s = stareInitiala2b({ ...PFA, inInfiintare: true })
    let r = buildAnexa2bDocxData(s).replacements
    expect(r['{{A2B_B_VII_INREGISTRARE}}']).toBe('☒')
    expect(r['{{A2B_CAEN_P_COD}}']).toBe('6201')
    expect(r['{{A2B_B_CAEN_INREG}}']).toBe('☒')
    expect(r['{{A2B_CAEN_INREG_1_COD}}']).toBe('6202')
    expect(r['{{A2B_CAEN_INREG_2_COD}}']).toBe(' ')

    const act = cu(s, { vii: { ...s.vii, moduri: ['ACTUALIZARE'] } })
    r = buildAnexa2bDocxData(act).replacements
    expect(r['{{A2B_B_TIP_CAEN}}']).toBe('☒')
    expect(r['{{A2B_CAEN_P_COD}}']).toBe('6201')
    expect(r['{{A2B_B_CAEN_INREG}}']).toBe('☐')
    expect(r['{{A2B_CAEN_INREG_1_COD}}']).toBe(' ')
    expect(avertismente2b(act).some(w => w.includes('nota 9'))).toBe(true)

    r = buildAnexa2bDocxData(stareInitiala2b(PFA)).replacements
    expect(r['{{A2B_CAEN_P_COD}}']).toBe(' ')
  })

  it('rândurile CAEN goale din mijloc nu lasă găuri', () => {
    const s = stareInitiala2b({ ...PFA, inInfiintare: true })
    const liste = { ...s.vii.liste, inreg: [{ cod: '', den: '' }, { cod: '7022', den: 'Consultanță' }, ...s.vii.liste.inreg.slice(2)] }
    const r = buildAnexa2bDocxData(cu(s, { vii: { ...s.vii, liste } })).replacements
    expect(r['{{A2B_CAEN_INREG_1_COD}}']).toBe('7022')
  })

  it('opis: primele 7 denumiri sunt tipărite, 8–11 vin din formular; totalul se adună', () => {
    const s = stareInitiala2b(PFA)
    s.opis[1] = { den: '', nrData: 'Contract comodat', file: '3' }
    s.opis[7] = { den: 'Specimen de semnătură', nrData: '', file: '1' }
    const r = buildAnexa2bDocxData(s).replacements
    expect(r['{{A2B_OPIS_1_DEN}}']).toBeUndefined()
    expect(r['{{A2B_OPIS_2_NRDATA}}']).toBe('Contract comodat')
    expect(r['{{A2B_OPIS_8_DEN}}']).toBe('Specimen de semnătură')
    expect(r['{{A2B_OPIS_TOTAL}}']).toBe('4')
  })

  it('radiere: motivul ales', () => {
    const r = buildAnexa2bDocxData(cu(stareInitiala2b(PFA), { puncte: [4], s4Motiv: 'CERERE' })).replacements
    expect(r['{{A2B_B_S4_CERERE}}']).toBe('☒')
    expect(r['{{A2B_B_S4_DECES}}']).toBe('☐')
  })

  it('comunicare la biroul Primăriei', () => {
    const s = stareInitiala2b(PFA)
    const r = buildAnexa2bDocxData(cu(s, { ix: { ...s.ix, comunicare: true, modalitate: 'PRIMARIE', primarie: 'Cluj-Napoca' } })).replacements
    expect(r['{{A2B_O_PRIMARIE}}']).toBe('●')
    expect(r['{{A2B_T_PRIMARIE}}']).toBe('Cluj-Napoca')
    expect(r['{{A2B_O_POSTA}}']).toBe('○')
  })

  it('facturare pe firmă: denumirea, CUI-ul și sediul profesional', () => {
    expect(dateFacturare(stareInitiala2b(PFA))).toMatchObject({ nume: PFA.denumire, cnpCui: '44556677', adresa: 'Cluj-Napoca, str. Florilor, nr. 2, jud. Cluj' })
  })
})

describe('verificări și avertismente', () => {
  it('PFA din fișă: doar mențiunea de ales lipsește', () => {
    expect(verificari2b(stareInitiala2b(PFA)).filter(c => c.invalid).map(c => c.id)).toEqual(['s2-ceva'])
  })

  it('fără client: forma, subsemnatul și punctele', () => {
    const ids = verificari2b(stareInitiala2b(null)).filter(c => c.invalid).map(c => c.id)
    expect(ids).toEqual(expect.arrayContaining(['orc', 'entitate', 'sub-nume', 'sub-cnp', 'puncte']))
  })

  it('PFA cu prea multe clase CAEN', () => {
    const s = stareInitiala2b({ ...PFA, inInfiintare: true })
    const inreg = s.vii.liste.inreg.map((_, i) => ({ cod: String(1000 + i), den: 'x' }))
    expect(avertismente2b(cu(s, { vii: { ...s.vii, liste: { ...s.vii.liste, inreg } } })).some(w => w.includes('cel mult 5'))).toBe(true)
  })
})
