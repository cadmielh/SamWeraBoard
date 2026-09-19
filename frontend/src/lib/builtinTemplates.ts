import { useEffect, useState } from 'react'
import type { BuiltinTemplate } from '../types'
import { fetchBuiltinTemplates } from './api'
import { auth } from './firebase'

/** Șabloanele de bază — servite din backend, aceleași în orice workspace, deci
 * un simplu fetch la mount e suficient (nu se schimbă decât la deploy).
 * Endpoint-ul cere doar tokenul Firebase (verificat server-side), nu accessToken
 * Google — acela lipsește adesea la reload/sesiune nouă și nu trebuie să blocheze
 * fetch-ul, altfel șabloanele dispar tăcut pentru orice utilizator fără popup-ul
 * de login încă activ în sessionStorage. */
export function useBuiltinTemplates() {
  const [builtins, setBuiltins] = useState<BuiltinTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const uid = auth.currentUser?.uid ?? null   // se reîncarcă la schimbarea utilizatorului

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!auth.currentUser) { setLoading(false); return }
    setLoading(true)
    fetchBuiltinTemplates()
      .then(list => { if (!cancelled) setBuiltins(list) })
      .catch(() => { if (!cancelled) setBuiltins([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [uid])

  return { builtins, loading }
}

export function findBuiltin(builtins: BuiltinTemplate[], key: string): BuiltinTemplate | undefined {
  return builtins.find(b => b.key === key)
}

interface AsociatiCountRule {
  min?: number
  max?: number
}

/** "Decizia Asociatului Unic" cere exact un asociat; "Hotărârea AGA" cere cel
 * puțin doi — indiferent dacă asociații sunt deja salvați în profilul
 * clientului sau doar scanați (nesalvați încă). Cheile sunt cele din
 * fisiere_template/registry.json, reutilizate și pentru copiile duplicate
 * (via DocTemplate.sourceKey), fiindcă restricția e a tipului de document
 * juridic, nu a fișierului anume. */
const ASOCIATI_COUNT_RULES: Record<string, AsociatiCountRule> = {
  decizie_asociat_unic: { min: 1, max: 1 },
  hotarare_aga: { min: 2 },
}

/** null dacă numărul de asociați respectă regula (sau șablonul n-are una);
 * altfel un mesaj explicativ, gata de afișat. */
export function asociatiCountMismatch(key: string | undefined, count: number): string | null {
  const rule = key ? ASOCIATI_COUNT_RULES[key] : undefined
  if (!rule) return null
  if (rule.min != null && rule.max === rule.min && count !== rule.min) {
    return `necesită exact ${rule.min} asociat${rule.min === 1 ? '' : 'i'} — clientul selectat are ${count}`
  }
  if (rule.min != null && count < rule.min) {
    return `necesită cel puțin ${rule.min} asociați — clientul selectat are ${count}`
  }
  if (rule.max != null && count > rule.max) {
    return `necesită cel mult ${rule.max} asociat${rule.max === 1 ? '' : 'i'} — clientul selectat are ${count}`
  }
  return null
}
