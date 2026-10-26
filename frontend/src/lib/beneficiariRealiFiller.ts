// Logică pură (fără JSX) pentru completarea șablonului DOCX „Declarație
// Beneficiari Reali" (Formular ONRC nr. 3, Legea 129/2019) — asamblarea
// valorilor editate de user în BeneficiariRealiFiller, în `replacements` +
// `groups.BENEFICIARI_REALI` pentru /fill/docx. Vezi anexa1Filler.ts pentru
// același model (formular dedicat, nu placeholdere generice/clauze).
import type { Client } from '../types'
import { splitSerieNumar } from './adresa'
import { persoanaToSingularMap } from './placeholders'
import { EMPTY_PERSOANA } from './clienti'

export interface BrxReprezentantCandidate {
  label: string
  nume: string
  prenume: string
}

/** Candidați pentru „Subsemnatul(a)" (IV) — administratorii firmei. Șablonul e
 * strict PJ (structura asociați/administratori), spre deosebire de Anexa 1 care
 * are și variantă PF. */
export function reprezentantCandidatesBrx(client?: Partial<Client> | null): BrxReprezentantCandidate[] {
  const seen = new Set<string>()
  const out: BrxReprezentantCandidate[] = []
  for (const p of client?.administratori ?? []) {
    const label = `${p.nume ?? ''} ${p.prenume ?? ''}`.trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push({ label, nume: p.nume ?? '', prenume: p.prenume ?? '' })
  }
  return out
}

export const BRX_TIP_DECLARATIE_OPTIONS = [
  { value: 'inmatriculare', label: 'Înmatriculare', tag: 'BIF_INMATRICULARE' },
  { value: 'modificare', label: 'Modificare', tag: 'BIF_MODIFICARE' },
  { value: 'eroare_material', label: 'Eroare materială', tag: 'BIF_EROARE_MATERIAL' },
  { value: 'anuala', label: 'Anuală (art. 56 alin. (13))', tag: 'BIF_ANUALA' },
  { value: 'art56_14', label: 'Art. 56 alin. (14) — firme înmatriculate anterior legii', tag: 'BIF_ART56_14' },
  { value: 'regii_autonome', label: 'Regii autonome / societăți de stat (OUG 123/2022)', tag: 'BIF_REGII_AUTONOME' },
] as const

export type BrxTipDeclaratie = typeof BRX_TIP_DECLARATIE_OPTIONS[number]['value']

export const BRX_TEMEI_OPTIONS = [
  { value: 'a1', label: 'art. 4 alin. (2) lit. a), pct. 1' },
  { value: 'a2', label: 'art. 4 alin. (2) lit. a), pct. 2' },
  { value: 'd1', label: 'art. 4 alin. (2) lit. d), pct. 1' },
  { value: 'd2', label: 'art. 4 alin. (2) lit. d), pct. 2' },
  { value: 'd3', label: 'art. 4 alin. (2) lit. d), pct. 3' },
  { value: 'd4', label: 'art. 4 alin. (2) lit. d), pct. 4' },
] as const

export type BrxTemei = typeof BRX_TEMEI_OPTIONS[number]['value']

export interface BrxBeneficiarRow {
  asociatIndex: number
  temei: BrxTemei
  descriere: string
}

export interface BeneficiariRealiFormState {
  tipDeclaratie: BrxTipDeclaratie | null
  reprezentantIndex: number | null
  beneficiari: BrxBeneficiarRow[]
  email: string
  telefon: string
}

export const EMPTY_BRX_STATE: BeneficiariRealiFormState = {
  tipDeclaratie: 'modificare',
  reprezentantIndex: null,
  beneficiari: [],
  email: '',
  telefon: '',
}

export const EMPTY_BRX_BENEFICIAR_ROW = (asociatIndex: number): BrxBeneficiarRow => ({
  asociatIndex,
  temei: BRX_TEMEI_OPTIONS[0].value,
  descriere: 'ÎN MOD DIRECT',
})

const BIFA = { da: '✔', nu: '☐' } as const
const bif = (checked: boolean) => (checked ? BIFA.da : BIFA.nu)

export interface BrxDocxData {
  replacements: Record<string, string>
  groups: Record<string, Record<string, string>[]>
}

/** Asamblează replacements (bifele II, reprezentantul legal IV/V/VI, EUID, email/telefon) și
 * groups.BENEFICIARI_REALI (câte un item per beneficiar real ales, mapat din client.asociati, cu
 * persoanaToSingularMap — aceeași funcție folosită deja pentru {{#ASOCIATI}}/{{#ADMINISTRATORI}} — plus
 * bifele de temei legal) — pornind din starea editată de user. Nu setează {{SOCIETATE_DENUMIRE}}/
 * {{SOCIETATE_NR_REG}}/{{SOCIETATE_CIF}}/{{SOCIETATE_JUDET}}/{{DATA_AZI}} — acelea vin din
 * buildReplacements() (lib/placeholders.ts), combinate de TemplateFiller cu rezultatul de aici înainte de
 * /fill/docx. */
export function buildBeneficiariRealiDocxData(
  state: BeneficiariRealiFormState, client?: Partial<Client> | null,
): BrxDocxData {
  const replacements: Record<string, string> = {}
  const set = (key: string, value: string) => { replacements[`{{${key}}}`] = value || ' ' }

  for (const opt of BRX_TIP_DECLARATIE_OPTIONS) {
    set(opt.tag, bif(state.tipDeclaratie === opt.value))
  }

  const candidates = reprezentantCandidatesBrx(client)
  const reprezentant = state.reprezentantIndex != null ? candidates[state.reprezentantIndex] : undefined
  const administratori = client?.administratori ?? []
  const reprezentantPersoana = state.reprezentantIndex != null ? administratori[state.reprezentantIndex] : undefined
  const { serie: repSerie, numar: repNr } = splitSerieNumar(reprezentantPersoana?.serie_numar)
  set('REPREZENTANT_NUME', reprezentant?.nume ?? '')
  set('REPREZENTANT_PRENUME', reprezentant?.prenume ?? '')
  set('REPREZENTANT_NUME_COMPLET', reprezentant?.label ?? '')
  set('REPREZENTANT_SERIE_ACT', repSerie)
  set('REPREZENTANT_NR_ACT', repNr)
  set('REPREZENTANT_CNP', reprezentantPersoana?.cnp ?? '')

  set('SOCIETATE_EUID', client?.nrRegistrul ? `ROONRC.${client.nrRegistrul}` : '')

  set('REPREZENTANT_EMAIL', state.email)
  set('REPREZENTANT_TELEFON', state.telefon)

  const asociati = client?.asociati ?? []
  const groups: Record<string, Record<string, string>[]> = {
    BENEFICIARI_REALI: state.beneficiari.map(row => {
      // `asociatIndex` poate rămâne "stale" dacă lista de asociați a clientului s-a schimbat între
      // momentul adăugării rândului și generare — fallback la EMPTY_PERSOANA (nu {}), ca toate
      // cheile {{NUME}}/{{CNP}}/etc. din blocul repetitiv să existe (altfel ar rămâne literal
      // {{...}} în document — același motiv ca la splitDigitBoxes/anexa1Filler.ts).
      const p = asociati[row.asociatIndex]
      const item: Record<string, string> = p
        ? { ...persoanaToSingularMap(p), CETATENIA: p.cetatenia || 'română' }
        : { ...persoanaToSingularMap(EMPTY_PERSOANA), NUME: '(asociat indisponibil)' }
      item.DESCRIERE_CONTROL = row.descriere || ' '
      for (const opt of BRX_TEMEI_OPTIONS) {
        item[`BIF_CONTROL_${BRX_TEMEI_OPTIONS.findIndex(o => o.value === opt.value) + 1}`] = bif(row.temei === opt.value)
      }
      return item
    }),
  }

  return { replacements, groups }
}

export const BRX_KEY = 'declaratie_beneficiari_reali'

/** Șablonul e Declarație Beneficiari Reali (cel de bază, sau o copie din bibliotecă a lui). */
export function isBeneficiariRealiTemplate(tpl: { sourceKey?: string; key?: string }): boolean {
  return tpl.sourceKey === BRX_KEY || tpl.key === BRX_KEY
}
