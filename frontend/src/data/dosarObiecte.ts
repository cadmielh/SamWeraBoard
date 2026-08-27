// Sugestii pentru "Obiectul cererii" — text liber (ca în registrul xlsx), dar
// cu sugestii curate; cele cu `clauseTag` se potrivesc cu o clauză cunoscută
// din CLAUSE_FIELD_SPECS (lib/clauseFieldSpecs.ts) și activează butonul
// "Generează documente" din DosarView.

export interface ObiectCererieOption {
  label: string
  clauseTag?: string
}

export const OBIECT_CERERE_OPTIONS: ObiectCererieOption[] = [
  { label: 'Cesiune părți sociale', clauseTag: 'CESIUNE_PARTI_SOCIALE' },
  { label: 'Adăugare cod CAEN', clauseTag: 'ADAUGARE_COD_CAEN' },
  { label: 'Schimbare cod CAEN principal', clauseTag: 'SCHIMBARE_COD_CAEN_PRINCIPAL' },
  { label: 'Schimbare administrator', clauseTag: 'SCHIMBARE_ADMINISTRATOR' },
  { label: 'Închidere punct de lucru', clauseTag: 'INCHIDERE_PUNCT_DE_LUCRU' },
  { label: 'Majorare capital social', clauseTag: 'MAJORARE_CAPITAL_SOCIAL' },
  // Fără clauză corespondentă — text liber, fără buton de generare documente.
  { label: 'Autorizare cod CAEN' },
  { label: 'Prelungire puncte de lucru' },
  { label: 'Certificat constatator' },
  { label: 'Actualizare coduri CAEN Rev 3' },
  { label: 'Schimbare sediu social' },
  { label: 'Schimbare denumire' },
  { label: 'Înmatriculare' },
  { label: 'Radiere' },
]

export function findClauseTag(label: string): string | undefined {
  return OBIECT_CERERE_OPTIONS.find(o => o.label.toLowerCase() === label.trim().toLowerCase())?.clauseTag
}
