/** Versiunile curente ale documentelor legale acceptate la crearea unui spațiu
 * de lucru. Trebuie ținute în sync cu TOS_VERSION / DPA_VERSION din
 * legal_versions.py — serverul respinge orice altă versiune. Se schimbă la
 * fiecare revizuire a textelor (paginile din pages/legal/). */
export const TOS_VERSION = '2026-11-24'
export const DPA_VERSION = '2026-11-24'

/** Ce s-a schimbat în versiunea curentă, pe scurt: arătat administratorilor care au acceptat o versiune anterioară
 * (ConsentGate). Se rescrie la fiecare revizuire a textelor. */
export const SCHIMBARI_LEGALE = 'Am adăugat păstrarea documentelor clienților: actele și fișierele pe care le încărcați în fișa unui client se '
  + 'stochează criptat, cu cheia cabinetului, în Uniunea Europeană (Frankfurt), până le ștergeți. Scanarea actelor nu păstrează, în continuare, imaginile.'

/** Workspace-ul a acceptat versiunile curente ale termenilor și DPA? */
export function hasCurrentConsent(consent: { tos?: string; dpa?: string } | undefined | null): boolean {
  return !!consent && consent.tos === TOS_VERSION && consent.dpa === DPA_VERSION
}
