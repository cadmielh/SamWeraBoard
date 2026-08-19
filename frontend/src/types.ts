export interface ToastItem {
  id: string
  message: string
  type: 'ok' | 'err' | 'info'
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
  placeholders: string[]
  clauses: ClauseMeta[]
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
