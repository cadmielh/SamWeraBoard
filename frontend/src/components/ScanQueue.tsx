import { useState } from 'react'
import type { ScannedPerson, ToastItem } from '../types'
import type { IDFields } from '../lib/api'
import { EMPTY_ID_FIELDS } from '../lib/idFields'
import PersonScanModal from './PersonScanModal'
import Modal from './Modal'

interface Props {
  accessToken: string
  onContinue: (persons: ScannedPerson[]) => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

function makePerson(role: ScannedPerson['role']): ScannedPerson {
  return { id: crypto.randomUUID(), role, cotaParticipare: '', fields: { ...EMPTY_ID_FIELDS }, scanStatus: 'empty' }
}

function equalShare(n: number): string {
  if (n <= 0) return ''
  const val = Math.round((100 / n) * 100) / 100
  return `${Number.isInteger(val) ? val : val.toFixed(2)}%`
}

function personKey(p: ScannedPerson): string {
  return p.fields.cnp.trim() || `${p.fields.nume.trim()}|${p.fields.prenume.trim()}`
}

function scanStatus(p: ScannedPerson) {
  if (p.scanStatus === 'empty') return { icon: '⏳', color: 'var(--s400)', label: 'Nescanat' }
  const filled = Object.values(p.fields).filter(v => v.trim()).length
  if (filled >= 8) return { icon: '✅', color: 'var(--g600)', label: `${p.fields.prenume} ${p.fields.nume}`.trim() || 'Complet' }
  return { icon: '⚠️', color: 'var(--y600, #ca8a04)', label: `${p.fields.prenume} ${p.fields.nume}`.trim() || 'Date parțiale' }
}

function personLabel(p: ScannedPerson, idx: number, role: string): string {
  const name = [p.fields.prenume, p.fields.nume].filter(Boolean).join(' ')
  return `${role} ${idx + 1}${name ? ` — ${name}` : ''}`
}

export default function ScanQueue({ accessToken, onContinue, onToast }: Props) {
  const [persons, setPersons] = useState<ScannedPerson[]>([
    makePerson('asociat'),
    makePerson('administrator'),
  ])
  const [scanTarget, setScanTarget] = useState<{ personId: string; manual: boolean } | null>(null)
  const [adminPicker, setAdminPicker] = useState(false)

  const asociati = persons.filter(p => p.role === 'asociat')
  const admini = persons.filter(p => p.role === 'administrator')

  const updatePerson = (id: string, patch: Partial<ScannedPerson>) =>
    setPersons(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))

  const removePerson = (id: string) =>
    setPersons(prev => {
      const removed = prev.find(p => p.id === id)
      const next = prev.filter(p => p.id !== id)
      if (removed?.role !== 'asociat') return next
      const prevEqual = equalShare(prev.filter(p => p.role === 'asociat').length)
      const newEqual = equalShare(next.filter(p => p.role === 'asociat').length)
      return next.map(p => (p.role === 'asociat' && p.cotaParticipare === prevEqual) ? { ...p, cotaParticipare: newEqual } : p)
    })

  const addAsociat = () =>
    setPersons(prev => {
      const asocCount = prev.filter(p => p.role === 'asociat').length
      const prevEqual = equalShare(asocCount)
      const newEqual = equalShare(asocCount + 1)
      const rebalanced = prev.map(p =>
        p.role === 'asociat' && (!p.cotaParticipare.trim() || p.cotaParticipare === prevEqual)
          ? { ...p, cotaParticipare: newEqual }
          : p
      )
      return [...rebalanced, { ...makePerson('asociat'), cotaParticipare: newEqual }]
    })

  const handleAddAdministrator = () => {
    if (asociati.length > 0) setAdminPicker(true)
    else setPersons(prev => [...prev, makePerson('administrator')])
  }

  const soleAsociat = asociati.length === 1 ? asociati[0] : null
  const isAdminSameAsSoleAsociat = !!soleAsociat && admini.length === 1 && personKey(admini[0]) === personKey(soleAsociat)

  const toggleAdminSameAsSoleAsociat = (checked: boolean) => {
    if (!soleAsociat) return
    setPersons(prev => {
      const withoutAdmins = prev.filter(p => p.role !== 'administrator')
      if (!checked) return withoutAdmins
      return [...withoutAdmins, {
        id: crypto.randomUUID(), role: 'administrator', cotaParticipare: '',
        fields: { ...soleAsociat.fields }, scanStatus: soleAsociat.scanStatus,
      }]
    })
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    setPersons(prev => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }

  const moveDown = (idx: number) => {
    setPersons(prev => {
      if (idx >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }

  const handleScanConfirm = (fields: IDFields) => {
    if (!scanTarget) return
    updatePerson(scanTarget.personId, {
      fields,
      scanStatus: scanTarget.manual ? 'manual' : 'scanned',
    })
    setScanTarget(null)
    onToast('Date salvate', 'ok')
  }

  const renderRow = (p: ScannedPerson, globalIdx: number) => {
    const roleLabel = p.role === 'asociat' ? 'Asociat' : 'Administrator'
    const roleIdx = persons.slice(0, globalIdx).filter(x => x.role === p.role).length
    const st = scanStatus(p)

    return (
      <div
        key={p.id}
        style={{
          background: 'var(--s50)', borderRadius: 'var(--r-sm)',
          border: '1.5px solid var(--s200)', padding: '.75rem .875rem',
          display: 'flex', flexDirection: 'column', gap: '.5rem',
        }}
      >
        {/* Top row: label + status + reorder + remove */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ fontSize: '.7rem', fontWeight: 700, color: p.role === 'asociat' ? 'var(--p600)' : 'var(--s600)', background: p.role === 'asociat' ? 'var(--p50)' : 'var(--s100)', padding: '.15rem .45rem', borderRadius: 4, whiteSpace: 'nowrap' }}>
            {roleLabel} {roleIdx + 1}
          </span>
          <span style={{ fontSize: '.8rem', color: st.color, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {st.icon} {st.label}
          </span>
          <div style={{ display: 'flex', gap: '.125rem', flexShrink: 0 }}>
            <button onClick={() => moveUp(globalIdx)} style={BTN_ICON} title="Sus" disabled={globalIdx === 0}>↑</button>
            <button onClick={() => moveDown(globalIdx)} style={BTN_ICON} title="Jos" disabled={globalIdx === persons.length - 1}>↓</button>
            <button onClick={() => removePerson(p.id)} style={{ ...BTN_ICON, color: 'var(--r500)' }} title="Elimină">×</button>
          </div>
        </div>

        {/* Cotă participare (asociați doar) */}
        {p.role === 'asociat' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <label style={LABEL_S}>Cotă participare</label>
            <input
              value={p.cotaParticipare}
              onChange={e => updatePerson(p.id, { cotaParticipare: e.target.value })}
              placeholder="ex: 50%"
              style={INPUT_S}
            />
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-outline-primary btn-sm"
            onClick={() => setScanTarget({ personId: p.id, manual: false })}
          >
            📷 Scanează CI
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setScanTarget({ personId: p.id, manual: true })}
          >
            ✏️ Introdu manual
          </button>
          {p.scanStatus !== 'empty' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => updatePerson(p.id, { fields: { ...EMPTY_ID_FIELDS }, scanStatus: 'empty' })}
              style={{ color: 'var(--s400)' }}
            >
              Șterge date
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Asociați — determină firma, deci se completează primii */}
        {asociati.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
            <div style={SECTION_TITLE}>Asociați <span style={COUNT_CHIP}>{asociati.length}</span></div>
            {persons.map((p, i) => p.role === 'asociat' ? renderRow(p, i) : null)}
          </section>
        )}

        {soleAsociat && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8125rem', color: 'var(--s600)', cursor: 'pointer' }}>
            <input type="checkbox" checked={isAdminSameAsSoleAsociat} onChange={e => toggleAdminSameAsSoleAsociat(e.target.checked)} />
            Administratorul este aceeași persoană cu asociatul unic
          </label>
        )}

        {/* Administratori */}
        {admini.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
            <div style={SECTION_TITLE}>Administratori <span style={COUNT_CHIP}>{admini.length}</span></div>
            {persons.map((p, i) => p.role === 'administrator' ? renderRow(p, i) : null)}
          </section>
        )}

        {/* Add buttons */}
        <div style={{ display: 'flex', gap: '.625rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={addAsociat}>
            + Adaugă asociat
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleAddAdministrator}>
            + Adaugă administrator
          </button>
        </div>

        {/* Continue */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '.5rem' }}>
          <button
            className="btn btn-primary"
            onClick={() => onContinue(persons)}
            disabled={persons.length === 0}
          >
            Continuă la template →
          </button>
        </div>
      </div>

      {/* Selector administrator dintre asociați */}
      {adminPicker && (
        <Modal onClose={() => setAdminPicker(false)} ariaLabel="Alege administrator">
          <div className="modal-head">
            <span className="modal-title">Cine este administrator?</span>
            <button className="modal-close" onClick={() => setAdminPicker(false)}>×</button>
          </div>
          <div className="modal-body">
            <p style={{ fontSize: '.8125rem', color: 'var(--s400)', marginTop: 0 }}>
              Selectează un asociat existent pentru a-i copia datele, sau adaugă o persoană nouă.
            </p>
            {asociati.map((a, i) => {
              const name = [a.fields.prenume, a.fields.nume].filter(Boolean).join(' ')
              return (
                <button
                  key={a.id}
                  type="button"
                  className="persoana-card"
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: '.375rem', border: '1px solid var(--s200)', background: 'transparent' }}
                  onClick={() => {
                    setPersons(prev => [...prev, {
                      id: crypto.randomUUID(), role: 'administrator', cotaParticipare: '',
                      fields: { ...a.fields }, scanStatus: a.scanStatus,
                    }])
                    setAdminPicker(false)
                  }}
                >
                  <div className="persoana-card-name">{name || `Asociat ${i + 1}`}</div>
                  <div className="persoana-card-sub">
                    Asociat{a.cotaParticipare ? ` — ${a.cotaParticipare}` : ''}{a.fields.cnp ? ` · CNP: ${a.fields.cnp}` : ''}
                  </div>
                </button>
              )
            })}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={() => setAdminPicker(false)}>Anulează</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { setPersons(prev => [...prev, makePerson('administrator')]); setAdminPicker(false) }}
            >
              + Persoană nouă
            </button>
          </div>
        </Modal>
      )}

      {/* Scan modal */}
      {scanTarget && (() => {
        const p = persons.find(x => x.id === scanTarget.personId)
        if (!p) return null
        const roleIdx = persons.filter((x, i) => x.role === p.role && i < persons.indexOf(p)).length
        const roleLabel = p.role === 'asociat' ? 'Asociat' : 'Administrator'
        return (
          <PersonScanModal
            personLabel={personLabel(p, roleIdx, roleLabel)}
            accessToken={accessToken}
            initialFields={scanTarget.manual ? p.fields : undefined}
            mode={scanTarget.manual ? 'manual' : 'scan'}
            onConfirm={handleScanConfirm}
            onClose={() => setScanTarget(null)}
            onToast={onToast}
          />
        )
      })()}
    </>
  )
}

const BTN_ICON: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--s400)', fontSize: '1rem', lineHeight: 1,
  padding: '.125rem .3rem', borderRadius: 4,
}
const LABEL_S: React.CSSProperties = {
  fontSize: '.72rem', fontWeight: 700, color: 'var(--s500)',
  letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
}
const INPUT_S: React.CSSProperties = {
  padding: '.275rem .5rem', borderRadius: 'var(--r-sm)',
  border: '1.5px solid var(--s300)', fontSize: '.85rem',
  color: 'var(--s800)', background: '#fff', fontFamily: 'var(--font)',
  outline: 'none', width: 120,
}
const SECTION_TITLE: React.CSSProperties = {
  fontSize: '.75rem', fontWeight: 700, color: 'var(--s500)',
  letterSpacing: '.06em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '.375rem',
}
const COUNT_CHIP: React.CSSProperties = {
  background: 'var(--s200)', color: 'var(--s600)', borderRadius: 99,
  padding: '.05rem .45rem', fontSize: '.7rem', fontWeight: 700,
}
