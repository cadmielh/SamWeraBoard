import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Client, Persoana } from '../types'
import {
  companyCaenOptions, extractJudet, parseAdresa, formatAdresa, splitSerieNumar,
  buildDeclaratieDocxData, EMPTY_DECLARANT, EMPTY_ADRESA,
} from '../lib/declaratieActivitateFiller'
import type { AdresaStructurata, DeclarantFormFields, DeclaratieFormState, SediuSecundarRow } from '../lib/declaratieActivitateFiller'
import type { ClientPatchProposal } from '../lib/clauseFieldSpecs'
import { JUDETE_ROMANIA } from '../lib/counties'
import { roDateToISO, isoDateToRo } from '../lib/dates'
import Combobox from './Combobox'

export interface DeclaratieFormValue {
  replacements: Record<string, string>
  rowGroups: Record<string, Record<string, string>[]>
  isComplete: boolean
  clientPatches: ClientPatchProposal[]
  /** Câte dintre câmpurile obligatorii sunt completate (baza procentului afișat lângă șablon). Numărătoarea include
   * mereu câmpurile declarantului, chiar înainte de alegerea lui, ca procentul să nu scadă după alegere. */
  completion: { done: number; total: number; missing: string[] }
}

interface Props {
  client?: Partial<Client> | null
  onChange: (value: DeclaratieFormValue) => void
}

export interface DeclaratieActivitateFillerHandle {
  /** Derulează/focalizează primul câmp obligatoriu necompletat; returnează
   * eticheta fiecărui câmp lipsă (listă goală dacă totul e complet) — același
   * tipar ca CompanyInfoFormHandle.scrollToFirstMissing, folosit de
   * TemplateFiller la click pe "Generează" în loc de a ține butonul disabled. */
  scrollToFirstMissing: () => string[]
}

type ElRef = (el: HTMLElement | null) => void

const MAX_SEDII_SECUNDARE = 30

// Client.sediuSocial e deja structurat (localitate/stradă/nr/bloc/scară/etaj/
// ap/județ) — nu mai are sens reparsarea unui string, doar fallback la un
// obiect gol pentru clienți fără sediu completat încă.
function sediuFromClient(client?: Partial<Client> | null): DeclaratieFormState['sediu'] {
  return client?.sediuSocial ?? { ...EMPTY_ADRESA }
}

interface DeclarantCandidate {
  label: string
  persoana: Persoana
  // Unde anume trăiește persoana în profilul clientului — necesar ca să
  // putem propune un patch înapoi (vezi persoanaFromDeclarant) care scrie
  // exact în locul potrivit, nu doar undeva generic.
  source: 'asociati' | 'administratori' | 'titular'
  index: number
}

function declarantCandidates(client?: Partial<Client> | null): DeclarantCandidate[] {
  const list: DeclarantCandidate[] = []
  const seen = new Set<string>()
  const addAll = (arr: Persoana[] | undefined, source: 'asociati' | 'administratori') => {
    (arr ?? []).forEach((p, index) => {
      const label = `${p.nume} ${p.prenume}`.trim()
      if (!label || seen.has(label)) return
      seen.add(label)
      list.push({ label, persoana: p, source, index })
    })
  }
  addAll(client?.asociati, 'asociati')
  addAll(client?.administratori, 'administratori')
  if (client?.tipClient === 'PF' && client.titular) {
    const label = `${client.titular.nume} ${client.titular.prenume}`.trim()
    if (label && !seen.has(label)) list.push({ label, persoana: client.titular, source: 'titular', index: 0 })
  }
  return list
}

function declarantFromPersoana(p: Persoana): DeclarantFormFields {
  const domiciliu = parseAdresa(p.adresa)
  const domiciliuJudet = p.judet || extractJudet(p.adresa)
  const nastere = parseAdresa(p.locul_nasterii)
  const nastereJudet = extractJudet(p.locul_nasterii)
  const { serie, numar } = splitSerieNumar(p.serie_numar)
  return {
    nume: p.nume, prenume: p.prenume, cnp: p.cnp,
    domiciliu, domiciliuJudet,
    tara: 'România', cetatenia: p.cetatenia || '',
    nasterelocalitate: nastere.localitate, nastereJudet, nastereTara: 'România', nastereData: p.data_nasterii || '',
    actTip: 'Carte de identitate', actSerie: serie, actNumar: numar,
    actEmisDe: p.emisa_de || '', actValabilDeLa: p.valabila_de_la || '', actValabilPanaLa: p.valabila_pana_la || '',
    calitate: p.calitate || '',
  }
}

/** Inversul lui declarantFromPersoana — reasamblează Persoana pornind de la
 * ce a editat userul în formular, ca modificările (CNP, date CI, domiciliu
 * etc.) să poată fi propuse înapoi în profilul clientului, nu doar folosite
 * pentru documentul curent. */
function persoanaFromDeclarant(original: Persoana, d: DeclarantFormFields): Persoana {
  return {
    ...original,
    nume: d.nume,
    prenume: d.prenume,
    cnp: d.cnp,
    serie_numar: (d.actSerie || d.actNumar) ? `${d.actSerie} ${d.actNumar}`.trim() : '',
    data_nasterii: d.nastereData,
    locul_nasterii: [d.nasterelocalitate, d.nastereJudet].filter(Boolean).join(', '),
    cetatenia: d.cetatenia,
    adresa: formatAdresa(d.domiciliu),
    judet: d.domiciliuJudet,
    emisa_de: d.actEmisDe,
    valabila_de_la: d.actValabilDeLa,
    valabila_pana_la: d.actValabilPanaLa,
    calitate: d.calitate,
  }
}

const AUTO_NOTE_STYLE: CSSProperties = {
  fontSize: '.72rem', color: 'var(--y700)', background: 'var(--y50)',
  border: '1px solid var(--y200)', borderRadius: 4, padding: '.25rem .5rem', marginBottom: '.5rem',
}

function SectionCard({ title, children, containerRef }: { title: string; children: ReactNode; containerRef?: ElRef }) {
  return (
    <div ref={containerRef} style={{ border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div style={{ fontWeight: 700, fontSize: '.75rem', color: 'var(--s600)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</div>
      {children}
    </div>
  )
}

// Subtitlu de grup de câmpuri (ex. "Domiciliul", "Născut(ă)") — stil distinct
// de eticheta unui câmp (.field-label), altfel se confundau vizual: aici text
// normal (nu uppercase), mai mare, cu o linie deasupra ca separator.
function SubTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: '.825rem', fontWeight: 700, color: 'var(--p600)',
      paddingTop: '.625rem', marginTop: '.125rem', borderTop: '1px dashed var(--s200)',
    }}>
      {children}
    </div>
  )
}

function Field({ label, value, onChange, flex = 1, placeholder, fieldRef }: {
  label: string; value: string; onChange: (v: string) => void; flex?: number; placeholder?: string; fieldRef?: ElRef
}) {
  return (
    <div className="field" style={{ flex, minWidth: 0 }}>
      <label className="field-label">{label}</label>
      <input ref={fieldRef} className="field-input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function FieldDate({ label, value, onChange, flex = 1, fieldRef }: {
  label: string; value: string; onChange: (v: string) => void; flex?: number; fieldRef?: ElRef
}) {
  return (
    <div className="field" style={{ flex, minWidth: 0 }}>
      <label className="field-label">{label}</label>
      <input
        ref={fieldRef} className="field-input" type="date"
        value={roDateToISO(value)}
        onChange={e => onChange(isoDateToRo(e.target.value))}
      />
    </div>
  )
}

function FieldJudet({ label, value, onChange, flex = 1, fieldRef }: {
  label: string; value: string; onChange: (v: string) => void; flex?: number; fieldRef?: ElRef
}) {
  return (
    <div className="field" ref={fieldRef} style={{ flex, minWidth: 0 }}>
      <label className="field-label">{label}</label>
      <Combobox value={value} options={JUDETE_ROMANIA} onChange={onChange} placeholder="Județ / Sector" />
    </div>
  )
}

function AdresaFields({ value, onChange, judet, fieldRefs }: {
  value: AdresaStructurata
  onChange: (v: AdresaStructurata) => void
  // Opțional — când e prezent, județul apare ca primul câmp de pe primul
  // rând, iar Stradă/Nr. se restrâng (nu au nevoie de mult spațiu).
  judet?: { value: string; onChange: (v: string) => void; fieldRef?: ElRef }
  // Chei posibile: localitate, strada, numar — restul (bloc/scară/etaj/ap) nu
  // sunt obligatorii, deci n-au nevoie de ref de validare.
  fieldRefs?: Partial<Record<'localitate' | 'strada' | 'numar', ElRef>>
}) {
  const set = (k: keyof AdresaStructurata, v: string) => onChange({ ...value, [k]: v })
  return (
    <>
      <div style={{ display: 'flex', gap: '.5rem' }}>
        {judet && <FieldJudet label="Județ / Sector" flex={1} value={judet.value} onChange={judet.onChange} fieldRef={judet.fieldRef} />}
        <Field label="Localitate" flex={2} value={value.localitate} onChange={v => set('localitate', v)} fieldRef={fieldRefs?.localitate} />
        <Field label="Stradă" flex={judet ? 1 : 2} value={value.strada} onChange={v => set('strada', v)} fieldRef={fieldRefs?.strada} />
        <Field label="Nr." flex={judet ? .6 : 1} value={value.numar} onChange={v => set('numar', v)} fieldRef={fieldRefs?.numar} />
      </div>
      <div style={{ display: 'flex', gap: '.5rem' }}>
        <Field label="Bloc" value={value.bloc} onChange={v => set('bloc', v)} />
        <Field label="Scară" value={value.scara} onChange={v => set('scara', v)} />
        <Field label="Etaj" value={value.etaj} onChange={v => set('etaj', v)} />
        <Field label="Apartament" value={value.apartament} onChange={v => set('apartament', v)} />
      </div>
    </>
  )
}

function CaenChecklist({ options, selected, onSelectAll, onDeselectAll, onToggle }: {
  options: { cod: string; descriere: string }[]
  selected: string[]
  onToggle: (cod: string) => void
  // Absent pentru checklist-urile fără "selectează tot" (nu e cazul aici,
  // păstrat pentru compatibilitate cu apelurile existente).
  onSelectAll?: () => void
  onDeselectAll?: () => void
}) {
  if (options.length === 0) {
    return <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}>Clientul nu are niciun cod CAEN înregistrat în profil.</div>
  }
  const allSelected = selected.length >= options.length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
      {onSelectAll && onDeselectAll && options.length > 1 && (
        <button
          type="button" className="btn btn-ghost btn-xs" style={{ alignSelf: 'flex-start' }}
          onClick={allSelected ? onDeselectAll : onSelectAll}
        >
          {allSelected ? 'Deselectează tot' : 'Selectează tot'}
        </button>
      )}
      {options.map(o => (
        <label key={o.cod} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.83rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={selected.includes(o.cod)} onChange={() => onToggle(o.cod)} />
          <span style={{ fontWeight: 700, color: 'var(--s700)', flexShrink: 0 }}>{o.cod}</span>
          <span style={{ color: 'var(--s600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.descriere}</span>
        </label>
      ))}
    </div>
  )
}

const DeclaratieActivitateFiller = forwardRef<DeclaratieActivitateFillerHandle, Props>(function DeclaratieActivitateFiller({ client, onChange }, ref) {
  const candidates = declarantCandidates(client)
  const defaultChoice = candidates.length === 1 ? candidates[0].label : ''

  const [declarantChoice, setDeclarantChoice] = useState(defaultChoice)
  const [sediu, setSediu] = useState(() => sediuFromClient(client))
  const [declarant, setDeclarant] = useState<DeclarantFormFields>(() => {
    const c = candidates.find(c => c.label === defaultChoice)
    return c ? declarantFromPersoana(c.persoana) : { ...EMPTY_DECLARANT }
  })
  const [caenSediu, setCaenSediu] = useState<string[]>(() => companyCaenOptions(client).map(o => o.cod))
  const [caenTerti, setCaenTerti] = useState<string[]>([])
  const [sediiSecundare, setSediiSecundare] = useState<SediuSecundarRow[]>([])
  // Nu există niciun efect care re-derivă sediul/declarantul dintr-un `client`
  // schimbat: componenta e montată cu key={client.id} din TemplateFiller, deci
  // un client diferit înseamnă o instanță nouă (stare inițială proaspătă),
  // nu o resetare manuală de state într-un efect.

  const selectDeclarant = (label: string) => {
    setDeclarantChoice(label)
    if (label === '__manual__') {
      setDeclarant({ ...EMPTY_DECLARANT })
      return
    }
    const c = candidates.find(c => c.label === label)
    setDeclarant(c ? declarantFromPersoana(c.persoana) : { ...EMPTY_DECLARANT })
  }

  const caenOptions = companyCaenOptions(client)
  const toggleCaen = (list: string[], set: (v: string[]) => void, cod: string) =>
    set(list.includes(cod) ? list.filter(c => c !== cod) : [...list, cod])

  const puncteLucruExistente = client?.puncteLucru ?? []
  // Per rând: "alege din puncteLucru existente" (implicit, dacă există) sau
  // "adresă nouă" (text liber) — separat de valoarea adresei, ca userul să
  // poată comuta fără să-i ștergem ce a scris deja.
  const [rowManual, setRowManual] = useState<boolean[]>([])
  const setRowMode = (i: number, manual: boolean) => setRowManual(prev => prev.map((v, idx) => idx === i ? manual : v))
  const addSediuSecundar = () => {
    setSediiSecundare(prev => [...prev, { adresa: '', caenCodes: [] }])
    setRowManual(prev => [...prev, puncteLucruExistente.length === 0])
  }
  const updateSediuSecundar = (i: number, patch: Partial<SediuSecundarRow>) =>
    setSediiSecundare(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const removeSediuSecundar = (i: number) => {
    setSediiSecundare(prev => prev.filter((_, idx) => idx !== i))
    setRowManual(prev => prev.filter((_, idx) => idx !== i))
  }
  const toggleSediuSecundarCaen = (i: number, cod: string) =>
    setSediiSecundare(prev => prev.map((r, idx) => {
      if (idx !== i) return r
      const has = r.caenCodes.includes(cod)
      return has ? { ...r, caenCodes: r.caenCodes.filter(c => c !== cod) } : { ...r, caenCodes: [...r.caenCodes, cod] }
    }))
  const setSediuSecundarCaen = (i: number, caenCodes: string[]) =>
    setSediiSecundare(prev => prev.map((r, idx) => idx === i ? { ...r, caenCodes } : r))

  const cnpValid = !declarant.cnp || /^\d{13}$/.test(declarant.cnp)
  const cnpComplete = !!declarant.cnp && cnpValid

  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  // Callback ref standard React (rulează la commit, nu la render) — regula
  // nouă react-hooks/refs nu distinge asta de o scriere directă în timpul
  // randării, deci flagează fals orice fabrică de callback-uri ca aceasta.
  // eslint-disable-next-line react-hooks/refs
  const bindRef = (id: string): ElRef => el => { fieldRefs.current[id] = el }

  const anyCaenAnywhere = caenSediu.length > 0 || caenTerti.length > 0 || sediiSecundare.some(r => r.adresa && r.caenCodes.length > 0)

  // Sursă unică pentru validare — folosită atât de scrollToFirstMissing (care
  // mai și derulează spre primul câmp lipsă), cât și pentru `isComplete`
  // raportat prin onChange, ca cele două să nu poată ajunge vreodată în dezacord.
  const buildValidationChecks = (includeDeclarant = false): { invalid: boolean; id: string; message: string }[] => {
    const checks: { invalid: boolean; id: string; message: string }[] = [
      { invalid: !sediu.localitate.trim(), id: 'sediu-localitate', message: 'localitatea sediului' },
      { invalid: !sediu.strada.trim(), id: 'sediu-strada', message: 'strada sediului' },
      { invalid: !sediu.numar.trim(), id: 'sediu-nr', message: 'numărul sediului' },
      { invalid: !sediu.judet.trim(), id: 'sediu-judet', message: 'județul sediului' },
      { invalid: !declarantChoice.trim(), id: 'declarant-choice', message: 'persoana declarantului' },
    ]
    // Câmpurile declarantului nu sunt randate până nu se alege o persoană —
    // n-are sens să le cerem înainte (și n-ar avea nici ref de derulat spre ele).
    if (declarantChoice.trim() || includeDeclarant) {
      checks.push(
        { invalid: !declarant.nume.trim(), id: 'declarant-nume', message: 'numele declarantului' },
        { invalid: !declarant.prenume.trim(), id: 'declarant-prenume', message: 'prenumele declarantului' },
        { invalid: !cnpComplete, id: 'declarant-cnp', message: 'CNP-ul declarantului' },
        { invalid: !declarant.domiciliu.localitate.trim(), id: 'declarant-domiciliu-localitate', message: 'localitatea domiciliului' },
        { invalid: !declarant.domiciliu.strada.trim(), id: 'declarant-domiciliu-strada', message: 'strada domiciliului' },
        { invalid: !declarant.domiciliu.numar.trim(), id: 'declarant-domiciliu-nr', message: 'numărul domiciliului' },
        { invalid: !declarant.domiciliuJudet.trim(), id: 'declarant-domiciliu-judet', message: 'județul domiciliului' },
        { invalid: !declarant.tara.trim(), id: 'declarant-tara', message: 'țara domiciliului' },
        { invalid: !declarant.cetatenia.trim(), id: 'declarant-cetatenia', message: 'cetățenia' },
        { invalid: !declarant.nasterelocalitate.trim(), id: 'declarant-nastere-localitate', message: 'localitatea nașterii' },
        { invalid: !declarant.nastereJudet.trim(), id: 'declarant-nastere-judet', message: 'județul nașterii' },
        { invalid: !declarant.nastereTara.trim(), id: 'declarant-nastere-tara', message: 'țara nașterii' },
        { invalid: !declarant.nastereData.trim(), id: 'declarant-nastere-data', message: 'data nașterii' },
        { invalid: !declarant.actTip.trim(), id: 'declarant-act-tip', message: 'tipul actului de identitate' },
        { invalid: !declarant.actSerie.trim(), id: 'declarant-act-serie', message: 'seria actului' },
        { invalid: !declarant.actNumar.trim(), id: 'declarant-act-numar', message: 'numărul actului' },
        { invalid: !declarant.actEmisDe.trim(), id: 'declarant-act-emisde', message: 'emitentul actului' },
        { invalid: !declarant.actValabilDeLa.trim(), id: 'declarant-act-valabildela', message: 'data emiterii actului' },
        { invalid: !declarant.actValabilPanaLa.trim(), id: 'declarant-act-valabilpanala', message: 'valabilitatea actului' },
        { invalid: !declarant.calitate.trim(), id: 'declarant-calitate', message: 'calitatea declarantului' },
      )
    }
    checks.push({ invalid: !anyCaenAnywhere, id: 'caen-section', message: 'cel puțin un cod CAEN (sediu, terți sau sediu secundar)' })
    sediiSecundare.forEach((row, i) => {
      checks.push({ invalid: !row.adresa.trim() || row.caenCodes.length === 0, id: `sediu-secundar-${i}`, message: `adresa și codul CAEN ale sediului secundar #${i + 1}` })
    })
    return checks
  }

  useImperativeHandle(ref, () => ({
    scrollToFirstMissing: () => {
      const failing = buildValidationChecks().filter(c => c.invalid)
      if (failing.length > 0) {
        const el = fieldRefs.current[failing[0].id]
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el?.focus()
      }
      return failing.map(c => c.message)
    },
  }))

  useEffect(() => {
    const state: DeclaratieFormState = { sediu, declarant, caenSediu, caenTerti, sediiSecundare }
    const { replacements, rowGroups } = buildDeclaratieDocxData(state, client)

    const isComplete = buildValidationChecks().every(c => !c.invalid)
    const allChecks = buildValidationChecks(true)
    const completion = {
      total: allChecks.length,
      done: allChecks.filter(c => !c.invalid).length,
      missing: allChecks.filter(c => c.invalid).map(c => c.message),
    }

    const noiAdrese = sediiSecundare.map(r => r.adresa).filter(Boolean).filter(a => !puncteLucruExistente.includes(a))
    const clientPatches: ClientPatchProposal[] = noiAdrese.length > 0 ? [{
      label: `Adaugă ${noiAdrese.length} sediu${noiAdrese.length === 1 ? '' : 'i'} secundar${noiAdrese.length === 1 ? '' : 'e'} în profilul clientului: ${noiAdrese.join('; ')}`,
      patch: { puncteLucru: [...puncteLucruExistente, ...noiAdrese] },
    }] : []

    // Datele declarantului (CNP, act de identitate, domiciliu…) completate/corectate
    // aici nu se salvau nicăieri înapoi în profil — userul le reintroducea la fiecare
    // generare. Le propunem ca patch, la fel ca adresele noi, doar dacă declarantul
    // e o persoană existentă (nu "Reprezentant/altă persoană", care n-are unde fi
    // salvată) și doar dacă a chiar diferă de ce e deja salvat.
    const selectedCandidate = candidates.find(c => c.label === declarantChoice)
    if (selectedCandidate) {
      const updated = persoanaFromDeclarant(selectedCandidate.persoana, declarant)
      if (JSON.stringify(updated) !== JSON.stringify(selectedCandidate.persoana)) {
        const numeComplet = `${declarant.nume} ${declarant.prenume}`.trim()
        if (selectedCandidate.source === 'titular') {
          clientPatches.push({ label: `Actualizează datele declarantului: ${numeComplet}`, patch: { titular: updated } })
        } else {
          const arr = selectedCandidate.source === 'asociati' ? (client?.asociati ?? []) : (client?.administratori ?? [])
          const noi = arr.map((p, i) => i === selectedCandidate.index ? updated : p)
          clientPatches.push({ label: `Actualizează datele declarantului: ${numeComplet}`, patch: { [selectedCandidate.source]: noi } })
        }
      }
    }

    onChange({ replacements, rowGroups, isComplete, clientPatches, completion })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sediu, declarant, declarantChoice, caenSediu, caenTerti, sediiSecundare, client])

  const summary = `Declarant: ${declarant.nume || declarant.prenume ? `${declarant.nume} ${declarant.prenume}`.trim() : '—'}` +
    ` · ${caenSediu.length} CAEN la sediu · ${caenTerti.length} la terți · ${sediiSecundare.filter(r => r.adresa).length} sedii secundare`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
      <SectionCard title="Sediul social/profesional">
        <div style={AUTO_NOTE_STYLE}>Completat automat din profil — verifică.</div>
        <AdresaFields
          value={sediu}
          onChange={v => setSediu({ ...sediu, ...v })}
          judet={{ value: sediu.judet, onChange: v => setSediu({ ...sediu, judet: v }), fieldRef: bindRef('sediu-judet') }}
          fieldRefs={{ localitate: bindRef('sediu-localitate'), strada: bindRef('sediu-strada'), numar: bindRef('sediu-nr') }}
        />
      </SectionCard>

      <SectionCard title="1. Subsemnatul(a) — declarant">
        <div className="field">
          <label className="field-label">Persoană</label>
          <select ref={bindRef('declarant-choice')} className="field-input" value={declarantChoice} onChange={e => selectDeclarant(e.target.value)}>
            <option value="">— alege —</option>
            {candidates.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
            <option value="__manual__">+ Reprezentant/altă persoană</option>
          </select>
        </div>

        {declarantChoice && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {declarantChoice !== '__manual__' && <div style={AUTO_NOTE_STYLE}>Completat automat din profil — verifică.</div>}

            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Field label="Nume" value={declarant.nume} onChange={v => setDeclarant({ ...declarant, nume: v })} fieldRef={bindRef('declarant-nume')} />
              <Field label="Prenume" value={declarant.prenume} onChange={v => setDeclarant({ ...declarant, prenume: v })} fieldRef={bindRef('declarant-prenume')} />
              <div className="field" style={{ flex: 1, minWidth: 0 }}>
                <label className="field-label">CNP</label>
                <input ref={bindRef('declarant-cnp')} className="field-input" value={declarant.cnp} onChange={e => setDeclarant({ ...declarant, cnp: e.target.value })} />
                {!cnpValid && <div style={{ fontSize: '.7rem', color: 'var(--y700)', marginTop: '.15rem' }}>⚠️ CNP-ul nu are 13 cifre</div>}
              </div>
            </div>

            <SubTitle>Domiciliul</SubTitle>
            <AdresaFields
              value={declarant.domiciliu} onChange={v => setDeclarant({ ...declarant, domiciliu: v })}
              fieldRefs={{ localitate: bindRef('declarant-domiciliu-localitate'), strada: bindRef('declarant-domiciliu-strada'), numar: bindRef('declarant-domiciliu-nr') }}
            />
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <FieldJudet label="Județ / Sector" value={declarant.domiciliuJudet} onChange={v => setDeclarant({ ...declarant, domiciliuJudet: v })} fieldRef={bindRef('declarant-domiciliu-judet')} />
              <Field label="Țara" value={declarant.tara} onChange={v => setDeclarant({ ...declarant, tara: v })} fieldRef={bindRef('declarant-tara')} />
              <Field label="Cetățenia" value={declarant.cetatenia} onChange={v => setDeclarant({ ...declarant, cetatenia: v })} fieldRef={bindRef('declarant-cetatenia')} />
            </div>

            <SubTitle>Născut(ă)</SubTitle>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Field label="Localitatea" flex={2} value={declarant.nasterelocalitate} onChange={v => setDeclarant({ ...declarant, nasterelocalitate: v })} fieldRef={bindRef('declarant-nastere-localitate')} />
              <FieldJudet label="Județ / Sector" value={declarant.nastereJudet} onChange={v => setDeclarant({ ...declarant, nastereJudet: v })} fieldRef={bindRef('declarant-nastere-judet')} />
              <Field label="Țara" value={declarant.nastereTara} onChange={v => setDeclarant({ ...declarant, nastereTara: v })} fieldRef={bindRef('declarant-nastere-tara')} />
              <FieldDate label="Data nașterii" value={declarant.nastereData} onChange={v => setDeclarant({ ...declarant, nastereData: v })} fieldRef={bindRef('declarant-nastere-data')} />
            </div>

            <SubTitle>Act de identitate</SubTitle>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Field label="Tip" value={declarant.actTip} onChange={v => setDeclarant({ ...declarant, actTip: v })} fieldRef={bindRef('declarant-act-tip')} />
              <Field label="Serie" value={declarant.actSerie} onChange={v => setDeclarant({ ...declarant, actSerie: v })} fieldRef={bindRef('declarant-act-serie')} />
              <Field label="Număr" value={declarant.actNumar} onChange={v => setDeclarant({ ...declarant, actNumar: v })} fieldRef={bindRef('declarant-act-numar')} />
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Field label="Emis de" flex={2} value={declarant.actEmisDe} onChange={v => setDeclarant({ ...declarant, actEmisDe: v })} fieldRef={bindRef('declarant-act-emisde')} />
              <FieldDate label="Valabil de la" value={declarant.actValabilDeLa} onChange={v => setDeclarant({ ...declarant, actValabilDeLa: v })} fieldRef={bindRef('declarant-act-valabildela')} />
              <FieldDate label="Valabil până la" value={declarant.actValabilPanaLa} onChange={v => setDeclarant({ ...declarant, actValabilPanaLa: v })} fieldRef={bindRef('declarant-act-valabilpanala')} />
            </div>

            <Field label="Calitate (asociat / administrator / reprezentant...)" value={declarant.calitate} onChange={v => setDeclarant({ ...declarant, calitate: v })} fieldRef={bindRef('declarant-calitate')} />
          </div>
        )}
      </SectionCard>

      <SectionCard title="3.1 Sediu social/profesional — coduri CAEN" containerRef={bindRef('caen-section')}>
        <CaenChecklist
          options={caenOptions} selected={caenSediu} onToggle={cod => toggleCaen(caenSediu, setCaenSediu, cod)}
          onSelectAll={() => setCaenSediu(caenOptions.map(o => o.cod))}
          onDeselectAll={() => setCaenSediu([])}
        />
      </SectionCard>

      <SectionCard title="3.2 Activități desfășurate la terți">
        <CaenChecklist
          options={caenOptions} selected={caenTerti} onToggle={cod => toggleCaen(caenTerti, setCaenTerti, cod)}
          onSelectAll={() => setCaenTerti(caenOptions.map(o => o.cod))}
          onDeselectAll={() => setCaenTerti([])}
        />
      </SectionCard>

      <SectionCard title="3.3 Sedii secundare">
        {sediiSecundare.length === 0 && puncteLucruExistente.length === 0 && (
          <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}>Niciun punct de lucru înregistrat.</div>
        )}
        {sediiSecundare.map((row, i) => {
          const manual = rowManual[i] ?? puncteLucruExistente.length === 0
          return (
            <div key={i} ref={bindRef(`sediu-secundar-${i}`)} style={{ border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.5rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              <div style={{ display: 'flex', gap: '.375rem', alignItems: 'flex-start' }}>
                <div className="field" style={{ flex: 1, minWidth: 0 }}>
                  <label className="field-label">Adresă</label>
                  {puncteLucruExistente.length > 0 && (
                    <div style={{ display: 'flex', gap: '.375rem', marginBottom: '.3rem' }}>
                      <button type="button" className={`btn btn-sm ${!manual ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setRowMode(i, false)}>Adresă existentă</button>
                      <button type="button" className={`btn btn-sm ${manual ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setRowMode(i, true)}>+ Adresă nouă</button>
                    </div>
                  )}
                  {manual ? (
                    <input className="field-input" placeholder="Adresă nouă" value={row.adresa} onChange={e => updateSediuSecundar(i, { adresa: e.target.value })} />
                  ) : (
                    <select className="field-input" value={row.adresa} onChange={e => updateSediuSecundar(i, { adresa: e.target.value })}>
                      <option value="">— alege —</option>
                      {puncteLucruExistente.map((a, idx) => <option key={idx} value={a}>{a}</option>)}
                    </select>
                  )}
                </div>
                <button type="button" onClick={() => removeSediuSecundar(i)} style={{ ...BTN_X, marginTop: '1.4rem' }}>×</button>
              </div>
              <div className="field">
                <label className="field-label">Coduri CAEN</label>
                <CaenChecklist
                  options={caenOptions} selected={row.caenCodes} onToggle={cod => toggleSediuSecundarCaen(i, cod)}
                  onSelectAll={() => setSediuSecundarCaen(i, caenOptions.map(o => o.cod))}
                  onDeselectAll={() => setSediuSecundarCaen(i, [])}
                />
              </div>
            </div>
          )
        })}
        {sediiSecundare.length < MAX_SEDII_SECUNDARE && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={addSediuSecundar} style={{ alignSelf: 'flex-start' }}>
            + Adaugă sediu secundar
          </button>
        )}
      </SectionCard>

      <div style={{ fontSize: '.8rem', color: 'var(--s600)', fontWeight: 600 }}>{summary}</div>
    </div>
  )
})

export default DeclaratieActivitateFiller

const BTN_X: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: '.125rem .25rem' }
