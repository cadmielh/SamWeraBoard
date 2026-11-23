import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { EMPTY_CLIENT, EMPTY_PERSOANA, creeazaClient, type ClientInput } from './clienti'
import { DURATA_NEDETERMINATA } from './durata'
import type { Persoana } from '../types'
import { CUI_DEMO, DENUMIRE_DEMO, NR_REGISTRU_DEMO } from './demo'

/**
 * Clientul demo, creat doar la cerere (din ghidul „Primii pași” sau din lista goală de clienți): o firmă
 * fictivă completă, ca utilizatorul să poată genera un document fără să introducă date reale.
 * Denumirea poartă „DEMO”, ca să nu fie confundat cu un client adevărat; se șterge ca orice client.
 */

const PONDERI_CNP = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9]

/** Adaugă cifra de control unui CNP de 12 cifre (aceeași regulă ca isValidCNP din lib/cnp.ts). */
export function cuCifraDeControl(primele12: string): string {
  const rest = primele12.split('').reduce((s, d, i) => s + Number(d) * PONDERI_CNP[i], 0) % 11
  return primele12 + (rest === 10 ? 1 : rest)
}

const persoana = (p: Partial<Persoana>): Persoana => ({ ...EMPTY_PERSOANA, cetatenia: 'română', ...p })

// Numerele de ordine 999 din CNP și seriile „DM” țin datele departe de persoane reale.
const andrei = persoana({
  calitate: 'Asociat', cotaParticipare: '60%', cnp: cuCifraDeControl('180041240999'), sex: 'M',
  nume: 'EXEMPLU', prenume: 'ANDREI', serie_numar: 'DM 000001',
  data_nasterii: '12.04.1980', locul_nasterii: 'Mun. București, Sector 1', judet: 'București',
  adresa: 'Mun. București, Sector 1, Str. Exemplului nr. 1, ap. 1',
  emisa_de: 'SPCEP Sector 1', valabila_de_la: '12.04.2022', valabila_pana_la: '12.04.2032',
})
const maria = persoana({
  calitate: 'Asociat', cotaParticipare: '40%', cnp: cuCifraDeControl('285092312999'), sex: 'F',
  nume: 'EXEMPLU', prenume: 'MARIA', serie_numar: 'DM 000002',
  data_nasterii: '23.09.1985', locul_nasterii: 'Mun. Cluj-Napoca, jud. Cluj', judet: 'Cluj',
  adresa: 'Mun. Cluj-Napoca, Str. Demonstrației nr. 2',
  emisa_de: 'SPCLEP Cluj-Napoca', valabila_de_la: '23.09.2023', valabila_pana_la: '23.09.2033',
})

export function clientDemo(): ClientInput {
  return {
    ...EMPTY_CLIENT,
    tipClient: 'PJ',
    denumire: DENUMIRE_DEMO,
    formaJuridica: 'SRL',
    codFiscal: CUI_DEMO,
    nrRegistrul: NR_REGISTRU_DEMO,
    sediuSocial: {
      localitate: 'București', strada: 'Str. Exemplului', numar: '10',
      bloc: '', scara: '', etaj: '1', apartament: '3', judet: 'București - Sector 1',
    },
    caenCod: '6920',
    caenDescriere: 'Activităţi de contabilitate şi audit financiar; consultanţă în domeniul fiscal',
    capitalSocial: 200,
    valoareParteSociala: 10,
    durataSocietate: { ...DURATA_NEDETERMINATA },
    dataInmatricularii: '15.06.2020',
    notite: 'Client fictiv, creat din ghidul „Primii pași” ca să încerci generarea documentelor. Îl poți șterge oricând.',
    asociati: [andrei, maria],
    administratori: [{
      ...andrei, calitate: 'Administrator', cotaParticipare: '',
      mandat: { durata: { ...DURATA_NEDETERMINATA }, inceput: 'aprobare', dataNumire: '15.06.2020' },
    }],
  }
}

/** Clientul demo al cabinetului: cel existent (ca a doua cerere să nu-l dubleze) sau unul nou. Întoarce id-ul. */
export async function clientDemoId(workspaceId: string, uid: string): Promise<string> {
  const q = query(collection(db, 'workspaces', workspaceId, 'clienti'), where('denumireLower', '==', DENUMIRE_DEMO.toLowerCase()), limit(1))
  const snap = await getDocs(q)
  if (!snap.empty) return snap.docs[0].id
  return creeazaClient(workspaceId, clientDemo(), uid)
}
