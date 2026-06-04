export interface ToastItem {
  id: string
  message: string
  type: 'ok' | 'err' | 'info'
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

export interface Client {
  id: string
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
  dataAnafActualizat: string | null
  notite: string
  asociati: Persoana[]
  administratori: Persoana[]
  createdAt: string | null
  createdBy: string
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
