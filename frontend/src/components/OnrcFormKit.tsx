// Piesele comune ale formularelor ONRC dedicate (Anexa 2a, Anexa 2b): câmpuri, adrese, persoane, catalog de mențiuni.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { EMPTY_PERSOANA, domiciliuText, elementAles, elementeAlese, persoanaDinBuletin, persoanaDinFisa } from '../lib/onrcCommon'
import type {
  CatalogStare, ComunicareOnrc, DeponentOnrc, ElementCatalog, ElementStare, FacturareOnrc, FirmaA2A, GrupCatalog,
  PersoanaA2A, PersoanaCandidat, SubsemnatStare,
} from '../lib/onrcCommon'
import type { IDFields } from '../lib/api'
import { JUDETE_ROMANIA } from '../lib/counties'
import type { ElRef } from '../lib/useFieldRefs'
import Combobox from './Combobox'
import DateFieldInput from './DateFieldInput'
import MiniOCR from './MiniOCR'
import { CollapsibleSection } from './FormFillerKit'
import { AUTO_NOTE, NOTE, ROW } from './onrcFormStyles'

// ── Câmpuri mici ────────────────────────────────────────────────────────────────────────────────────────────────────

export function Field({ label, value, onChange, flex = 1, placeholder, fieldRef, minWidth = 110 }: {
  label: string; value: string; onChange: (v: string) => void; flex?: number; placeholder?: string; fieldRef?: ElRef; minWidth?: number
}) {
  return (
    <div className="field" ref={fieldRef} style={{ flex, minWidth }}>
      <label className="field-label">{label}</label>
      <input className="field-input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

export function FieldDate({ label, value, onChange, flex = 1, showToday = false }: {
  label: string; value: string; onChange: (v: string) => void; flex?: number; showToday?: boolean
}) {
  return (
    <div style={{ flex, minWidth: 130 }}>
      <DateFieldInput label={label} value={value} onChange={onChange} showToday={showToday} />
    </div>
  )
}

export function FieldJudet({ label = 'Județ / sector', value, onChange, flex = 1, fieldRef }: {
  label?: string; value: string; onChange: (v: string) => void; flex?: number; fieldRef?: ElRef
}) {
  return (
    <div className="field" ref={fieldRef} style={{ flex, minWidth: 140 }}>
      <label className="field-label">{label}</label>
      <Combobox value={value} options={JUDETE_ROMANIA} onChange={onChange} placeholder="Județ / sector" />
    </div>
  )
}

export function Check({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.45rem', fontSize: '.83rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: '.15rem' }} />
      <span>{label}</span>
    </label>
  )
}

/** Alegere prin butoane: `multi` permite mai multe; la alegere unică, un clic pe opțiunea aleasă o anulează. */
export function Chips<T extends string>({ options, value, onChange, multi, fieldRef }: {
  options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; multi?: boolean; fieldRef?: ElRef
}) {
  const toggle = (v: T) => {
    const has = value.includes(v)
    if (multi) onChange(has ? value.filter(x => x !== v) : [...value, v])
    else onChange(has ? [] : [v])
  }
  return (
    <div ref={fieldRef} style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => toggle(o.value)}
          className={`btn btn-xs ${value.includes(o.value) ? 'btn-primary' : 'btn-outline-primary'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SubTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--p600)', paddingTop: '.4rem', borderTop: '1px dashed var(--s200)' }}>{children}</div>
}

// ── Blocuri de date ─────────────────────────────────────────────────────────────────────────────────────────────────

export function AdresaRow({ v, set, judet = true }: {
  v: { loc: string; str: string; nr: string; bl: string; sc: string; et: string; ap: string; jud: string }
  set: (k: 'loc' | 'str' | 'nr' | 'bl' | 'sc' | 'et' | 'ap' | 'jud', val: string) => void
  judet?: boolean
}) {
  return (
    <>
      <div style={ROW}>
        {judet && <FieldJudet value={v.jud} onChange={x => set('jud', x)} />}
        <Field label="Localitate" flex={2} value={v.loc} onChange={x => set('loc', x)} />
        <Field label="Stradă" flex={2} value={v.str} onChange={x => set('str', x)} />
        <Field label="Nr." flex={.5} minWidth={60} value={v.nr} onChange={x => set('nr', x)} />
      </div>
      <div style={ROW}>
        <Field label="Bloc" minWidth={60} value={v.bl} onChange={x => set('bl', x)} />
        <Field label="Scară" minWidth={60} value={v.sc} onChange={x => set('sc', x)} />
        <Field label="Etaj" minWidth={60} value={v.et} onChange={x => set('et', x)} />
        <Field label="Ap." minWidth={60} value={v.ap} onChange={x => set('ap', x)} />
      </div>
    </>
  )
}

/** Datele de identificare ale unei persoane fizice, cu alegere dintre persoanele din fișă sau „altă persoană” (cu scanare CI). */
export function PersoanaFields({ candidati, value, onChange, sursa, onSursa, fieldRefs }: {
  candidati: PersoanaCandidat[]
  value: PersoanaA2A
  onChange: (p: PersoanaA2A) => void
  sursa: string
  onSursa: (id: string, calitate: string) => void
  fieldRefs?: Partial<Record<'nume' | 'prenume' | 'cnp', ElRef>>
}) {
  const set = <K extends keyof PersoanaA2A>(k: K, v: PersoanaA2A[K]) => onChange({ ...value, [k]: v })
  const alege = (id: string) => {
    const c = candidati.find(x => x.id === id)
    onChange(c ? persoanaDinFisa(c.persoana) : { ...EMPTY_PERSOANA })
    onSursa(id, c?.calitate ?? '')
  }
  const cnpRau = !!value.cnp.trim() && !/^\d{13}$/.test(value.cnp.trim())
  return (
    <>
      <div className="field">
        <label className="field-label">Persoana</label>
        <select className="field-input" value={sursa} onChange={e => alege(e.target.value)}>
          <option value="">— alege —</option>
          {candidati.map(c => <option key={c.id} value={c.id}>{c.label} ({c.calitate})</option>)}
          <option value="__manual__">+ Altă persoană (avocat, împuternicit…)</option>
        </select>
      </div>
      {sursa && (
        <>
          {sursa !== '__manual__' && <div style={AUTO_NOTE}>Completat din fișa clientului — verifică.</div>}
          {sursa === '__manual__' && <MiniOCR onExtracted={f => onChange(persoanaDinBuletin(value, f))} />}
          <div style={ROW}>
            <Field label="Nume" value={value.nume} onChange={v => set('nume', v)} fieldRef={fieldRefs?.nume} />
            <Field label="Prenume" value={value.prenume} onChange={v => set('prenume', v)} fieldRef={fieldRefs?.prenume} />
            <div className="field" ref={fieldRefs?.cnp} style={{ flex: 1, minWidth: 140 }}>
              <label className="field-label">CNP / NIF</label>
              <input className="field-input" value={value.cnp} onChange={e => set('cnp', e.target.value)} />
              {cnpRau && <div style={{ fontSize: '.7rem', color: 'var(--y700)', marginTop: '.15rem' }}>⚠️ Nu are 13 cifre (în regulă doar pentru NIF)</div>}
            </div>
          </div>
          <SubTitle>Domiciliul</SubTitle>
          <AdresaRow
            v={{ loc: value.domLoc, str: value.domStr, nr: value.domNr, bl: value.domBl, sc: value.domSc, et: value.domEt, ap: value.domAp, jud: value.domJud }}
            set={(k, v) => set(({ loc: 'domLoc', str: 'domStr', nr: 'domNr', bl: 'domBl', sc: 'domSc', et: 'domEt', ap: 'domAp', jud: 'domJud' } as const)[k], v)}
          />
          <div style={ROW}>
            <Field label="Țara" value={value.domTara} onChange={v => set('domTara', v)} />
            <Field label="Cetățenia" value={value.cet} onChange={v => set('cet', v)} />
          </div>
          <SubTitle>Născut(ă)</SubTitle>
          <div style={ROW}>
            <Field label="Localitatea" flex={2} value={value.nastLoc} onChange={v => set('nastLoc', v)} />
            <FieldJudet label="Sector / județ" value={value.nastJud} onChange={v => set('nastJud', v)} />
            <Field label="Țara" value={value.nastTara} onChange={v => set('nastTara', v)} />
            <FieldDate label="La data de" value={value.nastData} onChange={v => set('nastData', v)} />
          </div>
          <SubTitle>Act de identitate</SubTitle>
          <div style={ROW}>
            <Field label="Tip" minWidth={70} value={value.actTip} onChange={v => set('actTip', v)} />
            <Field label="Seria" minWidth={70} value={value.actSeria} onChange={v => set('actSeria', v)} />
            <Field label="Nr." value={value.actNr} onChange={v => set('actNr', v)} />
            <Field label="Emis(ă) de" flex={2} value={value.actEmis} onChange={v => set('actEmis', v)} />
          </div>
          <div style={ROW}>
            <FieldDate label="La data" value={value.actData} onChange={v => set('actData', v)} />
            <FieldDate label="Valabil până la" value={value.actValabil} onChange={v => set('actValabil', v)} />
          </div>
        </>
      )}
    </>
  )
}

/** Lista de mențiuni sau de acte depuse (4.1/4.2 la 2a, 2.1/2.2 la 2b), pe grupuri care se pot restrânge. */
export function CatalogFields({ catalog, stare, onChange }: { catalog: GrupCatalog[]; stare: CatalogStare; onChange: (s: CatalogStare) => void }) {
  const [deschise, setDeschise] = useState<Set<string>>(() => new Set(catalog.filter(g => elementeAlese([g], stare).length > 0).map(g => g.titlu)))
  const toggleGrup = (t: string) => setDeschise(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n })
  const st = (id: string): ElementStare => stare[id] ?? { on: false, optiuni: [], texte: {} }
  const patch = (id: string, p: Partial<ElementStare>) => onChange({ ...stare, [id]: { ...st(id), ...p } })

  const renderElement = (el: ElementCatalog) => {
    const s = st(el.id)
    const ales = elementAles(el, s)
    return (
      <div key={el.id} style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', paddingLeft: el.box ? 0 : '.1rem' }}>
        {el.box
          ? <Check label={el.label} checked={s.on} onChange={v => patch(el.id, { on: v })} />
          : <div style={{ fontSize: '.83rem', color: 'var(--s700)' }}>{el.label}</div>}
        {(el.box ? s.on : true) && (el.grupuri?.length || el.texte?.length) ? (
          <div style={{ paddingLeft: '1.4rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
            {el.grupuri?.map((g, gi) => (
              <Chips key={gi} multi={g.multi} value={s.optiuni.filter(o => g.optiuni.some(x => x.tag === o))}
                options={g.optiuni.map(x => ({ value: x.tag, label: x.label }))}
                onChange={v => patch(el.id, { optiuni: [...s.optiuni.filter(o => !g.optiuni.some(x => x.tag === o)), ...v] })} />
            ))}
            {ales && el.texte?.filter(t => !t.pentru || s.optiuni.includes(t.pentru)).map(t => (
              <Field key={t.tag} label={t.label} flex={t.scurt ? 0 : 1} minWidth={t.scurt ? 120 : 200}
                placeholder={t.scurt ? 'nr.' : 'gol = rămâne de completat de mână'}
                value={s.texte[t.tag] ?? ''} onChange={v => patch(el.id, { texte: { ...s.texte, [t.tag]: v } })} />
            ))}
          </div>
        ) : null}
        {ales && el.nota && <div style={{ ...NOTE, paddingLeft: '1.4rem' }}>ℹ️ {el.nota}</div>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
      {catalog.map(g => {
        const n = elementeAlese([g], stare).length
        return (
          <CollapsibleSection key={g.titlu} nested title={g.titlu} open={deschise.has(g.titlu)} onToggle={() => toggleGrup(g.titlu)}
            summary={n ? `${n} ales${n === 1 ? '' : 'e'}` : undefined}>
            {g.elemente.map(renderElement)}
          </CollapsibleSection>
        )
      })}
    </div>
  )
}

// ── Rubrici comune Anexelor 2a și 2b ────────────────────────────────────────────────────────────────────────────────

/** Datele citite dintr-un buletin, pentru rubricile care iau doar o parte din ele (comunicare, facturare, deponent). */
const dinBuletin = (f: IDFields): PersoanaA2A => persoanaDinBuletin({ ...EMPTY_PERSOANA }, f)

/** O rubrică a formularului, actualizată funcțional (două actualizări din același eveniment nu se suprascriu). */
type Update<T> = (f: (prev: T) => T) => void

/** Punctul IV („Subsemnatul”): persoana, regimul matrimonial, calitatea, „prin” și „conform”. */
export function SubsemnatFields({ value, update, candidati, calitati, nota, bindRef }: {
  value: SubsemnatStare
  update: Update<SubsemnatStare>
  candidati: PersoanaCandidat[]
  calitati: string[]
  nota: ReactNode
  bindRef: (id: string) => ElRef
}) {
  const set = (p: Partial<SubsemnatStare>) => update(prev => ({ ...prev, ...p }))
  return (
    <>
      <PersoanaFields candidati={candidati} value={value.sub} sursa={value.subSursa}
        onChange={sub => set({ sub })}
        onSursa={(id, calitate) => update(prev => ({ ...prev, subSursa: id, subCalitate: calitate || prev.subCalitate }))}
        fieldRefs={{ nume: bindRef('sub-nume'), prenume: bindRef('sub-prenume'), cnp: bindRef('sub-cnp') }} />
      {value.subSursa && (
        <>
          <Field label="Regimul matrimonial (după caz)" value={value.subRegim} onChange={v => set({ subRegim: v })} />
          <SubTitle>Calitatea</SubTitle>
          <div className="field" ref={bindRef('sub-calitate')}>
            <Chips value={calitati.includes(value.subCalitate) ? [value.subCalitate] : []} onChange={v => set({ subCalitate: v[0] ?? '' })}
              options={calitati.map(c => ({ value: c, label: c }))} />
            <input className="field-input" style={{ marginTop: '.35rem' }} placeholder="sau scrie altă calitate"
              value={value.subCalitate} onChange={e => set({ subCalitate: e.target.value })} />
          </div>
          <div style={ROW}>
            <Field label="Prin (dacă e cazul)" value={value.subPrin} onChange={v => set({ subPrin: v })} />
            <Field label="Conform" flex={2} value={value.subConform} onChange={v => set({ subConform: v })}
              placeholder={value.subCalitate === 'avocat' ? 'împuternicirii avocațiale nr. … din …' : 'ex. procurii nr. … din …'} />
          </div>
          <div style={NOTE}>{nota}</div>
        </>
      )}
    </>
  )
}

/** Datele firmei clientului („pentru firma …” din punctele cererii), precompletate din fișă. */
export function FirmaFields({ firma, update, cuNrReg, sediu, nota, bindRef }: {
  firma: FirmaA2A
  update: Update<FirmaA2A>
  /** Nr. de înregistrare, CUI și EUID: doar dacă e ales un punct pentru o firmă deja înregistrată. */
  cuNrReg: boolean
  /** Titlul adresei („Sediul social” / „Sediul profesional”). */
  sediu: string
  nota: ReactNode
  bindRef: (id: string) => ElRef
}) {
  const set = (k: keyof FirmaA2A, v: string) => update(prev => ({ ...prev, [k]: v }))
  return (
    <>
      <div style={AUTO_NOTE}>{nota}</div>
      <Field label="Firma" value={firma.firma} onChange={v => set('firma', v)} fieldRef={bindRef('firma-denumire')} />
      {cuNrReg && (
        <div style={ROW}>
          <Field label="Nr. de înregistrare" value={firma.nrReg} onChange={v => update(prev => ({ ...prev, nrReg: v, euid: v ? `ROONRC.${v}` : '' }))} />
          <Field label="CUI" value={firma.cui} onChange={v => set('cui', v)} />
          <Field label="EUID" value={firma.euid} onChange={v => set('euid', v)} />
        </div>
      )}
      <SubTitle>{sediu}</SubTitle>
      <div ref={bindRef('firma-loc')} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        <div ref={bindRef('firma-jud')} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          <AdresaRow v={firma} set={(k, v) => set(k, v)} />
        </div>
      </div>
      <div style={ROW}>
        <Field label="E-mail" value={firma.email} onChange={v => set('email', v)} />
        <Field label="Telefon" value={firma.tel} onChange={v => set('tel', v)} />
        <Field label="Pagina de internet" value={firma.web} onChange={v => set('web', v)} />
      </div>
    </>
  )
}

/** Persoana pentru comunicare: subsemnatul sau altă persoană (cu preluare din buletin). */
export function ComunicareFields({ com, sub, update }: { com: ComunicareOnrc; sub: PersoanaA2A; update: Update<ComunicareOnrc> }) {
  const set = (p: Partial<ComunicareOnrc>) => update(prev => ({ ...prev, ...p }))
  const numeSub = `${sub.nume} ${sub.prenume}`.trim()
  return (
    <>
      <Chips<'sub' | 'manual'> value={[com.sursa]} onChange={v => v[0] && set({ sursa: v[0] })}
        options={[{ value: 'sub', label: `Subsemnatul (IV)${numeSub ? `: ${numeSub}` : ''}` }, { value: 'manual', label: 'Altă persoană' }]} />
      {com.sursa === 'sub' ? (
        <div style={NOTE}>Numele și adresa se iau de la punctul IV ({domiciliuText(sub) || 'adresa necompletată'}).</div>
      ) : (
        <>
          <MiniOCR compact onExtracted={f => {
            const b = dinBuletin(f)
            update(prev => ({ ...prev,
              nume: b.nume || prev.nume, prenume: b.prenume || prev.prenume,
              loc: b.domLoc || prev.loc, str: b.domStr || prev.str, nr: b.domNr || prev.nr, bl: b.domBl || prev.bl,
              sc: b.domSc || prev.sc, et: b.domEt || prev.et, ap: b.domAp || prev.ap, jud: b.domJud || prev.jud,
            }))
          }} />
          <div style={ROW}>
            <Field label="Nume" value={com.nume} onChange={v => set({ nume: v })} />
            <Field label="Prenume" value={com.prenume} onChange={v => set({ prenume: v })} />
          </div>
          <AdresaRow v={com} set={(k, v) => set({ [k]: v })} />
        </>
      )}
      <div style={ROW}>
        <Field label="Cod poștal" value={com.cp} onChange={v => set({ cp: v })} />
        <Field label="Telefon" value={com.tel} onChange={v => set({ tel: v })} />
        <Field label="E-mail" flex={2} value={com.email} onChange={v => set({ email: v })} />
      </div>
    </>
  )
}

/** Datele de facturare: firma, subsemnatul, altă persoană/firmă (cu preluare din buletin) sau necompletate. */
export function FacturareFields({ fact, rezolvat, update, nota }: {
  fact: FacturareOnrc
  /** Datele afișate pentru sursele „firma”/„subsemnatul” (dateFacturare). */
  rezolvat: FacturareOnrc
  update: Update<FacturareOnrc>
  /** Nota formularului despre facturarea pe plătitor (9 la 2a, 10 la 2b). */
  nota: string
}) {
  const set = (p: Partial<FacturareOnrc>) => update(prev => ({ ...prev, ...p }))
  return (
    <>
      <Chips<FacturareOnrc['sursa']> value={[fact.sursa]} onChange={v => v[0] && set({ sursa: v[0] })}
        options={[
          { value: 'firma', label: 'Firma' }, { value: 'sub', label: 'Subsemnatul (IV)' },
          { value: 'manual', label: 'Altă persoană / firmă' }, { value: 'niciuna', label: 'Necompletat' },
        ]} />
      {fact.sursa === 'niciuna' && <div style={NOTE}>{nota}: fără date de facturare, factura se emite pe numele celui care plătește.</div>}
      {(fact.sursa === 'firma' || fact.sursa === 'sub') && (
        <div style={NOTE}>{rezolvat.nume || '—'} · {rezolvat.cnpCui || 'fără CNP/CUI'} · {rezolvat.adresa || 'fără adresă'}</div>
      )}
      {fact.sursa === 'manual' && (
        <>
          <MiniOCR compact onExtracted={f => {
            const b = dinBuletin(f)
            const nume = `${b.nume} ${b.prenume}`.trim()
            const adresa = domiciliuText(b)
            update(prev => ({ ...prev, nume: nume || prev.nume, cnpCui: b.cnp || prev.cnpCui, adresa: adresa || prev.adresa }))
          }} />
          <div style={ROW}>
            <Field label="Nume și prenume / firmă" flex={2} value={fact.nume} onChange={v => set({ nume: v })} />
            <Field label="CNP / CUI" value={fact.cnpCui} onChange={v => set({ cnpCui: v })} />
          </div>
          <Field label="Sediul / adresa" value={fact.adresa} onChange={v => set({ adresa: v })} />
        </>
      )}
      {fact.sursa !== 'niciuna' && (
        <div style={ROW}>
          {fact.sursa !== 'firma' && <Field label="E-mail" value={fact.email} onChange={v => set({ email: v })} />}
          <Field label="Banca" value={fact.banca} onChange={v => set({ banca: v })} />
          <Field label="Cont IBAN" flex={2} value={fact.iban} onChange={v => set({ iban: v })} />
        </div>
      )}
    </>
  )
}

/** Deponentul (doar dacă e altă persoană decât semnatarul), cu preluare din buletin. */
export function DeponentFields({ dep, update, eticheta, bindRef }: {
  dep: DeponentOnrc
  update: Update<DeponentOnrc>
  /** Textul casetei (ex. „XII. Cererea o depune altă persoană decât semnatarul (nota 12)”). */
  eticheta: string
  bindRef: (id: string) => ElRef
}) {
  const set = (p: Partial<DeponentOnrc>) => update(prev => ({ ...prev, ...p }))
  return (
    <>
      <Check label={eticheta} checked={dep.activ} onChange={v => set({ activ: v })} />
      {dep.activ && (
        <>
          <MiniOCR compact onExtracted={f => {
            const b = dinBuletin(f)
            update(prev => ({ ...prev,
              nume: b.nume || prev.nume, prenume: b.prenume || prev.prenume, cnp: b.cnp || prev.cnp,
              actSeria: b.actSeria || prev.actSeria, actNr: b.actNr || prev.actNr,
            }))
          }} />
          <div style={ROW} ref={bindRef('dep-nume')}>
            <Field label="Nume" value={dep.nume} onChange={v => set({ nume: v })} />
            <Field label="Prenume" value={dep.prenume} onChange={v => set({ prenume: v })} />
            <Field label="CNP" value={dep.cnp} onChange={v => set({ cnp: v })} />
          </div>
          <div style={ROW}>
            <Field label="Act identitate" minWidth={70} value={dep.actTip} onChange={v => set({ actTip: v })} />
            <Field label="Seria" minWidth={70} value={dep.actSeria} onChange={v => set({ actSeria: v })} />
            <Field label="Nr." value={dep.actNr} onChange={v => set({ actNr: v })} />
          </div>
          <div style={ROW}>
            <Field label="În calitate de" value={dep.calitate} onChange={v => set({ calitate: v })} fieldRef={bindRef('dep-calitate')} />
            <Field label="Conform" flex={2} value={dep.conform} onChange={v => set({ conform: v })} placeholder="ex. împuternicirii" />
            <Field label="Nr." minWidth={60} value={dep.conformNr} onChange={v => set({ conformNr: v })} />
            <FieldDate label="Din" value={dep.conformData} onChange={v => set({ conformData: v })} />
          </div>
        </>
      )}
    </>
  )
}
