import { useId, useState } from 'react'
import type { ContextCamp } from '../types'

interface Props {
  context: ContextCamp
  /** Valoarea scrisă: apare în frază în locul golului. */
  value: string
}

/** Butonul mic „i” de lângă eticheta unui câmp manual: la trecerea cu mouse-ul, la focus sau la atingere arată fraza din
 * document în care intră valoarea (vezi doc_filler.placeholder_contexts_in_docx). Click-ul/atingerea doar deschid —
 * comutarea s-ar bate cu deschiderea de la focus/hover; se închide la ieșire, la pierderea focusului sau cu Escape. */
export default function ContextCampInfo({ context, value }: Props) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const parti = (t: string) => t.split(' ¶ ').map((x, i, a) => <span key={i}>{x}{i < a.length - 1 && <br />}</span>)
  return (
    <span className="ctx-info" onPointerEnter={e => { if (e.pointerType === 'mouse') setOpen(true) }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setOpen(false) }}>
      <button type="button" className="ctx-info-btn" aria-label="Unde apare în document" aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={e => { e.preventDefault(); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>i</button>
      {open && (
        <span role="tooltip" id={id} className="ctx-info-pop">
          {parti(context.before)}
          <mark className="ctx-info-mark">{value.trim() || '▢'}</mark>
          {parti(context.after)}
        </span>
      )}
    </span>
  )
}
