// Acordeonul, validarea și trimiterea rezultatului, comune formularelor ONRC dedicate (Anexa2aFiller, Anexa2bFiller).
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ForwardedRef, ReactNode } from 'react'
import type { VerificareOnrc } from '../lib/onrcCommon'
import { useFieldRefs } from '../lib/useFieldRefs'
import { CollapsibleSection } from './FormFillerKit'

export interface OnrcFormValue<St> {
  replacements: Record<string, string>
  isComplete: boolean
  completion: { done: number; total: number; missing: string[] }
  /** Starea completă, ținută de TemplateFiller: formularul e lung și nu trebuie pierdut la trecerea pe alt șablon. */
  state: St
}

export interface OnrcFormHandle {
  scrollToFirstMissing: () => string[]
}

export function useOnrcForm<St, Sec extends string>({ ref, state, build, verificari, onChange, sectiuni, deschisInitial }: {
  ref: ForwardedRef<OnrcFormHandle>
  state: St
  build: (s: St) => { replacements: Record<string, string> }
  verificari: (s: St) => VerificareOnrc<Sec>[]
  onChange: (v: OnrcFormValue<St>) => void
  /** Secțiunile afișate, în ordinea documentului (pentru „Continuă ›”). */
  sectiuni: Sec[]
  deschisInitial: Sec
}) {
  const [deschis, setDeschis] = useState<Sec | null>(deschisInitial)
  const deFocalizat = useRef<VerificareOnrc<Sec> | null>(null)
  const { bindRef, scrollToFirstMissing } = useFieldRefs()
  const checks = verificari(state)

  useImperativeHandle(ref, () => ({
    scrollToFirstMissing: () => {
      const failing = checks.filter(c => c.invalid)
      if (failing.length > 0) {
        // Câmpul există doar în secțiunea deschisă: întâi se deschide, apoi (după randare) se derulează la el.
        setDeschis(failing[0].sectiune)
        deFocalizat.current = failing[0]
      }
      return failing.map(c => c.message)
    },
  }))

  // Fără dependențe: rulează după fiecare randare, deci și după cea care a deschis secțiunea cu câmpul lipsă.
  useEffect(() => {
    if (!deFocalizat.current) return
    scrollToFirstMissing([deFocalizat.current])
    deFocalizat.current = null
  })

  useEffect(() => {
    onChange({
      replacements: build(state).replacements,
      isComplete: checks.every(c => !c.invalid),
      completion: { total: checks.length, done: checks.filter(c => !c.invalid).length, missing: checks.filter(c => c.invalid).map(c => c.message) },
      state,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const urmatoarea = (id: Sec) => sectiuni[sectiuni.indexOf(id) + 1] ?? null
  const lipsa = (id: Sec) => checks.filter(c => c.sectiune === id && c.invalid).length

  /** O secțiune a acordeonului: una singură deschisă o dată, cu „Continuă ›” spre următoarea. */
  const sec = (id: Sec, nr: string, title: string, summary: string | undefined, body: ReactNode) => (
    <CollapsibleSection key={id} nr={nr} title={title} summary={summary} missing={lipsa(id)}
      open={deschis === id} onToggle={() => setDeschis(deschis === id ? null : id)}>
      {body}
      {urmatoarea(id) && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }} onClick={() => setDeschis(urmatoarea(id))}>
          Continuă ›
        </button>
      )}
    </CollapsibleSection>
  )

  return { sec, bindRef }
}
