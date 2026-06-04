import { useState } from 'react'
import type { Client, Persoana } from '../types'
import { EMPTY_CLIENT, type ClientInput } from '../lib/clienti'
import { fetchAnafCompany } from '../lib/api'
import { useApp } from '../AppLayout'
import CAENCombobox from './CAENCombobox'
import PersoanaModal from './PersoanaModal'

interface Props {
  initial: Client | null
  onSave: (data: ClientInput) => Promise<void>
  onClose: () => void
}

const FORME_JURIDICE = ['SRL', 'SA', 'PFA', 'IF', 'II', 'SNC', 'SCS', 'RA', 'SNA', 'ONG', 'Asociație', 'Fundație', 'Altul']

type PersonaModalState = { type: 'asociati' | 'administratori'; index: number | null } | null

export default function ClientModal({ initial, onSave, onClose }: Props) {
  const { accessToken, toast } = useApp()

  const [form, setForm] = useState<ClientInput>(initial
    ? {
        denumire: initial.denumire, formaJuridica: initial.formaJuridica,
        codFiscal: initial.codFiscal, nrRegistrul: initial.nrRegistrul,
        sediuSocial: initial.sediuSocial, caenCod: initial.caenCod,
        caenDescriere: initial.caenDescriere, telefon: initial.telefon, email: initial.email ?? '',
        statutFiscal: initial.statutFiscal, platitorTva: initial.platitorTva,
        periodaTva: initial.periodaTva, dataAnafActualizat: initial.dataAnafActualizat,
        notite: initial.notite, asociati: [...initial.asociati],
        administratori: [...initial.administratori],
      }
    : { ...EMPTY_CLIENT }
  )

  const [saving, setSaving] = useState(false)
  const [anafLoading, setAnafLoading] = useState(false)
  const [personaModal, setPersonaModal] = useState<PersonaModalState>(null)

  const set = (key: keyof ClientInput, val: unknown) => setForm(prev => ({ ...prev, [key]: val }))

  const preiaAnaf = async () => {
    if (!form.codFiscal.trim()) return
    setAnafLoading(true)
    try {
      const result = await fetchAnafCompany(form.codFiscal, accessToken)
      if (!result.found) { toast('CIF-ul nu a fost găsit în baza de date ANAF', 'info'); return }
      setForm(prev => ({
        ...prev,
        denumire: result.denumire || prev.denumire,
        formaJuridica: result.formaJuridica || prev.formaJuridica,
        sediuSocial: result.adresa || prev.sediuSocial,
        nrRegistrul: result.nrRegCom || prev.nrRegistrul,
        telefon: result.telefon || prev.telefon,
        caenCod: result.caenCod || prev.caenCod,
        statutFiscal: result.statutFiscal || prev.statutFiscal,
        platitorTva: result.platitorTva ?? prev.platitorTva,
        periodaTva: result.periodaTva || prev.periodaTva,
        dataAnafActualizat: new Date().toISOString(),
      }))
      toast('Date preluate de la ANAF', 'ok')
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare ANAF', 'err')
    } finally {
      setAnafLoading(false)
    }
  }

  const handleSave = async () => {
    if (!form.denumire.trim()) return
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

  const savePersoana = (p: Persoana) => {
    if (!personaModal) return
    const { type, index } = personaModal
    const arr = [...form[type]]
    if (index === null) arr.push(p)
    else arr[index] = p
    set(type, arr)
    setPersonaModal(null)
  }

  const removePersoana = (type: 'asociati' | 'administratori', i: number) => {
    const arr = [...form[type]]
    arr.splice(i, 1)
    set(type, arr)
  }

  const editPersoana = (type: 'asociati' | 'administratori', i: number) => {
    setPersonaModal({ type, index: i })
  }

  if (personaModal) {
    const arr = personaModal.type === 'asociati' ? form.asociati : form.administratori
    return (
      <PersoanaModal
        initial={personaModal.index !== null ? arr[personaModal.index] : null}
        calitateDefault={personaModal.type === 'asociati' ? 'Asociat' : 'Administrator'}
        onSave={savePersoana}
        onClose={() => setPersonaModal(null)}
      />
    )
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box modal-box--wide">
        <div className="modal-head">
          <span className="modal-title">{initial ? 'Editează client' : 'Adaugă client'}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          {/* ANAF strip */}
          {form.dataAnafActualizat && (
            <div className="anaf-strip" style={{ marginBottom: '1rem' }}>
              ✓ <b>Date ANAF</b> — actualizat la {new Date(form.dataAnafActualizat).toLocaleDateString('ro-RO')}
              {form.statutFiscal && <span className={`badge badge-${form.statutFiscal}`}>{form.statutFiscal}</span>}
              {form.platitorTva && <span className="badge badge-tva">TVA {form.periodaTva}</span>}
              {!form.platitorTva && form.dataAnafActualizat && <span className="badge badge-notva">Non-TVA</span>}
            </div>
          )}

          <div className="form-grid">
            {/* Denumire */}
            <div className="field full">
              <label className="field-label">Denumire <span style={{ color: 'var(--r500)' }}>*</span></label>
              <input className="field-input" autoFocus value={form.denumire} onChange={e => set('denumire', e.target.value)} placeholder="Denumirea firmei" />
            </div>

            {/* Forma juridică */}
            <div className="field">
              <label className="field-label">Forma juridică</label>
              <select className="field-input" value={form.formaJuridica} onChange={e => set('formaJuridica', e.target.value)}>
                <option value="">— selectați —</option>
                {FORME_JURIDICE.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>

            {/* Cod fiscal cu buton ANAF */}
            <div className="field">
              <label className="field-label">Cod fiscal</label>
              <div className="field-with-btn">
                <input
                  className="field-input"
                  placeholder="ex: RO12345678"
                  value={form.codFiscal}
                  onChange={e => set('codFiscal', e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={preiaAnaf}
                  disabled={!form.codFiscal.trim() || anafLoading}
                  title="Preia date de la ANAF"
                  style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {anafLoading ? <span className="spin spin-dark" /> : '🔍 ANAF'}
                </button>
              </div>
            </div>

            {/* Nr. registrul comerțului */}
            <div className="field">
              <label className="field-label">Nr. registrul comerțului</label>
              <input className="field-input" placeholder="ex: J40/123/2020" value={form.nrRegistrul} onChange={e => set('nrRegistrul', e.target.value)} />
            </div>

            {/* Telefon */}
            <div className="field">
              <label className="field-label">Telefon</label>
              <input className="field-input" placeholder="07xx xxx xxx" value={form.telefon} onChange={e => set('telefon', e.target.value)} />
            </div>

            {/* Email */}
            <div className="field">
              <label className="field-label">Email</label>
              <input className="field-input" type="email" placeholder="contact@firma.ro" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>

            {/* Sediu social */}
            <div className="field full">
              <label className="field-label">Sediu social</label>
              <textarea className="field-textarea" value={form.sediuSocial} onChange={e => set('sediuSocial', e.target.value)} rows={2} />
            </div>

            {/* CAEN */}
            <div className="field full">
              <label className="field-label">Activitate principală (CAEN)</label>
              <CAENCombobox
                value={form.caenCod}
                descriere={form.caenDescriere}
                onChange={(cod, desc) => { set('caenCod', cod); set('caenDescriere', desc) }}
              />
            </div>

            {/* Notițe */}
            <div className="field full">
              <label className="field-label">Notițe interne</label>
              <textarea className="field-textarea" placeholder="Observații interne (nu sunt vizibile pentru client)…" value={form.notite} onChange={e => set('notite', e.target.value)} rows={2} />
            </div>
          </div>

          {/* Asociați */}
          <PersonSection
            title="Asociați"
            persons={form.asociati}
            onAdd={() => setPersonaModal({ type: 'asociati', index: null })}
            onEdit={i => editPersoana('asociati', i)}
            onRemove={i => removePersoana('asociati', i)}
          />

          {/* Administratori */}
          <PersonSection
            title="Administratori"
            persons={form.administratori}
            onAdd={() => setPersonaModal({ type: 'administratori', index: null })}
            onEdit={i => editPersoana('administratori', i)}
            onRemove={i => removePersoana('administratori', i)}
          />
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Anulează</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!form.denumire.trim() || saving}>
            {saving ? <><span className="spin" />Se salvează...</> : (initial ? 'Salvează' : 'Adaugă client')}
          </button>
        </div>
      </div>
    </div>
  )
}

function PersonSection({
  title, persons, onAdd, onEdit, onRemove
}: {
  title: string
  persons: Persoana[]
  onAdd: () => void
  onEdit: (i: number) => void
  onRemove: (i: number) => void
}) {
  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.625rem' }}>
        <span style={{ fontWeight: 700, fontSize: '.875rem', color: 'var(--s700)' }}>{title}</span>
        <button type="button" className="btn btn-outline-primary btn-sm" onClick={onAdd}>
          + Adaugă {title === 'Asociați' ? 'asociat' : 'administrator'}
        </button>
      </div>
      {persons.length === 0 && (
        <p style={{ fontSize: '.8125rem', color: 'var(--s400)', margin: 0 }}>Niciun {title === 'Asociați' ? 'asociat' : 'administrator'} adăugat.</p>
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
