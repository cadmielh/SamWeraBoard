import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDocs, limit, onSnapshot, query, setDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import type { Workspace, WorkspaceRole } from '../types'
import { hasFeature, type FeatureKey } from './features'
import { billingAccess } from './billing'
import { DENUMIRE_DEMO, esteClientDemo } from './demo'

/**
 * Ghidul „Primii pași”: o listă scurtă de acțiuni care duc utilizatorul nou la primul document generat.
 * Pașii se bifează singuri, după acțiunea reală (vezi marcheazaPas), nu la clic pe „Am înțeles”.
 * Progresul e personal și ține de cabinet: users/{uid}/ghidPornire/{workspaceId} (regulile permit deja
 * subcolecțiile proprii ale utilizatorului).
 */

export type PasGhid = 'scan' | 'generare' | 'anaf' | 'dosar' | 'sarcina' | 'documente' | 'alerte' | 'coleg' | 'sablon'

/** Un indiciu „Arată-mi”: elementul [data-ghid=țintă] e evidențiat cu textul alăturat. Indiciile se succed:
 * următorul apare după clic pe țintă (ex. butonul care deschide formularul, apoi câmpul din formular). */
export interface IndiciuGhid { tinta: string; text: string }

export interface DefinitiePas {
  key: PasGhid
  titlu: string
  descriere: string
  /** Pașii cu care merită început: duc cel mai repede la un rezultat. */
  recomandat?: boolean
  /** Doar pentru administratorii cabinetului (configurarea cabinetului, nu lucrul de zi cu zi). */
  doarAdmin?: boolean
  /** Bun de știut, dar nu condiționează terminarea ghidului (nu intră în progres). */
  optional?: boolean
  /** Doar la cabinetele cu funcția pornită (lansare treptată). */
  functie?: FeatureKey
  ruta: string
  indicii: IndiciuGhid[]
}

/** Indiciile pentru documentele clientului: aceleași în pasul din ghid și în turul „Arată-mi cum” al noutății. */
export const INDICII_DOCUMENTE: IndiciuGhid[] = [
  { tinta: 'client-deschide', text: 'Deschide un client: apasă „Vizualizează” pe rândul lui (pe telefon, atinge cardul clientului).' },
  { tinta: 'doc-incarca', text: 'Aici încarci actele clientului. Le poți și trage direct în secțiunea „Documente” sau lipi cu Ctrl+V.' },
  { tinta: 'doc-lista', text: 'Apasă un document ca să-l vezi. Din meniul „⋯” al unui buletin alegi „Extrage datele în fișă”; '
    + 'un document tras peste un folder se mută acolo.' },
]

export const PASI_GHID: DefinitiePas[] = [
  {
    key: 'scan', recomandat: true, ruta: '/extragere',
    titlu: 'Scanează un act de identitate',
    descriere: 'Încarci poza sau PDF-ul buletinului, iar numele, CNP-ul și adresa se completează singure.',
    indicii: [
      { tinta: 'gen-pf', text: 'Alege „Entitate nouă — PF”: aici pornești de la un buletin.' },
      { tinta: 'scan-upload', text: 'Trage aici poza sau PDF-ul buletinului (sau apasă și alege fișierul). Datele apar în câteva secunde.' },
    ],
  },
  {
    key: 'anaf', ruta: '/',
    titlu: 'Adaugă o firmă după CUI',
    descriere: 'Scrii CUI-ul, iar denumirea, sediul, CAEN-ul și datele fiscale vin de la ANAF.',
    indicii: [
      { tinta: 'client-add', text: 'Deschide formularul de client nou.' },
      { tinta: 'client-anaf', text: 'Scrie CUI-ul firmei și apasă ANAF: restul datelor se completează singure.' },
    ],
  },
  {
    key: 'generare', recomandat: true, ruta: '/extragere',
    titlu: 'Generează primul document',
    descriere: 'Alegi clientul și șablonul, iar documentul iese completat, gata de descărcat.',
    indicii: [
      { tinta: 'gen-client', text: 'Alege „Client din portofoliu”, apoi clientul și șablonul. Dacă n-ai încă un client, creează unul demo din ghid.' },
    ],
  },
  {
    key: 'dosar', ruta: '/dosare',
    titlu: 'Deschide un dosar',
    descriere: 'Un dosar ține la un loc lucrarea pentru un client: stadiul, termenele, onorariul. '
      + 'Când ajunge la „Documente predate client” și e facturat, trece la „Încheiate”.',
    indicii: [
      { tinta: 'dosar-add', text: 'Apasă „+ Dosar nou”.' },
      { tinta: 'dosar-sarcina', text: 'Completează clientul (din portofoliu sau o denumire liberă, pentru un prospect), obiectul cererii '
        + 'și responsabilul. Bifa de aici pune dosarul și ca sarcină pe board-ul din Sarcini, unde îi urmărești pașii; '
        + 'debifeaz-o dacă nu vrei.' },
    ],
  },
  {
    // Se bifează la prima mutare a unei sarcini, nu la adăugare: o sarcină creată odată cu dosarul ar bifa pasul
    // fără ca utilizatorul să fi văzut board-ul.
    key: 'sarcina', ruta: '/sarcini',
    titlu: 'Mută o sarcină pe board',
    descriere: 'Sarcinile, și cele create odată cu un dosar, trec prin Deschis → În lucru → Finalizat; cele finalizate ajung în arhivă.',
    indicii: [
      { tinta: 'sarcini-board', text: 'Fiecare coloană e o stare: Deschis, În lucru, Finalizat. Muți o sarcină trăgând cardul în altă coloană '
        + 'sau cu butoanele de pe card: „▶ În lucru”, „✓ Finalizează”.' },
      { tinta: 'sarcini-arhiva', text: 'Sarcinile finalizate trec singure aici, în arhivă, la finalul săptămânii. Cu „🗄 Arhivează” de pe card '
        + 'le muți imediat; din arhivă le poți readuce pe board.' },
      { tinta: 'sarcina-add', text: 'Pentru o sarcină nouă apeși aici. Pune-i un termen: primești alertă înainte să expire.' },
    ],
  },
  {
    key: 'documente', optional: true, functie: 'documente', ruta: '/',
    titlu: 'Păstrează actele clientului',
    descriere: 'Buletine, contracte, dovezi de sediu: în fișa clientului, criptate, în foldere. Le previzualizezi și extragi datele din ele.',
    indicii: INDICII_DOCUMENTE,
  },
  {
    key: 'alerte', optional: true, functie: 'alerte', ruta: '/setari/notificari',
    titlu: 'Alege ce alerte primești',
    descriere: 'Termene de mandat, buletine care expiră, dosare și sarcini: alertele apar în clopoțel. Merg și cu setările implicite.',
    indicii: [
      { tinta: 'notif-setari', text: 'Pornește sau oprește fiecare tip de alertă și alege cu câte zile înainte o primești. Se salvează singur.' },
      { tinta: 'notif-bell', text: 'Alertele apar aici, în clopoțel, pe fiecare pagină.' },
    ],
  },
  {
    // Opțional: un cabinet cu un singur om nu are pe cine invita; e destul să știe unde se face.
    key: 'coleg', doarAdmin: true, optional: true, ruta: '/setari/membri',
    titlu: 'Invită un coleg',
    descriere: 'Lucrezi cu alții? Îi inviți din Setări › Membri, cu rolul pe care îl alegi. Dacă lucrezi singur, poți sări peste.',
    indicii: [{ tinta: 'membri-invite', text: 'Când vrei să lucrezi cu un coleg, scrie aici adresa lui, alege rolul și trimite invitația.' }],
  },
  {
    key: 'sablon', doarAdmin: true, optional: true, ruta: '/extragere',
    titlu: 'Adaugă un șablon propriu',
    descriere: 'Folosește modelele cabinetului: încarci un .docx sau duplici un șablon de bază.',
    indicii: [{ tinta: 'gen-sabloane', text: 'Deschide biblioteca de șabloane: de aici încarci un .docx sau duplici un șablon de bază.' }],
  },
]

/** Pașii care contează la progres și la terminarea ghidului. */
export function pasiObligatorii(pasi: DefinitiePas[]): DefinitiePas[] {
  return pasi.filter(p => !p.optional)
}

/** Pașii care îl privesc pe utilizator, după rolul lui în cabinet și funcțiile pornite pentru cabinet. */
export function pasiPentruRol(role: WorkspaceRole | null, features?: Workspace['features']): DefinitiePas[] {
  return PASI_GHID.filter(p => (!p.doarAdmin || role === 'admin') && (!p.functie || hasFeature(features, p.functie)))
}

/** Membrii adăugați înainte de lansarea ghidului nu-l primesc deschis automat (îl pot deschide din meniu). */
export const GHID_DE_LA = '2026-11-23'

function dataAdaugarii(v: unknown): Date | null {
  if (!v) return null
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d }
  if (typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate: () => Date }).toDate()
  return null
}

export function membruNou(workspace: Workspace, uid: string): boolean {
  const d = dataAdaugarii(workspace.members[uid]?.addedAt)
  return !!d && d >= new Date(GHID_DE_LA)
}

/** Cât timp un membru nou (ex. un coleg invitat după probă) are ghidul la vedere. */
export const ZILE_MEMBRU_RECENT = 30

/**
 * Ghidul e „activ” (intrare în meniu, deschidere automată) cât timp cabinetul e în probă sau membrul a intrat
 * de curând. După aceea rămâne doar la cerere, din Setări › Cont.
 */
export function ghidActiv(workspace: Workspace, uid: string, now: Date = new Date()): boolean {
  if (billingAccess(workspace.billing, now).reason === 'trial') return true
  const d = dataAdaugarii(workspace.members[uid]?.addedAt)
  return !!d && now.getTime() - d.getTime() < ZILE_MEMBRU_RECENT * 86_400_000
}

// ── Bifarea pașilor ─────────────────────────────────────────────────────────
// Acțiunile reale (scanare, generare, salvări) anunță pasul printr-un eveniment pe window; ghidul, montat
// o singură dată în AppLayout, îl ascultă și îl salvează. Așa codul care face acțiunea nu depinde de ghid.

const EVENIMENT = 'cabinio:ghid-pas'
/** Cât așteaptă panoul după un pas făcut (rezultatul pasului apare întâi) și cât de des reverifică. */
const PAUZA_REDESCHIDERE_MS = 1200

export function marcheazaPas(pas: PasGhid): void {
  try { window.dispatchEvent(new CustomEvent<PasGhid>(EVENIMENT, { detail: pas })) } catch { /* fără window (teste) */ }
}

interface StareSalvata {
  pasi?: Partial<Record<PasGhid, string>>
  ascuns?: boolean
  /** Panoul s-a deschis singur o dată; după, se deschide doar la cerere. */
  prezentat?: boolean
  /** Clienții demo pe care utilizatorul a ales să-i păstreze: nu mai propunem ștergerea lor. */
  demoPastrat?: string[]
}

export interface GhidPornire {
  /** Pașii relevanți pentru rol, în ordine. */
  pasi: DefinitiePas[]
  facuti: Set<PasGhid>
  ascuns: boolean
  /** În probă sau membru recent: ghidul stă în meniu și se deschide singur prima dată. Altfel doar la cerere. */
  activ: boolean
  /** Panoul e deschis acum. */
  deschis: boolean
  /** Indiciul „Arată-mi” activ: pasul și poziția în lista lui de indicii. */
  indiciu: { pas: DefinitiePas; index: number } | null
  incarcat: boolean
  deschide: () => void
  inchide: () => void
  /** Ascunde ghidul de tot (se poate reafișa din meniu cu `deschide`). */
  ascunde: () => void
  arata: (pas: DefinitiePas) => void
  urmatorulIndiciu: () => void
  opresteIndiciul: () => void
  /** Clientul demo rămas la finalul ghidului: se propune ștergerea lui. */
  demoDeSters: string | null
  /** Răspunsul la propunere: șters (deja, de apelant) sau păstrat (nu mai întrebăm). */
  raspundeDemo: (pastrat: boolean) => void
}

export function useGhidPornire(uid: string | null, workspace: Workspace | null, role: WorkspaceRole | null): GhidPornire {
  const wid = workspace?.id ?? null
  const [stare, setStare] = useState<StareSalvata | null>(null)
  const [deschis, setDeschis] = useState(false)
  const [indiciu, setIndiciu] = useState<GhidPornire['indiciu']>(null)
  const [demoDeSters, setDemoDeSters] = useState<string | null>(null)
  const [redeschide, setRedeschide] = useState(false)
  const stareRef = useRef(stare)
  useEffect(() => { stareRef.current = stare }, [stare])

  const ref = useMemo(() => (uid && wid ? doc(db, 'users', uid, 'ghidPornire', wid) : null), [uid, wid])
  const salveaza = useCallback((patch: StareSalvata) => {
    if (!ref) return
    setDoc(ref, patch, { merge: true }).catch(() => { /* ghidul nu blochează lucrul */ })
  }, [ref])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStare(null); setDeschis(false); setIndiciu(null); setDemoDeSters(null); setRedeschide(false)
    if (!ref || !workspace || !uid) return
    return onSnapshot(ref, snap => {
      if (snap.exists()) { setStare(snap.data() as StareSalvata); return }
      // Prima dată în acest cabinet: membrii noi îl primesc deschis, cei de dinainte doar la cerere.
      const initial: StareSalvata = { pasi: {}, ascuns: !membruNou(workspace, uid), prezentat: false }
      setStare(initial)
      salveaza(initial)
    }, () => setStare({ ascuns: true }))
    // workspace se schimbă ca obiect la fiecare citire; contează doar id-ul (ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref])

  // Pașii anunțați de restul aplicației.
  useEffect(() => {
    const onPas = (e: Event) => {
      const pas = (e as CustomEvent<PasGhid>).detail
      if (stareRef.current?.pasi?.[pas]) return
      setStare(s => ({ ...s, pasi: { ...s?.pasi, [pas]: new Date().toISOString() } }))
      salveaza({ pasi: { [pas]: new Date().toISOString() } })
      setIndiciu(i => (i?.pas.key === pas ? null : i))
      if (!stareRef.current?.ascuns) setRedeschide(true)
    }
    window.addEventListener(EVENIMENT, onPas)
    return () => window.removeEventListener(EVENIMENT, onPas)
  }, [salveaza])

  // La finalul ghidului (pașii obligatorii făcuți sau ghidul închis de utilizator), dacă a rămas clientul demo,
  // propunem ștergerea lui. „Păstrez” e ținut minte; o singură verificare pe sesiune și cabinet.
  const demoVerificat = useRef(false)
  useEffect(() => { demoVerificat.current = false }, [wid])
  const propuneStergereaDemo = useCallback(() => {
    if (!wid || demoVerificat.current) return
    demoVerificat.current = true
    const q = query(collection(db, 'workspaces', wid, 'clienti'), where('denumireLower', '==', DENUMIRE_DEMO.toLowerCase()), limit(1))
    getDocs(q).then(snap => {
      const d = snap.docs[0]
      if (d && esteClientDemo(d.data()) && !stareRef.current?.demoPastrat?.includes(d.id)) setDemoDeSters(d.id)
    }).catch(() => { /* fără propunere */ })
  }, [wid])

  const raspundeDemo = useCallback((pastrat: boolean) => {
    setDemoDeSters(id => {
      if (pastrat && id) {
        const lista = [...(stareRef.current?.demoPastrat ?? []), id]
        setStare(s => ({ ...s, demoPastrat: lista }))
        salveaza({ demoPastrat: lista })
      }
      return null
    })
  }, [salveaza])

  // Un coleg intrat în cabinet bifează pasul și fără invitație trimisă de aici (ex. adăugat de suport).
  const areColegi = !!workspace && Object.keys(workspace.members).length > 1
  const facuti = useMemo(() => {
    const s = new Set(Object.keys(stare?.pasi ?? {}) as PasGhid[])
    if (areColegi) s.add('coleg')
    return s
  }, [stare, areColegi])

  const pasi = pasiPentruRol(role, workspace?.features)
  const toateFacute = stare !== null && pasiObligatorii(pasi).every(p => facuti.has(p.key))
  useEffect(() => { if (toateFacute) propuneStergereaDemo() }, [toateFacute, propuneStergereaDemo])

  const activ = !!workspace && !!uid && ghidActiv(workspace, uid)

  // Prima prezentare: panoul se deschide singur o dată, apoi rămâne la cerere. După probă, niciodată singur.
  useEffect(() => {
    if (!activ || !stare || stare.ascuns || stare.prezentat) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeschis(true)
    salveaza({ prezentat: true })
    setStare(s => ({ ...s, prezentat: true }))
  }, [activ, stare, salveaza])

  // Un pas tocmai făcut: panoul revine singur, cu bifa nouă și pasul următor, ca ghidul să nu se piardă din vedere.
  // Așteptăm să se închidă fereastra în care s-a făcut pasul (ex. formularul de client) și să dispară orice indiciu.
  useEffect(() => {
    if (!redeschide) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!activ) { setRedeschide(false); return }
    const t = setInterval(() => {
      if (document.querySelector('.modal-backdrop, .ghid-indiciu')) return
      setRedeschide(false)
      setDeschis(true)
    }, PAUZA_REDESCHIDERE_MS)
    return () => clearInterval(t)
  }, [redeschide, activ])

  const deschide = useCallback(() => {
    setIndiciu(null)
    setDeschis(true)
    if (stareRef.current?.ascuns) { setStare(s => ({ ...s, ascuns: false })); salveaza({ ascuns: false }) }
  }, [salveaza])

  const ascunde = useCallback(() => {
    setDeschis(false); setIndiciu(null)
    setStare(s => ({ ...s, ascuns: true }))
    salveaza({ ascuns: true })
    propuneStergereaDemo()
  }, [salveaza, propuneStergereaDemo])

  return {
    pasi,
    facuti,
    ascuns: stare?.ascuns ?? true,
    activ,
    deschis,
    indiciu,
    incarcat: stare !== null,
    deschide,
    inchide: useCallback(() => setDeschis(false), []),
    ascunde,
    arata: useCallback((pas: DefinitiePas) => { setDeschis(false); setIndiciu({ pas, index: 0 }) }, []),
    urmatorulIndiciu: useCallback(() => setIndiciu(i => (i && i.index + 1 < i.pas.indicii.length ? { ...i, index: i.index + 1 } : null)), []),
    opresteIndiciul: useCallback(() => setIndiciu(null), []),
    demoDeSters,
    raspundeDemo,
  }
}
