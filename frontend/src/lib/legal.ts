/** Versiunile curente ale documentelor legale acceptate la crearea unui spațiu
 * de lucru. Trebuie ținute în sync cu TOS_VERSION / DPA_VERSION din
 * legal_versions.py — serverul respinge orice altă versiune. Se schimbă la
 * fiecare revizuire a textelor (paginile din pages/legal/). */
export const TOS_VERSION = '2026-09-18'
export const DPA_VERSION = '2026-09-18'

/** Workspace-ul a acceptat versiunile curente ale termenilor și DPA? */
export function hasCurrentConsent(consent: { tos?: string; dpa?: string } | undefined | null): boolean {
  return !!consent && consent.tos === TOS_VERSION && consent.dpa === DPA_VERSION
}
