/** Cererile de documente (faza 4, docs/plan-documente-client.md): cabinetul cere actele, clientul le încarcă prin
 * link (pagina publică), cabinetul le verifică. Scrierile trec doar prin server (cereri_api.py); aici se citesc în
 * timp real, se construiesc propunerile de acte și mesajul de trimis. */
import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where, type DocumentData } from 'firebase/firestore'
import { db } from './firebase'
import { apiJson } from './api'
import { toDateSafe, formatDateRo } from './dates'
import { aceeasiInFisa, intrari } from './actPersoana'
import type { Client, Persoana } from '../types'
import { inferTipClient } from '../types'

export type TipAct = 'ci' | 'dovada_sediu' | 'altul'
export type StareAct = 'de_trimis' | 'primit' | 'acceptat' | 'respins'
export type StareCerere = 'deschisa' | 'completa' | 'anulata'

export interface ActCerere {
  id: string
  eticheta: string
  tip: TipAct
  stare: StareAct
  /** Fișierele trimise de client (id-uri în `fisiere`), cât actul e „primit”. */
  fisiere: string[]
  motiv?: string
  persoanaPid?: string
  primitLa: Date | null
}

export interface Cerere {
  id: string
  clientId: string
  clientNume: string
  mesaj: string
  acte: ActCerere[]
  stare: StareCerere
  deVerificat: number
  expiraLa: Date | null
  deschisaLa: Date | null
  creataLa: Date | null
}

/** Valabilitatea linkului, în zile (serverul acceptă 1–60). */
export const ZILE_VALABILITATE = [7, 14, 30] as const
export const ZILE_IMPLICIT = 14
export const MAX_ACTE = 20

export function cerereDinFirestore(id: string, d: DocumentData): Cerere {
  return {
    id,
    clientId: String(d.clientId ?? ''),
    clientNume: String(d.clientNume ?? ''),
    mesaj: String(d.mesaj ?? ''),
    acte: (Array.isArray(d.acte) ? d.acte : []).map((a: DocumentData) => ({
      id: String(a.id ?? ''),
      eticheta: String(a.eticheta ?? ''),
      tip: (['ci', 'dovada_sediu', 'altul'] as const).includes(a.tip) ? a.tip : 'altul',
      stare: (['de_trimis', 'primit', 'acceptat', 'respins'] as const).includes(a.stare) ? a.stare : 'de_trimis',
      fisiere: Array.isArray(a.fisiere) ? a.fisiere.map(String) : [],
      motiv: a.motiv ? String(a.motiv) : undefined,
      persoanaPid: a.persoanaPid ? String(a.persoanaPid) : undefined,
      primitLa: toDateSafe(a.primitLa),
    })),
    stare: d.stare === 'completa' || d.stare === 'anulata' ? d.stare : 'deschisa',
    deVerificat: Math.max(0, Number(d.deVerificat ?? 0)),
    expiraLa: toDateSafe(d.expiraLa),
    deschisaLa: toDateSafe(d.deschisaLa),
    creataLa: toDateSafe(d.creataLa),
  }
}

/** Cererea încă deschisă, dar cu linkul expirat: clientul nu mai poate încărca până la prelungire. */
export function expirata(c: Cerere, acum: Date = new Date()): boolean {
  return c.stare === 'deschisa' && !!c.expiraLa && c.expiraLa.getTime() <= acum.getTime()
}

/** Cererea are linkul activ (clientul poate încărca). */
export function activa(c: Cerere, acum: Date = new Date()): boolean {
  return c.stare === 'deschisa' && !expirata(c, acum)
}

/** Starea pe scurt, pentru lista cererilor unui client. */
export function stareCerere(c: Cerere, acum: Date = new Date()): { text: string; ton: 'ok' | 'info' | 'atentie' | 'stins' } {
  if (c.stare === 'anulata') return { text: 'Anulată', ton: 'stins' }
  if (c.stare === 'completa') return { text: 'Completă', ton: 'ok' }
  if (c.deVerificat > 0) return { text: c.deVerificat === 1 ? 'Un act de verificat' : `${c.deVerificat} acte de verificat`, ton: 'atentie' }
  if (expirata(c, acum)) return { text: 'Link expirat', ton: 'atentie' }
  return { text: c.deschisaLa ? 'Deschisă de client' : 'Trimisă, nedeschisă încă', ton: 'info' }
}

export const ETICHETA_STARE_ACT: Record<StareAct, string> = {
  de_trimis: 'Așteaptă', primit: 'De verificat', acceptat: 'Acceptat', respins: 'Respins',
}

function sorteaza(lista: Cerere[]): Cerere[] {
  return lista.sort((a, b) => (b.creataLa?.getTime() ?? 0) - (a.creataLa?.getTime() ?? 0))
}

/** Cererile unui client, cele mai noi primele, în timp real. */
export function useCereriClient(workspaceId: string | null, clientId: string) {
  const [stare, setStare] = useState<{ cheie: string; lista: Cerere[] } | null>(null)
  const cheie = `${workspaceId}/${clientId}`
  useEffect(() => {
    if (!workspaceId) return
    const q = query(collection(db, 'workspaces', workspaceId, 'cereriDocumente'), where('clientId', '==', clientId))
    return onSnapshot(q, snap => setStare({ cheie, lista: sorteaza(snap.docs.map(d => cerereDinFirestore(d.id, d.data()))) }),
      () => setStare({ cheie, lista: [] }))
  }, [workspaceId, clientId, cheie])
  return stare?.cheie === cheie ? stare.lista : null
}

/** „Documente primite”: cererile cu acte de verificat, la toți clienții cabinetului. */
export function useCereriDeVerificat(workspaceId: string | null) {
  const [stare, setStare] = useState<{ wid: string; lista: Cerere[] } | null>(null)
  useEffect(() => {
    if (!workspaceId) return
    const q = query(collection(db, 'workspaces', workspaceId, 'cereriDocumente'), where('deVerificat', '>', 0))
    return onSnapshot(q, snap => setStare({ wid: workspaceId, lista: sorteaza(snap.docs.map(d => cerereDinFirestore(d.id, d.data()))) }),
      () => setStare({ wid: workspaceId, lista: [] }))
  }, [workspaceId])
  return stare?.wid === workspaceId ? stare.lista : []
}

// ── Apeluri ──────────────────────────────────────────────────────────────────

export interface ActNou { eticheta: string; tip: TipAct; persoanaPid?: string }

export const creeazaCerere = (clientId: string, acte: ActNou[], mesaj: string, zile: number) =>
  apiJson<{ cerere: { id: string; expiraLa: string }; link: string }>('POST', '/cereri', { clientId, acte, mesaj, zile })
export const linkCerere = (id: string) => apiJson<{ link: string }>('GET', `/cereri/${encodeURIComponent(id)}/link`)
export const prelungesteCerere = (id: string, zile: number) =>
  apiJson('POST', `/cereri/${encodeURIComponent(id)}/prelungeste`, { zile })
export const anuleazaCerere = (id: string) => apiJson('POST', `/cereri/${encodeURIComponent(id)}/anuleaza`)
export const acceptaAct = (id: string, actId: string) =>
  apiJson('POST', `/cereri/${encodeURIComponent(id)}/acte/${encodeURIComponent(actId)}/accepta`)
export const respingeAct = (id: string, actId: string, motiv: string) =>
  apiJson('POST', `/cereri/${encodeURIComponent(id)}/acte/${encodeURIComponent(actId)}/respinge`, { motiv })

// ── Propuneri de acte, din fișa clientului ───────────────────────────────────

export interface PropunereAct extends ActNou {
  cheie: string
  /** Bifată din start: buletin expirat, care expiră curând sau fără date în fișă. */
  bifat: boolean
  /** De ce e propus (ex. „expiră pe 12.01.2027”). */
  nota?: string
}

/** Câte zile înainte de expirare un buletin e propus bifat (aceeași fereastră ca alerta implicită). */
export const ZILE_CI_PROPUS = 60

function dataRo(s: string | undefined): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((s ?? '').trim())
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return isNaN(d.getTime()) ? null : d
}

function numeAfisat(p: Persoana): string {
  return [p.nume, p.prenume].map(x => (x ?? '').trim()).filter(Boolean).join(' ')
}

const cheieNume = (p: Persoana) => numeAfisat(p).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase()
const cifreCnp = (p: Persoana) => (p.cnp || p.cnpMasked || '').replace(/\D/g, '').slice(-4)

/** Aceeași persoană pentru un buletin cerut: potrivirea strictă din fișă sau, fără CNP-uri care să se contrazică, același
 * nume (asociatul și administratorul introduși separat, fără date de buletin, au id-uri diferite). */
function aceeasiPentruCerere(a: Persoana, b: Persoana): boolean {
  if (aceeasiInFisa(a, b)) return true
  const ca = cifreCnp(a), cb = cifreCnp(b)
  return !!cheieNume(a) && cheieNume(a) === cheieNume(b) && !(ca.length === 4 && cb.length === 4 && ca !== cb)
}

export function propuneriActe(c: Client, azi: Date = new Date()): PropunereAct[] {
  const out: PropunereAct[] = []
  const vazute: Persoana[] = []
  for (const { p } of intrari(c)) {
    if (vazute.some(v => aceeasiPentruCerere(v, p))) continue  // asociat și administrator: un singur buletin
    vazute.push(p)
    const nume = numeAfisat(p)
    if (!nume) continue
    const expira = dataRo(p.valabila_pana_la)
    const zile = expira ? Math.floor((expira.getTime() - new Date(azi.getFullYear(), azi.getMonth(), azi.getDate()).getTime()) / 86_400_000) : null
    let nota: string | undefined
    let bifat = false
    if (zile === null) { nota = 'fără date de buletin în fișă'; bifat = true }
    else if (zile < 0) { nota = `expirat pe ${p.valabila_pana_la}`; bifat = true }
    else if (zile <= ZILE_CI_PROPUS) { nota = `expiră pe ${p.valabila_pana_la}`; bifat = true }
    out.push({ cheie: `ci:${p.pid ?? nume}`, eticheta: `CI – ${nume}`, tip: 'ci', persoanaPid: p.pid, bifat, nota })
  }
  if (inferTipClient(c) !== 'PF') {
    out.push({ cheie: 'dovada_sediu', eticheta: 'Dovada sediului (contract sau extras CF)', tip: 'dovada_sediu', bifat: false })
  }
  return out
}

// ── Trimiterea linkului ──────────────────────────────────────────────────────

export function mesajCerere(cabinet: string, link: string, expiraLa: Date | null): string {
  return [
    'Bună ziua,',
    '',
    `Vă rugăm să încărcați actele cerute${cabinet ? ` de ${cabinet}` : ''} aici:`,
    link,
    '',
    `${expiraLa ? `Linkul e valabil până pe ${formatDateRo(expiraLa)}. ` : ''}Puteți fotografia actele direct cu telefonul.`,
    '',
    'Mulțumim!',
  ].join('\n')
}

export const linkWhatsApp = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`

export function linkEmail(email: string, cabinet: string, text: string): string {
  const subiect = `Acte cerute${cabinet ? ` de ${cabinet}` : ''}`
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subiect)}&body=${encodeURIComponent(text)}`
}
