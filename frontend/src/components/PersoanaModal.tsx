import { useState } from 'react'
import type { Persoana } from '../types'
import type { IDFields } from '../lib/api'
import { EMPTY_PERSOANA } from '../lib/clienti'
import MiniOCR from './MiniOCR'

interface Props {
  initial: Persoana | null
  calitateDefault: string
  onSave: (p: Persoana) => void
  onClose: () => void
}

const CALITATI = ['Asociat', 'Administrator', 'Asociat și Administrator', 'Cenzor', 'Acționar', 'Fondator', 'Altul']

export default function PersoanaModal({ initial, calitateDefault, onSave, onClose }: Props) {
  const [p, setP] = useState<Persoana>(initial ?? { ...EMPTY_PERSOANA, calitate: calitateDefault })

  const set = (key: keyof Persoana, val: string) => setP(prev => ({ ...prev, [key]: val }))

  const handleExtracted = (fields: IDFields) => {
    setP(prev => ({
      ...prev,
      cnp: fields.cnp || prev.cnp,
      nume: fields.nume || prev.nume,
      prenume: fields.prenume || prev.prenume,
      serie_numar: fields.serie_numar || prev.serie_numar,
      data_nasterii: fields.data_nasterii || prev.data_nasterii,
      locul_nasterii: fields.locul_nasterii || prev.locul_nasterii,
      cetatenia: fields.cetatenia || prev.cetatenia,
      adresa: fields.adresa || prev.adresa,
      judet: fields.judet || prev.judet,
      emisa_de: fields.emisa_de || prev.emisa_de,
      valabila_pana_la: fields.valabila_pana_la || prev.valabila_pana_la,
    }))
  }

  const canSave = !!(p.nume.trim() || p.cnp.trim())

  const title = initial
    ? `Editează ${calitateDefault}`
    : `Adaugă ${calitateDefault}`

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <MiniOCR onExtracted={handleExtracted} />

          <div className="form-grid">
            <div className="field">
              <label className="field-label">Calitate</label>
              <select
                className="field-input"
                value={p.calitate}
                onChange={e => set('calitate', e.target.value)}
              >
                {CALITATI.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Cotă participare</label>
              <input className="field-input" placeholder="ex: 50%" value={p.cotaParticipare} onChange={e => set('cotaParticipare', e.target.value)} />
            </div>

            <div className="field full">
              <label className="field-label">CNP</label>
              <input className="field-input" placeholder="13 cifre" value={p.cnp} onChange={e => set('cnp', e.target.value)} maxLength={13} />
            </div>

            <div className="field">
              <label className="field-label">Nume</label>
              <input className="field-input" value={p.nume} onChange={e => set('nume', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Prenume</label>
              <input className="field-input" value={p.prenume} onChange={e => set('prenume', e.target.value)} />
            </div>

            <div className="field full">
              <label className="field-label">Serie / Număr buletin</label>
              <input className="field-input" placeholder="ex: MX 123456" value={p.serie_numar} onChange={e => set('serie_numar', e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Data nașterii</label>
              <input className="field-input" value={p.data_nasterii} onChange={e => set('data_nasterii', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Locul nașterii</label>
              <input className="field-input" value={p.locul_nasterii} onChange={e => set('locul_nasterii', e.target.value)} />
            </div>

            <div className="field full">
              <label className="field-label">Cetățenia</label>
              <input className="field-input" value={p.cetatenia} onChange={e => set('cetatenia', e.target.value)} />
            </div>

            <div className="field full">
              <label className="field-label">Adresa</label>
              <input className="field-input" value={p.adresa} onChange={e => set('adresa', e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Județul</label>
              <input className="field-input" value={p.judet} onChange={e => set('judet', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Emis de</label>
              <input className="field-input" value={p.emisa_de} onChange={e => set('emisa_de', e.target.value)} />
            </div>

            <div className="field full">
              <label className="field-label">Valabil până la</label>
              <input className="field-input" value={p.valabila_pana_la} onChange={e => set('valabila_pana_la', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Anulează</button>
          <button className="btn btn-primary" onClick={() => onSave(p)} disabled={!canSave}>
            {initial ? 'Salvează' : 'Adaugă'}
          </button>
        </div>
      </div>
    </div>
  )
}
