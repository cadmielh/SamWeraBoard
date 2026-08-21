import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Client, Persoana } from '../types'
import {
  companyCaenOptions, extractJudet, parseAdresa, splitSerieNumar,
  buildPdfFieldValues, EMPTY_DECLARANT,
} from '../lib/pdfFiller'
import type { AdresaParsed, DeclarantFormFields, DeclaratieFormState, SediuSecundarRow } from '../lib/pdfFiller'
import type { ClientPatchProposal } from '../lib/clauseFieldSpecs'
import { JUDETE_ROMANIA } from '../lib/counties'
import Combobox from './Combobox'

export interface PdfFormValue {
  fieldValues: Record<string, string>
  isComplete: boolean
  clientPatches: ClientPatchProposal[]
}

interface Props {
  client?: Partial<Client> | null
  onChange: (value: PdfFormValue) => void
}

const MAX_SEDII_SECUNDARE = 13

function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

function sediuFromClient(client?: Partial<Client> | null): DeclaratieFormState['sediu'] {
  const parsed = parseAdresa(client?.sediuSocial)
  const judet = extractJudet(client?.sediuSocial)
  return { ...parsed, judet }
}

interface DeclarantCandidate {
  label: string
  persoana: Persoana
}

function declarantCandidates(client?: Partial<Client> | null): DeclarantCandidate[] {
  const list: DeclarantCandidate[] = []
  const seen = new Set<string>()
  const addAll = (arr: Persoana[] | undefined) => {
    for (const p of arr ?? []) {
      const label = `${p.nume} ${p.prenume}`.trim()
      if (!label || seen.has(label)) continue
      seen.add(label)
      list.push({ label, persoana: p })
    }
  }
  addAll(client?.asociati)
  addAll(client?.administratori)
  if (client?.tipClient === 'PF' && client.titular) addAll([client.titular])
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

const AUTO_NOTE_STYLE: CSSProperties = {
  fontSize: '.72rem', color: 'var(--y700)', background: 'var(--y50)',
  border: '1px solid var(--y200)', borderRadius: 4, padding: '.25rem .5rem', marginBottom: '.5rem',
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
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

function Field({ label, value, onChange, flex = 1, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; flex?: number; placeholder?: string
}) {
  return (
    <div className="field" style={{ flex, minWidth: 0 }}>
      <label className="field-label">{label}</label>
      <input className="field-input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function FieldJudet({ label, value, onChange, flex = 1 }: {
  label: string; value: string; onChange: (v: string) => void; flex?: number
}) {
  return (
    <div className="field" style={{ flex, minWidth: 0 }}>
      <label className="field-label">{label}</label>
      <Combobox value={value} options={JUDETE_ROMANIA} onChange={onChange} placeholder="Județul" />
    </div>
  )
}

function AdresaFields({ value, onChange, judet }: {
  value: AdresaParsed
  onChange: (v: AdresaParsed) => void
  // Opțional — când e prezent, județul apare ca primul câmp de pe primul
  // rând, iar Stradă/Nr. se restrâng (nu au nevoie de mult spațiu).
  judet?: { value: string; onChange: (v: string) => void }
}) {
  const set = (k: keyof AdresaParsed, v: string) => onChange({ ...value, [k]: v })
  return (
    <>
      <div style={{ display: 'flex', gap: '.5rem' }}>
        {judet && <FieldJudet label="Județ/sector" flex={1} value={judet.value} onChange={judet.onChange} />}
        <Field label="Localitate" flex={2} value={value.localitate} onChange={v => set('localitate', v)} />
        <Field label="Stradă" flex={judet ? 1 : 2} value={value.strada} onChange={v => set('strada', v)} />
        <Field label="Nr." flex={judet ? .6 : 1} value={value.nr} onChange={v => set('nr', v)} />
      </div>
      <div style={{ display: 'flex', gap: '.5rem' }}>
        <Field label="Bloc" value={value.bloc} onChange={v => set('bloc', v)} />
        <Field label="Scară" value={value.scara} onChange={v => set('scara', v)} />
        <Field label="Etaj" value={value.etaj} onChange={v => set('etaj', v)} />
        <Field label="Apartament" value={value.ap} onChange={v => set('ap', v)} />
      </div>
    </>
  )
}

function CaenChecklist({ options, selected, onToggle }: {
  options: { cod: string; descriere: string }[]
  selected: string[]
  onToggle: (cod: string) => void
}) {
  if (options.length === 0) {
    return <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}>Clientul nu are niciun cod CAEN înregistrat în profil.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
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

export default function PdfFormFiller({ client, onChange }: Props) {
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
  const [dataCerere] = useState(today())
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
      if (has) return { ...r, caenCodes: r.caenCodes.filter(c => c !== cod) }
      if (r.caenCodes.length >= 2) return r
      return { ...r, caenCodes: [...r.caenCodes, cod] }
    }))

  const cnpValid = !declarant.cnp || /^\d{13}$/.test(declarant.cnp)

  useEffect(() => {
    const state: DeclaratieFormState = { sediu, declarant, caenSediu, caenTerti, sediiSecundare, dataCerere }
    const fieldValues = buildPdfFieldValues(state, client)

    const anyCaen = caenSediu.length > 0 || caenTerti.length > 0 || sediiSecundare.some(r => r.adresa && r.caenCodes.length > 0)
    const isComplete = !!(declarant.nume.trim() && declarant.prenume.trim()) && anyCaen

    const noiAdrese = sediiSecundare.map(r => r.adresa).filter(Boolean).filter(a => !puncteLucruExistente.includes(a))
    const clientPatches: ClientPatchProposal[] = noiAdrese.length > 0 ? [{
      label: `Adaugă ${noiAdrese.length} sediu${noiAdrese.length === 1 ? '' : 'i'} secundar${noiAdrese.length === 1 ? '' : 'e'} în profilul clientului: ${noiAdrese.join('; ')}`,
      patch: { puncteLucru: [...puncteLucruExistente, ...noiAdrese] },
    }] : []

    onChange({ fieldValues, isComplete, clientPatches })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sediu, declarant, caenSediu, caenTerti, sediiSecundare, dataCerere, client])

  const summary = `Declarant: ${declarant.nume || declarant.prenume ? `${declarant.nume} ${declarant.prenume}`.trim() : '—'}` +
    ` · ${caenSediu.length} CAEN la sediu · ${caenTerti.length} la terți · ${sediiSecundare.filter(r => r.adresa).length} sedii secundare`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
      <SectionCard title="Sediul social/profesional">
        <div style={AUTO_NOTE_STYLE}>Completat automat din profil — verifică.</div>
        <AdresaFields
          value={sediu}
          onChange={v => setSediu({ ...sediu, ...v })}
          judet={{ value: sediu.judet, onChange: v => setSediu({ ...sediu, judet: v }) }}
        />
      </SectionCard>

      <SectionCard title="1. Subsemnatul(a) — declarant">
        <div className="field">
          <label className="field-label">Persoană</label>
          <select className="field-input" value={declarantChoice} onChange={e => selectDeclarant(e.target.value)}>
            <option value="">— alege —</option>
            {candidates.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
            <option value="__manual__">+ Reprezentant/altă persoană</option>
          </select>
        </div>

        {declarantChoice && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {declarantChoice !== '__manual__' && <div style={AUTO_NOTE_STYLE}>Completat automat din profil — verifică.</div>}

            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Field label="Nume" value={declarant.nume} onChange={v => setDeclarant({ ...declarant, nume: v })} />
              <Field label="Prenume" value={declarant.prenume} onChange={v => setDeclarant({ ...declarant, prenume: v })} />
              <div className="field" style={{ flex: 1, minWidth: 0 }}>
                <label className="field-label">CNP</label>
                <input className="field-input" value={declarant.cnp} onChange={e => setDeclarant({ ...declarant, cnp: e.target.value })} />
                {!cnpValid && <div style={{ fontSize: '.7rem', color: 'var(--y700)', marginTop: '.15rem' }}>⚠️ CNP-ul nu are 13 cifre</div>}
              </div>
            </div>

            <SubTitle>Domiciliul</SubTitle>
            <AdresaFields value={declarant.domiciliu} onChange={v => setDeclarant({ ...declarant, domiciliu: v })} />
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <FieldJudet label="Județ/sector" value={declarant.domiciliuJudet} onChange={v => setDeclarant({ ...declarant, domiciliuJudet: v })} />
              <Field label="Țara" value={declarant.tara} onChange={v => setDeclarant({ ...declarant, tara: v })} />
              <Field label="Cetățenia" value={declarant.cetatenia} onChange={v => setDeclarant({ ...declarant, cetatenia: v })} />
            </div>

            <SubTitle>Născut(ă)</SubTitle>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Field label="Localitatea" flex={2} value={declarant.nasterelocalitate} onChange={v => setDeclarant({ ...declarant, nasterelocalitate: v })} />
              <FieldJudet label="Județ/sector" value={declarant.nastereJudet} onChange={v => setDeclarant({ ...declarant, nastereJudet: v })} />
              <Field label="Țara" value={declarant.nastereTara} onChange={v => setDeclarant({ ...declarant, nastereTara: v })} />
              <Field label="Data nașterii" value={declarant.nastereData} onChange={v => setDeclarant({ ...declarant, nastereData: v })} />
            </div>

            <SubTitle>Act de identitate</SubTitle>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Field label="Tip" value={declarant.actTip} onChange={v => setDeclarant({ ...declarant, actTip: v })} />
              <Field label="Serie" value={declarant.actSerie} onChange={v => setDeclarant({ ...declarant, actSerie: v })} />
              <Field label="Număr" value={declarant.actNumar} onChange={v => setDeclarant({ ...declarant, actNumar: v })} />
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Field label="Emis de" flex={2} value={declarant.actEmisDe} onChange={v => setDeclarant({ ...declarant, actEmisDe: v })} />
              <Field label="Valabil de la" value={declarant.actValabilDeLa} onChange={v => setDeclarant({ ...declarant, actValabilDeLa: v })} />
              <Field label="Valabil până la" value={declarant.actValabilPanaLa} onChange={v => setDeclarant({ ...declarant, actValabilPanaLa: v })} />
            </div>

            <Field label="Calitate (asociat / administrator / reprezentant...)" value={declarant.calitate} onChange={v => setDeclarant({ ...declarant, calitate: v })} />
          </div>
        )}
      </SectionCard>

      <SectionCard title="3.1 Sediu social/profesional — coduri CAEN">
        <CaenChecklist options={caenOptions} selected={caenSediu} onToggle={cod => toggleCaen(caenSediu, setCaenSediu, cod)} />
      </SectionCard>

      <SectionCard title="3.2 Activități desfășurate la terți">
        <CaenChecklist options={caenOptions} selected={caenTerti} onToggle={cod => toggleCaen(caenTerti, setCaenTerti, cod)} />
      </SectionCard>

      <SectionCard title="3.3 Sedii secundare">
        {sediiSecundare.length === 0 && puncteLucruExistente.length === 0 && (
          <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}>Niciun punct de lucru înregistrat.</div>
        )}
        {sediiSecundare.map((row, i) => {
          const manual = rowManual[i] ?? puncteLucruExistente.length === 0
          return (
            <div key={i} style={{ border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.5rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
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
                <label className="field-label">Coduri CAEN (max. 2)</label>
                <CaenChecklist options={caenOptions} selected={row.caenCodes} onToggle={cod => toggleSediuSecundarCaen(i, cod)} />
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
}

const BTN_X: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: '.125rem .25rem' }
