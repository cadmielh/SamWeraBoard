/**
 * Plasă de siguranță pentru șabloane: datele exacte trimise serverului la generare (etichete, liste, context pentru
 * variante) pentru câțiva clienți ficționali, fixate în tests/golden/payloads.json. Testul de pe server
 * (tests/test_golden_templates.py) completează cu ele toate șabloanele de bază și compară textul rezultat cu o
 * versiune salvată — o schimbare de cod care atinge un șablon existent apare ca diferență, înainte de deploy.
 *
 * Schimbare intenționată → `npx vitest run -u src/lib/golden.test.ts`, apoi `GOLDEN_UPDATE=1 pytest tests/test_golden_templates.py`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildReplacements, buildRepeatGroups, customPersonReplacements } from './placeholders'
import { buildVariantContext } from './variants'
import { parseAdresa } from './adresa'
import type { Client, Persoana } from '../types'

const persoana = (over: Partial<Persoana>): Persoana => ({
  calitate: '', cotaParticipare: '', cnp: '', nume: '', prenume: '', serie_numar: '', data_nasterii: '', locul_nasterii: '',
  cetatenia: 'română', adresa: '', judet: '', emisa_de: '', valabila_de_la: '', valabila_pana_la: '', ...over,
})

const ana = persoana({
  calitate: 'Asociat', cotaParticipare: '100%', cnp: '2900315123456', nume: 'POPA', prenume: 'ANA', serie_numar: 'XB 123456',
  data_nasterii: '15.03.1990', locul_nasterii: 'Mun. Cluj-Napoca, jud. Cluj', adresa: 'Mun. Cluj-Napoca, Str. Lalelelor nr. 4, ap. 2',
  judet: 'Cluj', emisa_de: 'SPCLEP Cluj-Napoca', valabila_de_la: '10.01.2020', valabila_pana_la: '15.03.2030',
})
const mihai = persoana({
  calitate: 'Asociat', cotaParticipare: '60%', cnp: '1850720123457', nume: 'IONESCU', prenume: 'MIHAI', serie_numar: 'RX 654321',
  data_nasterii: '20.07.1985', locul_nasterii: 'Mun. București, Sector 3', adresa: 'Mun. București, Sector 3, Bd. Unirii nr. 20',
  judet: 'București', emisa_de: 'SPCEP Sector 3', valabila_de_la: '01.02.2021', valabila_pana_la: '20.07.2031',
})
const elena = persoana({
  calitate: 'Asociat', cotaParticipare: '40%', cnp: '2920210123458', nume: 'DUMITRU', prenume: 'ELENA', serie_numar: 'IF 112233',
  data_nasterii: '10.02.1992', locul_nasterii: 'Or. Voluntari, jud. Ilfov', adresa: 'Or. Voluntari, Str. Pădurii nr. 7',
  judet: 'Ilfov', emisa_de: 'SPCLEP Voluntari', valabila_de_la: '05.05.2022', valabila_pana_la: '10.02.2032',
  sex: 'F',
})

const firma = (over: Partial<Client>): Partial<Client> => ({
  id: 'golden', tipClient: 'PJ', formaJuridica: 'SRL', codFiscal: '12345678', nrRegistrul: 'J12/345/2020',
  caenCod: '6201', caenDescriere: 'Activități de realizare a soft-ului la comandă',
  caenSecundare: [{ cod: '6202', descriere: 'Activități de consultanță în tehnologia informației' }, { cod: '7022', descriere: 'Activități de consultanță pentru afaceri și management' }],
  puncteLucru: [], capitalSocial: 200, valoareParteSociala: 10, ...over,
})

const CLIENTI: Record<string, Partial<Client>> = {
  pj_asociat_unic: firma({
    denumire: 'ALFA SOFT SRL', sediuSocial: parseAdresa('Jud. Cluj, Mun. Cluj-Napoca, Str. Memorandumului nr. 1, ap. 3'),
    asociati: [ana], administratori: [{ ...ana, calitate: 'Administrator', cotaParticipare: '' }],
  }),
  pj_doi_asociati: firma({
    denumire: 'BETA CONSULT SRL', sediuSocial: parseAdresa('Mun. București, Sector 1, Calea Victoriei nr. 100'),
    capitalSocial: 1000, puncteLucru: ['Mun. București, Sector 2, Str. Viitorului nr. 5'],
    asociati: [mihai, elena], administratori: [{ ...mihai, calitate: 'Administrator', cotaParticipare: '' }, { ...elena, calitate: 'Administrator', cotaParticipare: '' }],
  }),
  pf_ii: {
    id: 'golden', tipClient: 'PF', subtipPF: 'II', denumire: 'POPA ANA ÎNTREPRINDERE INDIVIDUALĂ', formaJuridica: 'II',
    codFiscal: '87654321', nrRegistrul: 'F12/678/2021', sediuSocial: parseAdresa('Jud. Cluj, Mun. Cluj-Napoca, Str. Lalelelor nr. 4'),
    caenCod: '9602', caenDescriere: 'Coafură și alte activități de înfrumusețare', caenSecundare: [], puncteLucru: [],
    titular: { ...ana, calitate: 'Titular', cotaParticipare: '' },
  },
}

function payload(client: Partial<Client>) {
  const opts = { idFields: null, client: client as Client, scannedPersons: [] }
  const replacements = buildReplacements(opts)
  // Reprezentantul din șabloanele cu rol propriu (ex. anexa hotărârii): primul administrator
  const admin = client.administratori?.[0]
  if (admin) Object.assign(replacements, customPersonReplacements('REPREZENTANT_SOCIETATE', 1, admin))
  const groups = buildRepeatGroups(opts)
  const { ctx } = buildVariantContext({ client, scannedPersons: [], idFields: null, replacements })
  return { tip: client.tipClient, replacements, groups, ctx }
}

describe('date trimise serverului pentru clienții ficționali (tests/golden)', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-16T10:00:00')) })
  afterAll(() => { vi.useRealTimers() })

  it('rămân neschimbate', async () => {
    const all = Object.fromEntries(Object.entries(CLIENTI).map(([k, c]) => [k, payload(c)]))
    await expect(JSON.stringify(all, null, 1) + '\n').toMatchFileSnapshot('../../../tests/golden/payloads.json')
  })
})
