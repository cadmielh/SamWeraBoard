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

export interface DocTemplate {
  id: string
  name: string
  description: string
  type: 'docx' | 'gdoc'
  fileBase64?: string
  fileName?: string
  driveFileId?: string
  placeholders?: string[]
  docId?: string
  outputNameTemplate: string
  tipTemplate?: 'PF' | 'PJ' | 'universal'
  createdAt: string
  createdBy: string
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
  valabila_pana_la: string
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
  telefon: string
  email: string
  statutFiscal: string
  platitorTva: boolean
  periodaTva: string
  tvaLaIncasare: boolean
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
