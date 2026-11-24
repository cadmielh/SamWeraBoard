/** Noutățile aplicației: anunțate o singură dată într-o fereastră „Ce e nou”, apoi păstrate în Setări › Noutăți.
 *
 * Lista se scrie aici, în cod, și pleacă odată cu funcția anunțată: nu poate exista un anunț pentru ceva nelansat, iar
 * textul trece prin aceeași verificare ca restul codului. Un anunț nou = o intrare nouă, cu `id` unic și stabil (nu se
 * schimbă după publicare: după el se ține minte cine l-a văzut).
 *
 * Cine vede un anunț: dacă are `feature`, doar în cabinetele cu funcția pornită, și abia când e pornită; dacă are
 * `roluri`, doar acele roluri. Conturile create după data anunțului nu primesc fereastra (au ghidul „Primii pași”), dar
 * îl găsesc în istoric. „Văzut” se ține pe cont (`users/{uid}.noutatiVazute`), nu pe dispozitiv. */
import { useCallback, useEffect, useState } from 'react'
import { arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { FeatureKey } from './features'

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
}

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
