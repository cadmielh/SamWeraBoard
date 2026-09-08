// Logică pură (fără JSX) pentru completarea șablonului DOCX "Declarație pe
// propria răspundere" (ONRC, Anexa nr. 4) — asamblarea valorilor finale,
// editate de user în DeclaratieActivitateFiller, în:
//   - `replacements`: Record<{{PLACEHOLDER}}, valoare> pentru câmpurile plate
//   - `rowGroups`: Record<TAG, listă de rânduri> pentru tabelele cu lungime
//     variabilă (coduri CAEN la sediu/terți, sedii secundare) — expandate de
//     doc_filler.py (_expand_repeat_table_rows) direct în tabelul șablon, deci
//     spre deosebire de PDF-ul AcroForm nu mai există niciun plafon fix de
//     sloturi (18 coduri CAEN, 13 sedii secundare).
import type { CaenActivitate, Client } from '../types'
import { EMPTY_ADRESA, type AdresaStructurata } from './adresa'

export { EMPTY_ADRESA, extractJudet, parseAdresa, formatAdresa, type AdresaStructurata } from './adresa'

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
  domiciliu: AdresaStructurata
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
  // asamblare (buildDeclaratieReplacements). Textul tipărit din șablon are
  // deja "...DE PE LÂNGĂ TRIBUNALUL", deci se completează doar cu județul.
  sediu: AdresaStructurata
  declarant: DeclarantFormFields
  caenSediu: string[]
  caenTerti: string[]
  sediiSecundare: SediuSecundarRow[]
}

export interface DeclaratieDocxData {
  replacements: Record<string, string>
  rowGroups: Record<string, Record<string, string>[]>
}

/** Asamblează valorile finale (deja editate/corectate de user în formular) în
 * forma cerută de /fill/docx: `replacements` cheiat cu exact placeholderele
 * {{...}} din șablon, plus `rowGroups` pentru tabelele cu rânduri repetitive
 * (CAEN sediu/terți, sedii secundare) — expandate de doc_filler.py direct în
 * tabelul șablon, fără plafon de capacitate.
 *
 * Nu setează {{SOCIETATE_DENUMIRE}}/{{SOCIETATE_NR_REG}}/{{SOCIETATE_CIF}}
 * și nici {{DATA_AZI}} — sunt deja calculate de buildReplacements() (vezi
 * lib/placeholders.ts) pentru orice document generat; TemplateFiller.tsx le
 * combină cu rezultatul de aici înainte de a trimite cererea, exact ca la
 * celelalte șabloane de bază. Un {{DATA_CERERE}} separat ar fi fost un
 * duplicat inutil — formularul nu oferă oricum o dată editabilă distinctă
 * de "azi". */
export function buildDeclaratieDocxData(state: DeclaratieFormState, client?: Partial<Client> | null): DeclaratieDocxData {
  const replacements: Record<string, string> = {}
  const set = (key: string, value: string | undefined | null) => { replacements[`{{${key}}}`] = value ?? '' }

  set('SEDIU_LOCALITATE', state.sediu.localitate)
  set('SEDIU_STRADA', state.sediu.strada)
  set('SEDIU_NR', state.sediu.numar)
  set('SEDIU_BL', state.sediu.bloc)
  set('SEDIU_SC', state.sediu.scara)
  set('SEDIU_ET', state.sediu.etaj)
  set('SEDIU_AP', state.sediu.apartament)
  set('SEDIU_JUDET', state.sediu.judet)
  set('SEDIU_EMAIL', client?.email)
  set('SEDIU_TEL', client?.telefon)
  set('SEDIU_WEB', '-')
  set('TRIBUNAL_JUDET', state.sediu.judet ? state.sediu.judet.toUpperCase() : '')

  const d = state.declarant
  set('DECLARANT_NUME', d.nume)
  set('DECLARANT_PRENUME', d.prenume)
  set('DECLARANT_CNP', d.cnp)
  set('DECLARANT_LOCALITATE', d.domiciliu.localitate)
  set('DECLARANT_STRADA', d.domiciliu.strada)
  set('DECLARANT_NR', d.domiciliu.numar)
  set('DECLARANT_BL', d.domiciliu.bloc)
  set('DECLARANT_SC', d.domiciliu.scara)
  set('DECLARANT_ET', d.domiciliu.etaj)
  set('DECLARANT_AP', d.domiciliu.apartament)
  set('DECLARANT_JUDET', d.domiciliuJudet)
  set('DECLARANT_TARA', d.tara)
  set('DECLARANT_CETATENIE', d.cetatenia)
  set('DECLARANT_NASTERE_LOCALITATE', d.nasterelocalitate)
  set('DECLARANT_NASTERE_JUDET', d.nastereJudet)
  set('DECLARANT_NASTERE_TARA', d.nastereTara)
  set('DECLARANT_NASTERE_DATA', d.nastereData)
  set('DECLARANT_ACT_TIP', d.actTip)
  set('DECLARANT_ACT_SERIE', d.actSerie)
  set('DECLARANT_ACT_NR', d.actNumar)
  set('DECLARANT_ACT_EMIS_DE', d.actEmisDe)
  set('DECLARANT_ACT_VALABIL_DE_LA', d.actValabilDeLa)
  set('DECLARANT_ACT_VALABIL_PANA_LA', d.actValabilPanaLa)
  set('DECLARANT_CALITATE', d.calitate)

  const options = companyCaenOptions(client)
  const descFor = (cod: string) => options.find(o => o.cod === cod)?.descriere ?? ''

  const rowGroups: Record<string, Record<string, string>[]> = {
    // Dacă sediul social n-are niciun cod CAEN bifat, tabelul 3.1 tot trebuie
    // să aibă un rând — altfel ar rămâne complet gol, ambiguu între "nu s-a
    // completat" și "nu se desfășoară nicio activitate acolo".
    CAEN_SEDIU: state.caenSediu.length > 0
      ? state.caenSediu.map(cod => ({ CAEN: cod, CAEN_DESC: descFor(cod) }))
      : [{ CAEN: '', CAEN_DESC: 'FĂRĂ ACTIVITATE*' }],
    CAEN_TERTI: state.caenTerti.map(cod => ({ CAEN: cod, CAEN_DESC: descFor(cod) })),
    SEDII_SECUNDARE: state.sediiSecundare
      .filter(row => row.adresa || row.caenCodes.length > 0)
      .flatMap((row, i) => {
        const nrCrt = String(i + 1)
        // Un rând de tabel per (adresă, cod CAEN) — dacă un sediu secundar nu
        // are încă niciun cod bifat, tot apare un rând (cu CAEN gol), ca
        // adresa să nu se piardă din document. Adresa (și nr. crt) apar o
        // singură dată, pe primul rând CAEN al sediului — rândurile
        // următoare, pentru celelalte coduri de la aceeași adresă, le lasă
        // goale, ca într-un tabel ONRC obișnuit.
        return (row.caenCodes.length > 0 ? row.caenCodes : ['']).map((cod, ci) => ({
          NR_CRT: ci === 0 ? nrCrt : '', ADRESA: ci === 0 ? row.adresa : '', CAEN: cod, CAEN_DESC: descFor(cod),
        }))
      }),
  }

  return { replacements, rowGroups }
}
