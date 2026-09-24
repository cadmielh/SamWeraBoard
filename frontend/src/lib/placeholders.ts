import type { IDFields } from './api'
import type { Client, Persoana, ScannedPerson } from '../types'
import { persoanaToIDFields } from './idFields'
import { parsePercent } from './cota'
import { formatAdresa, splitSerieNumar } from './adresa'
import { personSex } from './sex'
import { findCaenGrupaDescriere } from '../data/caenGrupe'

const PERSOANA_FIELD_MAP: Record<string, keyof Persoana> = {
  NUME: 'nume',
  PRENUME: 'prenume',
  CNP: 'cnp',
  ADRESA: 'adresa',
  JUDET: 'judet',
  DATA_NASTERII: 'data_nasterii',
  LOCUL_NASTERII: 'locul_nasterii',
  CETATENIA: 'cetatenia',
  SERIE_NUMAR: 'serie_numar',
  EMISA_DE: 'emisa_de',
  VALABILA_DE_LA: 'valabila_de_la',
  VALABILA_PANA_LA: 'valabila_pana_la',
  COTA_PARTICIPARE: 'cotaParticipare',
}

const ID_FIELD_MAP: Record<string, keyof IDFields> = {
  CNP: 'cnp',
  NUME: 'nume',
  PRENUME: 'prenume',
  SERIE_NUMAR: 'serie_numar',
  DATA_NASTERII: 'data_nasterii',
  LOCUL_NASTERII: 'locul_nasterii',
  CETATENIA: 'cetatenia',
  ADRESA: 'adresa',
  JUDET: 'judet',
  EMISA_DE: 'emisa_de',
  VALABILA_DE_LA: 'valabila_de_la',
  VALABILA_PANA_LA: 'valabila_pana_la',
}

function today(): Record<string, string> {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const dataStr = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
  return {
    '{{DATA_AZI}}': dataStr,
    '{{DATA_CURENTA}}': dataStr,
    '{{LUNA_AZI}}': pad(d.getMonth() + 1),
    '{{AN_AZI}}': String(d.getFullYear()),
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString('ro-RO', { maximumFractionDigits: 2 })
}

function formatCaen(cod?: string, descriere?: string): string {
  if (!cod) return ''
  return descriere ? `${cod} - ${descriere}` : cod
}

function persoanaToMap(p: Persoana, prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, field] of Object.entries(PERSOANA_FIELD_MAP)) {
    out[`{{${prefix}_${key}}}`] = (p as unknown as Record<string, string>)[field as string] ?? ''
  }
  // Seria și numărul actului, separat (pentru texte de tipul „CI seria …… nr. ……”)
  const { serie, numar } = splitSerieNumar(p.serie_numar)
  out[`{{${prefix}_SERIE_ACT}}`] = serie
  out[`{{${prefix}_NR_ACT}}`] = numar
  // Alias retro-compatibil: șabloane importate înainte de redenumirea SERIE → SERIE_ACT
  // au tag-ul vechi scris literal în fișier; fără alias ar rămâne goale definitiv.
  out[`{{${prefix}_SERIE}}`] = serie
  return out
}

function idFieldsToSingleMap(f: IDFields): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, field] of Object.entries(ID_FIELD_MAP)) {
    out[`{{${key}}}`] = f[field] ?? ''
  }
  return out
}

function scannedToPersoana(sp: ScannedPerson): Persoana {
  return {
    calitate: sp.role === 'asociat' ? 'Asociat' : 'Administrator',
    cotaParticipare: sp.cotaParticipare,
    cnp: sp.fields.cnp,
    nume: sp.fields.nume,
    prenume: sp.fields.prenume,
    serie_numar: sp.fields.serie_numar,
    data_nasterii: sp.fields.data_nasterii,
    locul_nasterii: sp.fields.locul_nasterii,
    cetatenia: sp.fields.cetatenia,
    adresa: sp.fields.adresa,
    judet: sp.fields.judet,
    emisa_de: sp.fields.emisa_de,
    valabila_de_la: sp.fields.valabila_de_la,
    valabila_pana_la: sp.fields.valabila_pana_la,
  }
}

export interface BuildOptions {
  idFields?: IDFields | null
  client?: Partial<Client> | null
  scannedPersons?: ScannedPerson[]
}

export function resolvePersons(
  client: Partial<Client> | null | undefined,
  scannedPersons: ScannedPerson[] | undefined,
  role: 'asociat' | 'administrator',
): Persoana[] {
  const clientList = role === 'asociat' ? (client?.asociati ?? []) : (client?.administratori ?? [])
  const scanned = (scannedPersons ?? []).filter(p => p.role === role)
  return scanned.length > 0 ? scanned.map(scannedToPersoana) : clientList
}

const KNOWN_AUTO_ROLES = new Set(['ASOCIAT', 'ADMINISTRATOR', 'MEMBRU_IF'])
const PERSOANA_FIELD_NAMES = new Set([...Object.keys(PERSOANA_FIELD_MAP), 'SERIE_ACT', 'NR_ACT', 'SERIE'])

/**
 * Roluri de persoană „noi”, în afara Asociat/Administrator/Membru IF (care au deja completare automată din
 * client) — ex. {{COMODANT_1_NUME}}, {{REPREZENTANT_LEGAL_1_CNP}} — detectate generic, direct din etichetele
 * șablonului (orice {{ROL_N_CÂMP}} a cărei CÂMP e un câmp de persoană cunoscut), nu dintr-o listă fixă de
 * roluri: un contract de comodat, o împuternicire etc. pot avea orice calitate, imposibil de anticipat
 * dinainte (vezi blanks.py: _ROLE_KEYWORDS — aceeași filozofie, pe partea de recunoaștere a șablonului).
 */
export function detectCustomPersonRoles(placeholders: string[]): { role: string; positions: number[] }[] {
  const byRole = new Map<string, Set<number>>()
  for (const ph of placeholders) {
    const inner = ph.replace(/^\{\{|\}\}$/g, '')
    const m = inner.match(/^([A-Z][A-Z_]*)_(\d+)_([A-Z_]+)$/)
    if (!m) continue
    const [, role, posStr, field] = m
    if (KNOWN_AUTO_ROLES.has(role) || !PERSOANA_FIELD_NAMES.has(field)) continue
    if (!byRole.has(role)) byRole.set(role, new Set())
    byRole.get(role)!.add(Number(posStr))
  }
  return [...byRole.entries()]
    .map(([role, positions]) => ({ role, positions: [...positions].sort((a, b) => a - b) }))
    .sort((a, b) => a.role.localeCompare(b.role))
}

/** Etichetele {{ROL_N_CÂMP}} pentru o persoană aleasă/introdusă pentru un rol nou de persoană (vezi
 * detectCustomPersonRoles) — aceeași mapare ca la Asociat/Administrator (persoanaToMap). */
export function customPersonReplacements(role: string, position: number, p: Persoana): Record<string, string> {
  return persoanaToMap(p, `${role}_${position}`)
}

export function buildReplacements({ idFields, client, scannedPersons }: BuildOptions): Record<string, string> {
  const out: Record<string, string> = {}

  const isPF = client?.tipClient === 'PF'

  // Câmpuri persoană singulară — din scanare sau din titular PF
  if (idFields) {
    Object.assign(out, idFieldsToSingleMap(idFields))
  } else if (isPF && client?.titular) {
    // Dacă nu s-a scanat separat, populăm din titular-ul clientului PF
    Object.assign(out, idFieldsToSingleMap(persoanaToIDFields(client.titular)))
  }

  // Câmpuri societate din client
  if (client) {
    out['{{SOCIETATE_DENUMIRE}}'] = client.denumire ?? ''
    out['{{SOCIETATE_CIF}}'] = client.codFiscal ?? ''
    out['{{SOCIETATE_NR_REG}}'] = client.nrRegistrul ?? ''
    out['{{SOCIETATE_SEDIU}}'] = client.sediuSocial ? formatAdresa(client.sediuSocial) : ''
    // Pentru șabloane care cer județul separat („sediul în ……, jud. ……”) — fără județ, ca să nu apară de două ori.
    out['{{SOCIETATE_SEDIU_FARA_JUDET}}'] = client.sediuSocial ? formatAdresa(client.sediuSocial, { includeJudet: false }) : ''
    out['{{SOCIETATE_JUDET}}'] = client.sediuSocial?.judet ?? ''
    out['{{SOCIETATE_FORMA_JURIDICA}}'] = client.formaJuridica ?? ''

    if (client.capitalSocial != null) {
      out['{{CAPITAL_SOCIAL_TOTAL}}'] = formatNumber(client.capitalSocial)
      out['{{PARTI_SOCIALE_TOTALE}}'] = formatNumber(client.capitalSocial / 10)
    }

    // CAEN_1 = activitate principală (unică — fără prefix numeric). Activitățile
    // secundare (număr nelimitat) se pun în blocul repetitiv {{#CAEN_SECUNDARE}}.
    out['{{CAEN_1}}'] = formatCaen(client.caenCod, client.caenDescriere)
    // CAEN_DOMENIU = „domeniul principal de activitate” din actele societăților — grupa CAEN (3 cifre),
    // derivată din codul principal (clasă, 4 cifre), cu denumirea ei oficială. Distinct de CAEN_1 (clasa
    // însăși) — unele șabloane cer amândouă („Domeniul principal... 620 ... Activitatea principală... 6201...”).
    const caenGrupaCod = client.caenCod ? client.caenCod.slice(0, 3) : ''
    out['{{CAEN_DOMENIU}}'] = formatCaen(caenGrupaCod, findCaenGrupaDescriere(client.caenCod ?? ''))
    // Doar codurile (fără denumire), pentru clauza „Actualizare cod CAEN REV3”: principal + secundarele pe o singură linie.
    out['{{CAEN_PRINCIPAL_COD}}'] = client.caenCod ?? ''
    const codSecundare = (client.caenSecundare ?? []).map(c => c.cod).filter(Boolean)
    out['{{CAEN_SECUNDARE_COD}}'] = codSecundare.length > 0 ? codSecundare.join(', ') : '-'
  }

  if (!isPF) {
    // Asociați și administratori — doar pentru PJ
    const asociatiToUse = resolvePersons(client, scannedPersons, 'asociat')
    const adminiToUse = resolvePersons(client, scannedPersons, 'administrator')

    asociatiToUse.forEach((p, i) => {
      // Cota apare deja ca {{ASOCIAT_N_COTA_PARTICIPARE}}, la fel ca orice alt câmp per-asociat
      Object.assign(out, persoanaToMap(p, `ASOCIAT_${i + 1}`))
      if (client?.capitalSocial != null) {
        const capitalAsociat = client.capitalSocial * parsePercent(p.cotaParticipare) / 100
        out[`{{CAPITAL_SOCIAL_ASOCIAT_${i + 1}}}`] = formatNumber(capitalAsociat)
        out[`{{PARTI_SOCIALE_ASOCIAT_${i + 1}}}`] = formatNumber(capitalAsociat / 10)
      }
    })
    adminiToUse.forEach((p, i) => {
      Object.assign(out, persoanaToMap(p, `ADMINISTRATOR_${i + 1}`))
    })
    // Numele pe o singură linie, pentru fraze de tipul „în calitate de asociați X și Y au drepturile…”
    out['{{ASOCIATI_LISTA}}'] = joinNames(asociatiToUse)
    out['{{ADMINISTRATORI_LISTA}}'] = joinNames(adminiToUse)
  }

  // Membri familie IF
  const membriIF = client?.membriIF ?? []
  membriIF.forEach((p, i) => {
    Object.assign(out, persoanaToMap(p, `MEMBRU_IF_${i + 1}`))
  })

  // Date automate
  Object.assign(out, today())

  return out
}

/** Câmp completat manual la generare: {{CAMP_ORICE_NUME}} (ex. {{CAMP_NR_HOTARARE}}). */
export const isManualPlaceholder = (ph: string): boolean => /^\{\{CAMP_[A-Z0-9_]+\}\}$/.test(ph)

/** Titlul afișat pentru un câmp manual: {{CAMP_NR_HOTARARE}} → „Nr hotarare”. */
export function manualLabel(ph: string): string {
  const words = ph.replace(/^\{\{CAMP_|\}\}$/g, '').toLowerCase().replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Valoare'
}

/** „Ion Popescu”, „Ion Popescu și Ana Ionescu”, „A, B și C” (numele complete ale persoanelor, fără cele goale). */
export function joinNames(persons: Persoana[]): string {
  const names = persons.map(p => `${p.nume ?? ''} ${p.prenume ?? ''}`.trim()).filter(Boolean)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} și ${names[names.length - 1]}`
}

function persoanaToSingularMap(p: Persoana, opts: { capitalSocialTotal?: number | null; includeCota?: boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, field] of Object.entries(PERSOANA_FIELD_MAP)) {
    // COTA_PARTICIPARE nu se aplică administratorilor — dacă e inclus mereu,
    // {{COTA_PARTICIPARE}} pare mereu "necompletat" în checkReadiness de îndată
    // ce există și un administrator (a cărui cotă e mereu goală, legitim).
    if (key === 'COTA_PARTICIPARE' && !opts.includeCota) continue
    out[key] = (p as unknown as Record<string, string>)[field as string] ?? ''
  }
  // Seria și numărul actului, separat — la fel ca la persoanaToMap (poziții numerotate), pentru blocurile
  // {{#ASOCIATI}}/{{#ADMINISTRATORI}} generate din documente fără etichete (vezi blanks.py: SERIE_ACT/NR_ACT).
  const { serie, numar } = splitSerieNumar(p.serie_numar)
  out.SERIE_ACT = serie
  out.NR_ACT = numar
  // Alias retro-compatibil: vezi persoanaToMap mai sus.
  out.SERIE = serie
  if (opts.capitalSocialTotal != null) {
    const capitalAsociat = opts.capitalSocialTotal * parsePercent(p.cotaParticipare) / 100
    out.CAPITAL_SOCIAL = formatNumber(capitalAsociat)
    out.PARTI_SOCIALE = formatNumber(capitalAsociat / 10)
  }
  return out
}

/**
 * Grupuri de date per-element pentru blocurile repetitive din șablon —
 * {{#ASOCIATI}}, {{#ADMINISTRATORI}} (câte un rând de câmpuri NUME, PRENUME,
 * CNP… + INDEX per persoană) și {{#CAEN_SECUNDARE}} (câte un {{CAEN}} per
 * activitate secundară) — multiplicate de backend o dată per element din listă.
 */
export function buildRepeatGroups({ client, scannedPersons }: BuildOptions): Record<string, Record<string, string>[]> {
  if (client?.tipClient === 'PF') return {}
  const asociati = resolvePersons(client, scannedPersons, 'asociat')
  const admini = resolvePersons(client, scannedPersons, 'administrator')
  const caenSecundare = client?.caenSecundare ?? []
  return {
    // SEX / SEX_REF: sexul fiecărei persoane, folosit de server la variantele „numit/ă”, „Domnul/Doamna” din blocul ei.
    ASOCIATI: asociati.map((p, i) => ({ ...persoanaToSingularMap(p, { capitalSocialTotal: client?.capitalSocial ?? null, includeCota: true }), SEX: personSex(p) ?? '', SEX_REF: `ASOCIAT_${i + 1}` })),
    ADMINISTRATORI: admini.map((p, i) => ({ ...persoanaToSingularMap(p), SEX: personSex(p) ?? '', SEX_REF: `ADMINISTRATOR_${i + 1}` })),
    CAEN_SECUNDARE: caenSecundare.map(c => ({ CAEN: formatCaen(c.cod, c.descriere) })),
  }
}

export interface ReadinessResult {
  filled: string[]
  missing: string[]
}

// SERIE_ACT/NR_ACT: calculate separat (splitSerieNumar), nu vin din PERSOANA_FIELD_MAP — trebuie adăugate explicit,
// altfel checkReadiness nu le recunoaște ca fiind câmpuri per-persoană dintr-un {{#ASOCIATI}}/{{#ADMINISTRATORI}}
// și le raportează mereu ca lipsă, chiar și cu Serie & Nr. CI completat la toate persoanele.
const SINGULAR_KEYS = new Set([...Object.keys(PERSOANA_FIELD_MAP), 'CAPITAL_SOCIAL', 'PARTI_SOCIALE', 'CAEN', 'SERIE_ACT', 'NR_ACT', 'SERIE'])

export function checkReadiness(
  placeholders: string[],
  replacements: Record<string, string>,
  repeatGroups?: Record<string, Record<string, string>[]>,
): ReadinessResult {
  const filled: string[] = []
  const missing: string[] = []
  const groupItems = repeatGroups ? Object.values(repeatGroups).flat() : []

  for (const ph of placeholders) {
    const inner = ph.replace(/^\{\{|\}\}$/g, '')
    if (replacements[ph] && replacements[ph].trim() !== '') {
      filled.push(ph)
    } else if (inner === 'INDEX' && groupItems.length > 0) {
      // Numărul de ordine dintr-un bloc repetitiv — generat automat, mereu disponibil
      filled.push(ph)
    } else if (SINGULAR_KEYS.has(inner)) {
      // Câmp singular dintr-un bloc repetitiv — se ia în calcul doar în elementele
      // grupului care chiar au acest câmp (ex. {{CAEN}} nu apare la asociați),
      // ca să nu se contamineze verificarea între grupuri diferite.
      const relevantItems = groupItems.filter(item => inner in item)
      if (relevantItems.length > 0 && relevantItems.every(item => (item[inner] ?? '').trim() !== '')) {
        filled.push(ph)
      } else {
        missing.push(ph)
      }
    } else {
      missing.push(ph)
    }
  }
  return { filled, missing }
}

// ── Friendly name helpers ─────────────────────────────────────────────────────

const FRIENDLY_FIELD: Record<string, string> = {
  NUME: 'Nume',
  PRENUME: 'Prenume',
  CNP: 'CNP',
  ADRESA: 'Adresă',
  JUDET: 'Județ',
  DATA_NASTERII: 'Data nașterii',
  LOCUL_NASTERII: 'Locul nașterii',
  CETATENIA: 'Cetățenia',
  SERIE_NUMAR: 'Serie & Nr. CI',
  SERIE_ACT: 'Serie CI',
  SERIE: 'Serie CI',
  NR_ACT: 'Nr. CI',
  SEDIU_FARA_JUDET: 'Sediul (fără județ)',
  EMISA_DE: 'Emisă de',
  VALABILA_DE_LA: 'Valabilă de la',
  VALABILA_PANA_LA: 'Valabilă până la',
  COTA_PARTICIPARE: 'Cotă participare',
  DENUMIRE: 'Denumire',
  CIF: 'Cod fiscal (CIF)',
  NR_REG: 'Nr. registrul comerțului',
  SEDIU: 'Sediu social',
  FORMA_JURIDICA: 'Forma juridică',
  DATA_AZI: 'Data de azi',
  LUNA_AZI: 'Luna curentă',
  AN_AZI: 'Anul curent',
  // Câmpuri ad-hoc din clauzele Decizie/Hotărâre AGA — fără etichetă
  // dedicată, ar apărea cu numele brut al placeholderului (cu "_").
  SEDIU_NOU: 'Sediu nou',
  TIP_CONTRACT_SEDIU: 'Tip contract (ex. închiriere)',
  CONTRACT_SEDIU_NR: 'Nr. contract sediu',
  CONTRACT_SEDIU_DATA: 'Data contract sediu',
  PUNCT_LUCRU_NOU_ADRESA: 'Adresă punct de lucru nou',
  TIP_CONTRACT_PUNCT_LUCRU: 'Tip contract (ex. comodat)',
  CONTRACT_PUNCT_LUCRU_NR: 'Nr. contract punct de lucru',
  CONTRACT_PUNCT_LUCRU_DATA: 'Data contract punct de lucru',
}

/** „REPREZENTANT_LEGAL” → „Reprezentant legal”, „COMODANT” → „Comodant” — etichetă prietenoasă pentru un rol
 * de persoană nou, necunoscut dinainte (vezi detectCustomPersonRoles mai jos). */
export function roleLabel(role: string): string {
  const words = role.toLowerCase().replace(/_/g, ' ')
  return words ? words[0].toUpperCase() + words.slice(1) : role
}

export function parsePlaceholder(ph: string): { group: string; field: string } {
  const inner = ph.replace(/^\{\{|\}\}$/g, '')

  const asociat = inner.match(/^ASOCIAT_(\d+)_(.+)$/)
  if (asociat) return { group: `Asociat ${asociat[1]}`, field: FRIENDLY_FIELD[asociat[2]] ?? asociat[2] }

  const admin = inner.match(/^ADMINISTRATOR_(\d+)_(.+)$/)
  if (admin) return { group: `Administrator ${admin[1]}`, field: FRIENDLY_FIELD[admin[2]] ?? admin[2] }

  const membruIF = inner.match(/^MEMBRU_IF_(\d+)_(.+)$/)
  if (membruIF) return { group: `Membru IF ${membruIF[1]}`, field: FRIENDLY_FIELD[membruIF[2]] ?? membruIF[2] }

  const capitalAsoc = inner.match(/^CAPITAL_SOCIAL_ASOCIAT_(\d+)$/)
  if (capitalAsoc) return { group: `Asociat ${capitalAsoc[1]}`, field: 'Capital social' }

  const partiAsoc = inner.match(/^PARTI_SOCIALE_ASOCIAT_(\d+)$/)
  if (partiAsoc) return { group: `Asociat ${partiAsoc[1]}`, field: 'Părți sociale' }

  if (inner === 'CAEN_1') return { group: 'Societate', field: 'Activitate principală (CAEN)' }
  if (inner === 'CAEN_DOMENIU') return { group: 'Societate', field: 'Domeniul principal de activitate (grupa CAEN)' }
  if (inner === 'CAEN') return { group: 'Societate', field: 'Activitate secundară (CAEN)' }
  if (inner === 'CAEN_PRINCIPAL_COD') return { group: 'Societate', field: 'Cod CAEN principal' }
  if (inner === 'CAEN_SECUNDARE_COD') return { group: 'Societate', field: 'Coduri CAEN secundare' }

  if (inner === 'CAPITAL_SOCIAL_TOTAL') return { group: 'Societate', field: 'Capital social total' }
  if (inner === 'PARTI_SOCIALE_TOTALE') return { group: 'Societate', field: 'Părți sociale totale' }
  if (inner === 'DATA_CURENTA') return { group: 'Date automate', field: 'Data curentă' }

  const soc = inner.match(/^SOCIETATE_(.+)$/)
  if (soc) return { group: 'Societate', field: FRIENDLY_FIELD[soc[1]] ?? soc[1] }

  // Rol de persoană nou, necunoscut dinainte (comodant, reprezentant legal…) — vezi detectCustomPersonRoles;
  // verificat DUPĂ Asociat/Administrator/Membru IF de mai sus, care au fiecare eticheta lor specifică.
  const custom = inner.match(/^([A-Z][A-Z_]*)_(\d+)_(.+)$/)
  if (custom) return { group: `${roleLabel(custom[1])} ${custom[2]}`, field: FRIENDLY_FIELD[custom[3]] ?? custom[3] }

  return { group: 'Persoană', field: FRIENDLY_FIELD[inner] ?? inner }
}

export function groupMissingFields(missing: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {}
  for (const ph of missing) {
    const { group, field } = parsePlaceholder(ph)
    if (!groups[group]) groups[group] = []
    groups[group].push(field)
  }
  return groups
}
