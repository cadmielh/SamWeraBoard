// Logică pură (fără JSX) pentru „Anexa 2a - Cerere înregistrare în registrul comerțului (PJ)” (ONRC) — starea editată
// în Anexa2aFiller și asamblarea ei în `replacements` pentru /fill/docx. Șablonul (generat de
// scripts/genereaza_anexa2a_docx.py) reproduce formularul oficial complet; fiecare etichetă primește aici o valoare,
// după convențiile din onrcCommon.ts.
// Nu se folosesc etichetele generice {{SOCIETATE_*}}: „pentru firma …” apare la mai multe puncte și trebuie completat
// doar la cele alese.
import type { Client, Persoana } from '../types'
import {
  DOTS, EMPTY_PERSOANA, comunicareGoala, cnpOk, dateFacturare, deponentGol, elementeAlese, facturareGoala, firmaDinFisa,
  optiune as o, persoanaComunicare, persoanaDinFisa, scriitorOnrc, totalFile, tribunalDinJudet, verificariFirma, verificariSubsemnat,
} from './onrcCommon'
import type {
  CatalogStare, ComunicareOnrc, DeponentOnrc, FacturareOnrc, FirmaA2A, GrupCatalog, PersoanaA2A, PersoanaCandidat,
  VerificareOnrc,
} from './onrcCommon'
import { formatDateRo } from './dates'

export const ANEXA2A_KEY = 'anexa2a_cerere_inregistrare_pj'


/** Persoanele din fișă care pot semna sau reprezenta: administratorii, apoi asociații (fără dubluri după nume). */
export function persoaneCandidat(client?: Partial<Client> | null): PersoanaCandidat[] {
  const out: PersoanaCandidat[] = []
  const seen = new Set<string>()
  const add = (arr: Persoana[] | undefined, src: string, calitate: string) => (arr ?? []).forEach((p, i) => {
    const label = `${p.nume ?? ''} ${p.prenume ?? ''}`.trim()
    if (!label || seen.has(label)) return
    seen.add(label)
    out.push({ id: `${src}:${i}`, label, calitate, persoana: p })
  })
  add(client?.administratori, 'administratori', 'administrator')
  add(client?.asociati, 'asociati', 'asociat')
  return out
}

export interface SediuSucursala {
  firma: string; loc: string; str: string; nr: string; bl: string; sc: string; et: string; ap: string; jud: string
  email: string; tel: string
}

export const EMPTY_SEDIU_SUCURSALA: SediuSucursala = { firma: '', loc: '', str: '', nr: '', bl: '', sc: '', et: '', ap: '', jud: '', email: '', tel: '' }

// ── Catalogul punctelor 4.1 și 4.2 ──────────────────────────────────────────────────────────────────────────────────
const NOTA_DECLARATIE = 'Formularul cere și declarația pe propria răspundere (punctul 4.3, nota 7).'

export const CATALOG_41: GrupCatalog[] = [
  {
    titlu: 'Firmă, sediu și sedii secundare',
    elemente: [
      { id: 'DENUMIRE', box: '41_DENUMIRE', label: 'Modificare denumire firmă' },
      { id: 'FORMA', box: '41_FORMA', label: 'Schimbare formă juridică' },
      { id: 'SEDIU', box: '41_SEDIU', label: 'Schimbare sediu social', texte: [{ tag: '41_SEDIU_JUDET', label: 'Noul sediu, în județul' }], nota: NOTA_DECLARATIE },
      {
        id: 'SPATIU', box: '41_SPATIU', label: 'Sediu social — act de spațiu',
        grupuri: [{ simbol: 'O', multi: false, optiuni: [o('41_SPATIU_PRELUNGIRE', 'Prelungire valabilitate act de spațiu'), o('41_SPATIU_MODIFICARE', 'Modificare act de spațiu')] }],
      },
      {
        id: 'SEDII', box: '41_SEDII', label: 'Sedii secundare',
        grupuri: [{ simbol: 'O', multi: true, optiuni: [o('41_SEDII_INF', 'Înființare'), o('41_SEDII_DESF', 'Desființare'), o('41_SEDII_MOD', 'Modificare/prelungire valabilitate')] }],
        texte: [
          { tag: '41_SEDII_INF_NR', label: 'Nr. sedii înființate', scurt: true, pentru: '41_SEDII_INF' },
          { tag: '41_SEDII_DESF_NR', label: 'Nr. sedii desființate', scurt: true, pentru: '41_SEDII_DESF' },
          { tag: '41_SEDII_MOD_NR', label: 'Nr. sedii modificate', scurt: true, pentru: '41_SEDII_MOD' },
        ],
        nota: NOTA_DECLARATIE,
      },
    ],
  },
  {
    titlu: 'Asociați, capital și conducere',
    elemente: [
      { id: 'TRANSMITERE', box: '41_TRANSMITERE', label: 'Transmitere părți sociale/acțiuni/părți de interes', texte: [{ tag: '41_TRANSMITERE_NR', label: 'Nr. asociați/acționari/membri care intră în societate', scurt: true }] },
      { id: 'BENEFICII', box: '41_BENEFICII', label: 'Participare la beneficii și pierderi' },
      { id: 'ORGANE', box: '41_ORGANE', label: 'Schimbare membri organe de conducere/administrare/control', texte: [{ tag: '41_ORGANE_NR', label: 'Nr. persoane numite (administrator, director, cenzor etc.)', scurt: true }] },
      { id: 'ASOCIAT', box: '41_ASOCIAT', label: 'Asociat/Acționar', grupuri: [{ simbol: 'O', multi: false, optiuni: [o('41_EXCLUDERE', 'Excludere'), o('41_RETRAGERE', 'Retragere')] }] },
      { id: 'CAPITAL', box: '41_CAPITAL', label: 'Capital social', grupuri: [{ simbol: 'O', multi: false, optiuni: [o('41_MAJORARE', 'Majorare'), o('41_REDUCERE', 'Reducere')] }] },
      {
        id: 'RENUNTARE', box: '41_RENUNTARE', label: 'Renunțare mandat',
        grupuri: [{ simbol: 'O', multi: true, optiuni: [o('41_REN_ADMIN', 'Administratori'), o('41_REN_IMPUTERNICITI', 'Persoane împuternicite'), o('41_REN_CENZORI', 'Cenzori')] }],
      },
      { id: 'DATE_ID', box: '41_DATE_ID', label: 'Modificare date de identificare ale profesionistului' },
      { id: 'REGIM', box: '41_REGIM', label: 'Modificare regim matrimonial' },
    ],
  },
  {
    titlu: 'Durată, activitate și acte',
    elemente: [
      { id: 'DURATA', box: '41_DURATA', label: 'Durată funcționare', grupuri: [{ simbol: 'O', multi: false, optiuni: [o('41_DURATA_PREL', 'Prelungire'), o('41_DURATA_RED', 'Reducere')] }] },
      { id: 'SUSPENDARE', label: 'Suspendare / reluare activitate', grupuri: [{ simbol: 'B', multi: false, optiuni: [o('41_SUSPENDARE', 'Suspendare activitate'), o('41_RELUARE', 'Reluare activitate')] }], nota: NOTA_DECLARATIE },
      { id: 'OBIECT', box: '41_OBIECT', label: 'Modificare obiect de activitate', nota: NOTA_DECLARATIE },
      { id: 'AC_ACTUALIZAT', box: '41_AC_ACTUALIZAT', label: 'Depunere act constitutiv actualizat' },
      { id: 'EXTRAS', box: '41_EXTRAS', label: 'Extras din registrul acționarilor' },
      { id: 'PRESCHIMBARE', box: '41_PRESCHIMBARE', label: 'Preschimbare certificat de înregistrare' },
    ],
  },
  {
    titlu: 'Reorganizări (fuziune, divizare, SE, GIE)',
    elemente: [
      { id: 'GIE', box: '41_GIE', label: 'Modificări acte constitutive GIE/GEIE' },
      { id: 'SE', box: '41_SE', label: 'Transformare societate pe acțiuni în SE' },
      { id: 'SE_SEDIU', box: '41_SE_SEDIU', label: 'Transfer sediu social SE într-un alt stat membru' },
      {
        id: 'DIVIZARE', label: 'Divizare / Fuziune',
        grupuri: [{ simbol: 'B', multi: true, optiuni: [o('41_DIVIZARE', 'Divizare'), o('41_FUZIUNE', 'Fuziune')] }],
        texte: [{ tag: '41_FUZIUNE_NR', label: 'Nr. profesioniști participanți', scurt: true }],
      },
      {
        id: 'CERT', box: '41_CERT', label: 'Certificat prealabil în operațiune transfrontalieră',
        grupuri: [{ simbol: 'O', multi: false, optiuni: [o('41_CERT_FUZIUNE', 'Fuziune'), o('41_CERT_DIVIZARE', 'Divizare'), o('41_CERT_TRANSFORMARE', 'Transformare')] }],
      },
      {
        id: 'TF', label: 'Fuziune / divizare / transformare transfrontalieră',
        grupuri: [{ simbol: 'B', multi: true, optiuni: [o('41_TF_FUZIUNE', 'Fuziune'), o('41_TF_DIVIZARE', 'Divizare'), o('41_TF_TRANSFORMARE', 'Transformare')] }],
      },
    ],
  },
  {
    titlu: 'Dizolvare, lichidare, insolvență',
    elemente: [
      { id: 'DIZOLVARE', box: '41_DIZOLVARE', label: 'Dizolvare' },
      { id: 'LICHIDATOR', box: '41_LICHIDATOR', label: 'Numire lichidator' },
      { id: 'CONSTATARE', box: '41_CONSTATARE', label: 'Constatare dizolvare, art. 237² din Legea nr. 31/1990' },
      {
        id: 'CONCORDAT', box: '41_CONCORDAT', label: 'Concordat preventiv',
        grupuri: [{ simbol: 'O', multi: false, optiuni: [o('41_CONC_DESCH', 'Deschidere'), o('41_CONC_INCH', 'Închidere'), o('41_CONC_ALTE', 'Alte mențiuni')] }],
        texte: [{ tag: '41_CONC_ALTE', label: 'Alte mențiuni', pentru: '41_CONC_ALTE' }],
      },
      { id: 'ACORD', box: '41_ACORD', label: 'Confirmare acord de restructurare preventivă' },
      {
        id: 'INSOLVENTA', label: 'Insolvență / Reorganizare judiciară / Faliment',
        grupuri: [
          { simbol: 'B', multi: true, optiuni: [o('41_INSOLVENTA', 'Insolvență'), o('41_REORGANIZARE', 'Reorganizare judiciară'), o('41_FALIMENT', 'Faliment')] },
          { simbol: 'O', multi: false, optiuni: [o('41_INS_DESCH', 'Deschidere'), o('41_INS_INCH', 'Închidere'), o('41_INS_ALTE', 'Alte mențiuni')] },
        ],
        texte: [{ tag: '41_INS_ALTE', label: 'Alte mențiuni', pentru: '41_INS_ALTE' }],
      },
    ],
  },
  {
    titlu: 'Măsuri și sancțiuni',
    elemente: [
      {
        id: 'ASIGURATORII', box: '41_ASIGURATORII', label: 'Înființare măsuri asigurătorii',
        grupuri: [{ simbol: 'O', multi: true, optiuni: [o('41_SECHESTRU', 'Sechestru asigurător'), o('41_POPRIRE', 'Poprire'), o('41_ALTE_ASIG', 'Alte măsuri asigurătorii')] }],
      },
      { id: 'MASURI', box: '41_MASURI', label: 'Măsuri', grupuri: [{ simbol: 'O', multi: true, optiuni: [o('41_PREVENTIVE', 'Preventive'), o('41_COMPLEMENTARE', 'Complementare')] }] },
      { id: 'CONDAMNARE', box: '41_CONDAMNARE', label: 'Condamnare penală definitivă' },
    ],
  },
  {
    titlu: 'Alte mențiuni',
    elemente: [{ id: 'ALTE', box: '41_ALTE', label: 'Alte mențiuni', texte: [{ tag: '41_ALTE', label: 'Care' }] }],
  },
]

export const CATALOG_42: GrupCatalog[] = [
  {
    titlu: 'Capital, hotărâri și proiecte',
    elemente: [
      { id: 'VARSAMANT', box: '42_VARSAMANT', label: 'Dovadă vărsământ capital social' },
      {
        id: 'PROSPECT', box: '42_PROSPECT', label: 'Prospect de emisiune acțiuni prin subscripție publică',
        grupuri: [{ simbol: 'O', multi: false, optiuni: [o('42_PROSPECT_CONST', 'Constituire'), o('42_PROSPECT_MAJ', 'Majorare capital S.A.')] }],
      },
      {
        id: 'HOTARARE', box: '42_HOTARARE', label: 'Hotărâre AGA / Decizie C.A. / Decizie directorat privind',
        grupuri: [{ simbol: 'O', multi: true, optiuni: [o('42_H_MAJ', 'Majorare capital'), o('42_H_RED', 'Reducere capital'), o('42_H_DURATA', 'Durata de funcționare'), o('42_H_DIZ', 'Dizolvare'), o('42_H_ALTE', 'Altele')] }],
        texte: [{ tag: '42_H_ALTE', label: 'Altele', pentru: '42_H_ALTE' }],
      },
      { id: 'PROIECT_FUZ', box: '42_PROIECT_FUZ', label: 'Proiect de fuziune', texte: [{ tag: '42_PROIECT_FUZ_NR', label: 'Nr. profesioniști participanți', scurt: true }] },
      { id: 'PROIECT_DIV', box: '42_PROIECT_DIV', label: 'Proiect de divizare', texte: [{ tag: '42_PROIECT_DIV_NR', label: 'Nr. profesioniști participanți', scurt: true }] },
      { id: 'EXPERT', box: '42_EXPERT', label: 'Numire expert' },
    ],
  },
  {
    titlu: 'Situații financiare și lichidare',
    elemente: [
      {
        id: 'SIT_FIN', box: '42_SIT_FIN', label: 'Situații financiare',
        grupuri: [{ simbol: 'O', multi: true, optiuni: [o('42_SF_ANUALE', 'Anuale'), o('42_SF_CONSOLIDATE', 'Consolidate'), o('42_SF_DECLARATIE', 'Declarație pe propria răspundere')] }],
      },
      { id: 'SF_LICHIDARE', box: '42_SF_LICHIDARE', label: 'Situații financiare finale de lichidare și repartizare' },
      { id: 'REGISTRE', box: '42_REGISTRE', label: 'Registre și acte ale persoanei juridice radiate' },
      { id: 'DARE_SEAMA', box: '42_DARE_SEAMA', label: 'Dare de seamă asupra gestiunii administratorilor/membrilor directoratului' },
    ],
  },
  {
    titlu: 'Instanță și contestații',
    elemente: [
      { id: 'OPOZITIE', box: '42_OPOZITIE', label: 'Opoziție' },
      { id: 'PLANGERE', box: '42_PLANGERE', label: 'Plângere' },
      { id: 'RADIERE120', box: '42_RADIERE120', label: 'Radiere conform art. 120 din Legea nr. 265/2022' },
      { id: 'HOT_JUD', box: '42_HOT_JUD', label: 'Hotărâre judecătorească' },
      { id: 'ACT_PROC', box: '42_ACT_PROC', label: 'Act procedural care redă dispozitivul hotărârii judecătorești' },
    ],
  },
  {
    titlu: 'Alte acte',
    elemente: [
      { id: 'ART103', box: '42_ART103', label: 'Acte conform art. 103 din Legea nr. 265/2022', texte: [{ tag: '42_ART103', label: 'Care' }] },
      { id: 'ALTE', box: '42_ALTE', label: 'Alte înscrisuri', texte: [{ tag: '42_ALTE', label: 'Care' }] },
    ],
  },
]

// ── Starea formularului ─────────────────────────────────────────────────────────────────────────────────────────────

export type Punct = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export const PUNCTE: { nr: Punct; tip: string; label: string }[] = [
  { nr: 1, tip: 'INMATRICULARE', label: 'Înmatriculare' },
  { nr: 2, tip: 'SUCURSALA_RO', label: 'Înregistrare sucursală persoană juridică română' },
  { nr: 3, tip: 'SUCURSALA_STRAINA', label: 'Înregistrare sucursală persoană juridică străină' },
  { nr: 4, tip: 'MENTIUNI', label: 'Înscriere mențiuni' },
  { nr: 5, tip: 'OPERATIUNI', label: 'Înscriere operațiuni comunicate de autoritatea/instituția publică' },
  { nr: 6, tip: 'RADIERE', label: 'Radiere' },
  { nr: 7, tip: 'EROARE', label: 'Îndreptare eroare materială' },
  { nr: 8, tip: 'CAEN', label: 'Actualizare obiect de activitate conform CAEN Rev. 3' },
]
/** Punctele care se referă la firma clientului („pentru firma …”), deci folosesc datele firmei. */
export const PUNCTE_CU_FIRMA: Punct[] = [1, 4, 5, 6, 7, 8]

export type Puteri = 'impreuna' | 'separat' | ''

export interface Anexa2aFormState {
  orcTribunal: string
  puncte: Punct[]
  actTemei: string
  subSursa: string          // id-ul persoanei din fișă, '__manual__' sau '' (nealeasă)
  sub: PersoanaA2A
  subRegim: string
  subCalitate: string
  subPrin: string
  subConform: string
  firma: FirmaA2A
  // *Sursa: ca la subSursa — persoana din fișă din care s-au preluat datele, '__manual__' sau ''.
  s2: { sediu: SediuSucursala; rd: PersoanaA2A; rdSursa: string; rn: PersoanaA2A; rnSursa: string; puteri: Puteri; pjOrct: string; pjDen: string; pjNrReg: string; pjCui: string }
  s3: {
    pjsFirma: string; pjsTara: string; pjsNrReg: string; pjsEuid: string
    rs: { nume: string; prenume: string; actTip: string; actSeria: string; actNr: string; actEmis: string; actData: string; actValabil: string; calitate: string }
    sediu: SediuSucursala; rn: PersoanaA2A; rnSursa: string; puteri: Puteri; lege: string
  }
  s41: CatalogStare
  s42: CatalogStare
  s43: boolean
  s5Autoritate: string
  s6: { tip: 'PJ' | 'SUC_RO' | 'SUC_STR' | ''; motiv: 'VOINTA' | 'HOTARARE' | 'INCETARE' | 'ALTELE' | ''; motivAltele: string; raport: boolean }
  s7: { act: string; cerere: string; tipCerere: ('INMATRICULARE' | 'MENTIUNE' | 'RADIERE')[]; inLocDe: string; seVa: string }
  s8Obiect: string
  vi: { audienta: boolean; copii: boolean; copiiCert: boolean; copiiCertDoc: string; comunicare: boolean; modalitate: 'POSTA' | 'CURIER' | 'ELECTRONIC' | 'SEDIU_ORCT' | ''; sediuOrct: string }
  com: ComunicareOnrc
  fact: FacturareOnrc
  opis: { caractere: string; pagini: string; randuri: { den: string; nrData: string; file: string }[] }
  anexe: string
  dataSemnare: string
  dep: DeponentOnrc
}

export const OPIS_RANDURI = 7

/** Starea inițială, precompletată din fișa clientului. Fără client: formular gol (dar valid ca structură). */
export function stareInitiala(client?: Partial<Client> | null, azi: Date = new Date()): Anexa2aFormState {
  const candidati = persoaneCandidat(client)
  const admini = candidati.filter(c => c.id.startsWith('administratori:'))
  const admin = admini[0]
  // Semnează de regulă reprezentantul legal (nota 1): administratorul, dacă e unul singur; altfel singura persoană din fișă.
  const primul = admini.length === 1 ? admin : candidati.length === 1 ? candidati[0] : undefined
  const firma = firmaDinFisa(client)
  const caen = [client?.caenCod, client?.caenDescriere].filter(Boolean).join(' - ')
  return {
    orcTribunal: tribunalDinJudet(client?.sediuSocial?.judet),
    // Clientul în înființare are nevoie de înmatriculare; altfel, cererea obișnuită e de înscriere mențiuni.
    puncte: client ? [client.inInfiintare ? 1 : 4] : [],
    actTemei: '',
    subSursa: primul?.id ?? '',
    sub: primul ? persoanaDinFisa(primul.persoana) : { ...EMPTY_PERSOANA },
    subRegim: '',
    subCalitate: primul?.calitate ?? '',
    subPrin: '',
    subConform: '',
    firma,
    s2: {
      sediu: { ...EMPTY_SEDIU_SUCURSALA },
      rd: admin ? persoanaDinFisa(admin.persoana) : { ...EMPTY_PERSOANA },
      rdSursa: admin?.id ?? '',
      rn: { ...EMPTY_PERSOANA },
      rnSursa: '',
      puteri: '',
      pjOrct: tribunalDinJudet(client?.sediuSocial?.judet), pjDen: firma.firma, pjNrReg: firma.nrReg, pjCui: firma.cui,
    },
    s3: {
      pjsFirma: '', pjsTara: '', pjsNrReg: '', pjsEuid: '',
      rs: { nume: '', prenume: '', actTip: '', actSeria: '', actNr: '', actEmis: '', actData: '', actValabil: '', calitate: '' },
      sediu: { ...EMPTY_SEDIU_SUCURSALA }, rn: { ...EMPTY_PERSOANA }, rnSursa: '', puteri: '', lege: '',
    },
    s41: {},
    s42: {},
    s43: false,
    s5Autoritate: '',
    s6: { tip: '', motiv: '', motivAltele: '', raport: false },
    s7: { act: '', cerere: '', tipCerere: [], inLocDe: '', seVa: '' },
    s8Obiect: caen,
    vi: { audienta: false, copii: false, copiiCert: false, copiiCertDoc: '', comunicare: false, modalitate: '', sediuOrct: '' },
    com: comunicareGoala(),
    fact: facturareGoala(client ? 'firma' : 'manual'),
    opis: { caractere: '', pagini: '', randuri: Array.from({ length: OPIS_RANDURI }, () => ({ den: '', nrData: '', file: '' })) },
    anexe: '',
    dataSemnare: formatDateRo(azi),
    dep: deponentGol(),
  }
}

export interface Anexa2aDocxData { replacements: Record<string, string> }

export function buildAnexa2aDocxData(s: Anexa2aFormState): Anexa2aDocxData {
  const { r, box, cerc, txt, txtManual, celula, persoana, catalog, firmaBlock: firma, subsemnat, comunicare, facturare, deponent } = scriitorOnrc('A2A')
  const firmaBlock = (pre: string, f: FirmaA2A, activ: boolean) => firma(pre, f, activ, pre !== 'S1')
  const sediuSuc = (pre: string, sd: SediuSucursala, activ: boolean) => {
    txt(`${pre}_FIRMA`, sd.firma, activ)
    txt(`${pre}_LOC`, sd.loc, activ); txt(`${pre}_STR`, sd.str, activ)
    txt(`${pre}_NR`, sd.nr, activ, true); txt(`${pre}_BL`, sd.bl, activ, true); txt(`${pre}_SC`, sd.sc, activ, true)
    txt(`${pre}_ET`, sd.et, activ, true); txt(`${pre}_AP`, sd.ap, activ, true); txt(`${pre}_JUD`, sd.jud, activ)
    txt(`${pre}_EMAIL`, sd.email, activ); txt(`${pre}_TEL`, sd.tel, activ)
  }
  const are = (n: Punct) => s.puncte.includes(n)

  // I–III. Antet: tipul cererii urmează punctele alese la V.
  r['{{A2A_ORC_TRIBUNAL}}'] = s.orcTribunal.trim() || DOTS
  for (const p of PUNCTE) box(`TIP_${p.tip}`, are(p.nr))

  // IV. Subsemnatul
  subsemnat(s)
  txtManual('ACT_TEMEI', s.actTemei, true)

  // V.1 Înmatriculare
  box('S1', are(1))
  firmaBlock('S1', s.firma, are(1))

  // V.2 Sucursală PJ română
  box('S2', are(2))
  sediuSuc('S2', s.s2.sediu, are(2))
  persoana('S2_RD', s.s2.rd, are(2))
  persoana('S2_RN', s.s2.rn, are(2))
  box('S2_IMPREUNA', are(2) && s.s2.puteri === 'impreuna')
  box('S2_SEPARAT', are(2) && s.s2.puteri === 'separat')
  txt('S2_PJ_ORCT', s.s2.pjOrct, are(2)); txt('S2_PJ_DEN', s.s2.pjDen, are(2))
  txt('S2_PJ_NRREG', s.s2.pjNrReg, are(2)); txt('S2_PJ_CUI', s.s2.pjCui, are(2))

  // V.3 Sucursală PJ străină
  const a3 = are(3)
  box('S3', a3)
  txt('S3_PJS_FIRMA', s.s3.pjsFirma, a3); txt('S3_PJS_TARA', s.s3.pjsTara, a3)
  txt('S3_PJS_NRREG', s.s3.pjsNrReg, a3); txt('S3_PJS_EUID', s.s3.pjsEuid, a3)
  const rs = s.s3.rs
  txt('S3_RS_NUME', rs.nume, a3); txt('S3_RS_PRENUME', rs.prenume, a3); txt('S3_RS_ACT_TIP', rs.actTip, a3)
  txt('S3_RS_ACT_SERIA', rs.actSeria, a3, true); txt('S3_RS_ACT_NR', rs.actNr, a3); txt('S3_RS_ACT_EMIS', rs.actEmis, a3)
  txt('S3_RS_ACT_DATA', rs.actData, a3); txt('S3_RS_ACT_VALABIL', rs.actValabil, a3); txt('S3_RS_CALITATE', rs.calitate, a3)
  sediuSuc('S3', s.s3.sediu, a3)
  persoana('S3_RN', s.s3.rn, a3)
  box('S3_IMPREUNA', a3 && s.s3.puteri === 'impreuna')
  box('S3_SEPARAT', a3 && s.s3.puteri === 'separat')
  txt('S3_LEGE', s.s3.lege, a3)

  // V.4 Înscriere mențiuni
  const a4 = are(4)
  box('S4', a4)
  firmaBlock('S4', s.firma, a4)
  box('41', a4 && elementeAlese(CATALOG_41, s.s41).length > 0)
  catalog(CATALOG_41, s.s41, a4)
  box('42', a4 && elementeAlese(CATALOG_42, s.s42).length > 0)
  catalog(CATALOG_42, s.s42, a4)
  box('43', a4 && s.s43)

  // V.5 Operațiuni comunicate de autorități
  box('S5', are(5))
  txtManual('S5_AUTORITATE', s.s5Autoritate, are(5))
  firmaBlock('S5', s.firma, are(5))

  // V.6 Radiere
  const a6 = are(6)
  box('S6', a6)
  firmaBlock('S6', s.firma, a6)
  box('S6_PJ', a6 && s.s6.tip === 'PJ'); box('S6_SUC_RO', a6 && s.s6.tip === 'SUC_RO'); box('S6_SUC_STR', a6 && s.s6.tip === 'SUC_STR')
  box('S6_VOINTA', a6 && s.s6.motiv === 'VOINTA'); box('S6_HOTARARE', a6 && s.s6.motiv === 'HOTARARE')
  box('S6_INCETARE', a6 && s.s6.motiv === 'INCETARE'); box('S6_ALTELE', a6 && s.s6.motiv === 'ALTELE')
  txtManual('T_S6_ALTELE', s.s6.motivAltele, a6 && s.s6.motiv === 'ALTELE')
  box('S6_RAPORT', a6 && s.s6.raport)

  // V.7 Îndreptare eroare materială
  const a7 = are(7)
  box('S7', a7)
  firmaBlock('S7', s.firma, a7)
  txtManual('S7_ACT', s.s7.act, a7); txtManual('S7_CERERE', s.s7.cerere, a7)
  box('S7_INMATRICULARE', a7 && s.s7.tipCerere.includes('INMATRICULARE'))
  box('S7_MENTIUNE', a7 && s.s7.tipCerere.includes('MENTIUNE'))
  box('S7_RADIERE', a7 && s.s7.tipCerere.includes('RADIERE'))
  txtManual('S7_IN_LOC_DE', s.s7.inLocDe, a7); txtManual('S7_SE_VA', s.s7.seVa, a7)

  // V.8 Actualizare CAEN Rev. 3
  box('S8', are(8))
  firmaBlock('S8', s.firma, are(8))
  txtManual('S8_OBIECT', s.s8Obiect, are(8))

  // VI. Solicit
  box('AUDIENTA', s.vi.audienta); box('COPII', s.vi.copii); box('COPII_CERT', s.vi.copiiCert)
  txtManual('T_COPII_CERT', s.vi.copiiCertDoc, s.vi.copiiCert)
  box('COMUNICARE', s.vi.comunicare)
  cerc('POSTA', s.vi.comunicare && s.vi.modalitate === 'POSTA')
  cerc('CURIER', s.vi.comunicare && s.vi.modalitate === 'CURIER')
  cerc('ELECTRONIC', s.vi.comunicare && s.vi.modalitate === 'ELECTRONIC')
  cerc('SEDIU_ORCT', s.vi.comunicare && s.vi.modalitate === 'SEDIU_ORCT')
  txtManual('T_SEDIU_ORCT', s.vi.sediuOrct, s.vi.comunicare && s.vi.modalitate === 'SEDIU_ORCT')

  // VII–VIII. Persoana pentru comunicare și datele de facturare
  comunicare(persoanaComunicare(s))
  facturare(dateFacturare(s))

  // IX. Opis
  txtManual('OPIS_CARACTERE', s.opis.caractere, true, true)
  txtManual('OPIS_PAGINI', s.opis.pagini, true, true)
  s.opis.randuri.slice(0, OPIS_RANDURI).forEach((row, i) => {
    const n = i + 1
    celula(`OPIS_${n}_DEN`, row.den)
    celula(`OPIS_${n}_NRDATA`, row.nrData)
    celula(`OPIS_${n}_FILE`, row.file)
  })
  celula('OPIS_TOTAL', totalFile(s.opis.randuri))

  // X–XI. Semnatarul (persoana de la IV) și data
  txtManual('X_NUME', `${s.sub.nume} ${s.sub.prenume}`.trim(), true)
  txtManual('X_DATA', s.dataSemnare, true)
  txtManual('ANEXE', s.anexe, true, true)
  txtManual('XI_DATA', s.dataSemnare, true)

  // XII. Deponentul — doar dacă e altă persoană decât semnatarul (nota 12)
  deponent(s.dep, s.dataSemnare)

  return { replacements: r }
}

// ── Validare ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Secțiunile formularului (acordeonul din Anexa2aFiller), în ordinea documentului. */
export type SectiuneId = 'antet' | 'iv' | 'v' | 'firma' | 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7' | 'p8' | 'vi' | 'vii' | 'viii' | 'ix' | 'semnare'

export type VerificareA2A = VerificareOnrc<SectiuneId>

/** Câmpurile fără de care cererea nu se poate depune. Restul rămân opționale (în document: „-” sau puncte). */
export function verificari(s: Anexa2aFormState): VerificareA2A[] {
  const v: VerificareA2A[] = []
  const add = (invalid: boolean, id: string, message: string, sectiune: SectiuneId) => v.push({ invalid, id, message, sectiune })
  const are = (n: Punct) => s.puncte.includes(n)

  add(!s.orcTribunal.trim(), 'orc', 'oficiul registrului comerțului (tribunalul)', 'antet')
  v.push(...verificariSubsemnat(s, 'iv'))
  add(s.puncte.length === 0, 'puncte', 'cel puțin un punct din secțiunea V', 'v')

  if (PUNCTE_CU_FIRMA.some(are)) v.push(...verificariFirma(s.firma, 'sediului social', 'firma'))
  if (are(2)) {
    add(!s.s2.sediu.firma.trim(), 's2-firma', 'firma sucursalei (2)', 'p2')
    add(!s.s2.sediu.loc.trim(), 's2-loc', 'localitatea sucursalei (2)', 'p2')
    add(!s.s2.rd.nume.trim(), 's2-rd', 'reprezentantul care deschide sucursala (2)', 'p2')
    add(!s.s2.rn.nume.trim(), 's2-rn', 'reprezentantul care conduce sucursala (2)', 'p2')
    add(!s.s2.puteri, 's2-puteri', 'modul de exercitare a puterilor (2)', 'p2')
  }
  if (are(3)) {
    add(!s.s3.pjsFirma.trim(), 's3-pjs', 'persoana juridică străină (3)', 'p3')
    add(!s.s3.pjsTara.trim(), 's3-tara', 'țara persoanei juridice străine (3)', 'p3')
    add(!s.s3.sediu.firma.trim(), 's3-firma', 'firma sucursalei (3)', 'p3')
    add(!s.s3.rn.nume.trim(), 's3-rn', 'reprezentantul sucursalei (3)', 'p3')
    add(!s.s3.puteri, 's3-puteri', 'modul de exercitare a puterilor (3)', 'p3')
  }
  if (are(4)) {
    const nimic = elementeAlese(CATALOG_41, s.s41).length === 0 && elementeAlese(CATALOG_42, s.s42).length === 0 && !s.s43
    add(nimic, 's4-ceva', 'cel puțin o mențiune sau un act depus (4.1, 4.2 sau 4.3)', 'p4')
  }
  if (are(5)) add(!s.s5Autoritate.trim(), 's5-autoritate', 'autoritatea/instituția publică (5)', 'p5')
  if (are(6)) {
    add(!s.s6.tip, 's6-tip', 'ce se radiază (6)', 'p6')
    add(!s.s6.motiv, 's6-motiv', 'motivul radierii (6)', 'p6')
  }
  if (are(7)) {
    add(!s.s7.act.trim(), 's7-act', 'actul la care se referă eroarea (7)', 'p7')
    add(!s.s7.seVa.trim(), 's7-seva', 'ce se va înregistra (7)', 'p7')
  }
  if (are(8)) add(!s.s8Obiect.trim(), 's8-obiect', 'obiectul de activitate principal (8)', 'p8')
  if (s.vi.comunicare) add(!s.vi.modalitate, 'vi-modalitate', 'modalitatea de comunicare (VI)', 'vi')
  if (s.dep.activ) {
    add(!s.dep.nume.trim() || !s.dep.prenume.trim(), 'dep-nume', 'numele deponentului (XII)', 'semnare')
    add(!s.dep.calitate.trim(), 'dep-calitate', 'calitatea deponentului (XII)', 'semnare')
  }
  return v
}

/** Avertismente care nu blochează generarea (ex. CNP cu alt număr de cifre — poate fi un NIF străin). */
export function avertismente(s: Anexa2aFormState): string[] {
  const out: string[] = []
  if (s.sub.cnp.trim() && !cnpOk(s.sub.cnp)) out.push('CNP-ul de la punctul IV nu are 13 cifre (e în regulă doar dacă e un NIF).')
  if (s.puncte.includes(4)) {
    const cuDeclaratie = elementeAlese(CATALOG_41, s.s41).filter(el => el.nota === NOTA_DECLARATIE)
    if (cuDeclaratie.length > 0 && !s.s43) out.push(`Ai ales ${cuDeclaratie.map(e => `„${e.label}”`).join(', ')}: ${NOTA_DECLARATIE}`)
  }
  if (s.puncte.includes(8) && s.puncte.includes(4) && elementeAlese(CATALOG_41, s.s41).some(el => el.id === 'OBIECT')) {
    out.push('Punctul 8 se completează doar dacă obiectul de activitate NU se modifică (nota 8).')
  }
  return out
}
