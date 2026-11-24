/** Noutățile aplicației: anunțate o singură dată într-o fereastră „Ce e nou”, apoi păstrate în Setări › Noutăți.
 *
 * Lista se scrie aici, în cod, și pleacă odată cu funcția anunțată: nu poate exista un anunț pentru ceva nelansat, iar
 * textul trece prin aceeași verificare ca restul codului. Un anunț nou = o intrare nouă, cu `id` unic și stabil (nu se
 * schimbă după publicare: după el se ține minte cine l-a văzut).
 *
 * Cine vede un anunț: dacă are `feature`, doar în cabinetele cu funcția pornită, și abia când e pornită; dacă are
 * `roluri`, doar acele roluri. Conturile create după data anunțului nu primesc fereastra (au ghidul „Primii pași”), dar
 * îl găsesc în istoric. „Văzut” se ține pe cont (`users/{uid}.noutatiVazute`), nu pe dispozitiv. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { FeatureKey } from './features'
import { INDICII_DOCUMENTE, type IndiciuGhid } from './ghidPornire'

export type Rol = 'admin' | 'member' | 'viewer'

export interface Noutate {
  id: string
  /** Data lansării (AAAA-LL-ZZ): ordinea în istoric și pragul pentru conturile noi. */
  data: string
  icon: string
  titlu: string
  text: string
  actiune?: { label: string; cale: string }
  feature?: FeatureKey
  roluri?: Rol[]
  /** Turul „Arată-mi cum” (opțional): pornește pe `ruta` și evidențiază pe rând elementele [data-ghid=țintă]. */
  tur?: { ruta: string; pasi: IndiciuGhid[] }
}

/** Câte anunțuri încap în fereastra „Ce e nou”; restul se văd în Setări › Noutăți. */
export const MAX_IN_FEREASTRA = 3

export const NOUTATI: Noutate[] = [
  {
    id: 'documente-clienti',
    data: '2026-11-24',
    icon: '📁',
    titlu: 'Documentele clienților, în fișa fiecăruia',
    text: 'Păstrezi actele clientului (buletine, contracte, dovezi de sediu) direct în fișa lui, criptat, în foldere. '
      + 'Le previzualizezi, le cauți, le tragi dintr-un folder în altul și extragi datele dintr-un buletin direct în fișă. '
      + 'La generarea unui document poți păstra și o copie a lui la client.',
    actiune: { label: 'Deschide clienții', cale: '/' },
    feature: 'documente',
    tur: {
      ruta: '/',
      pasi: INDICII_DOCUMENTE,
    },
  },
  {
    id: 'documente-foldere-implicite',
    data: '2026-11-24',
    icon: '🗂️',
    titlu: 'Folderele fiecărui client nou, alese de tine',
    text: 'În Setări › Documente stabilești ce foldere primește automat fiecare client și unde se păstrează copiile documentelor generate.',
    actiune: { label: 'Deschide setările documentelor', cale: '/setari/documente' },
    feature: 'documente',
    roluri: ['admin'],
  },
]

export interface ContextNoutati {
  hasFeature: (key: FeatureKey) => boolean
  rol: Rol | null
}

/** Anunțurile care privesc utilizatorul în cabinetul activ (funcție pornită, rol potrivit), cele mai noi primele. */
export function noutatiVizibile(lista: Noutate[], ctx: ContextNoutati): Noutate[] {
  return lista
    .filter(n => (!n.feature || ctx.hasFeature(n.feature)) && (!n.roluri || (!!ctx.rol && n.roluri.includes(ctx.rol))))
    .sort((a, b) => b.data.localeCompare(a.data))
}

/** Ce se anunță acum în fereastră: vizibile, nevăzute și lansate după crearea contului (un cont nou nu primește
 * anunțuri despre ce exista deja când și-a făcut contul). */
export function deAnuntat(lista: Noutate[], ctx: ContextNoutati, vazute: ReadonlySet<string>, contCreatLa: Date | null): Noutate[] {
  const prag = contCreatLa ? contCreatLa.toISOString().slice(0, 10) : ''
  return noutatiVizibile(lista, ctx).filter(n => !vazute.has(n.id) && (!prag || n.data >= prag))
}

/** Noutățile văzute de utilizator (null cât se încarcă) și marcarea lor. */
export function useNoutatiVazute(uid: string | null) {
  const [vazute, setVazute] = useState<{ uid: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!uid) return
    return onSnapshot(doc(db, 'users', uid), snap => {
      const v = snap.data()?.noutatiVazute
      setVazute({ uid, ids: new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []) })
    }, () => setVazute({ uid, ids: new Set() }))
  }, [uid])

  const marcheaza = useCallback(async (ids: string[]) => {
    if (!uid || !ids.length) return
    setVazute(prev => prev && prev.uid === uid ? { uid, ids: new Set([...prev.ids, ...ids]) } : prev)
    await setDoc(doc(db, 'users', uid), { noutatiVazute: arrayUnion(...ids) }, { merge: true })
  }, [uid])

  return { vazute: vazute?.uid === uid ? vazute.ids : null, marcheaza }
}

// ── Turul activ „Arată-mi cum” ──────────────────────────────────────────────
// În afara componentelor: pornit din fereastra „Ce e nou” (care se închide) sau din istoric, continuă după navigare.

// Pasul curent se ține și în sesiunea tabului: o reîncărcare a paginii (manuală sau a aplicației) nu pierde turul.
const CHEIE_TUR = 'cabinio:tur-noutate'

function turSalvat(): { noutate: Noutate; index: number } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(CHEIE_TUR) ?? 'null') as { id?: string; index?: number } | null
    const noutate = NOUTATI.find(n => n.id === v?.id)
    const index = Number(v?.index)
    return noutate?.tur && Number.isInteger(index) && index >= 0 && index < noutate.tur.pasi.length ? { noutate, index } : null
  } catch {
    return null
  }
}

let tur: { noutate: Noutate; index: number } | null = typeof window === 'undefined' ? null : turSalvat()
const ascultatoriTur = new Set<() => void>()
const seteazaTur = (t: typeof tur) => {
  tur = t
  try {
    if (t) sessionStorage.setItem(CHEIE_TUR, JSON.stringify({ id: t.noutate.id, index: t.index }))
    else sessionStorage.removeItem(CHEIE_TUR)
  } catch { /* fără stocare: turul ține doar până la reîncărcare */ }
  ascultatoriTur.forEach(l => l())
}

export function pornesteTur(n: Noutate) { if (n.tur?.pasi.length) seteazaTur({ noutate: n, index: 0 }) }
export function urmatorulPasTur() { if (tur) seteazaTur(tur.index + 1 < (tur.noutate.tur?.pasi.length ?? 0) ? { ...tur, index: tur.index + 1 } : null) }
export function opresteTur() { seteazaTur(null) }

/** Turul activ (pentru teste și cod din afara React). */
export const turAcum = () => tur

export function useTurNoutate() {
  return useSyncExternalStore(l => { ascultatoriTur.add(l); return () => { ascultatoriTur.delete(l) } }, () => tur)
}
