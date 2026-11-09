import type { IDFields } from './api'
import type { Client, Persoana, ScannedPerson } from '../types'
import { persoanaToIDFields } from './idFields'
import { parsePercent, valoareParteSociala, VALOARE_PARTE_SOCIALA_DEFAULT } from './cota'
import { formatAdresa, splitSerieNumar } from './adresa'
import { personSex } from './sex'
import { cetatenieAcord, cetatenieText } from './cetatenie'
import { findCaenGrupaDescriere } from '../data/caenGrupe'
import { numarInLitere } from './numarInLitere'
import { CLAUSE_WIDGET_GROUPS } from './clauseFieldSpecs'
import { dataExpirare, durataAni, durataComuna, durataFraza, durataScurta, durateEgale, inceputMandat, type Durata } from './durata'

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

/** Câmp de clauză ce ține codul CAEN principal — recunoscut după nume, în orice clauză și orice șablon, ca să primească
 * lista CAEN (REV 3) în loc de text liber: 'full' = „cod - denumire” ({{CAEN_1}}), 'cod' = doar codul. */
export function caenFieldKind(key: string): 'full' | 'cod' | null {
  if (key === 'CAEN_1') return 'full'
  if (key === 'CAEN_PRINCIPAL_COD') return 'cod'
  return null
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
  out[`{{${prefix}_CETATENIA}}`] = cetatenieText(p.cetatenia)
  out[`{{${prefix}_CETATENIA_ACORD}}`] = cetatenieAcord(p.cetatenia, personSex(p))
  return out
}

/** Mandatul unui administrator, fără prefix: DURATA_MANDAT („de 4 ani”), DURATA_MANDAT_TEXT („pe o perioadă de 4 ani”),
 * DATA_NUMIRE, DATA_EXPIRARE_MANDAT. La un mandat „din prezent”, datele care se află abia la aprobarea dosarului la
 * ONRC rămân loc de completat de mână — la fel ca CUI-ul și J-ul unei firme în înființare. */
function mandatFields(p: Persoana): Record<string, string> {
  const m = p.mandat
  if (!m) return { DURATA_MANDAT: '', DURATA_MANDAT_TEXT: '', DATA_NUMIRE: '', DATA_EXPIRARE_MANDAT: '' }
  const inceput = inceputMandat(m)
  const deCompletat = m.inceput === 'aprobare' ? HAND_FILL_BLANK : ''
  return {
    DURATA_MANDAT: durataScurta(m.durata),
    DURATA_MANDAT_TEXT: durataFraza(m.durata),
    DATA_NUMIRE: inceput || deCompletat,
    DATA_EXPIRARE_MANDAT: dataExpirare(m.durata, inceput) || (m.durata.tip === 'ani' ? deCompletat : ''),
  }
}

function idFieldsToSingleMap(f: IDFields): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, field] of Object.entries(ID_FIELD_MAP)) {
    out[`{{${key}}}`] = f[field] ?? ''
  }
  out['{{CETATENIA}}'] = cetatenieText(f.cetatenia)
  out['{{CETATENIA_ACORD}}'] = cetatenieAcord(f.cetatenia, personSex({ cnp: f.cnp }))
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

/** Scanarea aduce doar datele din CI — mandatul unui administrator rămâne cel din fișă (aceeași persoană: CNP sau nume). */
export function cuMandatDinFisa(p: Persoana, fisa: Persoana[]): Persoana {
  const nume = `${p.nume} ${p.prenume}`.trim()
  const dinFisa = fisa.find(c => (p.cnp && c.cnp === p.cnp) || (nume && `${c.nume} ${c.prenume}`.trim() === nume))
  return dinFisa?.mandat ? { ...p, mandat: dinFisa.mandat } : p
}

export function resolvePersons(
  client: Partial<Client> | null | undefined,
  scannedPersons: ScannedPerson[] | undefined,
  role: 'asociat' | 'administrator',
): Persoana[] {
  const clientList = role === 'asociat' ? (client?.asociati ?? []) : (client?.administratori ?? [])
  const scanned = (scannedPersons ?? []).filter(p => p.role === role)
  return scanned.length > 0 ? scanned.map(sp => cuMandatDinFisa(scannedToPersoana(sp), clientList)) : clientList
}

const KNOWN_AUTO_ROLES = new Set(['ASOCIAT', 'ADMINISTRATOR', 'MEMBRU_IF'])
const PERSOANA_FIELD_NAMES = new Set([...Object.keys(PERSOANA_FIELD_MAP), 'SERIE_ACT', 'NR_ACT', 'SERIE', 'CETATENIA_ACORD'])

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

// Formă de plural a tag-urilor de bloc repetitiv deja completate automat din client (vezi buildRepeatGroups
// mai jos) — restul găsite de list_repeat_groups_in_docx (backend) sunt roluri CUSTOM (ex. COMODANTI).
const KNOWN_AUTO_GROUP_TAGS = new Set(['ASOCIATI', 'ADMINISTRATORI', 'MEMBRU_IF', 'CAEN_SECUNDARE', 'ACTUALIZARE'])

/** Bloc {{#ACTUALIZARE}}…{{/ACTUALIZARE}}: text care apare doar la actualizarea unui act, nu la înființare (ex.
 * „ADAPTAT HOTĂRÂRII NR. … DIN …”, „- actualizat la … -”). Nu e o listă de persoane: se trimite cu un element gol
 * (păstrat) sau cu niciunul (șters cu totul, cu rând cu tot — vezi doc_filler._expand_repeat_blocks). */
export const ACTUALIZARE_GROUP = 'ACTUALIZARE'
export type ActMode = 'infiintare' | 'actualizare'
/** Implicit după CUI: o firmă cu CUI e deja înmatriculată (CUI-ul și J-ul se primesc împreună), deci actul ei e o
 * actualizare — chiar dacă bifa „în înființare” a rămas pusă; fără CUI, înființare. Fără client ales: actualizare. */
export const defaultActMode = (client?: { codFiscal?: string } | null): ActMode =>
  client && !client.codFiscal?.trim() ? 'infiintare' : 'actualizare'
export const actualizareGroups = (repeatGroups: string[] | undefined, mode: ActMode): Record<string, Record<string, string>[]> =>
  repeatGroups?.includes(ACTUALIZARE_GROUP) ? { [ACTUALIZARE_GROUP]: mode === 'actualizare' ? [{}] : [] } : {}

/** Câmpurile din blocul {{#ACTUALIZARE}} (ex. numărul și data hotărârii) — nu se cer la înființare. */
export function withoutActualizareFields(placeholders: string[], groupFields: Record<string, string[]> | undefined, mode: ActMode): string[] {
  const doarLaActualizare = mode === 'infiintare' ? groupFields?.[ACTUALIZARE_GROUP] : undefined
  if (!doarLaActualizare?.length) return placeholders
  return placeholders.filter(ph => !doarLaActualizare.includes(ph.replace(/^\{\{|\}\}$/g, '')))
}

/** „REPREZENTANT_COMODATAR” → true — un rol construit generic de blanks.py (vezi _role_override/entity_roles)
 * pentru cine REPREZINTĂ o parte care e o entitate (societate), nu o persoană directă — legal, reprezentantul
 * unei societăți e administratorul ei, de-asta lista de persoane oferite la alegere se restrânge la
 * administratorii firmei (vezi TemplateFiller.tsx), nu toată lista de persoane cunoscute (asociați incluși),
 * care n-au de regulă calitatea de a reprezenta. */
export const isReprezentantRole = (role: string): boolean => role.startsWith('REPREZENTANT_')

/** Dintre cine se alege persoana unui rol propriu: reprezentantul unei entități sau un rol „…_ADMINISTRATOR”
 * (ex. DECLARANT_ADMINISTRATOR) — administratorii firmei; un rol „…_ASOCIAT” (ex. DECLARANT_ASOCIAT) — asociații;
 * altfel oricine e deja cunoscut la firmă (comodant, cesionar…). Regulă după numele rolului, pentru orice șablon. */
export function customRolePool(role: string): 'administratori' | 'asociati' | 'toti' {
  if (isReprezentantRole(role) || role.endsWith('_ADMINISTRATOR')) return 'administratori'
  if (role.endsWith('_ASOCIAT')) return 'asociati'
  return 'toti'
}

/** „COMODANTI” → „COMODANT”, „REPREZENTANT_COMODATARI_LISTA” → „REPREZENTANT_COMODATAR” — inversul
 * pluralizării generice din blanks.py (_ROLE_PLURAL.get(role, role+"I")), plus convenția „_LISTA” (vezi
 * blanks.py: _role_list_field — un câmp SIMPLU, {{ROL_LISTA}}, cu toate numele îmbinate pe-o linie, cu
 * virgulă+„și” — ex. „Prin administratorii X, Y și Z” la o mențiune de nume, spre deosebire de un bloc
 * REPETITIV ({{#ROL}}…{{/ROL}}, o linie nouă per persoană — necesar la o linie de SEMNĂTURĂ olografă, unde
 * fiecare om are nevoie de rândul ei). Sufixul „_LISTA” se elimină ÎNAINTE de-al inversa „I”-ul de plural —
 * altfel „..._LISTA” (se termină în „A”) ar rămâne neschimbat, iar cele două tag-uri ale ACELUIAȘI rol (unul
 * repetitiv, unul „_LISTA”) n-ar mai ajunge la același singular. */
const singularOfCustomGroup = (tag: string): string => {
  const base = tag.endsWith('_LISTA') ? tag.slice(0, -'_LISTA'.length) : tag
  return base.endsWith('I') ? base.slice(0, -1) : base
}

// „…LISTA” deja completate automat din client (vezi buildReplacements) — un rol CUSTOM cu același sufix
// (ex. REPREZENTANT_COMODATARI_LISTA) nu trebuie confundat cu acestea.
const KNOWN_LIST_FIELDS = new Set(['ASOCIATI_LISTA', 'ADMINISTRATORI_LISTA'])

export interface CustomPersonGroup {
  role: string
  /** Tag-ul blocului REPETITIV (ex. „COMODANTI”), dacă există — o linie NOUĂ per persoană (necesar, de ex.,
   * la o linie de semnătură olografă — vezi blanks.py: _split_group_paragraph). */
  repeatTag?: string
  /** Tag-ul SIMPLU „…LISTA” (ex. „REPREZENTANT_COMODATARI_LISTA”), dacă există — toate numele îmbinate pe-o
   * singură linie, cu virgulă+„și” (vezi blanks.py: _role_list_field, joinNames mai jos). */
  listTag?: string
}

/**
 * Roluri de persoană „noi”, scrise fie ca bloc REPETITIV ({{#COMODANTI}}…{{/COMODANTI}}, scalabil la orice
 * număr de persoane — vezi blanks.py: _split_group_paragraph/_ROLE_PLURAL), fie ca un simplu câmp „…LISTA”
 * (numele îmbinate pe-o linie — vezi blanks.py: _role_list_field) — spre deosebire de detectCustomPersonRoles
 * mai sus (poziții FIXE, {{ROL_N_CÂMP}}). `repeatGroups` vine din backend (list_repeat_groups_in_docx —
 * list_placeholders_in_docx nu poate vedea tag-urile structurale {{#ROL}}, excluse deliberat de-acolo);
 * câmpurile „…LISTA” sunt placeholder-e SIMPLE, deci apar deja în `placeholders`.
 *
 * Grupat pe ROL, nu pe tag: ACELAȘI rol poate avea DOUĂ tag-uri în șablon — unul repetitiv (ex. linia de
 * semnătură) și unul „_LISTA” (mențiunea din clauza de identitate) — vezi blanks.py: analyze()/detect_groups.
 * Fără gruparea asta, utilizatorul ar vedea DOUĂ liste separate pentru aceiași oameni și ar trebui să-i aleagă
 * de două ori (exact bug-ul redundant „listă dublă” corectat mai devreme pentru pozițiile fixe — aici e
 * varianta lui pentru blocuri repetitive/câmpuri „…LISTA”).
 */
export function detectCustomPersonGroups(
  repeatGroups: string[], placeholders: string[] = [], groupFields?: Record<string, string[]>,
): CustomPersonGroup[] {
  const byRole = new Map<string, CustomPersonGroup>()
  for (const tag of repeatGroups) {
    if (KNOWN_AUTO_GROUP_TAGS.has(tag) || CLAUSE_WIDGET_GROUPS.has(tag)) continue
    // Un bloc fără niciun câmp de persoană (ex. {{#COD_CAEN_NOU}}{{CAEN}}{{/COD_CAEN_NOU}} al unei clauze) nu e o listă de persoane
    const fields = groupFields?.[tag]
    if (fields && !fields.some(f => PERSOANA_FIELD_NAMES.has(f))) continue
    const role = singularOfCustomGroup(tag)
    byRole.set(role, { ...(byRole.get(role) ?? { role }), repeatTag: tag })
  }
  for (const ph of placeholders) {
    const tag = ph.replace(/^\{\{|\}\}$/g, '')
    if (!tag.endsWith('_LISTA') || KNOWN_LIST_FIELDS.has(tag)) continue
    const role = singularOfCustomGroup(tag)
    byRole.set(role, { ...(byRole.get(role) ?? { role }), listTag: tag })
  }
  return [...byRole.values()].sort((a, b) => a.role.localeCompare(b.role))
}

/** Etichetele {{ROL_N_CÂMP}} pentru o persoană aleasă/introdusă pentru un rol nou de persoană (vezi
 * detectCustomPersonRoles) — aceeași mapare ca la Asociat/Administrator (persoanaToMap). */
export function customPersonReplacements(role: string, position: number, p: Persoana): Record<string, string> {
  return persoanaToMap(p, `${role}_${position}`)
}

/** Spațiul lăsat în document pentru o valoare care se completează de mână (ex. CUI-ul unei firme în înființare). */
export const HAND_FILL_BLANK = '....................'

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
    // Firmă în înființare: CUI-ul și J-ul nu există încă — loc de completat de mână, nu „-” sau etichetă rămasă.
    const deCompletat = client.inInfiintare ? HAND_FILL_BLANK : ''
    out['{{SOCIETATE_CIF}}'] = client.codFiscal?.trim() || deCompletat
    out['{{SOCIETATE_NR_REG}}'] = client.nrRegistrul?.trim() || deCompletat
    out['{{SOCIETATE_SEDIU}}'] = client.sediuSocial ? formatAdresa(client.sediuSocial) : ''
    // Pentru șabloane care cer județul separat („sediul în ……, jud. ……”) — fără județ, ca să nu apară de două ori.
    out['{{SOCIETATE_SEDIU_FARA_JUDET}}'] = client.sediuSocial ? formatAdresa(client.sediuSocial, { includeJudet: false }) : ''
    out['{{SOCIETATE_JUDET}}'] = client.sediuSocial?.judet ?? ''
    // Tribunalul / ORC-ul de pe lângă el: județul sediului, iar în București orașul, fără sector („București - Sector 1”).
    out['{{SOCIETATE_TRIBUNAL}}'] = (client.sediuSocial?.judet ?? '').replace(/\s*-\s*sector\s*\d+\s*$/i, '')
    // EUID = „ROONRC.” + numărul de ordine din registrul comerțului (J12/345/2020 sau J2024000123123).
    const nrReg = client.nrRegistrul?.trim().replace(/\s+/g, '')
    out['{{SOCIETATE_EUID}}'] = nrReg ? `ROONRC.${nrReg}` : deCompletat
    out['{{SOCIETATE_FORMA_JURIDICA}}'] = client.formaJuridica ?? ''

    const valoareParte = valoareParteSociala(client)
    if (client.capitalSocial != null) {
      out['{{CAPITAL_SOCIAL_TOTAL}}'] = formatNumber(client.capitalSocial)
      out['{{PARTI_SOCIALE_TOTALE}}'] = formatNumber(client.capitalSocial / valoareParte)
    }
    out['{{VALOARE_PARTE_SOCIALA}}'] = formatNumber(valoareParte)
    // Aceeași valoare în litere, pentru „{{VALOARE_PARTE_SOCIALA}} ({{VALOARE_PARTE_SOCIALA_LITERE}}) lei” → „10 (zece) lei”
    out['{{VALOARE_PARTE_SOCIALA_LITERE}}'] = numarInLitere(valoareParte)

    // CAEN_1 = activitate principală (unică — fără prefix numeric). Activitățile
    // secundare (număr nelimitat) se pun în blocul repetitiv {{#CAEN_SECUNDARE}}.
    out['{{CAEN_1}}'] = formatCaen(client.caenCod, client.caenDescriere)
    // CAEN_DOMENIU = „domeniul principal de activitate” din actele societăților — grupa CAEN (3 cifre),
    // derivată din codul principal (clasă, 4 cifre), cu denumirea ei oficială. Distinct de CAEN_1 (clasa
    // însăși) — unele șabloane cer amândouă („Domeniul principal... 620 ... Activitatea principală... 6201...”).
    const caenGrupaCod = client.caenCod ? client.caenCod.slice(0, 3) : ''
    out['{{CAEN_DOMENIU}}'] = formatCaen(caenGrupaCod, findCaenGrupaDescriere(client.caenCod ?? ''))
    // Codul și denumirea separat, pentru acte care le scriu în fraze diferite („Cod CAEN 7020 și denumirea activității …”,
    // „domeniul principal este …, căruia îi corespunde grupa CAEN 702”).
    out['{{CAEN_DOMENIU_COD}}'] = caenGrupaCod
    out['{{CAEN_DOMENIU_DENUMIRE}}'] = findCaenGrupaDescriere(client.caenCod ?? '')
    out['{{CAEN_PRINCIPAL_DENUMIRE}}'] = client.caenDescriere ?? ''
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
        out[`{{PARTI_SOCIALE_ASOCIAT_${i + 1}}}`] = formatNumber(capitalAsociat / valoareParteSociala(client))
      }
    })
    adminiToUse.forEach((p, i) => {
      Object.assign(out, persoanaToMap(p, `ADMINISTRATOR_${i + 1}`))
      for (const [k, v] of Object.entries(mandatFields(p))) out[`{{ADMINISTRATOR_${i + 1}_${k}}}`] = v
    })
    // Numele pe o singură linie, pentru fraze de tipul „în calitate de asociați X și Y au drepturile…”
    out['{{ASOCIATI_LISTA}}'] = joinNames(asociatiToUse)
    out['{{ADMINISTRATORI_LISTA}}'] = joinNames(adminiToUse)

    // Durata mandatului ca frază unică („Mandatul administratorilor este …”) — doar dacă e aceeași la toți; altfel
    // rămâne gol (apare la „lipsește”), iar șablonul trebuie să o scrie per administrator, în {{#ADMINISTRATORI}}.
    const mandatComun = durataComuna(adminiToUse)
    out['{{DURATA_MANDAT}}'] = durataScurta(mandatComun)
    out['{{DURATA_MANDAT_TEXT}}'] = durataFraza(mandatComun)
    out['{{DURATA_MANDAT_ANI}}'] = durataAni(mandatComun)

    // Durata societății curge de la înmatriculare. Necompletată (clienții dinainte) = gol, nu o valoare presupusă.
    const durata = client?.durataSocietate
    const ani = durataAni(durata)
    out['{{DURATA_SOCIETATE}}'] = durataScurta(durata)
    out['{{DURATA_SOCIETATE_TEXT}}'] = durataFraza(durata)
    out['{{DURATA_SOCIETATE_ANI}}'] = ani
    out['{{DURATA_SOCIETATE_ANI_LITERE}}'] = ani ? numarInLitere(Number(ani)) : ''
    out['{{DURATA_SOCIETATE_DATA_EXPIRARE}}'] = dataExpirare(durata, client?.dataInmatricularii ?? '')
      || (ani && client?.inInfiintare ? HAND_FILL_BLANK : '')
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

/** Câmp completat manual la generare: {{CAMP_ORICE_NUME}} (ex. {{CAMP_NUMAR_HOTARARE}}). */
export const isManualPlaceholder = (ph: string): boolean => /^\{\{CAMP_[A-Z0-9_]+\}\}$/.test(ph)

/** Cum își exercită mandatele reprezentanții legali (Art.19 din actul avocatului) — are sens doar de la 2
 * reprezentanți aleși; la unul singur, serverul scoate câmpul din frază (variants.py: _REPREZENTANT_MANDAT_RE). */
export const MOD_EXERCITARE_MANDATE = '{{CAMP_MOD_EXERCITARE_MANDATE}}'
export const MOD_EXERCITARE_OPTIUNI = ['separat', 'împreună'] as const

/** Câmpurile manuale de cerut pentru alegerile curente — fără modul de exercitare sub 2 reprezentanți legali. */
export function visibleManualPlaceholders(placeholders: string[], picks?: Record<string, Persoana[]>): string[] {
  const reprezentanti = picks?.REPREZENTANT_LEGAL?.length ?? 0
  return reprezentanti >= 2 ? placeholders : placeholders.filter(ph => ph !== MOD_EXERCITARE_MANDATE)
}

/** Titlul afișat pentru un câmp manual: {{CAMP_NUMAR_HOTARARE}} → „Numar hotarare”. */
export function manualLabel(ph: string): string {
  const words = ph.replace(/^\{\{CAMP_|\}\}$/g, '').toLowerCase().replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Valoare'
}

/** Un câmp „de completat manual” (CAMP_…) sau ad-hoc de clauză (CONTRACT_SEDIU_DATA…) arată ca o dată, după
 * eticheta lui prietenoasă („Data contract comodat”, „Valabilă până la”…) — regulă generală, ca orice câmp
 * nou cu „dată”/„valabil” în nume (fie dintr-un șablon de bază, fie dintr-unul al utilizatorului, trecut prin
 * detectarea de goluri — vezi blanks.py: manual_tag, care ia eticheta chiar din textul din jurul locului
 * liber) să capete automat un picker de calendar, nu doar text liber. Un tag fără niciun cuvânt recognoscibil
 * (ex. un nume ales la întâmplare de utilizator, într-un șablon propriu, pre-etichetat) rămâne câmp text
 * simplu — degradare acceptabilă, nu o eroare. */
export function isDateLabel(label: string): boolean {
  return /dat[aă]|valabil/i.test(label)
}

/** Perechi „Număr X” + „Dată X” printre câmpurile manuale ({{CAMP_NUMAR_X}} / {{CAMP_DATA_X}}, același
 * sufix X — ex. CAMP_NUMAR_CONTRACT_COMODAT / CAMP_DATA_CONTRACT_COMODAT) — se afișează alăturate, pe un
 * singur rând (numărul primul, cu o coloană mai îngustă), nu fiecare pe rândul lui ca restul câmpurilor
 * manuale. Regulă generică, după nume — se aplică oricărui șablon (de bază sau al utilizatorului) ale cărui
 * câmpuri manuale urmează convenția NUMAR_X/DATA_X, nu doar contractului de comodat. */
export function pairManualDateFields(manualFields: string[]): { pairs: [string, string][]; rest: string[] } {
  const byX = new Map<string, { nr?: string; data?: string }>()
  for (const ph of manualFields) {
    const inner = ph.replace(/^\{\{CAMP_|\}\}$/g, '')
    const nr = inner.match(/^NUMAR_(.+)$/)
    if (nr) { byX.set(nr[1], { ...(byX.get(nr[1]) ?? {}), nr: ph }); continue }
    const data = inner.match(/^DATA_(.+)$/)
    if (data) byX.set(data[1], { ...(byX.get(data[1]) ?? {}), data: ph })
  }
  const pairs: [string, string][] = []
  const used = new Set<string>()
  for (const { nr, data } of byX.values()) {
    if (nr && data) { pairs.push([nr, data]); used.add(nr); used.add(data) }
  }
  return { pairs, rest: manualFields.filter(ph => !used.has(ph)) }
}

/** „Ion Popescu”, „Ion Popescu și Ana Ionescu”, „A, B și C” (numele complete ale persoanelor, fără cele goale). */
export function joinNames(persons: Persoana[]): string {
  const names = persons.map(p => `${p.nume ?? ''} ${p.prenume ?? ''}`.trim()).filter(Boolean)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} și ${names[names.length - 1]}`
}

const ROL_GENITIV: Record<'asociat' | 'administrator', [string, string]> = {
  asociat: ['asociatului', 'asociaților'],
  administrator: ['administratorului', 'administratorilor'],
}

/** Clauzele „Actualizare date asociat/administrator”: persoanele bifate → „asociatului X” / „asociaților X și Y”.
 * Forma vine din numărul celor bifați, nu din numărul total al firmei (regula de acord din variants.py, care s-ar
 * aplica unui „asociatului” scris direct în șablon). Masculinul e forma din modelul avocatului și pentru o femeie. */
export function persoaneActualizate(persons: Persoana[], rol: 'asociat' | 'administrator'): { rol: string; nume: string } {
  const [singular, plural] = ROL_GENITIV[rol]
  return { rol: persons.length === 0 ? '' : persons.length === 1 ? singular : plural, nume: joinNames(persons) }
}

/** Clauza „Durata mandatului” cu durate diferite, pe tag-urile existente ale frazei „durata mandatului {{ADMINISTRATORI_MANDAT_ROL}}
 * {{ADMINISTRATORI_MANDAT}} ca fiind {{DURATA_MANDAT}}”: administratorii cu aceeași durată se grupează (în ordinea în care apar);
 * primul grup ocupă rolul și numele, iar restul frazei continuă în durată — „de 4 ani, a mandatului administratorului B ca fiind
 * de 2 ani, respectiv a mandatului administratorului C ca fiind nedeterminată”. Cu o singură durată: exact ca persoaneActualizate. */
export function mandateActualizate(alegeri: { persoana: Persoana; durata: Durata }[]): { rol: string; nume: string; durata: string } {
  const grupuri: { durata: Durata; persoane: Persoana[] }[] = []
  for (const { persoana, durata } of alegeri) {
    const g = grupuri.find(x => durateEgale(x.durata, durata))
    if (g) g.persoane.push(persoana); else grupuri.push({ durata, persoane: [persoana] })
  }
  if (grupuri.length === 0) return { rol: '', nume: '', durata: '' }
  const [primul, ...rest] = grupuri
  const { rol, nume } = persoaneActualizate(primul.persoane, 'administrator')
  const parti = rest.map(g => {
    const p = persoaneActualizate(g.persoane, 'administrator')
    return `${g.persoane.length === 1 ? 'a mandatului' : 'a mandatelor'} ${p.rol} ${p.nume} ca fiind ${durataScurta(g.durata)}`
  })
  const continuare = parti.length === 0 ? '' : `, ${[...parti.slice(0, -1), `respectiv ${parti[parti.length - 1]}`].join(', ')}`
  return { rol, nume, durata: durataScurta(primul.durata) + continuare }
}

/** Câmpurile unei persoane (NUME, PRENUME, CNP…), fără prefix de rol/poziție — forma pe care o așteaptă un
 * element dintr-un bloc repetitiv {{#ROL}} (vezi blanks.py: generic_person_tag) la completare, per element
 * din listă (vezi buildRepeatGroups mai jos și detectCustomPersonGroups, pentru roluri custom repetitive). */
export function persoanaToSingularMap(p: Persoana, opts: { capitalSocialTotal?: number | null; valoareParte?: number; includeCota?: boolean } = {}): Record<string, string> {
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
  // Cetățenia: forma de bază („română”) și cea acordată cu persoana, după „cetățean …” (vezi lib/cetatenie.ts).
  out.CETATENIA = cetatenieText(p.cetatenia)
  out.CETATENIA_ACORD = cetatenieAcord(p.cetatenia, personSex(p))
  if (opts.capitalSocialTotal != null) {
    const capitalAsociat = opts.capitalSocialTotal * parsePercent(p.cotaParticipare) / 100
    out.CAPITAL_SOCIAL = formatNumber(capitalAsociat)
    out.PARTI_SOCIALE = formatNumber(capitalAsociat / (opts.valoareParte ?? VALOARE_PARTE_SOCIALA_DEFAULT))
  }
  return out
}

/**
 * Grupuri de date per-element pentru blocurile repetitive din șablon —
 * {{#ASOCIATI}}, {{#ADMINISTRATORI}} (câte un rând de câmpuri NUME, PRENUME,
 * CNP… + INDEX per persoană) și {{#CAEN_SECUNDARE}} (câte un {{CAEN}} per
 * activitate secundară) — multiplicate de backend o dată per element din listă.
 */
// Un rând {{#CAEN_SECUNDARE}}: „cod - denumire” ({{CAEN}}) și separat ({{COD}}, {{DENUMIRE}}).
const caenRow = (c: { cod: string; descriere: string }) => ({ CAEN: formatCaen(c.cod, c.descriere), COD: c.cod, DENUMIRE: c.descriere ?? '' })

export function buildRepeatGroups({ client, scannedPersons }: BuildOptions): Record<string, Record<string, string>[]> {
  // Un rând lăsat gol în fișa clientului nu e o activitate: ar ieși un rând gol în document și câmpul ar apărea ca lipsă.
  const caenSecundare = (client?.caenSecundare ?? []).filter(c => c.cod?.trim())
  // PFA/II/IF n-au asociați sau administratori, dar au activități CAEN secundare.
  if (client?.tipClient === 'PF') return { CAEN_SECUNDARE: caenSecundare.map(caenRow) }
  const asociati = resolvePersons(client, scannedPersons, 'asociat')
  const admini = resolvePersons(client, scannedPersons, 'administrator')
  return {
    // SEX / SEX_REF: sexul fiecărei persoane, folosit de server la variantele „numit/ă”, „Domnul/Doamna” din blocul ei.
    ASOCIATI: asociati.map((p, i) => ({ ...persoanaToSingularMap(p, { capitalSocialTotal: client?.capitalSocial ?? null, valoareParte: valoareParteSociala(client), includeCota: true }), SEX: personSex(p) ?? '', SEX_REF: `ASOCIAT_${i + 1}` })),
    ADMINISTRATORI: admini.map((p, i) => ({ ...persoanaToSingularMap(p), ...mandatFields(p), SEX: personSex(p) ?? '', SEX_REF: `ADMINISTRATOR_${i + 1}` })),
    CAEN_SECUNDARE: caenSecundare.map(caenRow),
  }
}

export interface ReadinessResult {
  filled: string[]
  missing: string[]
}

// SERIE_ACT/NR_ACT: calculate separat (splitSerieNumar), nu vin din PERSOANA_FIELD_MAP — trebuie adăugate explicit,
// altfel checkReadiness nu le recunoaște ca fiind câmpuri per-persoană dintr-un {{#ASOCIATI}}/{{#ADMINISTRATORI}}
// și le raportează mereu ca lipsă, chiar și cu Serie & Nr. CI completat la toate persoanele.
const SINGULAR_KEYS = new Set([...Object.keys(PERSOANA_FIELD_MAP), 'CAPITAL_SOCIAL', 'PARTI_SOCIALE', 'CAEN', 'COD', 'DENUMIRE', 'SERIE_ACT', 'NR_ACT', 'SERIE', 'CETATENIA_ACORD',
  'DURATA_MANDAT', 'DURATA_MANDAT_TEXT', 'DATA_NUMIRE', 'DATA_EXPIRARE_MANDAT'])

/** `groupFields` (etichetele din fiecare bloc al șablonului, vezi list_repeat_group_fields_in_docx): un câmp
 * per-persoană se verifică doar la elementele blocurilor care îl conțin. Fără el (șabloane salvate înainte),
 * se verifică la toate elementele care au câmpul. */
export function checkReadiness(
  placeholders: string[],
  replacements: Record<string, string>,
  repeatGroups?: Record<string, Record<string, string>[]>,
  groupFields?: Record<string, string[]>,
): ReadinessResult {
  const filled: string[] = []
  const missing: string[] = []
  const groupItems = repeatGroups ? Object.values(repeatGroups).flat() : []
  const itemsFor = (inner: string) => !groupFields ? groupItems.filter(item => inner in item)
    : Object.entries(repeatGroups ?? {}).filter(([tag]) => groupFields[tag]?.includes(inner)).flatMap(([, items]) => items)

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
      const relevantItems = itemsFor(inner)
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
  CETATENIA_ACORD: 'Cetățenia',
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
  DURATA_MANDAT: 'Durata mandatului',
  DURATA_MANDAT_TEXT: 'Durata mandatului',
  DATA_NUMIRE: 'Data numirii',
  DATA_EXPIRARE_MANDAT: 'Data expirării mandatului',
}

const DURATA_LABELS: Record<string, { group: string; field: string }> = {
  DURATA_SOCIETATE: { group: 'Societate', field: 'Durata societății' },
  DURATA_SOCIETATE_TEXT: { group: 'Societate', field: 'Durata societății' },
  DURATA_SOCIETATE_ANI: { group: 'Societate', field: 'Durata societății (număr de ani)' },
  DURATA_SOCIETATE_ANI_LITERE: { group: 'Societate', field: 'Durata societății (ani, în litere)' },
  DURATA_SOCIETATE_DATA_EXPIRARE: { group: 'Societate', field: 'Data expirării duratei societății' },
  // Aceeași etichetă și pentru forma comună, și pentru cea din {{#ADMINISTRATORI}}: lipsește fie la un administrator, fie
  // (forma comună) diferă între ei — în ambele cazuri se rezolvă din mandatele administratorilor
  DURATA_MANDAT: { group: 'Administratori', field: 'Durata mandatului' },
  DURATA_MANDAT_TEXT: { group: 'Administratori', field: 'Durata mandatului' },
  DURATA_MANDAT_ANI: { group: 'Administratori', field: 'Durata mandatului (număr de ani)' },
  DURATA_MANDAT_NOU_TEXT: { group: 'Administratori', field: 'Durata mandatului noului administrator' },
  DATA_NUMIRE: { group: 'Administratori', field: 'Data numirii' },
  DATA_EXPIRARE_MANDAT: { group: 'Administratori', field: 'Data expirării mandatului' },
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

  if (DURATA_LABELS[inner]) return DURATA_LABELS[inner]
  if (inner === 'CAEN_1') return { group: 'Societate', field: 'Activitate principală (CAEN)' }
  if (inner === 'CAEN_DOMENIU') return { group: 'Societate', field: 'Domeniul principal de activitate (grupa CAEN)' }
  if (inner === 'CAEN') return { group: 'Societate', field: 'Activitate secundară (CAEN)' }
  if (inner === 'CAEN_PRINCIPAL_COD') return { group: 'Societate', field: 'Cod CAEN principal' }
  if (inner === 'SOCIETATE_TRIBUNAL') return { group: 'Societate', field: 'Tribunalul (județul sediului)' }
  if (inner === 'SOCIETATE_EUID') return { group: 'Societate', field: 'EUID' }
  if (inner === 'CAEN_PRINCIPAL_DENUMIRE') return { group: 'Societate', field: 'Denumirea activității principale' }
  if (inner === 'CAEN_DOMENIU_COD') return { group: 'Societate', field: 'Grupa CAEN a domeniului principal' }
  if (inner === 'CAEN_DOMENIU_DENUMIRE') return { group: 'Societate', field: 'Domeniul principal de activitate' }
  if (inner === 'CAEN_SECUNDARE_COD') return { group: 'Societate', field: 'Coduri CAEN secundare' }

  if (inner === 'CAPITAL_SOCIAL_TOTAL') return { group: 'Societate', field: 'Capital social total' }
  if (inner === 'PARTI_SOCIALE_TOTALE') return { group: 'Societate', field: 'Părți sociale totale' }
  if (inner === 'VALOARE_PARTE_SOCIALA') return { group: 'Societate', field: 'Valoarea unei părți sociale' }
  if (inner === 'VALOARE_PARTE_SOCIALA_LITERE') return { group: 'Societate', field: 'Valoarea unei părți sociale, în litere' }
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
