/**
 * Sursă unică de adevăr pentru cele 4 clauze cu widget dedicat (Cesiune, CAEN
 * nou, CAEN principal nou, Schimbare administrator) — scrisă direct din
 * tabelul "text vechi → placeholder nou" folosit la editarea celor 2 șabloane
 * de bază din fisiere_template/. Cheile sunt tag-urile exacte raportate de
 * backend (list_clauses_in_docx — vezi doc_filler.py:_slugify_clause).
 *
 * `ClauseSelector` verifică, înainte de a randa un widget, că toate `fields`
 * (+ `groupFields`, dacă există `groupName`) chiar apar în
 * tpl.clauses[].placeholders pentru șablonul curent — dacă cineva a redenumit
 * un placeholder editând o copie proprie, widget-ul dedicat nu se randează,
 * cade automat pe randarea generică (un input text per placeholder găsit).
 */

export type ClauseWidget = 'cesiune' | 'caenList' | 'caenSingle' | 'administrator' | 'punctLucruClose' | 'majorareCapital'

export interface ClauseFieldSpec {
  /** Placeholdere plate pe care widget-ul le completează direct. */
  fields: string[]
  /** Numele blocului repetitiv imbricat în clauză, dacă are unul. */
  groupName?: string
  /** Câmpurile unui rând din acel bloc repetitiv. */
  groupFields?: string[]
  widget: ClauseWidget
}

/** O propunere de actualizare a profilului clientului, derivată din datele
 * completate într-o clauză — afișată userului într-un dialog de confirmare
 * după generarea documentului, aplicată doar dacă o bifează explicit. */
export interface ClientPatchProposal {
  /** Rând afișat în dialogul de confirmare, ex. "Sediul social nou: ...". */
  label: string
  /** Aplicat via useClienti().update(workspaceId, client.id, patch). */
  patch: Partial<import('./clienti').ClientInput>
}

export const CLAUSE_FIELD_SPECS: Record<string, ClauseFieldSpec> = {
  CESIUNE_PARTI_SOCIALE: {
    fields: ['CEDENT_NUME', 'CESIONAR_NUME', 'NR_PARTI_CEDATE', 'VALOARE_NOMINALA', 'DATA_CONTRACT_CESIUNE'],
    groupName: 'STRUCTURA_REZULTATA',
    // Aceleași nume ca în blocul {{#ASOCIATI}} deja existent (CAPITAL_SOCIAL,
    // PARTI_SOCIALE, COTA_PARTICIPARE) — nu sinonime noi (SUMA/PARTI/PROCENT).
    groupFields: ['NUME', 'CAPITAL_SOCIAL', 'PARTI_SOCIALE', 'COTA_PARTICIPARE'],
    widget: 'cesiune',
  },
  ADAUGARE_COD_CAEN: {
    fields: [],
    groupName: 'COD_CAEN_NOU',
    groupFields: ['CAEN'],
    widget: 'caenList',
  },
  SCHIMBARE_COD_CAEN_PRINCIPAL: {
    fields: ['CAEN_PRINCIPAL_NOU'],
    widget: 'caenSingle',
  },
  SCHIMBARE_ADMINISTRATOR: {
    fields: ['ADMINISTRATOR_VECHI_NUME', 'ADMINISTRATOR_NOU_NUME', 'DURATA_MANDAT_ANI'],
    widget: 'administrator',
  },
  INCHIDERE_PUNCT_DE_LUCRU: {
    fields: ['PUNCT_LUCRU_INCHIS_ADRESA'],
    widget: 'punctLucruClose',
  },
  MAJORARE_CAPITAL_SOCIAL: {
    fields: ['ASOCIAT_APORT_NUME', 'CAPITAL_SOCIAL_NOU', 'PARTI_SOCIALE_NOI', 'ASOCIAT_APORT_COTA_PARTICIPARE'],
    widget: 'majorareCapital',
  },
}

/** True doar dacă toate câmpurile așteptate de spec chiar apar în lista de
 * placeholdere raportată de backend pentru acea clauză — altfel widget-ul
 * dedicat n-ar avea unde scrie valorile completate. */
export function specMatchesClause(spec: ClauseFieldSpec, clausePlaceholders: string[]): boolean {
  const present = new Set(clausePlaceholders.map(p => p.replace(/^\{\{|\}\}$/g, '')))
  const expected = [...spec.fields, ...(spec.groupFields ?? [])]
  return expected.every(f => present.has(f))
}
