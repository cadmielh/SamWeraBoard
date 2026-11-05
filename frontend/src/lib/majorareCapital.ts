import type { Persoana } from '../types'
import { parsePercent } from './cota'

export interface AportInput { nume: string; aport: number }

export type MajorareMultiResult =
  | { ok: false; error: string }
  | {
    ok: true
    capitalNou: number
    partiNoiTotal: number
    /** Câte un rând per asociat care aportă — rândurile blocului {{#APORTURI}} din Hotărârea AGA. */
    aporturi: { nume: string; aport: number; partiAport: number; cotaNoua: number }[]
    /** Cota nouă a fiecărui asociat (și a celor fără aport, a căror cotă scade proporțional). */
    structura: { nume: string; partiNoi: number; cotaNoua: number }[]
  }

export const numeAsociat = (a: Persoana) => `${a.nume} ${a.prenume}`.trim()

/** Majorare de capital cu aport de la unul sau mai mulți asociați: fiecare primește aport / valoareParte părți
 * noi, ceilalți își păstrează numărul de părți, iar cotele tuturor se recalculează la capitalul nou. */
export function calculeazaMajorareMulti(
  asociati: Persoana[], capitalVechi: number, aporturi: AportInput[], valoareParte: number,
): MajorareMultiResult {
  if (aporturi.length === 0) return { ok: false, error: 'Adaugă cel puțin un asociat care aportă.' }
  const vazuti = new Set<string>()
  for (const a of aporturi) {
    if (!a.nume) return { ok: false, error: 'Alege asociatul pentru fiecare aport.' }
    if (vazuti.has(a.nume)) return { ok: false, error: `${a.nume} apare de două ori — adună aporturile pe un singur rând.` }
    vazuti.add(a.nume)
    if (!(a.aport > 0)) return { ok: false, error: `Completează aportul lui ${a.nume} (în RON, mai mare ca 0).` }
    if (a.aport % valoareParte !== 0) {
      return { ok: false, error: `Aportul lui ${a.nume} (${a.aport} RON) nu se împarte exact în părți sociale de ${valoareParte} RON.` }
    }
  }
  const capitalNou = capitalVechi + aporturi.reduce((s, a) => s + a.aport, 0)
  const partiNoiTotal = capitalNou / valoareParte
  const aportDupaNume = new Map(aporturi.map(a => [a.nume, a.aport]))
  const structura = asociati.map(a => {
    const nume = numeAsociat(a)
    const partiVechi = Math.round(capitalVechi * parsePercent(a.cotaParticipare) / 100 / valoareParte)
    const partiNoi = partiVechi + (aportDupaNume.get(nume) ?? 0) / valoareParte
    return { nume, partiNoi, cotaNoua: partiNoi / partiNoiTotal * 100 }
  })
  return {
    ok: true, capitalNou, partiNoiTotal, structura,
    aporturi: aporturi.map(a => ({
      nume: a.nume, aport: a.aport, partiAport: a.aport / valoareParte,
      cotaNoua: structura.find(s => s.nume === a.nume)?.cotaNoua ?? 0,
    })),
  }
}
