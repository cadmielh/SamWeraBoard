import { useRef } from 'react'

export type ElRef = (el: HTMLElement | null) => void
export interface ValidationCheck { invalid: boolean; id: string; message: string }

/** Registru de ref-uri + scroll-la-primul-câmp-lipsă, partajat de toate fillerele de formulare
 * fiscale dedicate (Anexa1Filler, BeneficiariRealiFiller, DeclaratieActivitateFiller) — acestea
 * aveau fiecare propria copie byte-identică a acestui cod. */
export function useFieldRefs() {
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  const bindRef = (id: string): ElRef => el => { fieldRefs.current[id] = el }

  const scrollToFirstMissing = (checks: ValidationCheck[]): string[] => {
    const failing = checks.filter(c => c.invalid)
    if (failing.length > 0) {
      const el = fieldRefs.current[failing[0].id]
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Focus pe controlul real din interiorul wrapper-ului, nu pe div-ul însuși (care nu-l poate
      // primi) — același idiom deja folosit în DosarView.tsx pentru EditableRow.
      ;(el?.querySelector('input, select, textarea') as HTMLElement | null)?.focus()
    }
    return failing.map(c => c.message)
  }

  return { bindRef, scrollToFirstMissing }
}
