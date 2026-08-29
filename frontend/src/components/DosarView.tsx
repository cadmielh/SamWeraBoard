import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Dosar, DosarInput, ObiectCerereItem, StadiuDosar } from '../types'
import { STADIU_DOSAR_LABELS, STADIU_DOSAR_COLOR } from '../types'
import { dosarProfit } from '../lib/dosareStats'
import { CLAUSE_FIELD_SPECS } from '../lib/clauseFieldSpecs'
import { useClienti, EMPTY_CLIENT } from '../lib/clienti'
import { useApp } from '../AppContext'
import ObiectCereriiTags from './ObiectCereriiTags'
import ResponsabilCombobox from './ResponsabilCombobox'
import DosarSarciniList from './dosare/DosarSarciniList'
import IconTrash from './IconTrash'
import IconPencil from './IconPencil'

interface Props {
  dosar: Dosar
  embedded?: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onSaveField: (patch: Partial<DosarInput>) => Promise<void>
}

function EditableRow({ label, value, onSave, type = 'text', multiline = false, suffix }: {
  label: string
  value: string
  onSave: (v: string) => Promise<void>
  type?: string
  multiline?: boolean
  suffix?: string
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!editing) setVal(value) }, [value, editing])
  useEffect(() => { if (editing) (multiline ? textareaRef.current : inputRef.current)?.focus() }, [editing, multiline])

  const commit = async () => {
    if (val === value) { setEditing(false); return }
    setSaving(true)
    try { await onSave(val); setEditing(false) } finally { setSaving(false) }
  }
  const cancel = () => { setVal(value); setEditing(false) }

  if (editing) {
    return (
      <div className="cv2-info-row">
        <span className="cv2-info-label">{label}</span>
        <div className="cv2-inline-edit">
          {multiline ? (
            <textarea ref={textareaRef} className="field-textarea" rows={2} value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') cancel() }} />
          ) : (
            <input ref={inputRef} className="field-input" type={type} value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') cancel() }} />
          )}
          <button className="btn btn-ghost btn-xs" onClick={cancel} disabled={saving} title="Anulează">✕</button>
          <button className="btn btn-primary btn-xs" onClick={commit} disabled={saving} title="Salvează">
            {saving ? <span className="spin" /> : '✓'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button type="button" className="cv2-info-row cv2-info-row--editable" onClick={() => setEditing(true)}>
      <span className="cv2-info-label">{label}</span>
      <span className={`cv2-info-value${value ? '' : ' cv2-info-empty'}`}>
        {value ? `${value}${suffix ?? ''}` : 'Apasă pentru a completa…'}
        <span className="cv2-info-edit-hint">✏️</span>
      </span>
    </button>
  )
}

export default function DosarView({ dosar, embedded, onClose, onEdit, onDelete, onSaveField }: Props) {
  const navigate = useNavigate()
  const { user, activeWorkspace, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const { clienti, add: addClient } = useClienti(workspaceId)
  const profit = dosarProfit(dosar)
  // Fiecare etichetă cu clauseTag are propriul buton — dar numai dacă există
  // un client real legat (fără clientId, /extragere n-are pe cine pre-selecta).
  const generableObiecte = dosar.clientId
    ? dosar.obiecteCererii.filter(o => o.clauseTag && !!CLAUSE_FIELD_SPECS[o.clauseTag])
    : []
  const [creatingClient, setCreatingClient] = useState(false)

  const num = (v: number | null) => v == null ? '' : String(v)

  const handleUpgradeToClient = async () => {
    if (!workspaceId || !user || !dosar.clientDenumireLibera) return
    setCreatingClient(true)
    try {
      await addClient(workspaceId, { ...EMPTY_CLIENT, denumire: dosar.clientDenumireLibera }, user.uid)
      const created = clienti.find(c => c.denumire === dosar.clientDenumireLibera)
      await onSaveField({
        clientId: created?.id,
        clientDenumire: dosar.clientDenumireLibera,
        clientCui: created?.codFiscal,
        clientDenumireLibera: undefined,
      })
      toast('Client creat și legat de dosar', 'ok')
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la crearea clientului', 'err')
    } finally {
      setCreatingClient(false)
    }
  }

  return (
    <div className={embedded ? 'cv2-embed' : 'cv2-panel'}>
      <div className="cv2-header">
        <div className="cv2-header-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
          <div className="cv2-header-title" style={{ justifySelf: 'start', minWidth: 0 }}>
            <span className="cv2-company-name">{dosar.clientDenumire || dosar.clientDenumireLibera}</span>
          </div>
          <div className={`stadiu-select-wrap stadiu-badge-${STADIU_DOSAR_COLOR[dosar.stadiu]}`} style={{ justifySelf: 'center' }} title="Click pentru a schimba stadiul dosarului">
            <select
              className="stadiu-select"
              value={dosar.stadiu}
              onChange={e => onSaveField({ stadiu: e.target.value as StadiuDosar })}
            >
              {(Object.entries(STADIU_DOSAR_LABELS) as [StadiuDosar, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="cv2-header-actions" style={{ justifySelf: 'end' }}>
            <button className="btn btn-primary btn-sm" onClick={onEdit} title="Editează"><IconPencil size={16} /> Editează</button>
            <button className="btn btn-danger btn-sm" onClick={onDelete} title="Șterge"><IconTrash size={16} /> Șterge</button>
            {!embedded && <button className="btn btn-ghost btn-icon" onClick={onClose} title="Închide">✕</button>}
          </div>
        </div>
        <div className="cv2-header-anaf">
          <span className="cv2-anaf-note">{dosar.clientCui ? `CUI: ${dosar.clientCui}` : ''}{dosar.nrInregistrareDosar ? ` · Dosar: ${dosar.nrInregistrareDosar}` : ''}</span>
        </div>
      </div>

      <div className="cv2-body">
        {!dosar.clientId && dosar.clientDenumireLibera && (
          <div className="cv2-section" style={{ background: 'var(--p50)', borderColor: 'var(--p200)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem' }}>
            <span style={{ fontSize: '.8125rem', color: 'var(--p700)' }}>„{dosar.clientDenumireLibera}" nu e încă în registrul Clienți.</span>
            <button className="btn btn-outline-primary btn-xs" onClick={handleUpgradeToClient} disabled={creatingClient} style={{ flexShrink: 0 }}>
              {creatingClient ? <span className="spin spin-dark" /> : '+ Creează client'}
            </button>
          </div>
        )}

        {dosar.stadiu === 'documente_predate_client' && (
          <div className="cv2-section" style={{ background: 'var(--s100)', flexDirection: 'row', alignItems: 'center', gap: '.75rem' }}>
            <span style={{ fontSize: '.8125rem', color: 'var(--s600)' }}>📥 Documentele au fost predate — dosarul e arhivat (vizibil în „Arhivă dosare", restaurabil oricând).</span>
          </div>
        )}

        {generableObiecte.map(o => (
          <button
            key={o.label}
            type="button"
            className="btn btn-primary btn-full"
            onClick={() => navigate(`/extragere?clientId=${dosar.clientId}&mode=client`)}
          >
            📄 Generează documente — {o.label}
          </button>
        ))}

        <div className="cv2-section cv2-section--compact">
          <div className="cv2-section-label">Detalii cerere</div>

          <div className="cv2-info-row">
            <span className="cv2-info-label">Obiectul cererii</span>
            <ObiectCereriiTags value={dosar.obiecteCererii} onChange={(items: ObiectCerereItem[]) => onSaveField({ obiecteCererii: items })} />
          </div>

          <div className="cv2-two-col">
            <div className="cv2-info-row">
              <span className="cv2-info-label">Responsabil</span>
              <ResponsabilCombobox
                workspace={activeWorkspace}
                value={dosar.responsabilNume}
                onChange={(uid, nume) => onSaveField({ responsabilUid: uid ?? undefined, responsabilNume: nume })}
              />
            </div>
            <EditableRow label="Nr. înreg. dosar" value={dosar.nrInregistrareDosar} onSave={v => onSaveField({ nrInregistrareDosar: v })} />
          </div>

          <div className="cv2-two-col">
            <EditableRow label="Data admiterii" type="date" value={dosar.dataAdmiterii ?? ''} onSave={v => onSaveField({ dataAdmiterii: v || null })} />
            <EditableRow label="Data planificare" type="date" value={dosar.dataPlanificare ?? ''} onSave={v => onSaveField({ dataPlanificare: v || null })} />
          </div>
        </div>

        <DosarSarciniList dosar={dosar} onUpdateStadiu={stadiu => onSaveField({ stadiu })} />

        <div className="cv2-section cv2-section--compact">
          <div className="cv2-section-label">Financiar</div>

          <div className="cv2-two-col">
            <EditableRow label="Taxe ONRC (RON)" type="number" value={num(dosar.taxeOnrc)} onSave={v => onSaveField({ taxeOnrc: v === '' ? null : Number(v) })} />
            <EditableRow label="Tarif client (RON)" type="number" value={num(dosar.tarifClient)} onSave={v => onSaveField({ tarifClient: v === '' ? null : Number(v) })} />
          </div>

          <div className="cv2-two-col">
            <div className="cv2-info-row">
              <span className="cv2-info-label">Facturat</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={dosar.facturat} onChange={e => onSaveField({ facturat: e.target.checked })} />
                <span className="cv2-info-value">{dosar.facturat ? 'Da' : 'Nu'}</span>
              </label>
            </div>
            <div className="cv2-info-row">
              <span className="cv2-info-label">Profit</span>
              <span className="cv2-info-value" style={{ fontWeight: 700, color: profit >= 0 ? 'var(--g700)' : 'var(--r600)' }}>
                {profit.toLocaleString('ro-RO')} RON
              </span>
            </div>
          </div>
        </div>

        <div className="cv2-section cv2-section--notes">
          <div className="cv2-section-label">Observații</div>
          <EditableRow label="" value={dosar.observatii} multiline onSave={v => onSaveField({ observatii: v })} />
        </div>

      </div>
    </div>
  )
}
