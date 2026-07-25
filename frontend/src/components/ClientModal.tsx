import { useState } from 'react'
import type { Client, Persoana, TipClient, SubtipPF } from '../types'
import { EMPTY_CLIENT, EMPTY_PERSOANA, type ClientInput } from '../lib/clienti'
import { fetchAnafCompany } from '../lib/api'
import { useApp } from '../AppLayout'
import CAENCombobox from './CAENCombobox'
import PersoanaModal from './PersoanaModal'
import Modal from './Modal'

interface Props {
  initial: Client | null
  onSave: (data: ClientInput) => Promise<void>
  onClose: () => void
}

const FORME_JURIDICE_PJ = ['SRL', 'SA', 'SNC', 'SCS', 'RA', 'SNA', 'ONG', 'Asociație', 'Fundație', 'Altul']

type PersonaModalState =
  | { type: 'asociati' | 'administratori'; index: number | null; prefill?: Partial<Persoana> }
  | { type: 'titular' }
  | { type: 'membriIF'; index: number | null }
  | null

const SUBTIP_LABELS: Record<SubtipPF, string> = {
  PFA: 'PFA',
  IF: 'IF',
  II: 'II',
}

function equalShare(n: number): string {
  if (n <= 0) return ''
  const val = Math.round((100 / n) * 100) / 100
  return `${Number.isInteger(val) ? val : val.toFixed(2)}%`
}

function personKey(p: Persoana): string {
  return p.cnp.trim() || `${p.nume.trim()}|${p.prenume.trim()}`
}

export default function ClientModal({ initial, onSave, onClose }: Props) {
  const { accessToken, toast } = useApp()

  const [form, setForm] = useState<ClientInput>(() => {
    if (!initial) return { ...EMPTY_CLIENT }
    return {
      tipClient: initial.tipClient ?? 'PJ',
      subtipPF: initial.subtipPF,
      titular: initial.titular ? { ...initial.titular } : undefined,
      membriIF: initial.membriIF ? [...initial.membriIF] : undefined,
      denumire: initial.denumire,
      formaJuridica: initial.formaJuridica,
      codFiscal: initial.codFiscal,
      nrRegistrul: initial.nrRegistrul,
      sediuSocial: initial.sediuSocial,
      caenCod: initial.caenCod,
      caenDescriere: initial.caenDescriere,
      telefon: initial.telefon,
      email: initial.email ?? '',
      statutFiscal: initial.statutFiscal,
      platitorTva: initial.platitorTva,
      periodaTva: initial.periodaTva,
      tvaLaIncasare: initial.tvaLaIncasare ?? false,
      plafonTvaAnual: initial.plafonTvaAnual ?? null,
      regimFiscal: initial.regimFiscal ?? '',
      nrSalariati: initial.nrSalariati ?? null,
      capitalSocial: initial.capitalSocial ?? null,
      anFiscal: initial.anFiscal ?? '',
      dataAnafActualizat: initial.dataAnafActualizat,
      notite: initial.notite,
      asociati: [...initial.asociati],
      administratori: [...initial.administratori],
    }
  })

  const [saving, setSaving] = useState(false)
  const [anafLoading, setAnafLoading] = useState(false)
  const [personaModal, setPersonaModal] = useState<PersonaModalState>(null)
  const [adminPicker, setAdminPicker] = useState(false)

  const set = (key: keyof ClientInput, val: unknown) => setForm(prev => ({ ...prev, [key]: val }))

  const isEditing = !!initial
  const isPF = form.tipClient === 'PF'
  const isIF = isPF && form.subtipPF === 'IF'

  const soleAsociat = form.asociati.length === 1 ? form.asociati[0] : null
  const isAdminSameAsSoleAsociat = !!soleAsociat && form.administratori.length === 1
    && personKey(form.administratori[0]) === personKey(soleAsociat)

  const toggleAdminSameAsSoleAsociat = (checked: boolean) => {
    if (!soleAsociat) return
    set('administratori', checked ? [{ ...soleAsociat, calitate: 'Administrator', cotaParticipare: '' }] : [])
  }

  const handleAddAdministrator = () => {
    if (form.asociati.length > 0) setAdminPicker(true)
    else setPersonaModal({ type: 'administratori', index: null })
  }

  const switchTip = (tip: TipClient) => {
    if (isEditing) {
      setForm(prev => ({
        ...prev,
        tipClient: tip,
        subtipPF: tip === 'PF' ? (prev.subtipPF ?? 'PFA') : undefined,
      }))
      return
    }
    setForm(prev => ({
      ...EMPTY_CLIENT,
      tipClient: tip,
      subtipPF: tip === 'PF' ? 'PFA' : undefined,
      telefon: prev.telefon,
      email: prev.email,
      notite: prev.notite,
    }))
  }

  const switchSubtip = (subtip: SubtipPF) => {
    setForm(prev => ({
      ...prev,
      subtipPF: subtip,
      membriIF: subtip === 'IF' ? prev.membriIF : undefined,
    }))
  }

  const preiaAnaf = async () => {
    if (!form.codFiscal.trim()) return
    setAnafLoading(true)
    try {
      const result = await fetchAnafCompany(form.codFiscal, accessToken)
      if (!result.found) { toast('CIF-ul nu a fost găsit în baza de date ANAF', 'info'); return }
      setForm(prev => ({
        ...prev,
        denumire: result.denumire || prev.denumire,
        formaJuridica: !isPF ? (result.formaJuridica || prev.formaJuridica) : prev.formaJuridica,
        sediuSocial: result.adresa || prev.sediuSocial,
        nrRegistrul: result.nrRegCom || prev.nrRegistrul,
        telefon: result.telefon || prev.telefon,
        caenCod: result.caenCod || prev.caenCod,
        statutFiscal: result.statutFiscal || prev.statutFiscal,
        platitorTva: result.platitorTva ?? prev.platitorTva,
        periodaTva: result.periodaTva || prev.periodaTva,
        tvaLaIncasare: result.tvaLaIncasare ?? prev.tvaLaIncasare,
        dataAnafActualizat: new Date().toISOString(),
      }))
      toast('Date preluate de la ANAF', 'ok')
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare ANAF', 'err')
    } finally {
      setAnafLoading(false)
    }
  }

  const cifTrimmed = form.codFiscal.trim()
  const cifError = cifTrimmed && !/^(RO)?\d{2,10}$/i.test(cifTrimmed)
    ? 'CIF invalid (ex: RO12345678 sau 12345678)'
    : ''

  const canSave = !cifError && !!form.denumire.trim()

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la salvare', 'err')
    } finally {
      setSaving(false)
    }
  }

  const addAsociat = (p: Persoana) => {
    const prevEqual = equalShare(form.asociati.length)
    const newEqual = equalShare(form.asociati.length + 1)
    const rebalanced = form.asociati.map(a =>
      (!a.cotaParticipare.trim() || a.cotaParticipare === prevEqual) ? { ...a, cotaParticipare: newEqual } : a
    )
    const newP: Persoana = { ...p, cotaParticipare: p.cotaParticipare.trim() || newEqual }
    set('asociati', [...rebalanced, newP])
  }

  const savePersoana = (p: Persoana) => {
    if (!personaModal) return
    if (personaModal.type === 'titular') {
      set('titular', p)
    } else if (personaModal.type === 'membriIF') {
      const arr = [...(form.membriIF ?? [])]
      if (personaModal.index === null) arr.push(p)
      else arr[personaModal.index] = p
      set('membriIF', arr)
    } else if (personaModal.type === 'asociati' && personaModal.index === null) {
      addAsociat(p)
    } else {
      const arr = [...form[personaModal.type]]
      if (personaModal.index === null) arr.push(p)
      else arr[personaModal.index] = p
      set(personaModal.type, arr)
    }
    setPersonaModal(null)
  }

  const removePersoana = (type: 'asociati' | 'administratori', i: number) => {
    const arr = [...form[type]]
    arr.splice(i, 1)
    if (type === 'asociati') {
      const prevEqual = equalShare(arr.length + 1)
      const newEqual = equalShare(arr.length)
      set('asociati', arr.map(a => a.cotaParticipare === prevEqual ? { ...a, cotaParticipare: newEqual } : a))
    } else {
      set(type, arr)
    }
  }

  const removeMembru = (i: number) => {
    const arr = [...(form.membriIF ?? [])]; arr.splice(i, 1); set('membriIF', arr)
  }

  if (adminPicker) {
    return (
      <Modal onClose={() => setAdminPicker(false)} ariaLabel="Alege administrator">
        <div className="modal-head">
          <span className="modal-title">Cine este administrator?</span>
          <button className="modal-close" onClick={() => setAdminPicker(false)}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: '.8125rem', color: 'var(--s400)', marginTop: 0 }}>
            Selectează un asociat existent pentru a-i copia datele, sau adaugă o persoană nouă.
          </p>
          {form.asociati.map((a, i) => (
            <button
              key={i}
              type="button"
              className="persoana-card"
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: '.375rem', border: '1px solid var(--s150, #e5e7eb)', background: 'transparent' }}
              onClick={() => {
                setAdminPicker(false)
                setPersonaModal({ type: 'administratori', index: null, prefill: { ...a, calitate: 'Administrator', cotaParticipare: '' } })
              }}
            >
              <div>
                <div className="persoana-card-name">{a.prenume} {a.nume}</div>
                <div className="persoana-card-sub">Asociat{a.cotaParticipare ? ` — ${a.cotaParticipare}` : ''}{a.cnp ? ` · CNP: ${a.cnp}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={() => setAdminPicker(false)}>Anulează</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setAdminPicker(false); setPersonaModal({ type: 'administratori', index: null }) }}
          >
            + Persoană nouă
          </button>
        </div>
      </Modal>
    )
  }

  if (personaModal) {
    let initP: Persoana | null = null
    let prefill: Partial<Persoana> | undefined
    let calitateDefault = ''
    let showCota = false

    if (personaModal.type === 'asociati') {
      initP = personaModal.index !== null ? form.asociati[personaModal.index] : null
      if (personaModal.index === null) prefill = { cotaParticipare: equalShare(form.asociati.length + 1) }
      calitateDefault = 'Asociat'
      showCota = true
    } else if (personaModal.type === 'administratori') {
      initP = personaModal.index !== null ? form.administratori[personaModal.index] : null
      prefill = personaModal.index === null ? personaModal.prefill : undefined
      calitateDefault = 'Administrator'
    } else if (personaModal.type === 'titular') {
      initP = form.titular ?? { ...EMPTY_PERSOANA, calitate: 'Titular' }
      calitateDefault = 'Titular'
    } else if (personaModal.type === 'membriIF') {
      const arr = form.membriIF ?? []
      initP = personaModal.index !== null ? arr[personaModal.index] : null
      const isFirst = (personaModal.index ?? arr.length) === 0
      calitateDefault = isFirst ? 'Titular' : 'Membru IF'
    }

    return (
      <PersoanaModal
        initial={initP}
        prefill={prefill}
        calitateDefault={calitateDefault}
        showCota={showCota}
        onSave={savePersoana}
        onClose={() => setPersonaModal(null)}
      />
    )
  }

  return (
    <Modal onClose={onClose} className="modal-box--wide" ariaLabel={isEditing ? 'Editează client' : 'Adaugă client'}>
        <div className="modal-head">
          <span className="modal-title">{isEditing ? 'Editează client' : 'Adaugă client'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={e => { e.preventDefault(); handleSave() }}>
        <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>

          {/* Toggle PF / PJ */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '.5rem', marginBottom: isPF ? '.75rem' : 0 }}>
              {(['PJ', 'PF'] as TipClient[]).map(tip => (
                <button
                  key={tip}
                  type="button"
                  onClick={() => switchTip(tip)}
                  style={{
                    padding: '.375rem .875rem',
                    borderRadius: '6px',
                    border: '1.5px solid',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '.8125rem',
                    borderColor: form.tipClient === tip
                      ? (tip === 'PF' ? 'var(--b500, #3b82f6)' : 'var(--g500, #22c55e)')
                      : 'var(--s200)',
                    background: form.tipClient === tip
                      ? (tip === 'PF' ? 'var(--b50, #eff6ff)' : 'var(--g50, #f0fdf4)')
                      : 'transparent',
                    color: form.tipClient === tip
                      ? (tip === 'PF' ? 'var(--b600, #2563eb)' : 'var(--g700, #15803d)')
                      : 'var(--s400)',
                  }}
                >
                  {tip === 'PF' ? 'Persoană Fizică' : 'Persoană Juridică'}
                </button>
              ))}
            </div>

            {/* Subtip PF */}
            {isPF && (
              <div style={{ display: 'flex', gap: '.375rem', flexWrap: 'wrap' }}>
                {(Object.entries(SUBTIP_LABELS) as [SubtipPF, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => switchSubtip(key)}
                    style={{
                      padding: '.25rem .625rem',
                      borderRadius: '5px',
                      border: '1.5px solid',
                      cursor: 'pointer',
                      fontSize: '.75rem',
                      fontWeight: form.subtipPF === key ? 700 : 400,
                      borderColor: form.subtipPF === key ? 'var(--b400, #60a5fa)' : 'var(--s200)',
                      background: form.subtipPF === key ? 'var(--b100, #dbeafe)' : 'transparent',
                      color: form.subtipPF === key ? 'var(--b700, #1d4ed8)' : 'var(--s500)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Asociați / Administratori (doar PJ) — determină firma, deci se completează primele ── */}
          {!isPF && (
            <>
              <PersonSection title="Asociați" persons={form.asociati}
                onAdd={() => setPersonaModal({ type: 'asociati', index: null })}
                onEdit={i => setPersonaModal({ type: 'asociati', index: i })}
                onRemove={i => removePersoana('asociati', i)} />

              {soleAsociat && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8125rem', color: 'var(--s600)', marginTop: '.75rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={isAdminSameAsSoleAsociat} onChange={e => toggleAdminSameAsSoleAsociat(e.target.checked)} />
                  Administratorul este aceeași persoană cu asociatul unic
                </label>
              )}

              <PersonSection title="Administratori" persons={form.administratori}
                onAdd={handleAddAdministrator}
                onEdit={i => setPersonaModal({ type: 'administratori', index: i })}
                onRemove={i => removePersoana('administratori', i)} />
            </>
          )}

          {/* ANAF strip (doar dacă avem date ANAF) */}
          {form.dataAnafActualizat && (
            <div className="anaf-strip" style={{ marginBottom: '1rem' }}>
              ✓ <b>Date ANAF</b> — actualizat la {new Date(form.dataAnafActualizat).toLocaleDateString('ro-RO')}
              {form.statutFiscal && <span className={`badge badge-${form.statutFiscal}`}>{form.statutFiscal}</span>}
              {form.platitorTva && <span className="badge badge-tva">TVA {form.periodaTva}</span>}
              {form.platitorTva && form.tvaLaIncasare && <span className="badge badge-tva">TVA la încasare</span>}
              {!form.platitorTva && form.dataAnafActualizat && <span className="badge badge-notva">Non-TVA</span>}
            </div>
          )}

          {/* ── Bloc Date persoană (CI) — vizibil pentru orice PF ── */}
          {isPF && (
            <SectionCard
              title="Date persoană (CI)"
              action={
                <button type="button" className="btn btn-outline-primary btn-sm"
                  onClick={() => setPersonaModal({ type: 'titular' })}>
                  {form.titular?.nume ? '✏️ Editează CI' : '+ Adaugă / Scanează CI'}
                </button>
              }
            >
              {form.titular?.nume || form.titular?.prenume ? (
                <div className="persoana-card">
                  <div>
                    <div className="persoana-card-name">{form.titular.prenume} {form.titular.nume}</div>
                    <div className="persoana-card-sub">
                      {form.titular.cnp ? `CNP: ${form.titular.cnp}` : ''}
                      {form.titular.serie_numar ? ` · CI: ${form.titular.serie_numar}` : ''}
                      {form.titular.adresa ? ` · ${form.titular.adresa}` : ''}
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: '.8125rem', color: 'var(--s400)', margin: 0 }}>
                  Date de identificare (CNP, CI) necompletate.
                </p>
              )}
            </SectionCard>
          )}

          {/* ── Bloc Date entitate (ANAF/manual) — PF autorizată și PJ ── */}
          <SectionCard title={isPF ? 'Date entitate (ANAF/manual)' : undefined}>
            <div className="form-grid">
              {/* Denumire firmă */}
              <div className="field full">
                <label className="field-label">
                  Denumire <span style={{ color: 'var(--r500)' }}>*</span>
                </label>
                <input className="field-input" autoFocus={!isPF} value={form.denumire}
                  onChange={e => set('denumire', e.target.value)}
                  placeholder={isPF ? 'ex: Popescu Ion PFA' : 'Denumirea firmei'}
                  required />
              </div>

              {/* Forma juridică — doar PJ */}
              {!isPF && (
                <div className="field">
                  <label className="field-label">Forma juridică</label>
                  <select className="field-input" value={form.formaJuridica} onChange={e => set('formaJuridica', e.target.value)}>
                    <option value="">— selectați —</option>
                    {FORME_JURIDICE_PJ.map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
              )}

              {/* Cod fiscal cu buton ANAF */}
              <div className="field">
                <label className="field-label">Cod fiscal (CIF)</label>
                <div className="field-with-btn">
                  <input className="field-input" placeholder="ex: RO12345678"
                    value={form.codFiscal} onChange={e => set('codFiscal', e.target.value)}
                    aria-invalid={!!cifError} />
                  <button type="button" className="btn btn-outline-primary btn-sm"
                    onClick={preiaAnaf} disabled={!form.codFiscal.trim() || anafLoading}
                    title="Preia date de la ANAF" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {anafLoading ? <span className="spin spin-dark" /> : '🔍 ANAF'}
                  </button>
                </div>
                {cifError && <span className="field-error">{cifError}</span>}
              </div>

              {/* Nr. registrul comerțului */}
              <div className="field">
                <label className="field-label">Nr. registrul comerțului</label>
                <input className="field-input" placeholder="ex: J40/123/2020" value={form.nrRegistrul} onChange={e => set('nrRegistrul', e.target.value)} />
              </div>

              {/* CAEN */}
              <div className="field full">
                <label className="field-label">Activitate principală (CAEN)</label>
                <CAENCombobox value={form.caenCod} descriere={form.caenDescriere}
                  onChange={(cod, desc) => { set('caenCod', cod); set('caenDescriere', desc) }} />
              </div>

              {/* Sediu */}
              <div className="field full">
                <label className="field-label">{isPF ? 'Sediu profesional' : 'Sediu social'}</label>
                <textarea className="field-textarea" value={form.sediuSocial}
                  onChange={e => set('sediuSocial', e.target.value)} rows={2} />
              </div>
            </div>
          </SectionCard>

          {/* ── Bloc Date fiscale ── */}
          <SectionCard title="Date fiscale">
            <div className="form-grid">
              <div className="field">
                <label className="field-label">Regim de impunere</label>
                <select className="field-input" value={form.regimFiscal} onChange={e => set('regimFiscal', e.target.value)}>
                  <option value="">— necunoscut —</option>
                  <option value="microintreprindere">Microîntreprindere</option>
                  <option value="impozit_profit">Impozit pe profit</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">An fiscal</label>
                <input className="field-input" placeholder="ex: calendaristic" value={form.anFiscal} onChange={e => set('anFiscal', e.target.value)} />
              </div>

              {form.platitorTva && (
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.tvaLaIncasare} onChange={e => set('tvaLaIncasare', e.target.checked)} />
                    TVA la încasare
                  </label>
                </div>
              )}
              <div className="field">
                <label className="field-label">Plafon TVA anual (lei)</label>
                <input className="field-input" type="number" min={0} placeholder="ex: 300000"
                  value={form.plafonTvaAnual ?? ''}
                  onChange={e => set('plafonTvaAnual', e.target.value === '' ? null : Number(e.target.value))} />
              </div>

              <div className="field">
                <label className="field-label">Nr. salariați</label>
                <input className="field-input" type="number" min={0} placeholder="0"
                  value={form.nrSalariati ?? ''}
                  onChange={e => set('nrSalariati', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              {!isPF && (
                <div className="field">
                  <label className="field-label">Capital social (lei)</label>
                  <input className="field-input" type="number" min={0} placeholder="ex: 200"
                    value={form.capitalSocial ?? ''}
                    onChange={e => set('capitalSocial', e.target.value === '' ? null : Number(e.target.value))} />
                </div>
              )}
            </div>
          </SectionCard>

          {/* ── Câmpuri comune (telefon, email, notițe) ── */}
          <div className="form-grid" style={{ marginTop: '1rem' }}>
            <div className="field">
              <label className="field-label">Telefon</label>
              <input className="field-input" type="tel" placeholder="07xx xxx xxx" value={form.telefon} onChange={e => set('telefon', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Email</label>
              <input className="field-input" type="email" placeholder="contact@firma.ro" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div className="field full">
              <label className="field-label">Notițe interne</label>
              <textarea className="field-textarea" placeholder="Observații interne…" value={form.notite} onChange={e => set('notite', e.target.value)} rows={2} />
            </div>
          </div>

          {/* ── Secțiunea Membri familie (doar IF) ── */}
          {isIF && (
            <PersonSection
              title="Membri familie (IF)"
              persons={form.membriIF ?? []}
              onAdd={() => setPersonaModal({ type: 'membriIF', index: null })}
              onEdit={i => setPersonaModal({ type: 'membriIF', index: i })}
              onRemove={i => removeMembru(i)}
              addLabel="Adaugă membru"
            />
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Anulează</button>
          <button type="submit" className="btn btn-primary" disabled={!canSave || saving}>
            {saving ? <><span className="spin" />Se salvează...</> : (isEditing ? 'Salvează' : 'Adaugă client')}
          </button>
        </div>
        </form>
    </Modal>
  )
}

function SectionCard({ title, children, action }: {
  title?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div style={{
      border: '1px solid var(--s150, #e5e7eb)',
      borderRadius: '8px',
      padding: '1rem',
      marginBottom: '1rem',
    }}>
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' }}>
          {title && <span style={{ fontWeight: 700, fontSize: '.8125rem', color: 'var(--s600)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</span>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

function PersonSection({
  title, persons, onAdd, onEdit, onRemove, addLabel,
}: {
  title: string
  persons: Persoana[]
  onAdd: () => void
  onEdit: (i: number) => void
  onRemove: (i: number) => void
  addLabel?: string
}) {
  const label = addLabel ?? (title === 'Asociați' ? 'asociat' : title === 'Administratori' ? 'administrator' : 'persoană')
  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.625rem' }}>
        <span style={{ fontWeight: 700, fontSize: '.875rem', color: 'var(--s700)' }}>{title}</span>
        <button type="button" className="btn btn-outline-primary btn-sm" onClick={onAdd}>
          + {addLabel ?? `Adaugă ${label}`}
        </button>
      </div>
      {persons.length === 0 && (
        <p style={{ fontSize: '.8125rem', color: 'var(--s400)', margin: 0 }}>Nicio {label} adăugat{label.endsWith('a') ? '' : 'ă'}.</p>
      )}
      {persons.map((p, i) => (
        <div key={i} className="persoana-card" style={{ marginBottom: '.375rem' }}>
          <div>
            <div className="persoana-card-name">{p.prenume} {p.nume}</div>
            <div className="persoana-card-sub">{p.calitate}{p.cotaParticipare ? ` — ${p.cotaParticipare}` : ''}{p.cnp ? ` · CNP: ${p.cnp}` : ''}</div>
          </div>
          <div className="persoana-card-actions">
            <button className="btn btn-ghost btn-xs" onClick={() => onEdit(i)}>✏️</button>
            <button className="btn btn-ghost btn-xs" onClick={() => onRemove(i)} style={{ color: 'var(--r500)' }}>🗑️</button>
          </div>
        </div>
      ))}
    </div>
  )
}
