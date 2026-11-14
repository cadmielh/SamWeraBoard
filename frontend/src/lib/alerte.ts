import { useState, useEffect, useCallback, useRef } from 'react'
import {
  collection, doc, query, where, onSnapshot, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import type { DocumentData } from 'firebase/firestore'
import { db } from './firebase'
import { toDateSafe } from './dates'
import {
  MAX_IGNORATE, ORDINE_SEVERITATE, PREFERINTE_IMPLICITE, TIP_ALERTA,
  type Notificare, type PreferintaTip, type PreferinteAlerte, type RolCabinet, type SeveritateAlerta, type SursaDosare,
} from './alerteCatalog'
import { CATEGORII_SURSA, curataPreferinte, normalizeazaPraguri, responsabiliCurati, type CategorieSursa } from './alerteConfig'

/** Clopoțelul de notificări: citirea alertelor (scrise doar de server) și preferințele personale. Serverul aplică
 * preferințele (tip pornit, praguri, „de la”); în browser se aplică doar `ignorate` și amânările, la afișare și la
 * contor (vezi docs/plan-alerte.md, „Revizuire 14 noiembrie 2026”). */

export { MAX_IGNORATE }
/** Firestore limitează un batch la 500 de scrieri; rămânem cu marjă. */
const BATCH_MAX = 400

function notificariCol(workspaceId: string) {
  return collection(db, 'workspaces', workspaceId, 'notificari')
}

function preferinteDoc(workspaceId: string, uid: string) {
  return doc(db, 'workspaces', workspaceId, 'preferinteAlerte', uid)
}

const SEVERITATI: SeveritateAlerta[] = ['urgent', 'atentie', 'info']
const SURSE_DOSARE: SursaDosare[] = ['toate', 'ale_mele', 'responsabili']

const text = (v: unknown): string => typeof v === 'string' ? v : ''
const textSauNull = (v: unknown): string | null => typeof v === 'string' && v ? v : null

/** Documentul din Firestore → Notificare; Timestamp-urile devin Date, câmpurile lipsă primesc valori sigure. */
export function dinFirestore(id: string, d: DocumentData): Notificare {
  return {
    id,
    uid: text(d.uid),
    cheie: text(d.cheie),
    cheieBaza: text(d.cheieBaza) || text(d.cheie),
    cod: text(d.cod),
    sursa: text(d.sursa),
    severitate: SEVERITATI.includes(d.severitate) ? d.severitate as SeveritateAlerta : 'info',
    prag: text(d.prag),
    titlu: text(d.titlu),
    detaliu: text(d.detaliu),
    link: text(d.link),
    clientId: textSauNull(d.clientId),
    dosarId: textSauNull(d.dosarId),
    sarcinaId: textSauNull(d.sarcinaId),
    responsabilUid: textSauNull(d.responsabilUid),
    termen: textSauNull(d.termen),
    eveniment: d.eveniment === true,
    creatLa: toDateSafe(d.creatLa),
    actualizatLa: toDateSafe(d.actualizatLa),
    vazut: d.vazut === true,
    amanatPana: toDateSafe(d.amanatPana),
    rezolvat: d.rezolvat === true,
    rezolvatLa: toDateSafe(d.rezolvatLa),
  }
}

/** Ordinea din clopoțel: severitate, apoi termenul cel mai apropiat (fără termen la final), apoi cele mai noi. */
export function sorteazaNotificari(lista: Notificare[]): Notificare[] {
  return [...lista].sort((a, b) =>
    ORDINE_SEVERITATE[a.severitate] - ORDINE_SEVERITATE[b.severitate]
    || (a.termen === b.termen ? 0 : a.termen === null ? 1 : b.termen === null ? -1 : a.termen < b.termen ? -1 : 1)
    || (b.creatLa?.getTime() ?? 0) - (a.creatLa?.getTime() ?? 0))
}

/** Alertele nerezolvate ale utilizatorului, live. Regulile permit citirea doar a propriilor documente, deci filtrul pe uid e obligatoriu. */
export function useNotificari(workspaceId: string | null, uid: string | null) {
  const [notificari, setNotificari] = useState<Notificare[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!workspaceId || !uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotificari([]); setLoading(false)
      return
    }
    setLoading(true)
    setError(false)
    return onSnapshot(
      query(notificariCol(workspaceId), where('uid', '==', uid), where('rezolvat', '==', false)),
      snap => {
        setNotificari(sorteazaNotificari(snap.docs.map(d => dinFirestore(d.id, d.data()))))
        setLoading(false)
      },
      () => { setError(true); setLoading(false) },
    )
  }, [workspaceId, uid])

  return { notificari, loading, error }
}

const listaCurata = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(-max) : []

const esteObiect = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Preferințele citite din Firestore, curățate structural; documentul lipsă sau în forma veche (`oprite`, `sursaDosare`)
 * = PREFERINTE_IMPLICITE, adică implicitele rolului. Codurile necunoscute se ignoră. */
export function preferinteDinFirestore(d: DocumentData | undefined): PreferinteAlerte {
  if (!d) return { ...PREFERINTE_IMPLICITE }
  const tipuri: Record<string, PreferintaTip> = {}
  if (esteObiect(d.tipuri)) {
    for (const [cod, v] of Object.entries(d.tipuri)) {
      const tip = TIP_ALERTA[cod]
      if (!tip || !esteObiect(v)) continue
      const intrare: PreferintaTip = {}
      if (typeof v.activ === 'boolean') intrare.activ = v.activ
      const praguri = normalizeazaPraguri(tip.fel, v.praguri)
      if (praguri.length) intrare.praguri = praguri
      if (Object.keys(intrare).length) tipuri[cod] = intrare
    }
  }
  const surse: PreferinteAlerte['surse'] = {}
  if (esteObiect(d.surse)) {
    for (const cat of CATEGORII_SURSA) {
      const v = d.surse[cat]
      if (esteObiect(v) && SURSE_DOSARE.includes(v.sursa as SursaDosare)) {
        surse[cat] = { sursa: v.sursa as SursaDosare, responsabili: responsabiliCurati(v.responsabili) }
      }
    }
  }
  return { tipuri, surse, ignorate: listaCurata(d.ignorate, MAX_IGNORATE) }
}

/** Scrie preferințele întregi, doar diferențele față de implicitele rolului (vezi curataPreferinte). */
export async function salveazaPreferinte(workspaceId: string, uid: string, prefs: PreferinteAlerte, role: RolCabinet): Promise<void> {
  const curate = curataPreferinte(prefs, role)
  await setDoc(preferinteDoc(workspaceId, uid), { ...curate, actualizatLa: serverTimestamp() })
}

/** Preferințele utilizatorului, live, plus `actualizeaza(fn)`, care aplică o modificare peste ultima versiune citită.
 * Scrierea apare imediat în snapshot (compensarea latenței din Firestore); la eroare, snapshot-ul revine singur. */
export function usePreferinteAlerte(workspaceId: string | null, uid: string | null, role: RolCabinet | null) {
  const [prefs, setPrefs] = useState<PreferinteAlerte>(PREFERINTE_IMPLICITE)
  const [loading, setLoading] = useState(true)
  const ultimele = useRef<PreferinteAlerte>(PREFERINTE_IMPLICITE)

  useEffect(() => {
    if (!workspaceId || !uid) {
      ultimele.current = PREFERINTE_IMPLICITE
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefs(PREFERINTE_IMPLICITE); setLoading(false)
      return
    }
    setLoading(true)
    return onSnapshot(
      preferinteDoc(workspaceId, uid),
      snap => {
        const p = preferinteDinFirestore(snap.exists() ? snap.data() : undefined)
        ultimele.current = p
        setPrefs(p)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [workspaceId, uid])

  const actualizeaza = useCallback(async (modificare: (p: PreferinteAlerte) => PreferinteAlerte) => {
    if (!workspaceId || !uid || !role) return
    await salveazaPreferinte(workspaceId, uid, modificare(ultimele.current), role)
  }, [workspaceId, uid, role])

  return { prefs, loading, actualizeaza }
}

// ── Filtrarea personală (pură) ───────────────────────────────────────────────

export interface ContextFiltru {
  now: Date
}

/** „Vreau alerte de la” (dosare și sarcini) are sens doar dacă utilizatorul are în cabinet cel puțin un coleg cu cont
 * care poate fi responsabil (nu vizualizator), indiferent de rolul lui. Altfel controlul nu se arată în Setări. */
export function areFiltruDeLaCine(role: string | null | undefined, uid: string, membri: Record<string, { role?: string }>): boolean {
  return !!role && Object.entries(membri).some(([u, m]) => u !== uid && !!m && m.role !== 'viewer')
}

export function esteAmanata(n: Notificare, now: Date): boolean {
  return n.amanatPana !== null && n.amanatPana.getTime() > now.getTime()
}

/** Ce mai filtrează browserul, fără amânare: alertele rezolvate și ignorările (o sursă întreagă sau o persoană).
 * Tipul oprit, pragurile și „de la cine” le aplică deja serverul. */
export function trecePreferintele(n: Notificare, prefs: PreferinteAlerte): boolean {
  if (n.rezolvat) return false
  return !prefs.ignorate.includes(n.sursa) && !prefs.ignorate.includes(n.cheieBaza)
}

/** Alertele de arătat acum: trec de preferințe și nu sunt amânate. */
export function filtreazaVizibile(notificari: Notificare[], prefs: PreferinteAlerte, ctx: ContextFiltru): Notificare[] {
  return notificari.filter(n => trecePreferintele(n, prefs) && !esteAmanata(n, ctx.now))
}

/** Alertele amânate care altfel ar fi vizibile (fila „Amânate”). */
export function filtreazaAmanate(notificari: Notificare[], prefs: PreferinteAlerte, ctx: ContextFiltru): Notificare[] {
  return notificari.filter(n => trecePreferintele(n, prefs) && esteAmanata(n, ctx.now))
}

/** Contorul clopoțelului: alerte vizibile și nevăzute. */
export function contorNoi(notificari: Notificare[], prefs: PreferinteAlerte, ctx: ContextFiltru): number {
  return filtreazaVizibile(notificari, prefs, ctx).filter(n => !n.vazut).length
}

/** Printre alertele noi e vreuna urgentă? (contorul devine roșu) */
export function areUrgente(notificari: Notificare[], prefs: PreferinteAlerte, ctx: ContextFiltru): boolean {
  return filtreazaVizibile(notificari, prefs, ctx).some(n => !n.vazut && n.severitate === 'urgent')
}

// ── Modificări ale preferințelor (pure) ──────────────────────────────────────

/** Adaugă o ignorare (o `sursa` întreagă sau o `cheieBaza`); la limită, se pierde cea mai veche. */
export function cuIgnorat(prefs: PreferinteAlerte, intrare: string): PreferinteAlerte {
  if (!intrare || prefs.ignorate.includes(intrare)) return prefs
  return { ...prefs, ignorate: [...prefs.ignorate, intrare].slice(-MAX_IGNORATE) }
}

export function faraIgnorat(prefs: PreferinteAlerte, intrare: string): PreferinteAlerte {
  return { ...prefs, ignorate: prefs.ignorate.filter(x => x !== intrare) }
}

/** Pornește sau oprește un tip pentru utilizator; tipurile obligatorii pentru rol și codurile necunoscute rămân neschimbate. */
export function cuTipActiv(prefs: PreferinteAlerte, role: RolCabinet, cod: string, activ: boolean): PreferinteAlerte {
  const tip = TIP_ALERTA[cod]
  if (!tip || tip.obligatoriu.includes(role)) return prefs
  return { ...prefs, tipuri: { ...prefs.tipuri, [cod]: { ...prefs.tipuri[cod], activ } } }
}

/** Pragurile alese pentru un tip „termen”/„vechime” (curățate la salvare). */
export function cuPraguri(prefs: PreferinteAlerte, cod: string, praguri: number[]): PreferinteAlerte {
  return { ...prefs, tipuri: { ...prefs.tipuri, [cod]: { ...prefs.tipuri[cod], praguri } } }
}

/** „Vreau alerte de la” pentru dosare sau sarcini. */
export function cuSursa(prefs: PreferinteAlerte, categorie: CategorieSursa, sursa: SursaDosare, responsabili: string[]): PreferinteAlerte {
  return { ...prefs, surse: { ...prefs.surse, [categorie]: { sursa, responsabili } } }
}

/** „Revino la implicite”: șterge alegerile pe tipuri și surse; ignorările rămân. */
export function faraModificari(prefs: PreferinteAlerte): PreferinteAlerte {
  return { ...prefs, tipuri: {}, surse: {} }
}

// ── Acțiuni ──────────────────────────────────────────────────────────────────
// Destinatarul poate schimba doar `vazut` și `amanatPana` (regulile Firestore). Nu trec prin assertWritable:
// notificările se pot citi și gestiona și când cabinetul e în citire.

export async function marcheazaVazut(workspaceId: string, id: string): Promise<void> {
  await updateDoc(doc(notificariCol(workspaceId), id), { vazut: true })
}

export async function marcheazaToateVazute(workspaceId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BATCH_MAX) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + BATCH_MAX)) batch.update(doc(notificariCol(workspaceId), id), { vazut: true })
    await batch.commit()
  }
}

/** Amână alerta până la `pana` (null = o readuce acum). Revine ca nouă, ca să fie observată când reapare. */
export async function amana(workspaceId: string, id: string, pana: Date | null): Promise<void> {
  await updateDoc(doc(notificariCol(workspaceId), id), {
    amanatPana: pana ? Timestamp.fromDate(pana) : null,
    vazut: false,
  })
}

export async function ignora(workspaceId: string, uid: string, prefs: PreferinteAlerte, role: RolCabinet, intrare: string): Promise<void> {
  await salveazaPreferinte(workspaceId, uid, cuIgnorat(prefs, intrare), role)
}

/** „Nu mai vreau acest tip”: oprește tipul pentru utilizator. Nu face nimic la tipurile obligatorii pentru rol. */
export async function opresteTip(workspaceId: string, uid: string, prefs: PreferinteAlerte, role: RolCabinet, cod: string): Promise<void> {
  const nou = cuTipActiv(prefs, role, cod, false)
  if (nou === prefs) return
  await salveazaPreferinte(workspaceId, uid, nou, role)
}

// ── Texte pentru afișare (pure) ──────────────────────────────────────────────

const LUNI_SCURT = ['ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.', 'iul.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.']

function inceputZi(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** „azi”, „mâine”, „ieri”, altfel „12 dec.” (cu anul, dacă e altul decât cel curent). */
export function dataScurta(d: Date, now: Date): string {
  const zile = Math.round((inceputZi(d) - inceputZi(now)) / 86_400_000)
  if (zile === 0) return 'azi'
  if (zile === 1) return 'mâine'
  if (zile === -1) return 'ieri'
  const an = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''
  return `${d.getDate()} ${LUNI_SCURT[d.getMonth()]}${an}`
}

/** Termenul ISO (yyyy-mm-dd) ca dată locală; null dacă lipsește sau e invalid. */
export function termenCaData(iso: string | null): Date | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/** Data arătată în dreapta alertei: termenul, dacă are, altfel momentul apariției. */
export function dataAlerta(n: Notificare, now: Date): string {
  const d = termenCaData(n.termen) ?? n.creatLa
  return d ? dataScurta(d, now) : ''
}

/** Tipul entității din `sursa`: client, dosar, sarcina; null pentru „cabinet” sau o sursă necunoscută. */
export function felSursa(sursa: string): 'client' | 'dosar' | 'sarcina' | null {
  const prefix = sursa.split(':')[0]
  return prefix === 'client' || prefix === 'dosar' || prefix === 'sarcina' ? prefix : null
}

/** Tipurile la care se poate ignora o singură persoană (cheieBaza), nu tot clientul. */
export function areIgnorarePersoana(cod: string): boolean {
  return cod === 'ci_expira' || cod.startsWith('mandat_')
}

/** Data de reapariție pentru „Amână”: începutul zilei respective, la 8 dimineața. */
export function amanarePana(zile: number, now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + zile, 8, 0, 0)
}
