import { useState } from 'react'
import type { AdresaStructurata } from '../lib/adresa'
import { JUDETE_ROMANIA } from '../lib/counties'
import { formatDateRo } from '../lib/dates'
import Combobox from './Combobox'

interface Props {
  value: AdresaStructurata
  onChange: (patch: Partial<AdresaStructurata>) => void
  label: string
  required?: boolean
  /** Ultima valoare structurată primită de la ANAF — folosită doar pentru
   * hint-ul de proveniență (comparație câmp cu câmp), nu pentru afișare directă. */
  anafSnapshot?: AdresaStructurata | null
  /** ISO — dacă e prezent, apare "Sincronizat cu ANAF la ...". */
  anafSyncedAt?: string | null
  /** Șirul întreg (necomponentizat) exact cum l-a întors ANAF — afișat chiar
   * sub "Sincronizat cu ANAF", lângă câmpurile editabile, ca userul să vadă
   * imediat, alături, ce ar necesita corectare. */
  anafRawText?: string | null
  /** Textul vechi (necompletat), doar la prima deschidere a unui client migrat. */
  legacyRaw?: string | null
  firstFieldRef?: React.RefObject<HTMLInputElement | null>
  extraHeaderAction?: React.ReactNode
}

function AnafHint({ anaf, current }: { anaf?: string; current: string }) {
  if (!anaf || anaf === current) return null
  return <div style={{ fontSize: '.7rem', color: 'var(--s400)', marginTop: '.15rem' }}>ANAF: {anaf}</div>
}

const SUBFIELD_LABEL_STYLE = { fontSize: '.7rem', fontWeight: 500, color: 'var(--s500)', marginBottom: '.15rem', display: 'block' } as const

export default function SediuSocialFields({
  value, onChange, label, required, anafSnapshot, anafSyncedAt, anafRawText, legacyRaw, firstFieldRef, extraHeaderAction,
}: Props) {
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const set = (key: keyof AdresaStructurata, v: string) => onChange({ [key]: v })

  return (
    <div className="field full">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label className="field-label" style={{ margin: 0 }}>
          {label} {required && <span style={{ color: 'var(--r500)' }}>*</span>}
        </label>
        {extraHeaderAction}
      </div>

      {(anafSyncedAt || anafRawText) && (
        <div className="anaf-strip" style={{ marginBottom: '.5rem' }}>
          {anafSyncedAt && (
            <span>✓ <b>Sincronizat cu ANAF</b> la {formatDateRo(new Date(anafSyncedAt))}</span>
          )}
          {anafRawText && (
            <span style={{ width: '100%' }}>Sediu social conform ANAF, întreg: {anafRawText}</span>
          )}
        </div>
      )}

      {legacyRaw && !bannerDismissed && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '.5rem',
          background: 'var(--y50, #fffbeb)', border: '1px solid var(--y200, #fde68a)', borderRadius: '6px',
          padding: '.5rem .625rem', marginBottom: '.5rem', fontSize: '.75rem', color: 'var(--s600)',
        }}>
          <span>Adresa a fost separată automat din formatul vechi: „{legacyRaw}” — verifică și corectează câmpurile de mai jos dacă e nevoie.</span>
          <button type="button" className="btn btn-ghost btn-xs" style={{ flexShrink: 0 }} onClick={() => setBannerDismissed(true)}>×</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 160px', minWidth: 0 }}>
          <label style={SUBFIELD_LABEL_STYLE}>Localitate</label>
          <input ref={firstFieldRef} className="field-input" value={value.localitate}
            onChange={e => set('localitate', e.target.value)} />
          <AnafHint anaf={anafSnapshot?.localitate} current={value.localitate} />
        </div>
        <div style={{ flex: '2 1 160px', minWidth: 0 }}>
          <label style={SUBFIELD_LABEL_STYLE}>Stradă</label>
          <input className="field-input" value={value.strada}
            onChange={e => set('strada', e.target.value)} />
          <AnafHint anaf={anafSnapshot?.strada} current={value.strada} />
        </div>
        <div style={{ flex: '1 1 80px', minWidth: 0 }}>
          <label style={SUBFIELD_LABEL_STYLE}>Număr</label>
          <input className="field-input" value={value.numar}
            onChange={e => set('numar', e.target.value)} />
          <AnafHint anaf={anafSnapshot?.numar} current={value.numar} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
        <div style={{ flex: '1 1 90px', minWidth: 0 }}>
          <label style={SUBFIELD_LABEL_STYLE}>Bloc</label>
          <input className="field-input" value={value.bloc}
            onChange={e => set('bloc', e.target.value)} />
          <AnafHint anaf={anafSnapshot?.bloc} current={value.bloc} />
        </div>
        <div style={{ flex: '1 1 90px', minWidth: 0 }}>
          <label style={SUBFIELD_LABEL_STYLE}>Scară</label>
          <input className="field-input" value={value.scara}
            onChange={e => set('scara', e.target.value)} />
          <AnafHint anaf={anafSnapshot?.scara} current={value.scara} />
        </div>
        <div style={{ flex: '1 1 90px', minWidth: 0 }}>
          <label style={SUBFIELD_LABEL_STYLE}>Etaj</label>
          <input className="field-input" value={value.etaj}
            onChange={e => set('etaj', e.target.value)} />
          <AnafHint anaf={anafSnapshot?.etaj} current={value.etaj} />
        </div>
        <div style={{ flex: '1 1 90px', minWidth: 0 }}>
          <label style={SUBFIELD_LABEL_STYLE}>Apartament</label>
          <input className="field-input" value={value.apartament}
            onChange={e => set('apartament', e.target.value)} />
          <AnafHint anaf={anafSnapshot?.apartament} current={value.apartament} />
        </div>
        <div style={{ flex: '1 1 140px', minWidth: 0 }}>
          <label style={SUBFIELD_LABEL_STYLE}>Județ / Sector</label>
          <Combobox value={value.judet} options={JUDETE_ROMANIA} onChange={v => set('judet', v)} />
          <AnafHint anaf={anafSnapshot?.judet} current={value.judet} />
        </div>
      </div>
    </div>
  )
}
