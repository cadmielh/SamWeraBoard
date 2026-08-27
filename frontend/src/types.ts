export interface ToastItem {
  id: string
  message: string
  type: 'ok' | 'err' | 'info'
  /** Apelat când toast-ul se închide normal (expiră sau ×) — pentru
   * toast-uri cu acțiune amânată (ex. ștergere), aici se comite efectiv
   * acțiunea. Absent pentru toast-uri simple, fără nimic de amânat. */
  onExpire?: () => void
  /** Buton explicit în toast (ex. "Anulează" la o ștergere amânată) —
   * anulează acțiunea amânată și închide toast-ul, fără să declanșeze onExpire. */
  action?: { label: string; onClick: () => void }
}

export interface ScannedPerson {
  id: string
  role: 'asociat' | 'administrator'
  cotaParticipare: string
  fields: import('./lib/api').IDFields
  scanStatus: 'scanned' | 'manual' | 'empty'
}

export interface ClauseMeta {
  tag: string
  label: string
  placeholders: string[]
}

export interface DocTemplate {
  id: string
  name: string
  description: string
  type: 'docx' | 'gdoc'
  fileBase64?: string
  fileName?: string
  driveFileId?: string
  placeholders?: string[]
  // Prezent doar pe șabloanele "bibliotecă de clauze" (ex. Decizia Asociatului
  // Unic, Hotărâre AGA) — un articol per element, în ordinea din document.
  clauses?: ClauseMeta[]
  docId?: string
  outputNameTemplate: string
  tipTemplate?: 'PF' | 'PJ' | 'universal'
  // Prezente doar pe șabloanele obținute prin "Duplică" dintr-un șablon de
  // bază — leagă copia de originalul din care a pornit, pentru eticheta de
  // "versiune mai nouă disponibilă". Absente pe un șablon urcat de la zero.
  sourceKey?: string
  sourceVersion?: number
  createdAt: string
  createdBy: string
}

// Șablon de bază, servit din backend (nu din Firestore) — aceeași formă ca
// DocTemplate, minus câmpurile specifice unui document Firestore.
export interface BuiltinTemplate {
  key: string
  version: number
  filename: string
  name: string
  description: string
  tipTemplate: 'PF' | 'PJ' | 'universal'
  outputNameTemplate: string
  type: 'docx' | 'pdf'
  placeholders: string[]
  clauses: ClauseMeta[]
  // Prezent doar pentru type === 'pdf' — numele tuturor câmpurilor AcroForm
  // din PDF, în ordinea din document.
  pdfFields: string[]
}

export interface DocGeneration {
  templateId: string
  templateName: string
  generatedAt: string
  generatedBy: string
  outputName: string
  driveLink?: string
}

export interface Persoana {
  calitate: string
  cotaParticipare: string
  cnp: string
  nume: string
  prenume: string
  serie_numar: string
  data_nasterii: string
  locul_nasterii: string
  cetatenia: string
  adresa: string
  judet: string
  emisa_de: string
  valabila_de_la: string
  valabila_pana_la: string
}

export interface CaenActivitate {
  cod: string
  descriere: string
}

export type TipClient = 'PF' | 'PJ'
export type SubtipPF = 'PFA' | 'IF' | 'II'
export type RegimFiscal = '' | 'microintreprindere' | 'impozit_profit'

export interface Client {
  id: string
  tipClient: TipClient
  subtipPF?: SubtipPF
  // Date persoană fizică (sursă: CI scanat sau introdus manual)
  titular?: Persoana
  // Membri IF (calitate: 'Titular' sau 'Membru IF')
  membriIF?: Persoana[]
  // Date entitate (sursă: ANAF sau introducere manuală)
  denumire: string
  denumireLower: string
  formaJuridica: string
  codFiscal: string
  nrRegistrul: string
  sediuSocial: string
  caenCod: string
  caenDescriere: string
  caenSecundare: CaenActivitate[]
  puncteLucru: string[]
  telefon: string
  email: string
  statutFiscal: string
  platitorTva: boolean
  periodaTva: string
  tvaLaIncasare: boolean
  inactivAnaf: boolean
  splitTva: boolean
  eFactura: boolean
  // Strict informativ, din ANAF — nu înlocuiește lista structurată `administratori`
  administratoriAnaf: { nume: string; rol: string }[]
  plafonTvaAnual: number | null
  regimFiscal: RegimFiscal
  nrSalariati: number | null
  capitalSocial: number | null
  anFiscal: string
  dataAnafActualizat: string | null
  notite: string
  asociati: Persoana[]
  administratori: Persoana[]
  createdAt: string | null
  createdBy: string
}

export function inferTipClient(c: Partial<Client>): TipClient {
  return c.tipClient ?? 'PJ'
}

export function getClientDisplayName(c: Pick<Client, 'denumire' | 'tipClient' | 'subtipPF' | 'titular'>): string {
  return c.denumire
}

export interface WorkspaceMember {
  role: 'admin' | 'member'
  email: string
  displayName: string
  addedAt: string | null
}

export interface Workspace {
  id: string
  name: string
  ownerId: string
  members: Record<string, WorkspaceMember>
  createdAt: string | null
}

// ── Dosare (registru ONRC) ───────────────────────────────────────────────

export type StadiuDosar =
  | 'in_lucru' | 'in_asteptare_client' | 'depus_in_solutionare'
  | 'dosar_amanat' | 'dosar_spre_eliberare' | 'dosar_eliberat' | 'documente_predate_client'

export const STADIU_DOSAR_LABELS: Record<StadiuDosar, string> = {
  in_lucru: 'În lucru',
  in_asteptare_client: 'În așteptare client',
  depus_in_solutionare: 'Depus, în soluționare',
  dosar_amanat: 'Dosar amânat',
  dosar_spre_eliberare: 'Dosar spre eliberare',
  dosar_eliberat: 'Dosar eliberat',
  documente_predate_client: 'Documente predate client',
}

export type StadiuDosarColor = 'blue' | 'amber' | 'primary' | 'orange' | 'yellow' | 'green' | 'muted'

export const STADIU_DOSAR_COLOR: Record<StadiuDosar, StadiuDosarColor> = {
  in_lucru: 'blue',
  in_asteptare_client: 'amber',
  depus_in_solutionare: 'primary',
  dosar_amanat: 'orange',
  dosar_spre_eliberare: 'yellow',
  dosar_eliberat: 'green',
  documente_predate_client: 'muted',
}

/** Stadii care marchează un dosar drept încheiat — folosite pentru promptul
 * "marchează și sarcina asociată ca finalizată" din DosarView. */
export const STADII_DOSAR_FINALE: StadiuDosar[] = ['dosar_eliberat', 'documente_predate_client']

/** Un "tip de cerere" ales pentru un dosar — etichetă liberă sau din sugestii
 * (vezi data/dosarObiecte.ts). `clauseTag` e prezent doar dacă eticheta se
 * potrivește exact cu o clauză cunoscută din CLAUSE_FIELD_SPECS — fiecare
 * astfel de etichetă activează propriul buton "Generează documente" în
 * DosarView. Etichetele fără clauseTag rămân text liber, fără integrare. */
export interface ObiectCerereItem {
  label: string
  clauseTag?: string
}

/** Text unificat pentru afișare/căutare (tabel, filtrare) — derivat din
 * etichete, nu stocat separat, ca să nu poată ajunge desincronizat. */
export function obiecteCereriiText(items: ObiectCerereItem[]): string {
  return items.map(o => o.label).join(', ')
}

export interface Dosar {
  id: string
  // Legătură la un client existent din registru — mutual exclusivă cu
  // clientDenumireLibera. Niciuna nu e obligatorie individual, dar cel puțin
  // una din ele trebuie completată (impus de DosarModal, nu de tip).
  clientId?: string
  clientDenumire?: string        // denormalizat din Client la creare
  clientDenumireLibera?: string  // denumire scrisă liber, fără Client încă (ex. prospect)
  clientCui?: string             // denormalizat din Client.codFiscal — absent dacă nu există clientId
  nrInregistrareDosar: string
  // Membru existent (uid) SAU nume liber, fără cont în aplicație — accesul
  // aplicației se dă doar prin invitație pe email, deci nu există un flux de
  // "creează cont din interior" echivalent celui pentru client.
  responsabilUid?: string
  responsabilNume: string
  obiecteCererii: ObiectCerereItem[]
  stadiu: StadiuDosar
  dataAdmiterii: string | null    // ISO yyyy-mm-dd
  dataPlanificare: string | null  // ISO yyyy-mm-dd
  observatii: string
  taxeOnrc: number | null
  tarifClient: number | null
  facturat: boolean
  // Relația cu Sarcini e 1:N — un dosar poate avea mai multe sarcini legate,
  // deci nu ținem un id singular aici; lista se derivă din Sarcina.dosarId
  // (sursă unică de adevăr, fără risc de desincronizare) via fetchSarciniByDosar().
  // Arhivare (vezi lib/dosare.ts) — un dosar e arhivat dacă stadiu ===
  // 'documente_predate_client' și (arhivatManual === true SAU
  // documentePredateAt < startOfWeek()); calculat, nu un status separat.
  documentePredateAt: string | null   // serverTimestamp() la tranziția în acest stadiu; șters la ieșire
  arhivatManual?: boolean             // arhivare forțată devreme, indiferent de săptămână
  createdAt: string | null
  createdBy: string
}

export type DosarInput = Omit<Dosar, 'id' | 'createdAt' | 'createdBy'>

// ── Sarcini (board de lucru) ─────────────────────────────────────────────

export type SarcinaStatus = 'deschis' | 'in_lucru' | 'finalizat'
export type SarcinaPrioritate = 'scazuta' | 'medie' | 'ridicata' | 'urgenta'

export const SARCINA_STATUS_LABELS: Record<SarcinaStatus, string> = {
  deschis: 'Deschis',
  in_lucru: 'În lucru',
  finalizat: 'Finalizat',
}

export const SARCINA_STATUS_ORDER: SarcinaStatus[] = ['deschis', 'in_lucru', 'finalizat']

/** Următorul status în flux (Deschis→În lucru→Finalizat), sau `null` dacă e
 * deja ultimul — folosit de shortcut-ul "▶" de pe cardul din board. */
export function nextSarcinaStatus(status: SarcinaStatus): SarcinaStatus | null {
  const idx = SARCINA_STATUS_ORDER.indexOf(status)
  return idx >= 0 && idx < SARCINA_STATUS_ORDER.length - 1 ? SARCINA_STATUS_ORDER[idx + 1] : null
}

/** Statusul anterior în flux, sau `null` dacă e deja primul — folosit de
 * shortcut-ul "◀" (revenire/redeschidere) de pe cardul din board. */
export function previousSarcinaStatus(status: SarcinaStatus): SarcinaStatus | null {
  const idx = SARCINA_STATUS_ORDER.indexOf(status)
  return idx > 0 ? SARCINA_STATUS_ORDER[idx - 1] : null
}

export const PRIORITATE_LABELS: Record<SarcinaPrioritate, string> = {
  scazuta: 'Scăzută',
  medie: 'Medie',
  ridicata: 'Ridicată',
  urgenta: 'Urgentă',
}

export type PrioritateColor = 'muted' | 'blue' | 'amber' | 'red'

export const PRIORITATE_COLOR: Record<SarcinaPrioritate, PrioritateColor> = {
  scazuta: 'muted',
  medie: 'blue',
  ridicata: 'amber',
  urgenta: 'red',
}

export const PRIORITATE_ORDER: SarcinaPrioritate[] = ['scazuta', 'medie', 'ridicata', 'urgenta']

export interface Sarcina {
  id: string
  titlu: string
  titluLower: string   // denormalizat, căutare prefix ca la Client.denumireLower
  descriere: string
  status: SarcinaStatus
  prioritate: SarcinaPrioritate
  termenLimita: string | null   // ISO yyyy-mm-dd
  assigneeUid: string | null
  assigneeNume: string
  // Legătură la un client existent din registru — mutual exclusivă cu clientDenumireLibera.
  clientId?: string
  clientDenumire?: string
  // Denumire scrisă liber, fără Client încă existent (ex. un prospect) — vezi
  // "Creează client din acest nume" în TaskModal pentru conversia la clientId.
  clientDenumireLibera?: string
  dosarId?: string       // legătură opțională la un Dosar
  dosarLabel?: string    // denormalizat (nrInregistrareDosar || obiectulCererii)
  // Eticheta exactă a obiectului cererii (din Dosar.obiecteCererii) pentru care
  // a fost creată automat această sarcină — prezentă doar pe sarcinile
  // generate 1:1 per obiect (la crearea dosarului sau prin sugestia din
  // DosarSarciniList), absentă pe sarcinile adăugate manual. Permite
  // potrivirea sarcină↔obiect când obiectele unui dosar se editează ulterior.
  obiectCererii?: string
  order: number           // poziție manuală în coloană
  completedAt: string | null   // setat (serverTimestamp) la trecerea în 'finalizat', șters altfel
  // Arhivare (vezi lib/sarcini.ts) — o sarcină finalizată e arhivată dacă
  // arhivatManual === true SAU completedAt < startOfWeek(); calculat.
  arhivatManual?: boolean
  createdAt: string | null
  createdBy: string
}

export type SarcinaInput = Omit<Sarcina, 'id' | 'createdAt' | 'createdBy'>
