// Logică pură (fără JSX) pentru „Anexa 2b - Cerere înregistrare în registrul comerțului” (ONRC) a PFA, întreprinderilor
// individuale (II) și familiale (IF) — starea editată în Anexa2bFiller și asamblarea ei în `replacements` pentru
// /fill/docx. Șablonul (generat de scripts/genereaza_anexa2b_docx.py) urmează aceleași convenții ca Anexa 2a (vezi
// onrcCommon.ts): casete ☒/☐, opțiuni ●/○, câmpurile din punctele nealese rămân cu puncte.
import type { Client, Persoana, SubtipPF } from '../types'
import {
  EMPTY_PERSOANA, DOTS, cnpOk, comunicareGoala, dateFacturare, deponentGol, elementeAlese, facturareGoala, firmaDinFisa,
  optiune as o, persoanaComunicare, persoanaDinFisa, scriitorOnrc, totalFile, tribunalDinJudet, verificariFirma, verificariSubsemnat,
} from './onrcCommon'
import type {
  CatalogStare, ComunicareOnrc, DeponentOnrc, FacturareOnrc, FirmaA2A, GrupCatalog, PersoanaA2A, PersoanaCandidat,
  VerificareOnrc,
} from './onrcCommon'
import { formatDateRo } from './dates'

export const ANEXA2B_KEY = 'anexa2b_cerere_inregistrare_pf'


export type Entitate = SubtipPF
export const ENTITATI: { value: Entitate; label: string }[] = [
  { value: 'PFA', label: 'PFA' }, { value: 'II', label: 'Întreprindere individuală' }, { value: 'IF', label: 'Întreprindere familială' },
]

// ── Persoane ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Calitatea propusă la punctul IV pentru titularul din fișă. */
export function calitateTitular(e: Entitate | ''): string {
  return e === 'PFA' ? 'persoană fizică autorizată' : e === 'II' ? 'titular' : e === 'IF' ? 'reprezentant' : ''
}

/** Persoanele din fișă care pot semna: titularul (la IF, reprezentantul), apoi membrii IF (fără dubluri după nume). */
export function persoaneCandidatPF(client?: Partial<Client> | null): PersoanaCandidat[] {
  const out: PersoanaCandidat[] = []
  const seen = new Set<string>()
  const add = (p: Persoana, id: string, calitate: string) => {
    const label = `${p.nume ?? ''} ${p.prenume ?? ''}`.trim()
    if (!label || seen.has(label)) return
    seen.add(label)
    out.push({ id, label, calitate, persoana: p })
  }
  if (client?.titular) add(client.titular, 'titular', calitateTitular(client.subtipPF ?? ''))
  ;(client?.membriIF ?? []).forEach((p, i) => add(p, `membriIF:${i}`, p.calitate === 'Titular' ? 'reprezentant' : 'membru'))
  return out
}

export interface MembruIF { sursa: string; p: PersoanaA2A; regim: string; calitate: string; prin: string; conform: string }
export const MEMBRI_RANDURI = 2
const membruGol = (): MembruIF => ({ sursa: '', p: { ...EMPTY_PERSOANA }, regim: '', calitate: '', prin: '', conform: '' })

// ── Catalogul punctelor 2.1 și 2.2 ──────────────────────────────────────────────────────────────────────────────────

const NOTA_DECLARATIE = 'Formularul cere și declarația pe propria răspundere (punctul 2.3, nota 7).'

export const CATALOG_21: GrupCatalog[] = [
  {
    titlu: 'Firmă, obiect și membri',
    elemente: [
      { id: 'DENUMIRE', box: '21_DENUMIRE', label: 'Denumire' },
      { id: 'OBIECT', box: '21_OBIECT', label: 'Obiect de activitate', nota: NOTA_DECLARATIE },
      { id: 'ACORD', box: '21_ACORD', label: 'Acord de constituire' },
      { id: 'PATRIMONIU', box: '21_PATRIMONIU', label: 'Patrimoniu de afectațiune' },
      {
        id: 'MEMBRU', box: '21_MEMBRU', label: 'Reprezentant / membru întreprindere familială',
        grupuri: [{ simbol: 'O', multi: true, optiuni: [o('21_COOPTARE', 'Cooptare'), o('21_RETRAGERE', 'Retragere')] }],
      },
      {
        id: 'REGIM', box: '21_REGIM', label: 'Schimbare regim juridic',
        texte: [{ tag: '21_REGIM_DIN', label: 'Din' }, { tag: '21_REGIM_IN', label: 'În' }],
      },
    ],
  },
  {
    titlu: 'Sediu profesional și sedii secundare',
    elemente: [
      {
        id: 'SEDIU', box: '21_SEDIU', label: 'Schimbarea sediului profesional',
        texte: [
          { tag: '21_SEDIU_JUD', label: 'Județ / sector' }, { tag: '21_SEDIU_LOC', label: 'Localitatea' },
          { tag: '21_SEDIU_STR', label: 'Strada' }, { tag: '21_SEDIU_NR', label: 'Nr.', scurt: true },
          { tag: '21_SEDIU_BL', label: 'Bloc', scurt: true }, { tag: '21_SEDIU_SC', label: 'Scara', scurt: true },
          { tag: '21_SEDIU_ET', label: 'Etaj', scurt: true }, { tag: '21_SEDIU_AP', label: 'Ap.', scurt: true },
          { tag: '21_SEDIU_CP', label: 'Cod poștal', scurt: true }, { tag: '21_SEDIU_TEL', label: 'Telefon' },
          { tag: '21_SEDIU_EMAIL', label: 'E-mail' }, { tag: '21_SEDIU_WEB', label: 'Pagina de internet' },
        ],
        nota: NOTA_DECLARATIE,
      },
      {
        id: 'SPATIU', box: '21_SPATIU', label: 'Sediu profesional — act de spațiu',
        grupuri: [{ simbol: 'O', multi: false, optiuni: [o('21_SPATIU_PRELUNGIRE', 'Prelungire valabilitate act de spațiu'), o('21_SPATIU_MODIFICARE', 'Modificare act de spațiu')] }],
      },
      { id: 'SEDII_PL', box: '21_SEDII_PL', label: 'Sedii secundare (puncte de lucru)' },
      {
        id: 'SEDII', box: '21_SEDII', label: 'Sedii secundare: înființare / desființare / modificare',
        grupuri: [{ simbol: 'O', multi: true, optiuni: [o('21_SEDII_INF', 'Înființare'), o('21_SEDII_DESF', 'Desființare'), o('21_SEDII_MOD', 'Modificare/prelungire valabilitate')] }],
        texte: [
          { tag: '21_SEDII_INF_NR', label: 'Nr. sedii înființate', scurt: true, pentru: '21_SEDII_INF' },
          { tag: '21_SEDII_DESF_NR', label: 'Nr. sedii desființate', scurt: true, pentru: '21_SEDII_DESF' },
          { tag: '21_SEDII_MOD_NR', label: 'Nr. sedii modificate', scurt: true, pentru: '21_SEDII_MOD' },
        ],
        nota: NOTA_DECLARATIE,
      },
    ],
  },
  {
    titlu: 'Activitate și participarea soțului/soției',
    elemente: [
      { id: 'INTRERUPERE', box: '21_INTRERUPERE', label: 'Întrerupere temporară a activității', texte: [{ tag: '21_INTRERUPERE_DATA', label: 'Până la data' }], nota: NOTA_DECLARATIE },
      { id: 'RELUARE', box: '21_RELUARE', label: 'Reluare activitate', texte: [{ tag: '21_RELUARE_DATA', label: 'Cu data de' }], nota: NOTA_DECLARATIE },
      { id: 'SOT_PARTICIPARE', box: '21_SOT_PARTICIPARE', label: 'Participarea în mod obișnuit a soției/soțului la activitate' },
      { id: 'SOT_INCETARE', box: '21_SOT_INCETARE', label: 'Încetarea activității soției/soțului' },
    ],
  },
  {
    titlu: 'Insolvență și sancțiuni',
    elemente: [
      {
        id: 'PROCEDURI', label: 'Concordat / restructurare / insolvență / faliment',
        grupuri: [{ simbol: 'B', multi: true, optiuni: [o('21_CONCORDAT', 'Concordat preventiv'), o('21_ACORD_RESTR', 'Acord de restructurare preventivă'), o('21_INSOLVENTA', 'Insolvență'), o('21_FALIMENT', 'Faliment')] }],
      },
      { id: 'CONDAMNARE', box: '21_CONDAMNARE', label: 'Condamnare penală' },
    ],
  },
  {
    titlu: 'Alte mențiuni',
    elemente: [{ id: 'ALTE', box: '21_ALTE', label: 'Alte mențiuni', texte: [{ tag: '21_ALTE', label: 'Care' }] }],
  },
]

export const CATALOG_22: GrupCatalog[] = [
  {
    titlu: 'Acte depuse',
    elemente: [
      { id: 'PLANGERE', box: '22_PLANGERE', label: 'Plângere' },
      { id: 'RADIERE120', box: '22_RADIERE120', label: 'Cerere radiere conform art. 120 din Legea nr. 265/2022' },
      { id: 'HOT_JUD', box: '22_HOT_JUD', label: 'Hotărâre judecătorească' },
      { id: 'ACT_PROC', box: '22_ACT_PROC', label: 'Act procedural care redă dispozitivul hotărârii judecătorești' },
      { id: 'ART103', box: '22_ART103', label: 'Acte conform art. 103 din Legea nr. 265/2022', texte: [{ tag: '22_ART103', label: 'Care' }] },
      { id: 'ALTE', box: '22_ALTE', label: 'Alte înscrisuri', texte: [{ tag: '22_ALTE', label: 'Care' }] },
    ],
  },
]

// ── Obiectul de activitate (VII) ────────────────────────────────────────────────────────────────────────────────────

export interface ClasaCaen { cod: string; den: string }
export type ModVII = 'INREGISTRARE' | 'MODIFICARE' | 'ACTUALIZARE'
export type ListaCaen = 'inreg' | 'renuntare' | 'completare'
/** Rândurile tabelelor din formular (peste ele: anexă, nota 8). */
export const CAEN_RANDURI: Record<ListaCaen, number> = { inreg: 9, renuntare: 4, completare: 4 }
const CAEN_TAG: Record<ListaCaen, string> = { inreg: 'INREG', renuntare: 'RENUNTARE', completare: 'COMPLETARE' }
/** Câte clase CAEN poate avea, în total, fiecare formă (OUG nr. 44/2008). */
export const MAX_CLASE_CAEN: Record<Entitate, number> = { PFA: 5, II: 10, IF: 10 }

const randuriCaen = (n: number, din: ClasaCaen[] = []): ClasaCaen[] =>
  Array.from({ length: n }, (_, i) => din[i] ?? { cod: '', den: '' })

// ── Starea formularului ─────────────────────────────────────────────────────────────────────────────────────────────

export type Punct2b = 1 | 2 | 3 | 4 | 5
export const PUNCTE_2B: { nr: Punct2b; tip: string; label: string }[] = [
  { nr: 1, tip: 'INREGISTRARE', label: 'Înregistrare' },
  { nr: 2, tip: 'MENTIUNI', label: 'Înscriere mențiuni' },
  { nr: 3, tip: 'OPERATIUNI', label: 'Înscriere operațiuni comunicate de autoritatea/instituția publică' },
  { nr: 4, tip: 'RADIERE', label: 'Radiere' },
  { nr: 5, tip: 'EROARE', label: 'Îndreptare eroare materială' },
]

export interface Anexa2bFormState {
  orcTribunal: string
  entitate: Entitate | ''
  puncte: Punct2b[]
  actTemei: string
  subSursa: string          // id-ul persoanei din fișă, '__manual__' sau '' (nealeasă)
  sub: PersoanaA2A
  subRegim: string
  subCalitate: string
  subPrin: string
  subConform: string
  membri: MembruIF[]
  firma: FirmaA2A
  s21: CatalogStare
  s22: CatalogStare
  s23: boolean
  s3Autoritate: string
  s4Motiv: 'DECES' | 'CERERE' | 'ART120' | ''
  s5: { act: string; cerere: string; tipCerere: ('INREGISTRARE' | 'MENTIUNE' | 'RADIERE')[]; inLocDe: string; seVa: string }
  vii: { moduri: ModVII[]; principal: ClasaCaen; on: Record<ListaCaen, boolean>; liste: Record<ListaCaen, ClasaCaen[]> }
  viii: { inf: boolean; infText: string; rad: boolean; radText: string }
  ix: {
    audienta: boolean; copii: boolean; copiiCert: boolean; copiiCertDoc: string; comunicare: boolean
    modalitate: 'POSTA' | 'CURIER' | 'ELECTRONIC' | 'SEDIU_ORCT' | 'PRIMARIE' | ''; sediuOrct: string; primarie: string
  }
  com: ComunicareOnrc
  fact: FacturareOnrc
  /** Rândurile opisului. Primele 7 au denumirea tipărită în formular (OPIS_TIPARITE); `den` contează doar la 8–11. */
  opis: { nrData: string; file: string; den: string }[]
  anexe: string
  dataSemnare: string
  dep: DeponentOnrc
}

export const OPIS_TIPARITE = [
  'Documente care atestă pregătire/experiența profesională',
  'Dovadă sediu profesional',
  'Acord de constituire',
  'Declarația privind participarea soției/soțului la activitate',
  'Anexa nr. 1 — Declarație privind îndeplinirea condițiilor de funcționare',
  'Anexa nr. 2 — înregistrarea fiscală',
  'Împuternicire',
]
export const OPIS_RANDURI_2B = 11

/** Starea inițială, precompletată din fișa clientului. Fără client: formular gol (dar valid ca structură). */
export function stareInitiala2b(client?: Partial<Client> | null, azi: Date = new Date()): Anexa2bFormState {
  const entitate: Entitate | '' = client?.tipClient === 'PF' ? client.subtipPF ?? 'PFA' : ''
  const candidati = persoaneCandidatPF(client)
  // Semnează titularul (PFA, II) sau reprezentantul IF (nota 1).
  const primul = candidati[0]
  const firma = firmaDinFisa(client)
  const nou = !!client?.inInfiintare
  // La IF, rubrica V se completează cu ceilalți membri din fișă (cel mult doi; restul — într-o anexă, nota 2).
  const membri = entitate === 'IF' ? candidati.filter(c => c.id !== primul?.id).slice(0, MEMBRI_RANDURI) : []
  const secundare = (client?.caenSecundare ?? []).map(c => ({ cod: c.cod, den: c.descriere }))
  return {
    orcTribunal: tribunalDinJudet(client?.sediuSocial?.judet),
    entitate,
    // Clientul în înființare are nevoie de înregistrare; altfel, cererea obișnuită e de înscriere mențiuni.
    puncte: client ? [nou ? 1 : 2] : [],
    actTemei: '',
    subSursa: primul?.id ?? '',
    sub: primul ? persoanaDinFisa(primul.persoana) : { ...EMPTY_PERSOANA },
    subRegim: '',
    subCalitate: primul?.calitate ?? '',
    subPrin: '',
    subConform: '',
    membri: Array.from({ length: MEMBRI_RANDURI }, (_, i) => membri[i]
      ? { ...membruGol(), sursa: membri[i].id, p: persoanaDinFisa(membri[i].persoana), calitate: membri[i].calitate }
      : membruGol()),
    firma,
    s21: {},
    s22: {},
    s23: false,
    s3Autoritate: '',
    s4Motiv: '',
    s5: { act: '', cerere: '', tipCerere: [], inLocDe: '', seVa: '' },
    vii: {
      moduri: nou ? ['INREGISTRARE'] : [],
      principal: { cod: client?.caenCod ?? '', den: client?.caenDescriere ?? '' },
      on: { inreg: nou && secundare.length > 0, renuntare: false, completare: false },
      liste: { inreg: randuriCaen(CAEN_RANDURI.inreg, secundare), renuntare: randuriCaen(CAEN_RANDURI.renuntare), completare: randuriCaen(CAEN_RANDURI.completare) },
    },
    viii: { inf: nou && (client?.puncteLucru ?? []).length > 0, infText: nou ? (client?.puncteLucru ?? []).join('; ') : '', rad: false, radText: '' },
    ix: { audienta: false, copii: false, copiiCert: false, copiiCertDoc: '', comunicare: false, modalitate: '', sediuOrct: '', primarie: '' },
    com: comunicareGoala(),
    fact: facturareGoala(client ? 'firma' : 'manual'),
    opis: Array.from({ length: OPIS_RANDURI_2B }, () => ({ nrData: '', file: '', den: '' })),
    anexe: '',
    dataSemnare: formatDateRo(azi),
    dep: deponentGol(),
  }
}

/** Clasele CAEN completate dintr-o listă (rândurile goale nu contează). */
export const claseCompletate = (lista: ClasaCaen[]) => lista.filter(c => c.cod.trim() || c.den.trim())

/** VII se completează doar dacă e ales cel puțin un mod; la „doar actualizare” se completează doar activitatea principală (nota 9). */
export function listaCaenActiva(s: Anexa2bFormState, l: ListaCaen): boolean {
  const m = s.vii.moduri
  const doarActualizare = m.length === 1 && m[0] === 'ACTUALIZARE'
  return m.length > 0 && !doarActualizare && s.vii.on[l]
}

// ── Asamblarea pentru /fill/docx ────────────────────────────────────────────────────────────────────────────────────

export function buildAnexa2bDocxData(s: Anexa2bFormState): { replacements: Record<string, string> } {
  const { r, box, cerc, txt, txtManual, celula, persoana, firmaBlock, catalog, subsemnat, comunicare, facturare, deponent } = scriitorOnrc('A2B')
  const are = (n: Punct2b) => s.puncte.includes(n)

  // I–III. Antet: forma (PFA/II/IF) și tipul cererii, după punctele alese la VI.
  r['{{A2B_ORC_TRIBUNAL}}'] = s.orcTribunal.trim() || DOTS
  for (const e of ENTITATI) box(`ENT_${e.value}`, s.entitate === e.value)
  for (const p of PUNCTE_2B) box(`TIP_${p.tip}`, are(p.nr))
  box('TIP_CAEN', s.vii.moduri.includes('ACTUALIZARE'))

  // IV. Subsemnatul
  subsemnat(s)

  // V. Membrii IF — doar la întreprinderea familială și doar rândurile alese
  s.membri.slice(0, MEMBRI_RANDURI).forEach((m, i) => {
    const pre = `M${i + 1}`
    const activ = s.entitate === 'IF' && !!m.sursa
    persoana(pre, m.p, activ)
    txt(`${pre}_REGIM`, m.regim, activ); txt(`${pre}_CALITATE`, m.calitate, activ)
    txt(`${pre}_PRIN`, m.prin, activ); txt(`${pre}_CONFORM`, m.conform, activ)
  })

  // VI. Obiectul cererii
  txtManual('ACT_TEMEI', s.actTemei, true)

  box('S1', are(1))
  firmaBlock('S1', s.firma, are(1), false)

  const a2 = are(2)
  box('S2', a2)
  firmaBlock('S2', s.firma, a2)
  box('21', a2 && elementeAlese(CATALOG_21, s.s21).length > 0)
  catalog(CATALOG_21, s.s21, a2)
  box('22', a2 && elementeAlese(CATALOG_22, s.s22).length > 0)
  catalog(CATALOG_22, s.s22, a2)
  box('23', a2 && s.s23)

  box('S3', are(3))
  txtManual('S3_AUTORITATE', s.s3Autoritate, are(3))
  firmaBlock('S3', s.firma, are(3))

  const a4 = are(4)
  box('S4', a4)
  firmaBlock('S4', s.firma, a4)
  box('S4_DECES', a4 && s.s4Motiv === 'DECES'); box('S4_CERERE', a4 && s.s4Motiv === 'CERERE'); box('S4_ART120', a4 && s.s4Motiv === 'ART120')

  const a5 = are(5)
  box('S5', a5)
  firmaBlock('S5', s.firma, a5)
  txtManual('S5_ACT', s.s5.act, a5); txtManual('S5_CERERE', s.s5.cerere, a5)
  box('S5_INREGISTRARE', a5 && s.s5.tipCerere.includes('INREGISTRARE'))
  box('S5_MENTIUNE', a5 && s.s5.tipCerere.includes('MENTIUNE'))
  box('S5_RADIERE', a5 && s.s5.tipCerere.includes('RADIERE'))
  txtManual('S5_IN_LOC_DE', s.s5.inLocDe, a5); txtManual('S5_SE_VA', s.s5.seVa, a5)

  // VII. Obiectul de activitate — tabelele rămân goale dacă rubrica nu se completează.
  for (const m of ['INREGISTRARE', 'MODIFICARE', 'ACTUALIZARE'] as ModVII[]) box(`VII_${m}`, s.vii.moduri.includes(m))
  const aVii = s.vii.moduri.length > 0
  celula('CAEN_P_COD', aVii ? s.vii.principal.cod : ''); celula('CAEN_P_DEN', aVii ? s.vii.principal.den : '')
  for (const l of ['inreg', 'renuntare', 'completare'] as ListaCaen[]) {
    const activ = listaCaenActiva(s, l)
    box(`CAEN_${CAEN_TAG[l]}`, activ)
    // Rândurile completate, de sus în jos (cele goale din mijloc nu lasă găuri în tabel).
    const clase = activ ? claseCompletate(s.vii.liste[l]) : []
    for (let i = 0; i < CAEN_RANDURI[l]; i++) {
      celula(`CAEN_${CAEN_TAG[l]}_${i + 1}_COD`, clase[i]?.cod)
      celula(`CAEN_${CAEN_TAG[l]}_${i + 1}_DEN`, clase[i]?.den)
    }
  }

  // VIII. Sedii secundare
  box('VIII_INF', s.viii.inf); txtManual('VIII_INF', s.viii.infText, s.viii.inf)
  box('VIII_RAD', s.viii.rad); txtManual('VIII_RAD', s.viii.radText, s.viii.rad)

  // IX. Solicit
  box('AUDIENTA', s.ix.audienta); box('COPII', s.ix.copii); box('COPII_CERT', s.ix.copiiCert)
  txtManual('T_COPII_CERT', s.ix.copiiCertDoc, s.ix.copiiCert)
  box('COMUNICARE', s.ix.comunicare)
  for (const m of ['POSTA', 'CURIER', 'ELECTRONIC', 'SEDIU_ORCT', 'PRIMARIE'] as const) cerc(m, s.ix.comunicare && s.ix.modalitate === m)
  txtManual('T_SEDIU_ORCT', s.ix.sediuOrct, s.ix.comunicare && s.ix.modalitate === 'SEDIU_ORCT')
  txtManual('T_PRIMARIE', s.ix.primarie, s.ix.comunicare && s.ix.modalitate === 'PRIMARIE')

  // X–XI. Persoana pentru comunicare și datele de facturare (nota 10: fără date, factura e pe plătitor)
  comunicare(persoanaComunicare(s))
  facturare(dateFacturare(s))

  // XII. Opis
  s.opis.slice(0, OPIS_RANDURI_2B).forEach((row, i) => {
    const n = i + 1
    if (n > OPIS_TIPARITE.length) celula(`OPIS_${n}_DEN`, row.den)
    celula(`OPIS_${n}_NRDATA`, row.nrData)
    celula(`OPIS_${n}_FILE`, row.file)
  })
  celula('OPIS_TOTAL', totalFile(s.opis))

  // XIII–XIV. Semnatarul (persoana de la IV) și data
  txtManual('XIII_NUME', `${s.sub.nume} ${s.sub.prenume}`.trim(), true)
  txtManual('XIII_DATA', s.dataSemnare, true)
  txtManual('ANEXE', s.anexe, true, true)
  txtManual('XIV_DATA', s.dataSemnare, true)

  // XV. Deponentul — doar dacă e altă persoană decât semnatarul (nota 13)
  deponent(s.dep, s.dataSemnare)

  return { replacements: r }
}

// ── Validare ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Secțiunile formularului (acordeonul din Anexa2bFiller), în ordinea documentului. */
export type Sectiune2b = 'antet' | 'iv' | 'v' | 'vi' | 'firma' | 'p2' | 'p3' | 'p4' | 'p5' | 'vii' | 'viii' | 'ix' | 'x' | 'xi' | 'xii' | 'semnare'

export type Verificare2b = VerificareOnrc<Sectiune2b>

/** Câmpurile fără de care cererea nu se poate depune. Restul rămân opționale (în document: „-” sau puncte). */
export function verificari2b(s: Anexa2bFormState): Verificare2b[] {
  const v: Verificare2b[] = []
  const add = (invalid: boolean, id: string, message: string, sectiune: Sectiune2b) => v.push({ invalid, id, message, sectiune })
  const are = (n: Punct2b) => s.puncte.includes(n)

  add(!s.orcTribunal.trim(), 'orc', 'oficiul registrului comerțului (tribunalul)', 'antet')
  add(!s.entitate, 'entitate', 'forma: PFA, întreprindere individuală sau familială', 'antet')
  v.push(...verificariSubsemnat(s, 'iv'))
  add(s.puncte.length === 0, 'puncte', 'cel puțin un punct din secțiunea VI', 'vi')

  if (s.puncte.length > 0) v.push(...verificariFirma(s.firma, 'sediului profesional', 'firma'))
  if (are(2)) {
    const nimic = elementeAlese(CATALOG_21, s.s21).length === 0 && elementeAlese(CATALOG_22, s.s22).length === 0 && !s.s23
    add(nimic, 's2-ceva', 'cel puțin o mențiune sau un act depus (2.1, 2.2 sau 2.3)', 'p2')
  }
  if (are(3)) add(!s.s3Autoritate.trim(), 's3-autoritate', 'autoritatea/instituția publică (3)', 'p3')
  if (are(4)) add(!s.s4Motiv, 's4-motiv', 'motivul radierii (4)', 'p4')
  if (are(5)) {
    add(!s.s5.act.trim(), 's5-act', 'actul la care se referă eroarea (5)', 'p5')
    add(!s.s5.seVa.trim(), 's5-seva', 'ce se va înregistra (5)', 'p5')
  }
  if (s.vii.moduri.length > 0) {
    add(!s.vii.principal.cod.trim(), 'vii-principal', 'clasa CAEN a activității principale (VII)', 'vii')
  }
  if (s.ix.comunicare) add(!s.ix.modalitate, 'ix-modalitate', 'modalitatea de comunicare (IX)', 'ix')
  if (s.dep.activ) {
    add(!s.dep.nume.trim() || !s.dep.prenume.trim(), 'dep-nume', 'numele deponentului (XV)', 'semnare')
    add(!s.dep.calitate.trim(), 'dep-calitate', 'calitatea deponentului (XV)', 'semnare')
  }
  return v
}

/** Avertismente care nu blochează generarea. */
export function avertismente2b(s: Anexa2bFormState, client?: Partial<Client> | null): string[] {
  const out: string[] = []
  if (s.sub.cnp.trim() && !cnpOk(s.sub.cnp)) out.push('CNP-ul de la punctul IV nu are 13 cifre (e în regulă doar dacă e un NIF).')
  if (s.puncte.includes(2)) {
    const cuDeclaratie = elementeAlese(CATALOG_21, s.s21).filter(el => el.nota === NOTA_DECLARATIE)
    if (cuDeclaratie.length > 0 && !s.s23) out.push(`Ai ales ${cuDeclaratie.map(e => `„${e.label}”`).join(', ')}: ${NOTA_DECLARATIE}`)
  }
  if (s.entitate === 'IF') {
    const numeSub = `${s.sub.nume} ${s.sub.prenume}`.trim()
    const membriFisa = persoaneCandidatPF(client).filter(c => c.label !== numeSub).length
    if (membriFisa > MEMBRI_RANDURI) out.push(`În fișă sunt ${membriFisa} membri pe lângă reprezentant: formularul are loc pentru ${MEMBRI_RANDURI}, ceilalți se trec într-o anexă (nota 2).`)
  }
  for (const l of ['inreg', 'completare'] as ListaCaen[]) {
    if (s.vii.on[l] && claseCompletate(s.vii.liste[l]).length >= CAEN_RANDURI[l]) {
      out.push('Dacă sunt mai multe activități decât rândurile din tabel, ele se trec într-o anexă (nota 8).')
      break
    }
  }
  if (s.entitate && s.vii.moduri.includes('INREGISTRARE')) {
    const total = (s.vii.principal.cod.trim() ? 1 : 0) + (listaCaenActiva(s, 'inreg') ? claseCompletate(s.vii.liste.inreg).length : 0)
    const max = MAX_CLASE_CAEN[s.entitate]
    if (total > max) out.push(`${s.entitate} poate avea cel mult ${max} clase CAEN (OUG nr. 44/2008); ai ${total}.`)
  }
  const m = s.vii.moduri
  if (m.length === 1 && m[0] === 'ACTUALIZARE' && (['inreg', 'renuntare', 'completare'] as ListaCaen[]).some(l => s.vii.on[l])) {
    out.push('La „doar actualizare CAEN Rev. 3” se completează numai activitatea principală (nota 9); activitățile secundare nu apar în document.')
  }
  return out
}
