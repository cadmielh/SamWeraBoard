/** Câmpuri completate automat — din ANAF (fișa clientului, formularul de firmă nouă) sau din buletinul scanat (fereastra
 * persoanei) —, evidențiate până le editează utilizatorul, ca să știe ce să verifice. Statusurile fiscale ANAF (TVA,
 * inactiv, e-Factura) nu sunt aici: au banda lor. */
export const CAMPURI_ANAF = [
  'denumire', 'formaJuridica', 'nrRegistrul', 'dataInmatricularii', 'caenCod', 'caenSecundare', 'sediuSocial', 'telefon',
] as const

export const CAMPURI_BULETIN = [
  'cnp', 'serie_numar', 'nume', 'prenume', 'data_nasterii', 'locul_nasterii', 'cetatenia', 'adresa', 'judet', 'emisa_de',
  'valabila_de_la', 'valabila_pana_la',
] as const

/** Doar câmpurile a căror valoare s-a schimbat: unul deja identic cu sursa nu e „completat” de ea. */
export function campuriSchimbate(inainte: object, dupa: object, campuri: readonly string[] = CAMPURI_ANAF): string[] {
  const a = inainte as Record<string, unknown>, b = dupa as Record<string, unknown>
  return campuri.filter(k => k in b && JSON.stringify(a[k] ?? '') !== JSON.stringify(b[k] ?? ''))
}

export function mesajCompletare(n: number, sursa: 'ANAF' | 'buletin' = 'ANAF'): string {
  if (n === 0) return sursa === 'ANAF' ? 'Datele din ANAF coincid cu cele din formular.' : 'Datele din buletin coincid cu cele din formular.'
  return n === 1 ? `Un câmp completat din ${sursa} — verifică-l.` : `${n} câmpuri completate din ${sursa} — verifică-le.`
}
