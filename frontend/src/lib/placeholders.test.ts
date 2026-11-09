import { describe, it, expect } from 'vitest'
import {
  buildReplacements, buildRepeatGroups, checkReadiness, joinNames, persoaneActualizate, mandateActualizate, isManualPlaceholder, manualLabel,
  detectCustomPersonRoles, customPersonReplacements, roleLabel, groupMissingFields,
  visibleManualPlaceholders, MOD_EXERCITARE_MANDATE,
  actualizareGroups, withoutActualizareFields, defaultActMode,
  detectCustomPersonGroups, persoanaToSingularMap, isReprezentantRole, customRolePool, HAND_FILL_BLANK, caenFieldKind,
} from './placeholders'
import type { Client, Persoana } from '../types'
import { CAEN_CODES } from '../data/caen'
import { findCaenGrupaDescriere } from '../data/caenGrupe'

const client = (over: Partial<Client>): Partial<Client> => ({
  tipClient: 'PJ', caenCod: '7020', caenDescriere: 'Activități de consultanță', caenSecundare: [], asociati: [], administratori: [], ...over,
})
const build = (c: Partial<Client>) => buildReplacements({ idFields: null, client: c as Client, scannedPersons: [] })

describe('valoarea părții sociale în litere', () => {
  it('din câmpul clientului, implicit 10', () => {
    expect(build(client({}))['{{VALOARE_PARTE_SOCIALA_LITERE}}']).toBe('zece')
    expect(build(client({ valoareParteSociala: 25 }))['{{VALOARE_PARTE_SOCIALA_LITERE}}']).toBe('douăzeci și cinci')
  })
})

describe('tribunalul și EUID-ul societății', () => {
  it('tribunalul e județul sediului; în București, fără sector', () => {
    expect(build(client({ sediuSocial: { judet: 'Arad' } as Client['sediuSocial'] }))['{{SOCIETATE_TRIBUNAL}}']).toBe('Arad')
    expect(build(client({ sediuSocial: { judet: 'București - Sector 1' } as Client['sediuSocial'] }))['{{SOCIETATE_TRIBUNAL}}']).toBe('București')
  })

  it('EUID = ROONRC. + numărul de înmatriculare; firmă în înființare → loc de completat de mână', () => {
    expect(build(client({ nrRegistrul: 'J2/123/2020' }))['{{SOCIETATE_EUID}}']).toBe('ROONRC.J2/123/2020')
    expect(build(client({ nrRegistrul: 'J2024 000123 123' }))['{{SOCIETATE_EUID}}']).toBe('ROONRC.J2024000123123')
    expect(build(client({ nrRegistrul: '', inInfiintare: true }))['{{SOCIETATE_EUID}}']).toBe(HAND_FILL_BLANK)
  })
})

describe('coduri CAEN pentru clauza „Actualizare cod CAEN REV3”', () => {
  it('principalul și secundarele apar doar ca coduri, pe o linie', () => {
    const r = build(client({ caenSecundare: [
      { cod: '4100', descriere: 'Construcții' }, { cod: '4311', descriere: 'Demolări' }, { cod: '7311', descriere: 'Publicitate' },
    ] }))
    expect(r['{{CAEN_PRINCIPAL_COD}}']).toBe('7020')
    expect(r['{{CAEN_SECUNDARE_COD}}']).toBe('4100, 4311, 7311')
    expect(r['{{CAEN_1}}']).toContain('Activități')            // formatul „cod - descriere” rămâne neschimbat
  })

  it('PFA/II/IF: blocul {{#CAEN_SECUNDARE}} primește activitățile secundare, fără asociați/administratori', () => {
    const c = client({ tipClient: 'PF', caenSecundare: [{ cod: '4100', descriere: 'Construcții' }] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.CAEN_SECUNDARE).toHaveLength(1)
    expect(groups.CAEN_SECUNDARE[0].CAEN).toContain('4100')
    expect(groups.ASOCIATI).toBeUndefined()
    expect(checkReadiness(['{{CAEN}}'], build(c), groups).missing).toEqual([])
  })

  it('un rând CAEN secundar lăsat gol în fișă nu face câmpul să pară lipsă', () => {
    const c = client({ caenSecundare: [{ cod: '4100', descriere: 'Construcții' }, { cod: '', descriere: '' }] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.CAEN_SECUNDARE).toHaveLength(1)
    expect(checkReadiness(['{{CAEN}}'], build(c), groups).missing).toEqual([])
  })

  it('codul și denumirea separat: principal, domeniu (grupa) și fiecare activitate secundară', () => {
    const c = client({ caenSecundare: [{ cod: '7311', descriere: 'Activități ale agențiilor de publicitate' }] })
    const r = build(c)
    expect(r['{{CAEN_PRINCIPAL_DENUMIRE}}']).toBe('Activități de consultanță')
    expect(r['{{CAEN_DOMENIU_COD}}']).toBe('702')
    expect(r['{{CAEN_DOMENIU}}']).toBe(`702 - ${r['{{CAEN_DOMENIU_DENUMIRE}}']}`)
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.CAEN_SECUNDARE[0]).toMatchObject({ COD: '7311', DENUMIRE: 'Activități ale agențiilor de publicitate' })
    expect(checkReadiness(['{{COD}}', '{{DENUMIRE}}'], r, groups).missing).toEqual([])
  })

  it('fără CAEN secundare: „-”; fără CAEN principal: gol (rămâne de completat)', () => {
    expect(build(client({}))['{{CAEN_SECUNDARE_COD}}']).toBe('-')
    expect(build(client({ caenCod: '' }))['{{CAEN_PRINCIPAL_COD}}']).toBe('')
  })
})

describe('caenFieldKind — câmpurile de clauză care primesc lista CAEN', () => {
  it('recunoaște activitatea principală (cod + denumire) și doar codul; restul rămân text', () => {
    expect(caenFieldKind('CAEN_1')).toBe('full')
    expect(caenFieldKind('CAEN_PRINCIPAL_COD')).toBe('cod')
    expect(caenFieldKind('CAEN_SECUNDARE_COD')).toBeNull()
    expect(caenFieldKind('SEDIU_NOU')).toBeNull()
  })
})

describe('CAEN_DOMENIU —„domeniul principal de activitate” (grupa CAEN, 3 cifre), derivată din codul principal', () => {
  it('grupa (3 cifre) și denumirea ei oficială, derivate din clasa (4 cifre) aleasă de client', () => {
    const r = build(client({ caenCod: '7020', caenDescriere: 'Activități de consultanță pentru afaceri' }))
    expect(r['{{CAEN_DOMENIU}}']).toBe('702 - Activităţi de consultanţă în afaceri şi management')
    expect(r['{{CAEN_1}}']).toBe('7020 - Activități de consultanță pentru afaceri')   // clasa rămâne distinctă
  })

  it('cod CAEN necunoscut în lista de grupe: rămâne doar codul de 3 cifre, fără denumire', () => {
    const r = build(client({ caenCod: '9999' }))
    expect(r['{{CAEN_DOMENIU}}']).toBe('999')
  })

  it('fără CAEN principal completat: gol, fără eroare', () => {
    expect(build(client({ caenCod: '' }))['{{CAEN_DOMENIU}}']).toBe('')
  })

  it('fiecare cod din lista CAEN are grupa lui (aceeași revizie — Rev.3), ca domeniul să nu ajungă de completat manual', () => {
    expect(CAEN_CODES.filter(c => !findCaenGrupaDescriere(c.cod)).map(c => c.cod)).toEqual([])
    expect(build(client({ caenCod: '6210' }))['{{CAEN_DOMENIU_DENUMIRE}}']).toBe('Activităţi de programare')
  })
})

describe('etichete pentru șabloane importate din documente cu locuri libere', () => {
  const p = (o: Partial<Persoana>): Persoana => ({
    calitate: 'Asociat', cotaParticipare: '50%', cnp: '', nume: '', prenume: '', serie_numar: '', data_nasterii: '', locul_nasterii: '',
    cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...o,
  })
  const c = client({
    sediuSocial: { judet: 'Timiș', localitate: 'Timișoara', strada: 'Exemplu', numar: '1', bloc: '', scara: '', etaj: '', apartament: '', detaliiAdresa: '' } as never,
    capitalSocial: 200,
    asociati: [p({ nume: 'Ionescu', prenume: 'Maria', serie_numar: 'CJ 123456' }), p({ nume: 'Popescu', prenume: 'Ion' })],
    administratori: [p({ nume: 'Popescu', prenume: 'Ion' })],
  })
  const r = build(c)

  it('județul sediului, seria și numărul actului separat, listele de nume', () => {
    expect(r['{{SOCIETATE_JUDET}}']).toBe('Timiș')
    expect(r['{{ASOCIAT_1_SERIE_ACT}}']).toBe('CJ')
    expect(r['{{ASOCIAT_1_NR_ACT}}']).toBe('123456')
    expect(r['{{ASOCIATI_LISTA}}']).toBe('Ionescu Maria și Popescu Ion')
    expect(r['{{ADMINISTRATORI_LISTA}}']).toBe('Popescu Ion')
    expect(r['{{CAPITAL_SOCIAL_ASOCIAT_1}}']).toBe('100')
  })

  it('joinNames: unul, doi, trei sau niciunul', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames([p({ nume: 'A', prenume: 'a' })])).toBe('A a')
    expect(joinNames([p({ nume: 'A' }), p({ nume: 'B' }), p({ nume: 'C' })])).toBe('A, B și C')
  })

  describe('mandateActualizate: clauza „Durata mandatului” cu durate diferite, pe tag-urile frazei avocatului', () => {
    const ani = (n: number) => ({ tip: 'ani' as const, ani: String(n), data: '' })
    const nedet = { tip: 'nedeterminata' as const, ani: '', data: '' }
    const fraza = (r: { rol: string; nume: string; durata: string }) => `durata mandatului ${r.rol} ${r.nume} ca fiind ${r.durata}.`
    const A = p({ nume: 'POP', prenume: 'ION' }), B = p({ nume: 'DAN', prenume: 'VASILE' }), C = p({ nume: 'RUS', prenume: 'ANA' })

    it('aceeași durată: ca până acum — toți într-un singur grup', () => {
      expect(fraza(mandateActualizate([{ persoana: A, durata: ani(4) }, { persoana: B, durata: ani(4) }])))
        .toBe('durata mandatului administratorilor POP ION și DAN VASILE ca fiind de 4 ani.')
    })
    it('două durate: „respectiv” înaintea celei de-a doua', () => {
      expect(fraza(mandateActualizate([{ persoana: A, durata: ani(4) }, { persoana: C, durata: nedet }])))
        .toBe('durata mandatului administratorului POP ION ca fiind de 4 ani, respectiv a mandatului administratorului RUS ANA ca fiind nedeterminată.')
    })
    it('trei durate, iar cei cu aceeași durată grupați („a mandatelor administratorilor”)', () => {
      const D = p({ nume: 'ENE', prenume: 'MARIA' })
      expect(fraza(mandateActualizate([
        { persoana: A, durata: ani(4) }, { persoana: B, durata: ani(2) }, { persoana: C, durata: nedet }, { persoana: D, durata: ani(2) },
      ]))).toBe('durata mandatului administratorului POP ION ca fiind de 4 ani, a mandatelor administratorilor DAN VASILE și ENE MARIA '
        + 'ca fiind de 2 ani, respectiv a mandatului administratorului RUS ANA ca fiind nedeterminată.')
    })
    it('niciun administrator: totul gol', () => {
      expect(mandateActualizate([])).toEqual({ rol: '', nume: '', durata: '' })
    })
  })

  it('persoaneActualizate: forma după câte persoane sunt bifate, nu după câte are firma', () => {
    expect(persoaneActualizate([], 'asociat')).toEqual({ rol: '', nume: '' })
    expect(persoaneActualizate([p({ nume: 'CIUȘ', prenume: 'ADELINA-LARISA' })], 'asociat'))
      .toEqual({ rol: 'asociatului', nume: 'CIUȘ ADELINA-LARISA' })
    expect(persoaneActualizate([p({ nume: 'A', prenume: 'a' }), p({ nume: 'B', prenume: 'b' })], 'asociat'))
      .toEqual({ rol: 'asociaților', nume: 'A a și B b' })
    expect(persoaneActualizate([p({ nume: 'A', prenume: 'a' })], 'administrator').rol).toBe('administratorului')
    expect(persoaneActualizate([p({ nume: 'A' }), p({ nume: 'B' })], 'administrator').rol).toBe('administratorilor')
  })


  it('câmpuri manuale {{CAMP_…}}: recunoscute și cu titlu citibil', () => {
    expect(isManualPlaceholder('{{CAMP_NR_HOTARARE}}')).toBe(true)
    expect(isManualPlaceholder('{{CAMPUL}}')).toBe(false)
    expect(isManualPlaceholder('{{ASOCIAT_1_NUME}}')).toBe(false)
    expect(manualLabel('{{CAMP_NR_HOTARARE}}')).toBe('Nr hotarare')
  })
})

describe('buildRepeatGroups — {{#ASOCIATI}}/{{#ADMINISTRATORI}}, pentru șabloane cu bloc repetitiv', () => {
  const p = (o: Partial<Persoana>): Persoana => ({
    calitate: 'Asociat', cotaParticipare: '50%', cnp: '', nume: '', prenume: '', serie_numar: '', data_nasterii: '', locul_nasterii: '',
    cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...o,
  })

  it('SERIE și NR_ACT sunt despărțite ca la pozițiile numerotate (Serie & Nr. CI e un singur câmp în fișă)', () => {
    const c = client({ asociati: [p({ nume: 'Ionescu', prenume: 'Maria', serie_numar: 'AR 123456' })], administratori: [] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.ASOCIATI[0].SERIE_ACT).toBe('AR')
    expect(groups.ASOCIATI[0].NR_ACT).toBe('123456')
    expect(groups.ASOCIATI[0].SERIE_NUMAR).toBe('AR 123456')     // forma combinată rămâne disponibilă și ea
  })

  it('alias retro-compatibil: un șablon convertit înainte de redenumirea SERIE → SERIE_ACT tot se completează', () => {
    const c = client({ asociati: [p({ nume: 'Ionescu', prenume: 'Maria', serie_numar: 'AR 123456' })], administratori: [] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.ASOCIATI[0].SERIE).toBe('AR')                  // tag-ul vechi {{SERIE}} din bloc repetitiv deja convertit
    const r = buildReplacements({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(r['{{ASOCIAT_1_SERIE}}']).toBe('AR')                  // tag-ul vechi {{ASOCIAT_1_SERIE}} din poziții numerotate
    expect(r['{{ASOCIAT_1_SERIE_ACT}}']).toBe('AR')               // și forma nouă rămâne disponibilă
  })

  it('la fel și pentru administratori', () => {
    const c = client({ asociati: [], administratori: [p({ nume: 'Popescu', prenume: 'Ion', serie_numar: 'TM 654321' })] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.ADMINISTRATORI[0].SERIE_ACT).toBe('TM')
    expect(groups.ADMINISTRATORI[0].NR_ACT).toBe('654321')
  })

  it('serie lipsă: câmpurile despărțite rămân goale, nu apar erori', () => {
    const c = client({ asociati: [p({ nume: 'X', serie_numar: '' })], administratori: [] })
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.ASOCIATI[0].SERIE_ACT).toBe('')
    expect(groups.ASOCIATI[0].NR_ACT).toBe('')
  })
})

describe('SOCIETATE_SEDIU_FARA_JUDET — pentru șabloane cu județul cerut separat („sediul în ……, jud. ……”)', () => {
  it('conține tot ce are SOCIETATE_SEDIU, în afară de județ', () => {
    const c = client({ sediuSocial: { judet: 'Timiș', localitate: 'Timișoara', strada: 'Exemplu', numar: '1', bloc: '', scara: '', etaj: '', apartament: '' } })
    const r = buildReplacements({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(r['{{SOCIETATE_SEDIU}}']).toBe('Timiș, Timișoara, Str. Exemplu, nr. 1')
    expect(r['{{SOCIETATE_SEDIU_FARA_JUDET}}']).toBe('Timișoara, Str. Exemplu, nr. 1')
    expect(r['{{SOCIETATE_SEDIU_FARA_JUDET}}']).not.toContain('Timiș,')
  })

  it('fără sediu completat: gol, fără eroare', () => {
    const r = buildReplacements({ idFields: null, client: client({}) as Client, scannedPersons: [] })
    expect(r['{{SOCIETATE_SEDIU_FARA_JUDET}}']).toBe('')
  })
})

describe('checkReadiness cu etichetele fiecărui bloc', () => {
  const groups = {
    ASOCIATI: [{ NUME: 'Pop', CETATENIA_ACORD: 'român' }],
    ADMINISTRATORI: [{ NUME: 'Ionescu', CETATENIA_ACORD: '' }],
  }
  it('cetățenia cerută doar la asociați nu e raportată lipsă pentru un administrator fără cetățenie', () => {
    const fields = { ASOCIATI: ['NUME', 'CETATENIA_ACORD'], ADMINISTRATORI: ['NUME'] }
    expect(checkReadiness(['{{CETATENIA_ACORD}}'], {}, groups, fields).missing).toEqual([])
  })
  it('lipsa e raportată când cetățenia chiar e cerută în blocul administratorilor', () => {
    const fields = { ASOCIATI: ['NUME'], ADMINISTRATORI: ['NUME', 'CETATENIA_ACORD'] }
    expect(checkReadiness(['{{CETATENIA_ACORD}}'], {}, groups, fields).missing).toEqual(['{{CETATENIA_ACORD}}'])
  })
  it('fără etichetele blocurilor (șabloane salvate înainte) se verifică toate persoanele', () => {
    expect(checkReadiness(['{{CETATENIA_ACORD}}'], {}, groups).missing).toEqual(['{{CETATENIA_ACORD}}'])
  })
})

describe('checkReadiness recunoaște {{SERIE_ACT}}/{{NR_ACT}} ca fiind câmpuri per-persoană dintr-un bloc repetitiv', () => {
  const p = (o: Partial<Persoana>): Persoana => ({
    calitate: 'Asociat', cotaParticipare: '', cnp: '', nume: '', prenume: '', serie_numar: '', data_nasterii: '', locul_nasterii: '',
    cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...o,
  })
  const groups = buildRepeatGroups({
    idFields: null, scannedPersons: [],
    client: client({ asociati: [p({ nume: 'A', serie_numar: 'AR 111111' }), p({ nume: 'B', serie_numar: 'TM 222222' })] }) as Client,
  })

  it('completat la toate persoanele: nu apare ca lipsă (bug reprodus: rămânea mereu „lipsă”)', () => {
    const { filled, missing } = checkReadiness(['{{SERIE_ACT}}', '{{NR_ACT}}'], {}, groups)
    expect(filled).toEqual(['{{SERIE_ACT}}', '{{NR_ACT}}'])
    expect(missing).toEqual([])
  })

  it('lipsă la o singură persoană: rămâne raportat ca „lipsă” (corect)', () => {
    const cu_una_goala = buildRepeatGroups({
      idFields: null, scannedPersons: [],
      client: client({ asociati: [p({ nume: 'A', serie_numar: 'AR 111111' }), p({ nume: 'B', serie_numar: '' })] }) as Client,
    })
    const { missing } = checkReadiness(['{{SERIE_ACT}}', '{{NR_ACT}}'], {}, cu_una_goala)
    expect(missing).toEqual(['{{SERIE_ACT}}', '{{NR_ACT}}'])
  })
})

describe('roluri de persoană „noi” (comodant, reprezentant legal…) — în afara Asociat/Administrator/Membru IF', () => {
  it('detectCustomPersonRoles găsește rolul și pozițiile, ignoră Asociat/Administrator/Membru IF (deja completate din client)', () => {
    const roles = detectCustomPersonRoles([
      '{{COMODANT_1_NUME}}', '{{COMODANT_1_CNP}}', '{{COMODANT_2_NUME}}',
      '{{REPREZENTANT_LEGAL_1_NUME}}',
      '{{ASOCIAT_1_NUME}}', '{{ADMINISTRATOR_1_CNP}}', '{{MEMBRU_IF_1_NUME}}',
      '{{SOCIETATE_DENUMIRE}}', '{{CAMP_NR_HOTARARE}}',
    ])
    expect(roles).toEqual([
      { role: 'COMODANT', positions: [1, 2] },
      { role: 'REPREZENTANT_LEGAL', positions: [1] },
    ])
  })

  it('roleLabel produce o etichetă prietenoasă', () => {
    expect(roleLabel('COMODANT')).toBe('Comodant')
    expect(roleLabel('REPREZENTANT_LEGAL')).toBe('Reprezentant legal')
  })

  it('customPersonReplacements mapează persoana pe etichetele {{ROL_N_CÂMP}}, ca la Asociat/Administrator', () => {
    const p: Persoana = {
      calitate: 'Comodant', cotaParticipare: '', cnp: '1234567890123', nume: 'Ionescu', prenume: 'Ana',
      serie_numar: 'CJ 111111', data_nasterii: '', locul_nasterii: '', cetatenia: 'română',
      adresa: 'Cluj, str. Test 1', judet: 'Cluj', emisa_de: '', valabila_de_la: '', valabila_pana_la: '',
    }
    const r = customPersonReplacements('COMODANT', 1, p)
    expect(r['{{COMODANT_1_NUME}}']).toBe('Ionescu')
    expect(r['{{COMODANT_1_PRENUME}}']).toBe('Ana')
    expect(r['{{COMODANT_1_CNP}}']).toBe('1234567890123')
    expect(r['{{COMODANT_1_ADRESA}}']).toBe('Cluj, str. Test 1')
    expect(r['{{COMODANT_1_SERIE_ACT}}']).toBe('CJ')
    expect(r['{{COMODANT_1_NR_ACT}}']).toBe('111111')
  })

  it('checkReadiness + groupMissingFields le recunosc: gol → grupate sub „Comodant 1”; completat → nu mai lipsesc', () => {
    const placeholders = ['{{COMODANT_1_NUME}}', '{{COMODANT_1_CNP}}']
    const { missing } = checkReadiness(placeholders, {}, undefined)
    expect(missing).toEqual(placeholders)
    expect(groupMissingFields(missing)).toEqual({ 'Comodant 1': ['Nume', 'CNP'] })

    const p: Persoana = {
      calitate: 'Comodant', cotaParticipare: '', cnp: '1234567890123', nume: 'Ionescu', prenume: 'Ana',
      serie_numar: '', data_nasterii: '', locul_nasterii: '', cetatenia: '', adresa: '', judet: '',
      emisa_de: '', valabila_de_la: '', valabila_pana_la: '',
    }
    const { filled, missing: stillMissing } = checkReadiness(placeholders, customPersonReplacements('COMODANT', 1, p), undefined)
    expect(filled).toEqual(placeholders)
    expect(stillMissing).toEqual([])
  })

  it('detectCustomPersonGroups găsește rolurile scrise ca bloc repetitiv, ignoră Asociat/Administrator/Membru IF/CAEN', () => {
    const groups = detectCustomPersonGroups(['ASOCIATI', 'ADMINISTRATORI', 'MEMBRU_IF', 'CAEN_SECUNDARE', 'COMODANTI', 'COMODATARI'])
    expect(groups).toEqual([
      { role: 'COMODANT', repeatTag: 'COMODANTI' },
      { role: 'COMODATAR', repeatTag: 'COMODATARI' },
    ])
  })

  it('înființare/actualizare implicit după CUI, nu după bifa „în înființare”', () => {
    expect(defaultActMode({ codFiscal: '' })).toBe('infiintare')
    expect(defaultActMode({ codFiscal: 'RO123' })).toBe('actualizare')     // bifa rămasă nu mai contează
    expect(defaultActMode(null)).toBe('actualizare')                      // fără client ales
  })

  it('blocul {{#ACTUALIZARE}} se păstrează la actualizare și dispare la înființare, cu câmpurile lui cu tot', () => {
    expect(actualizareGroups(['ASOCIATI', 'ACTUALIZARE'], 'actualizare')).toEqual({ ACTUALIZARE: [{}] })
    expect(actualizareGroups(['ASOCIATI', 'ACTUALIZARE'], 'infiintare')).toEqual({ ACTUALIZARE: [] })
    expect(actualizareGroups(['ASOCIATI'], 'infiintare')).toEqual({})                 // șablon fără bloc: nimic trimis
    const phs = ['{{SOCIETATE_DENUMIRE}}', '{{CAMP_NUMAR_HOTARARE}}', '{{CAMP_DATA_HOTARARE}}']
    const fields = { ACTUALIZARE: ['CAMP_NUMAR_HOTARARE', 'CAMP_DATA_HOTARARE'] }
    expect(withoutActualizareFields(phs, fields, 'infiintare')).toEqual(['{{SOCIETATE_DENUMIRE}}'])
    expect(withoutActualizareFields(phs, fields, 'actualizare')).toEqual(phs)
    expect(detectCustomPersonGroups(['ACTUALIZARE'])).toEqual([])                     // nu e o listă de persoane
  })

  it('modul de exercitare a mandatelor se cere doar de la 2 reprezentanți legali aleși', () => {
    const phs = ['{{CAMP_NUMAR_HOTARARE}}', MOD_EXERCITARE_MANDATE]
    const rep = (n: number) => ({ REPREZENTANT_LEGAL: Array.from({ length: n }, () => ({}) as Persoana) })
    expect(visibleManualPlaceholders(phs)).toEqual(['{{CAMP_NUMAR_HOTARARE}}'])
    expect(visibleManualPlaceholders(phs, rep(1))).toEqual(['{{CAMP_NUMAR_HOTARARE}}'])
    expect(visibleManualPlaceholders(phs, rep(2))).toEqual(phs)
  })

  it('{{REPREZENTANT_LEGALI_LISTA}} (Art.19 din actul avocatului) e rolul REPREZENTANT_LEGAL, ales dintre administratori', () => {
    expect(detectCustomPersonGroups([], ['{{REPREZENTANT_LEGALI_LISTA}}'])).toEqual([
      { role: 'REPREZENTANT_LEGAL', listTag: 'REPREZENTANT_LEGALI_LISTA' },
    ])
    expect(customRolePool('REPREZENTANT_LEGAL')).toBe('administratori')
  })

  it('detectCustomPersonGroups combină sub ACELAȘI rol tag-ul repetitiv (semnătură) și cel „_LISTA” (mențiune îmbinată din identitate, placeholder simplu)', () => {
    // bug real, raportat de utilizator: fără gruparea pe rol, cele două tag-uri ale ACELUIAȘI reprezentant
    // (mențiunea din identitate, placeholder simplu „…LISTA” + linia „Prin administrator”, bloc repetitiv)
    // ar arăta ca DOUĂ liste separate, cerând aceiași oameni de două ori — vezi blanks.py: _role_list_field.
    const groups = detectCustomPersonGroups(
      ['REPREZENTANT_COMODATARI'],
      ['{{REPREZENTANT_COMODATARI_LISTA}}', '{{SOCIETATE_DENUMIRE}}', '{{ASOCIATI_LISTA}}'],
    )
    expect(groups).toEqual([
      { role: 'REPREZENTANT_COMODATAR', repeatTag: 'REPREZENTANT_COMODATARI', listTag: 'REPREZENTANT_COMODATARI_LISTA' },
    ])
  })

  it('detectCustomPersonGroups ignoră blocurile fără câmpuri de persoană (ex. COD_CAEN_NOU dintr-o clauză)', () => {
    const groups = detectCustomPersonGroups(['COD_CAEN_NOU', 'CESIONARI'], [], { COD_CAEN_NOU: ['CAEN'], CESIONARI: ['NUME', 'CNP'] })
    expect(groups).toEqual([{ role: 'CESIONAR', repeatTag: 'CESIONARI' }])
  })

  it('detectCustomPersonGroups ignoră blocurile completate de widget-ul unei clauze (aporturi, lichidare), chiar cu câmpuri de persoană', () => {
    const groups = detectCustomPersonGroups(['APORTURI', 'LICHIDARE_ASOCIATI', 'STRUCTURA_REZULTATA'], [],
      { APORTURI: ['NUME', 'APORT'], LICHIDARE_ASOCIATI: ['NUME', 'COTA_PARTICIPARE'], STRUCTURA_REZULTATA: ['NUME'] })
    expect(groups).toEqual([])
  })

  it('detectCustomPersonGroups ignoră ASOCIATI_LISTA/ADMINISTRATORI_LISTA (completate automat din client, nu roluri custom)', () => {
    const groups = detectCustomPersonGroups([], ['{{ASOCIATI_LISTA}}', '{{ADMINISTRATORI_LISTA}}'])
    expect(groups).toEqual([])
  })

  it('persoanaToSingularMap produce câmpurile FĂRĂ prefix, forma cerută de un element dintr-un bloc {{#ROL}}', () => {
    const p: Persoana = {
      calitate: 'Comodant', cotaParticipare: '', cnp: '1234567890123', nume: 'Ionescu', prenume: 'Ana',
      serie_numar: 'CJ 111111', data_nasterii: '', locul_nasterii: '', cetatenia: 'română',
      adresa: 'Cluj, str. Test 1', judet: 'Cluj', emisa_de: '', valabila_de_la: '', valabila_pana_la: '',
    }
    const r = persoanaToSingularMap(p)
    expect(r.NUME).toBe('Ionescu')
    expect(r.PRENUME).toBe('Ana')
    expect(r.CNP).toBe('1234567890123')
    expect(r.SERIE_ACT).toBe('CJ')
    expect(r.NR_ACT).toBe('111111')
  })

  it('isReprezentantRole recunoaște un rol „REPREZENTANT_X” construit de blanks.py sau REPREZENTANT_LEGAL existent', () => {
    expect(isReprezentantRole('REPREZENTANT_COMODATAR')).toBe(true)
    expect(isReprezentantRole('REPREZENTANT_LEGAL')).toBe(true)
    expect(isReprezentantRole('COMODANT')).toBe(false)
    expect(isReprezentantRole('ASOCIAT')).toBe(false)
  })

  it('customRolePool: „…_ADMINISTRATOR” și reprezentanții — administratori; „…_ASOCIAT” — asociați; restul — oricine', () => {
    expect(customRolePool('DECLARANT_ADMINISTRATOR')).toBe('administratori')
    expect(customRolePool('REPREZENTANT_SOCIETATE')).toBe('administratori')
    expect(customRolePool('DECLARANT_ASOCIAT')).toBe('asociati')
    expect(customRolePool('CESIONAR')).toBe('toti')
    expect(customRolePool('COMODANT')).toBe('toti')
  })
})

describe('CUI și J pentru o firmă în curs de înființare', () => {
  it('lipsa lor devine loc de completat de mână', () => {
    const r = build(client({ inInfiintare: true, codFiscal: '', nrRegistrul: '' }))
    expect(r['{{SOCIETATE_CIF}}']).toBe(HAND_FILL_BLANK)
    expect(r['{{SOCIETATE_NR_REG}}']).toBe(HAND_FILL_BLANK)
  })

  it('o valoare deja completată se folosește normal', () => {
    const r = build(client({ inInfiintare: true, codFiscal: 'RO123', nrRegistrul: '' }))
    expect(r['{{SOCIETATE_CIF}}']).toBe('RO123')
    expect(r['{{SOCIETATE_NR_REG}}']).toBe(HAND_FILL_BLANK)
  })

  it('fără bifă, lipsa rămâne goală (marcată mai departe ca „-”)', () => {
    const r = build(client({ codFiscal: '', nrRegistrul: '' }))
    expect(r['{{SOCIETATE_CIF}}']).toBe('')
  })
})

describe('valoarea unei părți sociale', () => {
  const asociat = { nume: 'POPESCU', prenume: 'ION', cotaParticipare: '100%' } as Persoana

  it('implicit 10 lei: părțile sociale se calculează ca înainte', () => {
    const r = build(client({ capitalSocial: 200, asociati: [asociat] }))
    expect(r['{{VALOARE_PARTE_SOCIALA}}']).toBe('10')
    expect(r['{{PARTI_SOCIALE_TOTALE}}']).toBe('20')
    expect(r['{{PARTI_SOCIALE_ASOCIAT_1}}']).toBe('20')
  })

  it('cu 1 leu pe parte, numărul de părți urmează valoarea clientului, și în blocul asociaților', () => {
    const c = client({ capitalSocial: 200, valoareParteSociala: 1, asociati: [asociat] })
    const r = build(c)
    expect(r['{{VALOARE_PARTE_SOCIALA}}']).toBe('1')
    expect(r['{{PARTI_SOCIALE_TOTALE}}']).toBe('200')
    expect(r['{{PARTI_SOCIALE_ASOCIAT_1}}']).toBe('200')
    const groups = buildRepeatGroups({ idFields: null, client: c as Client, scannedPersons: [] })
    expect(groups.ASOCIATI[0].PARTI_SOCIALE).toBe('200')
  })
})

describe('durata societății și mandatele administratorilor', () => {
  const admin = (nume: string, mandat?: Persoana['mandat']): Persoana => ({
    calitate: 'Administrator', cotaParticipare: '', cnp: '', nume, prenume: 'Ion', serie_numar: '', data_nasterii: '',
    locul_nasterii: '', cetatenia: '', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '',
    ...(mandat ? { mandat } : {}),
  })
  const patruAni = { tip: 'ani' as const, ani: '4', data: '' }

  it('clientul de dinainte, fără durată salvată: tag-urile rămân goale (apar la „lipsește”), nu „99 de ani”', () => {
    const r = build(client({ administratori: [admin('POPA')] }))
    expect(r['{{DURATA_SOCIETATE_TEXT}}']).toBe('')
    expect(r['{{DURATA_MANDAT_TEXT}}']).toBe('')
    expect(r['{{ADMINISTRATOR_1_DURATA_MANDAT}}']).toBe('')
  })

  it('durata societății: formele scurtă, frază, ani, în litere, expirare de la înmatriculare', () => {
    const r = build(client({ durataSocietate: { tip: 'ani', ani: '10', data: '' }, dataInmatricularii: '01.02.2027' }))
    expect(r['{{DURATA_SOCIETATE}}']).toBe('de 10 ani')
    expect(r['{{DURATA_SOCIETATE_TEXT}}']).toBe('pe o perioadă de 10 ani')
    expect(r['{{DURATA_SOCIETATE_ANI}}']).toBe('10')
    expect(r['{{DURATA_SOCIETATE_ANI_LITERE}}']).toBe('zece')
    expect(r['{{DURATA_SOCIETATE_DATA_EXPIRARE}}']).toBe('01.02.2037')
    expect(build(client({ durataSocietate: { tip: 'nedeterminata', ani: '', data: '' } }))['{{DURATA_SOCIETATE_TEXT}}']).toBe('pe durată nedeterminată')
  })

  it('firmă în înființare: datele care se află la înmatriculare rămân loc de completat de mână', () => {
    const r = build(client({
      inInfiintare: true, durataSocietate: { tip: 'ani', ani: '10', data: '' },
      administratori: [admin('POPA', { durata: patruAni, inceput: 'aprobare', dataNumire: '' })],
    }))
    expect(r['{{DURATA_SOCIETATE_DATA_EXPIRARE}}']).toBe(HAND_FILL_BLANK)
    expect(r['{{ADMINISTRATOR_1_DATA_NUMIRE}}']).toBe(HAND_FILL_BLANK)
    expect(r['{{ADMINISTRATOR_1_DATA_EXPIRARE_MANDAT}}']).toBe(HAND_FILL_BLANK)
    expect(r['{{ADMINISTRATOR_1_DURATA_MANDAT_TEXT}}']).toBe('pe o perioadă de 4 ani')
  })

  it('mandat comun doar dacă e același la toți; per administrator mereu, și în {{#ADMINISTRATORI}}', () => {
    const c = client({
      dataInmatricularii: '10.03.2027',
      administratori: [
        admin('POPA', { durata: patruAni, inceput: 'aprobare', dataNumire: '10.03.2027' }),
        admin('VASILE', { durata: patruAni, inceput: 'data', dataNumire: '07.11.2026' }),
      ],
    })
    const r = build(c)
    expect(r['{{DURATA_MANDAT}}']).toBe('de 4 ani')
    expect(r['{{DURATA_MANDAT_ANI}}']).toBe('4')
    expect(r['{{ADMINISTRATOR_1_DATA_EXPIRARE_MANDAT}}']).toBe('10.03.2031')
    expect(r['{{ADMINISTRATOR_2_DATA_NUMIRE}}']).toBe('07.11.2026')
    const rows = buildRepeatGroups({ client: c as Client }).ADMINISTRATORI
    expect(rows.map(x => x.DATA_EXPIRARE_MANDAT)).toEqual(['10.03.2031', '07.11.2030'])

    const diferite = build({ ...c, administratori: [c.administratori![0], admin('DAN', { durata: { tip: 'nedeterminata', ani: '', data: '' }, inceput: 'data', dataNumire: '' })] })
    expect(diferite['{{DURATA_MANDAT_TEXT}}']).toBe('')
    expect(diferite['{{ADMINISTRATOR_2_DURATA_MANDAT_TEXT}}']).toBe('pe durată nedeterminată')
  })

  it('etichete prietenoase în lista „lipsește”', () => {
    expect(groupMissingFields(['{{DURATA_SOCIETATE_TEXT}}', '{{DURATA_MANDAT_TEXT}}', '{{ADMINISTRATOR_2_DATA_NUMIRE}}'])).toEqual({
      Societate: ['Durata societății'],
      Administratori: ['Durata mandatului'],
      'Administrator 2': ['Data numirii'],
    })
  })
})
