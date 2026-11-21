// Adresa spațiului dintr-un contract de comodat/închiriere sau proces-verbal ({{CAMP_ADRESA_SPATIU}},
// {{CAMP_ADRESA_IMOBIL}}): se alege dintre sediul social și punctele de lucru ale clientului sau se scrie una nouă.
// O adresă nouă se propune după generare ca punct de lucru în fișă (dacă documentul nu e pentru sediul social).
import type { Client } from '../types'
import type { ClientPatchProposal } from './clauseFieldSpecs'
import { formatAdresa } from './adresa'

export const isAdresaSpatiu = (ph: string): boolean => /^\{\{CAMP_ADRESA_(SPATIU|IMOBIL)(_[A-Z0-9_]+)?\}\}$/.test(ph)

export type FelAdresa = 'sediu' | 'punct'
export interface OptiuneAdresa { fel: FelAdresa; adresa: string }

export function optiuniAdresa(client: Partial<Client> | null | undefined): OptiuneAdresa[] {
  const out: OptiuneAdresa[] = []
  const sediu = client?.sediuSocial ? formatAdresa(client.sediuSocial) : ''
  if (sediu.trim()) out.push({ fel: 'sediu', adresa: sediu })
  for (const p of client?.puncteLucru ?? []) if (p?.trim()) out.push({ fel: 'punct', adresa: p })
  return out
}

/** Forma de comparat a unei adrese: fără diacritice, majuscule și punctuație, cu prescurtările uzuale aduse la aceeași
 * formă („Strada Mică nr. 2” = „str mica 2”). Doar pentru recunoaștere; adresa rămâne scrisă cum e în fișă. */
const ABREVIERI: [RegExp, string][] = [
  [/\b(strada|str)\b/g, 'str'], [/\b(numarul|numar|nr)\b/g, ''], [/\b(bulevardul|bulevard|bd|bdul|b dul)\b/g, 'bd'],
  [/\b(calea|cal)\b/g, 'cal'], [/\b(soseaua|sos)\b/g, 'sos'], [/\b(aleea|al)\b/g, 'al'], [/\b(piata|pta)\b/g, 'pta'],
  [/\b(judetul|judet|jud)\b/g, 'jud'], [/\b(municipiul|mun)\b/g, 'mun'], [/\b(orasul|oras)\b/g, 'oras'],
  [/\b(comuna|com)\b/g, 'com'], [/\b(satul|sat)\b/g, 'sat'], [/\b(blocul|bloc|bl)\b/g, 'bl'], [/\b(scara|sc)\b/g, 'sc'],
  [/\b(etajul|etaj|et)\b/g, 'et'], [/\b(apartamentul|apartament|ap)\b/g, 'ap'], [/\b(sectorul|sector|sect)\b/g, 'sector'],
]
export function normAdresa(s: string): string {
  let n = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,;:()"'„”-]/g, ' ')
  for (const [re, v] of ABREVIERI) n = n.replace(re, v)
  return n.replace(/\s+/g, ' ').trim()
}
const norm = normAdresa

/** Felul adresei scrise: din fișă (sediu/punct), nouă, sau null cât e goală. */
export function felAdresa(adresa: string, optiuni: OptiuneAdresa[]): FelAdresa | 'noua' | null {
  if (!adresa.trim()) return null
  return optiuni.find(o => norm(o.adresa) === norm(adresa))?.fel ?? 'noua'
}

/** Destinația potrivită adresei alese ({{BIFA_DESTINATIE_…}}), când documentul are o asemenea alegere. */
export const DESTINATIE_DUPA_ADRESA: Record<FelAdresa, string> = { sediu: 'SEDIU_SOCIAL', punct: 'PUNCT_DE_LUCRU' }

export function propunerePunctLucru(adresa: string): ClientPatchProposal {
  const a = adresa.trim()
  return {
    label: `Punct de lucru nou: ${a}`,
    patch: {},
    update: current => {
      const puncte = current.puncteLucru ?? []
      return puncte.some(p => norm(p) === norm(a)) ? {} : { puncteLucru: [...puncte, a] }
    },
  }
}
