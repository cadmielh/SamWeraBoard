import type { IDFields } from './api'
import type { Client, Persoana, ScannedPerson } from '../types'
import { persoanaToIDFields } from './idFields'

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
  VALABILA_PANA_LA: 'valabila_pana_la',
}

function today(): Record<string, string> {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    '{{DATA_AZI}}': `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
    '{{LUNA_AZI}}': pad(d.getMonth() + 1),
    '{{AN_AZI}}': String(d.getFullYear()),
  }
}

function persoanaToMap(p: Persoana, prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, field] of Object.entries(PERSOANA_FIELD_MAP)) {
    out[`{{${prefix}_${key}}}`] = (p as unknown as Record<string, string>)[field as string] ?? ''
  }
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
    valabila_pana_la: sp.fields.valabila_pana_la,
  }
}

export interface BuildOptions {
  idFields?: IDFields | null
  client?: Partial<Client> | null
  scannedPersons?: ScannedPerson[]
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
    out['{{SOCIETATE_SEDIU}}'] = client.sediuSocial ?? ''
    out['{{SOCIETATE_FORMA_JURIDICA}}'] = client.formaJuridica ?? ''
  }

  if (!isPF) {
    // Asociați și administratori — doar pentru PJ
    const clientAsociati = client?.asociati ?? []
    const clientAdmini = client?.administratori ?? []

    const scannedAsociati = (scannedPersons ?? []).filter(p => p.role === 'asociat')
    const scannedAdmini = (scannedPersons ?? []).filter(p => p.role === 'administrator')

    const asociatiToUse: Persoana[] = scannedAsociati.length > 0
      ? scannedAsociati.map(scannedToPersoana)
      : clientAsociati

    const adminiToUse: Persoana[] = scannedAdmini.length > 0
      ? scannedAdmini.map(scannedToPersoana)
      : clientAdmini

    asociatiToUse.forEach((p, i) => {
      Object.assign(out, persoanaToMap(p, `ASOCIAT_${i + 1}`))
    })
    adminiToUse.forEach((p, i) => {
      Object.assign(out, persoanaToMap(p, `ADMINISTRATOR_${i + 1}`))
    })
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

export interface ReadinessResult {
  filled: string[]
  missing: string[]
}

export function checkReadiness(
  placeholders: string[],
  replacements: Record<string, string>,
): ReadinessResult {
  const filled: string[] = []
  const missing: string[] = []
  for (const ph of placeholders) {
    if (replacements[ph] && replacements[ph].trim() !== '') {
      filled.push(ph)
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
  EMISA_DE: 'Emisă de',
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
}

export function parsePlaceholder(ph: string): { group: string; field: string } {
  const inner = ph.replace(/^\{\{|\}\}$/g, '')

  const asociat = inner.match(/^ASOCIAT_(\d+)_(.+)$/)
  if (asociat) return { group: `Asociat ${asociat[1]}`, field: FRIENDLY_FIELD[asociat[2]] ?? asociat[2] }

  const admin = inner.match(/^ADMINISTRATOR_(\d+)_(.+)$/)
  if (admin) return { group: `Administrator ${admin[1]}`, field: FRIENDLY_FIELD[admin[2]] ?? admin[2] }

  const membruIF = inner.match(/^MEMBRU_IF_(\d+)_(.+)$/)
  if (membruIF) return { group: `Membru IF ${membruIF[1]}`, field: FRIENDLY_FIELD[membruIF[2]] ?? membruIF[2] }

  const soc = inner.match(/^SOCIETATE_(.+)$/)
  if (soc) return { group: 'Societate', field: FRIENDLY_FIELD[soc[1]] ?? soc[1] }

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
