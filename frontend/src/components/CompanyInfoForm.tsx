import { useState } from 'react'
import type { CaenActivitate, Persoana, ToastItem } from '../types'
import { fetchAnafCompany } from '../lib/api'
import { FORME_JURIDICE_PJ } from '../lib/formeJuridice'
import { findCaenDescriere } from '../data/caen'
import CAENCombobox from './CAENCombobox'
import Modal from './Modal'

export interface CompanyData {
  denumire: string
  formaJuridica: string
  codFiscal: string
  nrRegistrul: string
  sediuSocial: string
  caenCod: string
  caenDescriere: string
  caenSecundare: CaenActivitate[]
  capitalSocial: number | null
}

interface Props {
  value: CompanyData
  onChange: (patch: Partial<CompanyData>) => void
  asociati: Persoana[]
  accessToken: string
  onToast: (msg: string, type: ToastItem['type']) => void
}

export default function CompanyInfoForm({ value, onChange, asociati, accessToken, onToast }: Props) {
  const [anafLoading, setAnafLoading] = useState(false)
  const [sediuPicker, setSediuPicker] = useState(false)

  const set = <K extends keyof CompanyData>(key: K, val: CompanyData[K]) => onChange({ [key]: val } as Partial<CompanyData>)

  const cifTrimmed = value.codFiscal.trim()
  const cifError = cifTrimmed && !/^(RO)?\d{2,10}$/i.test(cifTrimmed)
    ? 'CIF invalid (ex: RO12345678 sau 12345678)'
    : ''

  const preiaAnaf = async () => {
    if (!value.codFiscal.trim()) return
    setAnafLoading(true)
    try {
      const result = await fetchAnafCompany(value.codFiscal, accessToken)
      if (!result.found) { onToast('CIF-ul nu a fost găsit în baza de date ANAF', 'info'); return }
      onChange({
        denumire: result.denumire || value.denumire,
        formaJuridica: result.formaJuridica || value.formaJuridica,
        sediuSocial: result.adresa || value.sediuSocial,
        nrRegistrul: result.nrRegCom || value.nrRegistrul,
        caenCod: result.caenCod || value.caenCod,
        caenDescriere: result.caenCod ? findCaenDescriere(result.caenCod) : value.caenDescriere,
        caenSecundare: result.caenSecundare
          ? result.caenSecundare.map(cod => ({ cod, descriere: findCaenDescriere(cod) }))
          : value.caenSecundare,
      })
      onToast('Date preluate de la ANAF', 'ok')
    } catch (e: unknown) {
      onToast((e as Error).message ?? 'Eroare ANAF', 'err')
    } finally {
      setAnafLoading(false)
    }
  }

  const addCaenSecundar = () => set('caenSecundare', [...value.caenSecundare, { cod: '', descriere: '' }])
  const updateCaenSecundar = (i: number, cod: string, descriere: string) => {
    const arr = [...value.caenSecundare]; arr[i] = { cod, descriere }; set('caenSecundare', arr)
  }
  const removeCaenSecundar = (i: number) => {
    const arr = [...value.caenSecundare]; arr.splice(i, 1); set('caenSecundare', arr)
  }

  const partiSocialeTotal = value.capitalSocial != null ? value.capitalSocial / 10 : null

  if (sediuPicker) {
    return (
      <Modal onClose={() => setSediuPicker(false)} ariaLabel="Alege adresa asociatului">
        <div className="modal-head">
          <span className="modal-title">Copiază sediul de la un asociat</span>
          <button className="modal-close" onClick={() => setSediuPicker(false)}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: '.8125rem', color: 'var(--s400)', marginTop: 0 }}>
            Selectează asociatul a cărui adresă de domiciliu devine sediul social.
          </p>
          {asociati.map((a, i) => {
            const adresaFull = [a.adresa, a.judet].filter(Boolean).join(', ')
            return (
              <button
                key={i}
                type="button"
                className="persoana-card"
                disabled={!adresaFull}
                style={{ width: '100%', textAlign: 'left', cursor: adresaFull ? 'pointer' : 'not-allowed', marginBottom: '.375rem', border: '1px solid var(--s150, #e5e7eb)', background: 'transparent', opacity: adresaFull ? 1 : .5 }}
                onClick={() => { set('sediuSocial', adresaFull); setSediuPicker(false) }}
              >
                <div>
                  <div className="persoana-card-name">{a.prenume} {a.nume}</div>
                  <div className="persoana-card-sub">{adresaFull || 'Fără adresă completată'}</div>
                </div>
              </button>
            )
          })}
          {asociati.length === 0 && (
            <p style={{ fontSize: '.8125rem', color: 'var(--s400)' }}>Niciun asociat configurat încă.</p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={() => setSediuPicker(false)}>Anulează</button>
        </div>
      </Modal>
    )
  }

  return (
    <div className="form-grid">
      <div className="field full">
        <label className="field-label">Denumire <span style={{ color: 'var(--r500)' }}>*</span></label>
        <input className="field-input" value={value.denumire} onChange={e => set('denumire', e.target.value)} placeholder="Denumirea firmei" />
      </div>

      <div className="field">
        <label className="field-label">Forma juridică</label>
        <select className="field-input" value={value.formaJuridica} onChange={e => set('formaJuridica', e.target.value)}>
          <option value="">— selectați —</option>
          {FORME_JURIDICE_PJ.map(f => <option key={f}>{f}</option>)}
        </select>
      </div>

      <div className="field">
        <label className="field-label">Cod fiscal (CIF)</label>
        <div className="field-with-btn">
          <input className="field-input" placeholder="ex: RO12345678"
            value={value.codFiscal} onChange={e => set('codFiscal', e.target.value)}
            aria-invalid={!!cifError} />
          <button type="button" className="btn btn-outline-primary btn-sm"
            onClick={preiaAnaf} disabled={!value.codFiscal.trim() || anafLoading}
            title="Preia date de la ANAF" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            {anafLoading ? <span className="spin spin-dark" /> : '🔍 ANAF'}
          </button>
        </div>
        {cifError && <span className="field-error">{cifError}</span>}
      </div>

      <div className="field full">
        <label className="field-label">Nr. registrul comerțului</label>
        <input className="field-input" placeholder="ex: J40/123/2020" value={value.nrRegistrul} onChange={e => set('nrRegistrul', e.target.value)} />
      </div>

      <div className="field full">
        <label className="field-label">Activitate principală (CAEN)</label>
        <CAENCombobox value={value.caenCod} descriere={value.caenDescriere || findCaenDescriere(value.caenCod)}
          onChange={(cod, desc) => onChange({ caenCod: cod, caenDescriere: desc })} />
      </div>

      <div className="field full">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.375rem' }}>
          <label className="field-label" style={{ margin: 0 }}>Activități secundare (CAEN)</label>
          <button type="button" className="btn btn-ghost btn-xs" onClick={addCaenSecundar}>+ Adaugă activitate secundară</button>
        </div>
        {value.caenSecundare.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.375rem' }}>
            <div style={{ flex: 1 }}>
              <CAENCombobox value={a.cod} descriere={a.descriere || findCaenDescriere(a.cod)} onChange={(cod, desc) => updateCaenSecundar(i, cod, desc)} />
            </div>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => removeCaenSecundar(i)} style={{ color: 'var(--r500)' }}>🗑️</button>
          </div>
        ))}
      </div>

      <div className="field full">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="field-label" style={{ margin: 0 }}>Sediu social</label>
          {asociati.length > 0 && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSediuPicker(true)}>
              📍 Folosește adresa unui asociat
            </button>
          )}
        </div>
        <textarea className="field-textarea" value={value.sediuSocial} onChange={e => set('sediuSocial', e.target.value)} rows={2} />
      </div>

      <div className="field">
        <label className="field-label">Capital social (lei)</label>
        <input className="field-input" type="number" min={0} placeholder="ex: 200"
          value={value.capitalSocial ?? ''}
          onChange={e => set('capitalSocial', e.target.value === '' ? null : Number(e.target.value))} />
      </div>
      <div className="field">
        <label className="field-label">Părți sociale</label>
        <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)' }}>
          {partiSocialeTotal != null ? partiSocialeTotal.toLocaleString('ro-RO') : '—'}
        </div>
      </div>
    </div>
  )
}
