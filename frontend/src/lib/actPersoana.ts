/** Datele citite dintr-un act păstrat în documentele clientului (OCR) aplicate unei persoane din fișă: persoana existentă
 * potrivită (după nume sau după ultimele cifre ale CNP-ului) ori o persoană nouă. Modificarea se salvează apoi prin
 * update-ul obișnuit al clientului, care trece CNP-ul și seria prin vault (sanitizeForSave). */
import type { IDFields } from './api'
import type { Client, Persoana } from '../types'
import { inferTipClient } from '../types'
import { maskSerie, normalizeCnp, normalizeSerie, type PiiMap } from './pii'
import { normalizeazaCautare } from './fisiere'
import { adaugaAsociat, cotaCuProcent, equalShare, parsePercent } from './cota'

export type ListaPersoane = 'titular' | 'membriIF' | 'asociati' | 'administratori'

/** O persoană din fișă, cu locul ei (lista și poziția). */
export interface Intrare { lista: ListaPersoane; index: number; p: Persoana; eticheta: string }

/** Unde se aplică datele: o intrare existentă sau o persoană nouă în lista dată. */
export type Tinta = { fel: 'existenta'; lista: ListaPersoane; index: number } | { fel: 'noua'; lista: ListaPersoane }

const ROL: Record<ListaPersoane, string> = { titular: 'titular', membriIF: 'membru IF', asociati: 'asociat', administratori: 'administrator' }

const norm = (s: string) => normalizeazaCautare(s).replace(/\s+/g, ' ')
const numeComplet = (p: Pick<Persoana, 'nume' | 'prenume'>) => norm(`${p.nume} ${p.prenume}`)
// Fără CNP-ul în clar, se compară ultimele 4 cifre (singurele vizibile în varianta mascată, oricare i-ar fi formatul).
const ultimele4 = (v: string | undefined) => (v ?? '').replace(/\D/g, '').slice(-4)

/** Listele de persoane care există pentru tipul clientului: PF — titularul (și membrii, la IF); PJ — asociații și
 * administratorii. Alte liste rămase în date (ex. „asociați” la un PFA) nu se afișează în fișă, deci nici nu se ating. */
export function listeValabile(c: Partial<Client>): ListaPersoane[] {
  if (inferTipClient(c) === 'PF') return c.subtipPF === 'IF' ? ['titular', 'membriIF'] : ['titular']
  return ['asociati', 'administratori']
}

export function intrari(c: Partial<Client>): Intrare[] {
  const out: Intrare[] = []
  const adauga = (lista: ListaPersoane, persoane: Persoana[]) => persoane.forEach((p, index) => out.push({
    lista, index, p, eticheta: `${[p.prenume, p.nume].filter(Boolean).join(' ') || 'Fără nume'} (${ROL[lista]})`,
  }))
  for (const lista of listeValabile(c)) {
    if (lista === 'titular') { if (c.titular) adauga('titular', [c.titular]) }
    else adauga(lista, c[lista] ?? [])
  }
  return out
}

/** Persoana din fișă e cea din act? CNP-ul complet decide când e cunoscut; altfel numele trebuie să coincidă și, dacă
 * ambele au CNP (cel din act și varianta mascată din fișă), și ultimele 4 cifre. Doar numele (fără CNP de comparat)
 * ajunge pentru o propunere, pe care utilizatorul o confirmă. */
export function aceeasiPersoana(p: Persoana, f: Pick<IDFields, 'cnp' | 'nume' | 'prenume'>): boolean {
  const cnp = normalizeCnp(f.cnp)
  const pCnp = normalizeCnp(p.cnp)
  if (cnp && pCnp) return cnp === pCnp
  const numeEgal = !!numeComplet(p) && numeComplet(p) === numeComplet(f)
  const masca = ultimele4(p.cnpMasked)
  if (cnp.length === 13 && masca.length === 4) return numeEgal && masca === cnp.slice(-4)
  return numeEgal
}

/** Două intrări din fișă sunt aceeași persoană (ex. asociat și administrator)? Mai strict decât potrivirea cu actul:
 * același pid, același CNP sau același nume ȘI aceleași ultime cifre ale CNP-ului. Doi oameni cu același nume
 * (tată și fiu) nu se confundă. */
function aceeasiInFisa(a: Persoana, b: Persoana): boolean {
  if (a === b || (!!a.pid && a.pid === b.pid)) return true
  if (a.cnp && b.cnp) return normalizeCnp(a.cnp) === normalizeCnp(b.cnp)
  const ma = ultimele4(a.cnpMasked)
  return ma.length === 4 && ma === ultimele4(b.cnpMasked) && !!numeComplet(a) && numeComplet(a) === numeComplet(b)
}

/** Ținta propusă: prima persoană potrivită; altfel o persoană nouă (asociat la PJ, titular la PF fără titular). */
export function tintaPropusa(c: Partial<Client>, f: IDFields): Tinta {
  const gasit = intrari(c).find(i => aceeasiPersoana(i.p, f))
  if (gasit) return { fel: 'existenta', lista: gasit.lista, index: gasit.index }
  return { fel: 'noua', lista: inferTipClient(c) === 'PF' && !c.titular ? 'titular' : inferTipClient(c) === 'PF' ? 'membriIF' : 'asociati' }
}

/** Listele în care se poate adăuga o persoană nouă, după tipul clientului. */
export function listeNoi(c: Partial<Client>): ListaPersoane[] {
  if (inferTipClient(c) !== 'PF') return ['asociati', 'administratori']
  return [...(c.titular ? [] : ['titular' as const]), ...(c.subtipPF === 'IF' ? ['membriIF' as const] : [])]
}

export const etichetaNoua = (l: ListaPersoane) => `Persoană nouă: ${ROL[l]}`

const CAMPURI_ACT = ['nume', 'prenume', 'data_nasterii', 'locul_nasterii', 'cetatenia', 'adresa', 'judet', 'emisa_de',
  'valabila_de_la', 'valabila_pana_la'] as const

/** Persoana cu datele din act. Un câmp pe care OCR-ul nu l-a citit (gol) păstrează valoarea din fișă. CNP-ul și seria se
 * trimit spre vault mereu împreună, deci doar când le știm pe amândouă: cele din act, completate cu cele actuale (`vechi`,
 * aduse din vault). Fără `vechi`, la o persoană salvată ele nu se ating (altfel una necitită s-ar șterge). */
function cuDateleActului(p: Persoana, f: IDFields, vechi?: { cnp: string; serie_numar: string }): Persoana {
  const out: Persoana = { ...p }
  for (const k of CAMPURI_ACT) if (f[k]) out[k] = f[k]
  const cunoscute = vechi ?? (!p.pid || p.piiLoaded ? { cnp: p.cnp, serie_numar: p.serie_numar } : null)
  if (cunoscute) {
    out.cnp = f.cnp || cunoscute.cnp
    out.serie_numar = f.serie_numar || cunoscute.serie_numar
    out.piiLoaded = true
  }
  return out
}

/** Modificarea clientului. La o persoană existentă se actualizează și celelalte roluri ale aceleiași persoane (de ex.
 * asociat și administrator); rolul, cota, mandatul și sexul ales rămân. Celelalte persoane nu se ating. */
export function aplicaAct(c: Partial<Client>, tinta: Tinta, f: IDFields, cota = '', pii?: PiiMap): Partial<Client> {
  const patch: Partial<Client> = {}
  if (tinta.fel === 'noua') {
    // Aceleași calități implicite ca la adăugarea manuală din fișă (ClientModal).
    const calitate = tinta.lista === 'administratori' ? 'Administrator' : tinta.lista === 'asociati' ? 'Asociat'
      : tinta.lista === 'titular' || !(c.membriIF ?? []).length ? 'Titular' : 'Membru IF'
    const noua = cuDateleActului({ calitate, cotaParticipare: tinta.lista === 'asociati' ? cotaCuProcent(cota) : '' } as Persoana, f)
    delete noua.piiLoaded       // persoană nouă: fără pid, deci CNP-ul pleacă oricum spre vault
    if (tinta.lista === 'titular') patch.titular = noua
    else if (tinta.lista === 'asociati') patch.asociati = adaugaAsociat(c.asociati ?? [], noua)
    else patch[tinta.lista] = [...(c[tinta.lista] ?? []), noua]
    return patch
  }
  const ales = intrari(c).find(i => i.lista === tinta.lista && i.index === tinta.index)
  if (!ales) return patch
  const aceeasi = (p: Persoana) => aceeasiInFisa(p, ales.p)
  const cu = (p: Persoana) => cuDateleActului(p, f, p.pid ? pii?.[p.pid] : undefined)
  const valabile = listeValabile(c)
  if (valabile.includes('titular') && c.titular && aceeasi(c.titular)) patch.titular = cu(c.titular)
  for (const l of (['membriIF', 'asociati', 'administratori'] as const).filter(x => valabile.includes(x))) {
    const lista = c[l] ?? []
    if (lista.some(aceeasi)) patch[l] = lista.map(p => aceeasi(p) ? cu(p) : p)
  }
  return patch
}

const CAMPURI: [keyof IDFields, string][] = [
  ['nume', 'numele'], ['prenume', 'prenumele'], ['data_nasterii', 'data nașterii'], ['locul_nasterii', 'locul nașterii'],
  ['cetatenia', 'cetățenia'], ['adresa', 'adresa'], ['judet', 'județul'], ['emisa_de', 'emitentul actului'],
  ['valabila_de_la', 'valabil de la'], ['valabila_pana_la', 'valabil până la'],
]
const egal = (a: string | undefined, b: string | undefined) => norm(a ?? '') === norm(b ?? '')

/** Ce s-ar schimba la persoana existentă (etichete românești), ca utilizatorul să vadă înainte și după salvare. CNP-ul și
 * seria se compară prin variantele mascate (cele în clar nu sunt încărcate în fișă). Persoană nouă: listă goală. */
export function diferente(c: Partial<Client>, tinta: Tinta, f: IDFields): string[] {
  if (tinta.fel !== 'existenta') return []
  const p = intrari(c).find(i => i.lista === tinta.lista && i.index === tinta.index)?.p
  if (!p) return []
  const out: string[] = []
  const cnp = normalizeCnp(f.cnp)
  if (cnp && (p.cnp ? normalizeCnp(p.cnp) !== cnp : ultimele4(p.cnpMasked) !== cnp.slice(-4))) out.push('CNP')
  const serie = normalizeSerie(f.serie_numar)
  if (serie && (p.serie_numar ? normalizeSerie(p.serie_numar) !== serie : (p.serieMasked ?? '') !== maskSerie(serie))) out.push('seria actului')
  for (const [k, eticheta] of CAMPURI) if (f[k] && !egal(p[k as keyof Persoana] as string, f[k])) out.push(eticheta)
  return out
}

/** Eticheta persoanei țintă, pentru mesaje („Ion Popescu (asociat)” sau „asociat nou”). */
export function etichetaTinta(c: Partial<Client>, tinta: Tinta): string {
  if (tinta.fel === 'noua') return `${ROL[tinta.lista]} nou`
  return intrari(c).find(i => i.lista === tinta.lista && i.index === tinta.index)?.eticheta ?? ROL[tinta.lista]
}

/** Cota propusă pentru un asociat nou: partea egală, ca la adăugarea manuală (ex. 50% pentru al doilea asociat). */
export function cotaPropusa(c: Partial<Client>): string {
  return equalShare((c.asociati?.length ?? 0) + 1)
}

/** O cotă introdusă e validă: un procent mai mare ca 0 și cel mult 100. */
export function cotaValida(v: string): boolean {
  const n = parsePercent(v)
  return /\d/.test(v) && n > 0 && n <= 100
}
