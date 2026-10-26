import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { formatDateRo, isIncompleteOrInvalidRoDate, isoDateToRo, roDateInputCaretPos, roDateInputError, roDateInputMask, roDateInputSlotAtCaret, roDateToISO, roDigitsToPartialDate } from '../lib/dates'
import IconCalendar from './IconCalendar'

interface Props {
  id?: string
  /** Omis când eticheta e afișată deja de componenta părinte (ex. EditableRow din DosarView). */
  label?: string
  /** Formatul românesc, zz.ll.aaaa (ca orice altă valoare de completare din document). */
  value: string
  onChange: (v: string) => void
  style?: CSSProperties
  /** Bifa „Azi” are sens doar la câmpurile completate la generare (data poate fi chiar ziua
   * redactării) — nu la datele persoanei (naștere, valabilitate CI) sau alte date „neutre”
   * (admiterea unui dosar, termenul unei sarcini), unde nu are legătură cu ziua curentă. */
  showToday?: boolean
}

/**
 * Câmp de dată generic — text liber, care arată mereu scheletul „zz.ll.aaaa” și suprascrie
 * literele cu cifrele tastate (ca la `input[type=date]` nativ, care arată „zz/ll/aaaa” și
 * suprascrie segmentele — acela e comportament nativ al browserului, nu are nevoie de cod;
 * pentru câmpul text liber de aici, îl reproducem manual prin `onKeyDown`, ca să putem
 * controla exact ce se suprascrie și unde ajunge cursorul) + un buton de calendar, care deschide
 * picker-ul nativ al browserului (un <input type="date"> ascuns, sincronizat cu același text) +
 * bifă „Azi” opțională (`showToday`), care completează automat data curentă — relevantă doar la
 * câmpurile completate la generare (CAMP_…, câmpuri ad-hoc de clauză — „Nr./Data contract…” etc.),
 * unde data cerută e adesea chiar ziua redactării; se omite la datele „neutre” (ale persoanei,
 * ale unui dosar/sarcini), care n-au legătură cu „azi”.
 *
 * Validează ziua/luna (și, odată scrisă toată data, plauzibilitatea ei reală — zile-în-lună,
 * ani bisecți) pe măsură ce se tastează — `input[type=date]` nativ respinge automat 32 sau 13
 * la zi/lună; aici, fiind text liber, trebuie verificat explicit (`roDateInputError`), altfel
 * `roDateToISO` ar fi singurul loc care ar prinde o dată imposibilă, abia la salvare.
 *
 * Tastarea/ștergerea țin cont de poziția cursorului (deci și de unde s-a dat click), nu
 * operează mereu la finalul textului: o cifră tastată suprascrie cifra de la poziția
 * cursorului (ca la segmentele unui `input[type=date]` nativ), iar Backspace/Delete șterg
 * cifra de lângă cursor, nu mereu ultima cifră din dată.
 *
 * Totul se întâmplă pe `onKeyDown` + `onPaste`, nu pe `beforeinput`/`InputEvent.inputType`:
 * acela din urmă are suport inconsistent pentru Backspace/Delete între browsere (exact
 * ștergerea era cea care „nu făcea ce trebuie"), în timp ce `keydown` e universal și comportamentul
 * lui e complet sub controlul nostru.
 */
export default function DateFieldInput({ id, label, value, onChange, style, showToday = true }: Props) {
  const textRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const [touched, setTouched] = useState(false)
  const today = formatDateRo(new Date())
  const isToday = !!value && value === today

  const digitCount = value.replace(/\D/g, '').length
  // "Dată incompletă" apare abia la blur (`touched`), nu la fiecare tastă — altfel ar flashui
  // eroare cât timp utilizatorul încă scrie cifrele. `roDateInputError` deja semnalează imediat
  // zi/lună clar greșite; aici completăm doar cazul rămas: câmp nevid, dar niciodată terminat.
  const typingError = roDateInputError(value)
  const error = typingError ?? (touched && isIncompleteOrInvalidRoDate(value) ? 'Dată incompletă' : null)

  // Repoziționează cursorul după orice randare declanșată de o editare (React resetează
  // selecția la scrierea `.value` pe DOM, ca efect secundar al re-randării controlate).
  useEffect(() => {
    const pos = pendingCaretRef.current ?? roDateInputCaretPos(digitCount)
    pendingCaretRef.current = null
    textRef.current?.setSelectionRange(pos, pos)
  }, [value, digitCount])

  // Mută cursorul chiar acum (nu doar prin efectul de mai sus): dacă rezultatul editării e
  // identic cu `value` curent (ex. se retastează aceeași cifră care era deja acolo), `onChange`
  // nu schimbă nimic, React nu re-randează, iar efectul de mai sus nu mai are ocazia să ruleze —
  // fără linia asta, tastarea ar părea „omisă" de tot (nici cursorul nu s-ar mișca).
  const applyCaret = (pos: number) => {
    pendingCaretRef.current = pos
    textRef.current?.setSelectionRange(pos, pos)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const hasSelection = el.selectionStart !== el.selectionEnd
    const digits = value.replace(/\D/g, '')

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      if (hasSelection) {
        applyCaret(roDateInputCaretPos(0))
        onChange('')
        return
      }
      const caret = el.selectionStart ?? digits.length
      const slot = Math.min(roDateInputSlotAtCaret(caret), digits.length)
      if (e.key === 'Delete') {
        if (slot >= digits.length) return
        applyCaret(roDateInputCaretPos(slot))
        onChange(roDigitsToPartialDate(digits.slice(0, slot) + digits.slice(slot + 1)))
      } else {
        if (slot <= 0) return
        applyCaret(roDateInputCaretPos(slot - 1))
        onChange(roDigitsToPartialDate(digits.slice(0, slot - 1) + digits.slice(slot)))
      }
      return
    }

    const isPlainDigit = /^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey
    if (isPlainDigit) {
      e.preventDefault()
      if (hasSelection) {
        applyCaret(roDateInputCaretPos(1))
        onChange(roDigitsToPartialDate(e.key))
        return
      }
      const caret = el.selectionStart ?? digits.length
      const slot = Math.min(roDateInputSlotAtCaret(caret), digits.length)
      const next = slot < digits.length
        ? digits.slice(0, slot) + e.key + digits.slice(slot + 1)
        : (digits + e.key).slice(0, 8)
      applyCaret(roDateInputCaretPos(Math.min(slot + 1, 8)))
      onChange(roDigitsToPartialDate(next))
      return
    }

    // Orice altă tastă care ar modifica textul (litere, semne) e blocată — câmpul e strict
    // numeric. Navigarea (săgeți, Home/End, Tab) și shortcut-urile (Ctrl+A, Ctrl+C) nu intră
    // în acest if (lungime>1 sau au un modificator), deci funcționează normal.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const insertedDigits = e.clipboardData.getData('text').replace(/\D/g, '')
    if (!insertedDigits) return
    const el = textRef.current
    const digits = value.replace(/\D/g, '')
    const hasSelection = !!el && el.selectionStart !== el.selectionEnd
    if (hasSelection) {
      const next = insertedDigits.slice(0, 8)
      applyCaret(roDateInputCaretPos(next.length))
      onChange(roDigitsToPartialDate(next))
      return
    }
    const caret = el?.selectionStart ?? digits.length
    const slot = Math.min(roDateInputSlotAtCaret(caret), digits.length)
    const next = (digits.slice(0, slot) + insertedDigits).slice(0, 8)
    applyCaret(roDateInputCaretPos(Math.min(slot + insertedDigits.length, 8)))
    onChange(roDigitsToPartialDate(next))
  }

  const openPicker = () => {
    const el = pickerRef.current
    if (!el) return
    const withPicker = el as HTMLInputElement & { showPicker?: () => void }
    if (typeof withPicker.showPicker === "function") {
      try { withPicker.showPicker() } catch { el.focus() }
    } else {
      el.focus()
    }
  }

  return (
    <div className="field" style={style}>
      {label && <label className="field-label" htmlFor={id}>{label}</label>}
      <div className="field-with-btn">
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            ref={textRef}
            id={id} className="field-input" type="text" inputMode="numeric"
            style={{ paddingRight: '2.25rem' }}
            value={roDateInputMask(value)}
            aria-invalid={!!error}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={() => setTouched(true)}
            onChange={() => {}}
          />
          <button
            type="button" onClick={openPicker} aria-label="Alege data din calendar"
            style={{
              position: 'absolute', right: '.4rem', top: '50%', transform: 'translateY(-50%)',
              display: 'flex', background: 'none', border: 'none', padding: '.2rem', cursor: 'pointer',
              color: 'var(--s400)',
            }}
          >
            <IconCalendar />
          </button>
          {/* Nevăzut — doar ca să deschidă picker-ul nativ de dată (showPicker) și să-l citească la alegere. */}
          <input
            ref={pickerRef} type="date" tabIndex={-1} aria-hidden="true"
            value={roDateToISO(value)}
            onChange={e => onChange(isoDateToRo(e.target.value))}
            style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', width: '100%', height: '100%' }}
          />
        </div>
        {showToday && (
          <label className="field-checkbox-row" style={{ whiteSpace: 'nowrap' }}>
            <input
              type="checkbox" className="field-checkbox" checked={isToday}
              onChange={e => onChange(e.target.checked ? today : '')}
            />
            Azi
          </label>
        )}
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  )
}

/**
 * Variantă pentru câmpurile a căror stare „oficială" e ISO (yyyy-mm-dd — DosarInput,
 * SarcinaInput etc.), nu RO. Textul RO tastat trebuie ținut separat de ISO cât se scrie:
 * dacă `value` ar fi recalculat din ISO la fiecare apăsare de tastă (`isoDateToRo(iso)`),
 * fiecare cifră ar trece prin `roDateToISO`, care întoarce „" pentru orice dată incompletă —
 * câmpul ar reseta mereu la scheletul gol și ar părea „blocat", nu ar acumula cifrele tastate.
 */
export function IsoDateFieldInput({ id, label, value, onChange, onValidityChange, style, showToday }: {
  id?: string
  label?: string
  /** Data în format ISO (yyyy-mm-dd), sau null/gol dacă necompletată. */
  value: string | null | undefined
  onChange: (iso: string | null) => void
  /** Opțional — anunță părintele când textul RO tastat e nevid dar nu (încă) o dată validă, ca
   * să poată bloca Salvare/Adaugă în loc să lase `onChange` să scrie silențios `null`. Valoarea
   * ISO existentă e mereu validă-sau-null, deci asta poate deveni `true` doar din tastarea curentă. */
  onValidityChange?: (invalid: boolean) => void
  style?: CSSProperties
  showToday?: boolean
}) {
  const [ro, setRo] = useState(isoDateToRo(value ?? ''))
  return (
    <DateFieldInput
      id={id} label={label} style={style} showToday={showToday}
      value={ro}
      onChange={v => {
        setRo(v)
        onValidityChange?.(isIncompleteOrInvalidRoDate(v))
        onChange(roDateToISO(v) || null)
      }}
    />
  )
}
