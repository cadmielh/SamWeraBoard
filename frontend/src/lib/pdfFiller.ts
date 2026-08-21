// Logică pură (fără JSX) pentru completarea PDF-ului "Declarație pe propria
// răspundere" (ONRC, Anexa nr. 4) — parsare best-effort a adreselor/județului
// existente în profilul clientului și asamblarea valorilor finale, editate de
// user în PdfFormFiller, în Record<string,string> cu exact numele câmpurilor
// AcroForm din PDF (confirmate via pdf_filler.list_pdf_fields pe fișierul real).
import type { CaenActivitate, Client } from '../types'
import { JUDETE_ROMANIA } from './counties'

export interface AdresaParsed {
  localitate: string
  strada: string
  nr: string
  bloc: string
  scara: string
  etaj: string
  ap: string
}

const EMPTY_ADRESA: AdresaParsed = { localitate: '', strada: '', nr: '', bloc: '', scara: '', etaj: '', ap: '' }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Litere care pot apărea fie cu diacritic corect, fie într-o formă OCR/tastare
// alternativă des întâlnită (fără diacritic, sau cu sedilă în loc de virgulă
// dedesubt) — folosit ca să potrivim "Timiș"/"Timis" și "Brăila"/"Braila" cu
// același pattern, direct pe textul original (fără normalizare prealabilă).
const DIACRITIC_CLASS: Record<string, string> = {
  a: 'aăâ', ă: 'aăâ', â: 'aăâ',
  i: 'iî', î: 'iî',
  s: 'sșş', ș: 'sșş', ş: 'sșş',
  t: 'tțţ', ț: 'tțţ', ţ: 'tțţ',
}

function diacriticInsensitiveSource(word: string): string {
  return word.toLowerCase().split('').map(ch => {
    const cls = DIACRITIC_CLASS[ch]
    return cls ? `[${cls}]` : escapeRegExp(ch)
  }).join('')
}

/** Caută în text un nume de județ din lista canonică (diacritic-insensitiv,
 * tolerant la prefixe gen "jud.", "județul") — folosit atât pentru sediul
 * social, cât și pentru domiciliul/locul nașterii declarantului. */
export function extractJudet(text?: string | null): string {
  if (!text) return ''
  for (const judet of JUDETE_ROMANIA) {
    if (new RegExp(`\\b${diacriticInsensitiveSource(judet)}\\b`, 'i').test(text)) return judet
  }
  return ''
}

const LABELED_PARTS: { key: keyof AdresaParsed; re: RegExp }[] = [
  { key: 'nr', re: /\bnr\.?\s*([^\s,]+)/i },
  { key: 'bloc', re: /\b(?:bl\.?|bloc)\s*([^\s,]+)/i },
  { key: 'scara', re: /\b(?:sc\.?|scara)\s*([^\s,]+)/i },
  { key: 'etaj', re: /\b(?:et\.?|etaj)\s*([^\s,]+)/i },
  { key: 'ap', re: /\b(?:ap\.?|apartament)\s*([^\s,]+)/i },
]

/**
 * Parsare best-effort a unei adrese românești în componente. Tot ce nu se
 * potrivește unei etichete recunoscute (Str./Nr./Bl./Sc./Et./Ap./jud.) cade în
 * `localitate` — informația nu se pierde, doar ajunge în câmpul "greșit",
 * ușor de mutat manual (câmpurile rămân editabile în formular).
 */
export function parseAdresa(text?: string | null): AdresaParsed {
  if (!text) return { ...EMPTY_ADRESA }
  let rest = text

  // Scoate județul/sectorul înainte de orice altceva, ca să nu polueze
  // "localitate" — județul are propriul câmp în PDF (extractJudet separat).
  const judet = extractJudet(rest)
  if (judet) {
    rest = rest.replace(new RegExp(`\\b(?:jud(?:e[tț]ul)?\\.?\\s*)?${diacriticInsensitiveSource(judet)}\\b`, 'i'), '')
  }
  rest = rest.replace(/\bsector\s*\d\b/i, '')

  const result: AdresaParsed = { ...EMPTY_ADRESA }
  for (const { key, re } of LABELED_PARTS) {
    const m = rest.match(re)
    if (m && m.index !== undefined) {
      result[key] = m[1].trim()
      rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length)
    }
  }

  // Strada: eticheta explicită dacă există, altfel textul rămas (mai puțin
  // sigur, dar mai bine decât un câmp gol) — comuna/localitatea rămâne oricum
  // recognoscibilă lângă ea și userul o poate corecta din formular.
  const stradaMatch = rest.match(/\b(?:str\.?|strada)\s*([^,]*)/i)
  if (stradaMatch) {
    result.strada = stradaMatch[1].trim()
    rest = rest.slice(0, stradaMatch.index) + rest.slice((stradaMatch.index ?? 0) + stradaMatch[0].length)
  }

  result.localitate = rest
    .split(',')
    .map(p => p.trim().replace(/^(?:mun\.?|municipiul|com\.?|comuna|oraș|orasul)\s+/i, '').trim())
    .filter(Boolean)
    .join(', ')

  return result
}

/** Formatul standard CI: literă(e) + cifre, ex. "TM 123456" → { serie: "TM", numar: "123456" }. */
export function splitSerieNumar(serieNumar?: string | null): { serie: string; numar: string } {
  if (!serieNumar) return { serie: '', numar: '' }
  const m = serieNumar.trim().match(/^([A-ZȘȚ]{1,3})\s*-?\s*(\d+)$/i)
  if (!m) return { serie: '', numar: serieNumar.trim() }
  return { serie: m[1].toUpperCase(), numar: m[2] }
}

export interface CaenOption {
  cod: string
  descriere: string
}

/** Toate codurile CAEN ale firmei (principal + secundare), deduplicate — sursa
 * din care userul bifează explicit ce se aplică la fiecare din tabelele 3.1/3.2/3.3. */
export function companyCaenOptions(client?: Partial<Client> | null): CaenOption[] {
  const out: CaenOption[] = []
  const seen = new Set<string>()
  if (client?.caenCod) {
    out.push({ cod: client.caenCod, descriere: client.caenDescriere ?? '' })
    seen.add(client.caenCod)
  }
  for (const c of (client?.caenSecundare ?? []) as CaenActivitate[]) {
    if (c.cod && !seen.has(c.cod)) {
      out.push({ cod: c.cod, descriere: c.descriere ?? '' })
      seen.add(c.cod)
    }
  }
  return out
}

export interface DeclarantFormFields {
  nume: string
  prenume: string
  cnp: string
  domiciliu: AdresaParsed
  domiciliuJudet: string
  tara: string
  cetatenia: string
  nasterelocalitate: string
  nastereJudet: string
  nastereTara: string
  nastereData: string
  actTip: string
  actSerie: string
  actNumar: string
  actEmisDe: string
  actValabilDeLa: string
  actValabilPanaLa: string
  calitate: string
}

export const EMPTY_DECLARANT: DeclarantFormFields = {
  nume: '', prenume: '', cnp: '',
  domiciliu: { ...EMPTY_ADRESA }, domiciliuJudet: '',
  tara: 'România', cetatenia: '',
  nasterelocalitate: '', nastereJudet: '', nastereTara: '', nastereData: '',
  actTip: 'Carte de identitate', actSerie: '', actNumar: '', actEmisDe: '', actValabilDeLa: '', actValabilPanaLa: '',
  calitate: '',
}

export interface SediuSecundarRow {
  adresa: string
  caenCodes: string[]
}

export interface DeclaratieFormState {
  // Fără câmp separat pentru Tribunalul — se derivă direct din județ, la
  // asamblare (buildPdfFieldValues). Formularul PDF are deja tipărit
  // "Tribunalul" lângă acest câmp, deci se completează doar cu județul.
  sediu: AdresaParsed & { judet: string }
  declarant: DeclarantFormFields
  caenSediu: string[]
  caenTerti: string[]
  sediiSecundare: SediuSecundarRow[]
  dataCerere: string
}

/** 18 sloturi pe tabelul 3.1/3.2, câte 3 stivuite pe fiecare din cele 6
 * rânduri vizibile din PDF (confirmat din rect-urile câmpurilor). Dacă
 * numărul de coduri încape cu un cod pe rând (mai lizibil, un rând gol între
 * ele), le pune spațiat; altfel (mai multe coduri decât rânduri) le apropie,
 * un slot pe cod, ca să încapă toate până la limita de 18. */
function caenSlotIndices(count: number): number[] {
  const rows = 6
  const slotsPerRow = 3
  const capped = Math.min(count, rows * slotsPerRow)
  if (capped <= rows) {
    return Array.from({ length: capped }, (_, i) => i * slotsPerRow)
  }
  return Array.from({ length: capped }, (_, i) => i)
}

/** Asamblează valorile finale (deja editate/corectate de user în formular)
 * într-un Record<string,string> cheiat exact cu numele câmpurilor AcroForm
 * din PDF (confirmate din fișierul real via pdf_filler.list_pdf_fields). */
export function buildPdfFieldValues(state: DeclaratieFormState, client?: Partial<Client> | null): Record<string, string> {
  const values: Record<string, string> = {}
  const set = (key: string, value: string | undefined | null) => { if (value) values[key] = value }

  set('InmFirma', client?.denumire)
  set('nr100', client?.nrRegistrul)
  set('nr101', client?.codFiscal)
  set('InmLocalitatea', state.sediu.localitate)
  set('InmStrada', state.sediu.strada)
  set('InmNr', state.sediu.nr)
  set('InmBl', state.sediu.bloc)
  set('InmSc', state.sediu.scara)
  set('InmEt', state.sediu.etaj)
  set('InmAp', state.sediu.ap)
  set('InmJudSect', state.sediu.judet)
  set('InmEmail', client?.email)
  set('InmTel', client?.telefon)
  set('TRIBUNALUL', state.sediu.judet)

  const d = state.declarant
  set('SubNume', d.nume)
  set('SubPrenume', d.prenume)
  set('SubCNP', d.cnp)
  set('SubLocalitatea', d.domiciliu.localitate)
  set('SubStrada', d.domiciliu.strada)
  set('SubNr', d.domiciliu.nr)
  set('SubBl', d.domiciliu.bloc)
  set('SubSc', d.domiciliu.scara)
  set('SubEt', d.domiciliu.etaj)
  set('SubAp', d.domiciliu.ap)
  set('SubJudSect', d.domiciliuJudet)
  set('SubTara', d.tara)
  set('SubCetatenia', d.cetatenia)
  set('SubNLocalitatea', d.nasterelocalitate)
  set('SubNSectJud', d.nastereJudet)
  set('SubNTara', d.nastereTara)
  set('SubNData', d.nastereData)
  set('SubTipActIdent', d.actTip)
  set('SubSerieActIdent', d.actSerie)
  set('SubNrActIdent', d.actNumar)
  set('SubEmisActIdent', d.actEmisDe)
  set('SubEmisActIdentLaData', d.actValabilDeLa)
  set('SubEmisActIdentPanaData', d.actValabilPanaLa)
  set('SubCalitate', d.calitate)

  const options = companyCaenOptions(client)
  const descFor = (cod: string) => options.find(o => o.cod === cod)?.descriere ?? ''

  const sediuSlots = caenSlotIndices(state.caenSediu.length)
  state.caenSediu.slice(0, sediuSlots.length).forEach((cod, i) => {
    set(`clasa_caen.0.${sediuSlots[i]}`, cod)
    set(`clasa_caen_desc.0.${sediuSlots[i]}`, descFor(cod))
  })
  const tertiSlots = caenSlotIndices(state.caenTerti.length)
  state.caenTerti.slice(0, tertiSlots.length).forEach((cod, i) => {
    set(`clasa_caen.1.${tertiSlots[i]}`, cod)
    set(`clasa_caen_desc.1.${tertiSlots[i]}`, descFor(cod))
  })
  state.sediiSecundare.forEach((row, i) => {
    // Nu sări rândul doar pentru că adresa e goală — userul poate bifa
    // CAEN înainte de a alege adresa, iar codul tot trebuie să apară.
    if (!row.adresa && row.caenCodes.length === 0) return
    set(`nr_crt.0.${i}`, String(i + 1))
    set(`sedii_sec_adresa.0.${i}`, row.adresa)
    row.caenCodes.slice(0, 2).forEach((cod, j) => {
      set(`sedii_sec_caen.0.${i * 2 + j}`, cod)
      set(`sedii_sec_caen_desc.0.${i * 2 + j}`, descFor(cod))
    })
  })

  set('DataCerere', state.dataCerere)
  return values
}
