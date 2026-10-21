// Logică pură (fără JSX) pentru completarea șablonului DOCX „Anexa 1 -
// Înregistrare fiscală" (ANAF, Anexa nr. 1 la Ordinul 2.509/5.672/C/2022) —
// asamblarea valorilor editate de user în Anexa1Filler, în `replacements`
// pentru /fill/docx. Șablonul n-are niciun bloc repetitiv ({{#TAG}}) — doar
// placeholder-e plate, inclusiv cutiile de dată „cifră cu cifră" (câte un
// placeholder per caracter, vezi splitDigitBoxes).
import type { Client, Persoana } from '../types'

export interface Anexa1DeclarantCandidate {
  label: string
  numeComplet: string
  functie: string
}

/** Candidați pentru „persoana care face declarația": administratorii firmei
 * pentru clienți PJ, titularul pentru clienți PF — exact distincția pe care
 * o face deja declarantCandidates din DeclaratieActivitateFiller.tsx, dar
 * simplificată: aici avem nevoie doar de numele complet + „funcția" scrisă
 * în document, nu de toate câmpurile CI ale unui declarant. */
export function declarantCandidatesAnexa1(client?: Partial<Client> | null): Anexa1DeclarantCandidate[] {
  const numeComplet = (p: Persoana) => `${p.nume ?? ''} ${p.prenume ?? ''}`.trim()

  if (client?.tipClient === 'PF') {
    if (!client.titular) return []
    const label = numeComplet(client.titular)
    return label ? [{ label, numeComplet: label, functie: '-' }] : []
  }

  const seen = new Set<string>()
  const out: Anexa1DeclarantCandidate[] = []
  for (const p of client?.administratori ?? []) {
    const label = numeComplet(p)
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push({ label, numeComplet: label, functie: 'ADMINISTRATOR' })
  }
  return out
}

const RO_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/

/** „13.10.2026" → {{PREFIX_1}}..{{PREFIX_8}} = '1','3','1','0','2','0','2','6' — cifrele zilei, lunii și
 * anului, în ordine, fără separatorii „.", care rămân text fix în șablon (cutiile „/" dintre ele). Gol
 * (string invalid/necompletat) → toate cele 8 placeholder-e primesc „ " (un spațiu), NU string gol: /fill/docx
 * (app.py) filtrează din `replacements` orice valoare falsy (`if v`) înainte de înlocuire — cu „”, cheia ar
 * dispărea din payload și eticheta {{...}} ar rămâne vizibilă literal în document (bug real, raportat de
 * utilizator). Un spațiu e truthy, deci ajunge la `fill_docx`, și randează vizual la fel de gol într-o celulă
 * de-o literă — exact convenția deja folosită de formularul ANAF original pentru cutiile necompletate. */
export function splitDigitBoxes(prefix: string, dataRo: string): Record<string, string> {
  const m = RO_DATE_RE.exec(dataRo.trim())
  const digits = m ? `${m[1]}${m[2]}${m[3]}`.split('') : [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ']
  const out: Record<string, string> = {}
  digits.forEach((d, i) => { out[`{{${prefix}_${i + 1}}}`] = d })
  return out
}

export interface Anexa1FormState {
  // Obligatorii — alegere exclusivă între 1 (impozit pe profit) și 2 (impozit pe veniturile
  // microîntreprinderilor): exact unul dintre cele două se aplică oricărei firme, niciodată amândouă.
  impozitTip: 'profit' | 'micro'
  dataLuareEvidentaProfit: string
  perioadaProfit: 'trimestriala' | 'anuala'
  dataLuareEvidentaMicro: string
  declarantIndex: number | null
  // Opționale, dar vizibile mereu (nu în panoul pliabil)
  nrCerere: string
  dataCerere: string
  // Panoul opțional (punctele 3-4.5)
  salariatiSub3: boolean
  venitSub100k: boolean
  salariiPerioada: 'lunara' | 'trimestriala' | ''
  impozitSalarii: boolean
  dataLuareEvidentaSalarii: string
  cas: boolean
  dataLuareEvidentaCas: string
  cass: boolean
  dataLuareEvidentaCass: string
  cam: boolean
  dataLuareEvidentaCam: string
  tva: boolean
  cifraAfaceriTva: string
  tvaRegim: 'depasire' | 'optiune' | ''
  tvaPerioada: 'lunara' | 'trimestriala' | ''
  tvaLaIncasare: boolean
}

export const EMPTY_ANEXA1_STATE: Anexa1FormState = {
  impozitTip: 'profit',
  dataLuareEvidentaProfit: '',
  perioadaProfit: 'trimestriala',
  dataLuareEvidentaMicro: '',
  declarantIndex: null,
  nrCerere: '',
  dataCerere: '',
  salariatiSub3: false,
  venitSub100k: false,
  salariiPerioada: '',
  impozitSalarii: false,
  dataLuareEvidentaSalarii: '',
  cas: false,
  dataLuareEvidentaCas: '',
  cass: false,
  dataLuareEvidentaCass: '',
  cam: false,
  dataLuareEvidentaCam: '',
  tva: false,
  cifraAfaceriTva: '',
  tvaRegim: '',
  tvaPerioada: '',
  tvaLaIncasare: false,
}

const BIFA = { da: '☒', nu: '☐' } as const
const bif = (checked: boolean) => (checked ? BIFA.da : BIFA.nu)

export interface Anexa1DocxData {
  replacements: Record<string, string>
}

/** Asamblează toate cele 80 de placeholder-e ale șablonului — bifele ☒/☐, cutiile de dată (8 cifre per
 * cutie) și câmpurile de text/declarant — pornind din starea editată de user și din client (pentru tipul de
 * entitate și candidatul de declarant ales). Nu setează {{SOCIETATE_*}}/{{DATA_AZI}} — ca la celelalte
 * șabloane, acelea vin din buildReplacements() (lib/placeholders.ts), combinate de TemplateFiller cu
 * rezultatul de aici înainte de /fill/docx. */
export function buildAnexa1DocxData(state: Anexa1FormState, client?: Partial<Client> | null): Anexa1DocxData {
  const replacements: Record<string, string> = {}
  // „ " (un spațiu) în loc de „” pentru orice valoare goală — vezi comentariul din splitDigitBoxes: /fill/docx
  // (app.py) elimină din payload orice cheie cu valoare falsy, ceea ce ar lăsa eticheta {{...}} vizibilă literal
  // în document (CAMP_NR_CERERE, CAMP_CIFRA_AFACERI_TVA etc., necompletate). Bifele ☒/☐ nu sunt afectate —
  // bif() nu întoarce niciodată string gol.
  const set = (key: string, value: string) => { replacements[`{{${key}}}`] = value || ' ' }

  const isPF = client?.tipClient === 'PF'
  set('BIF_PERSOANA_JURIDICA', bif(!isPF))
  set('BIF_PERSOANA_FIZICA', bif(isPF))

  // Necompletate, rămân punctate ca în formularul ANAF original ("Nr. ...............", "Data ................."
  // — 15, respectiv 17 puncte), nu goale — se pot completa ulterior de mână, la depunere (număr/dată
  // atribuite de ANAF), nu doar la generare.
  set('CAMP_NR_CERERE', state.nrCerere || '.'.repeat(15))
  set('CAMP_DATA_CERERE', state.dataCerere || '.'.repeat(17))

  // 1. Impozit pe profit vs. 2. Impozit pe veniturile microîntreprinderilor — alegere exclusivă,
  // obligatorie (vezi Anexa1FormState.impozitTip): niciodată amândouă bifate deodată.
  const isProfit = state.impozitTip === 'profit'
  set('BIF_IMPOZIT_PROFIT', bif(isProfit))
  Object.assign(replacements, splitDigitBoxes('DLEP', isProfit ? state.dataLuareEvidentaProfit : ''))
  set('BIF_PERIOADA_TRIM', bif(isProfit && state.perioadaProfit === 'trimestriala'))
  set('BIF_PERIOADA_ANUALA', bif(isProfit && state.perioadaProfit === 'anuala'))

  set('BIF_IMPOZIT_MICRO', bif(!isProfit))
  Object.assign(replacements, splitDigitBoxes('DLEM', !isProfit ? state.dataLuareEvidentaMicro : ''))

  const candidates = declarantCandidatesAnexa1(client)
  const declarant = state.declarantIndex != null ? candidates[state.declarantIndex] : undefined
  set('DECLARANT_NUME_COMPLET', declarant?.numeComplet ?? '')
  set('DECLARANT_FUNCTIE', declarant?.functie ?? '')

  // 3. Impozit pe salarii și contribuții sociale
  set('BIF_SALARIATI_SUB3', bif(state.salariatiSub3))
  set('BIF_VENIT_SUB100K', bif(state.venitSub100k))
  set('BIF_SALARII_LUNARA', bif(state.salariiPerioada === 'lunara'))
  set('BIF_SALARII_TRIMESTRIALA', bif(state.salariiPerioada === 'trimestriala'))
  // „3.3. Impozit pe veniturile din salarii..." n-are bifă proprie în șablon (rândul e doar text, pe toată
  // lățimea) — spre deosebire de 3.4/3.5/3.6, care au fiecare propria celulă ☐. `impozitSalarii` controlează
  // doar dacă se completează cutia de dată 3.3.1.
  Object.assign(replacements, splitDigitBoxes('DLES', state.impozitSalarii ? state.dataLuareEvidentaSalarii : ''))
  set('BIF_CAS', bif(state.cas))
  Object.assign(replacements, splitDigitBoxes('DLECAS', state.cas ? state.dataLuareEvidentaCas : ''))
  set('BIF_CASS', bif(state.cass))
  Object.assign(replacements, splitDigitBoxes('DLECASS', state.cass ? state.dataLuareEvidentaCass : ''))
  set('BIF_CAM', bif(state.cam))
  Object.assign(replacements, splitDigitBoxes('DLECAM', state.cam ? state.dataLuareEvidentaCam : ''))

  // 4. TVA
  set('BIF_TVA_SECTIUNE', bif(state.tva))
  set('CAMP_CIFRA_AFACERI_TVA', state.tva ? state.cifraAfaceriTva : '')
  set('BIF_TVA_DEPASIRE_PLAFON', bif(state.tva && state.tvaRegim === 'depasire'))
  set('BIF_TVA_OPTIUNE_PLAFON', bif(state.tva && state.tvaRegim === 'optiune'))
  set('BIF_TVA_LUNARA', bif(state.tva && state.tvaPerioada === 'lunara'))
  set('BIF_TVA_TRIMESTRIALA', bif(state.tva && state.tvaPerioada === 'trimestriala'))
  set('BIF_TVA_LA_INCASARE', bif(state.tva && state.tvaLaIncasare))

  // {{DDEC_1}}..{{DDEC_8}} — data declarației (semnătura), completată automat cu azi, la fel ca {{DATA_AZI}}
  // la celelalte șabloane — fără niciun câmp în UI.
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const todayRo = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`
  Object.assign(replacements, splitDigitBoxes('DDEC', todayRo))

  return { replacements }
}

export const ANEXA1_KEY = 'anexa1_inregistrare_fiscala'

/** Șablonul e Anexa 1 (cerere de înregistrare fiscală): cel de bază, sau o copie din bibliotecă a lui. */
export function isAnexa1Template(tpl: { sourceKey?: string; key?: string }): boolean {
  return tpl.sourceKey === ANEXA1_KEY || tpl.key === ANEXA1_KEY
}
