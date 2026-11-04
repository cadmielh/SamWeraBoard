import type { Sex } from './sex'

/** Forme masculine care nu se obțin doar prin eliminarea lui „ă” final. */
const MASC_EXCEPTIONS: Record<string, string> = { 'greacă': 'grec' }

/** Un singur cuvânt terminat în „ă” („Română”, „MOLDOVEANĂ”): adjectivul de cetățenie, la feminin. */
const ADJ_RE = /^\p{L}+ă$/iu

/** Cetățenia ca în textul unui act, după „cetățenia …”: adjectivul cu literă mică („Română” → „română”).
 * Orice altă formă (mai multe cuvinte, cod de țară, nume de stat) rămâne exact cum e în fișă. */
export function cetatenieText(value: string | null | undefined): string {
  const v = (value ?? '').trim()
  return ADJ_RE.test(v) ? v.toLocaleLowerCase('ro-RO') : v
}

/** Cetățenia acordată cu persoana, după „cetățean …”: „român” pentru un bărbat, „română” pentru o femeie.
 * Fără sex cunoscut se folosește masculinul, ca substantivul „cetățean” din text. O valoare care nu e
 * un adjectiv recunoscut rămâne neschimbată. */
export function cetatenieAcord(value: string | null | undefined, sex: Sex | null): string {
  const fem = cetatenieText(value)
  if (!ADJ_RE.test(fem) || sex === 'F') return fem
  return MASC_EXCEPTIONS[fem] ?? fem.slice(0, -1)
}
