import { useState, useEffect, useRef } from 'react'
import type { Client, Persoana } from '../types'

interface Props {
  client: Client
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onSaveNotite: (notite: string) => Promise<void>
  embedded?: boolean
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function getAvatarColor(seed: string): string {
  const palette = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#0ea5e9', '#d97706', '#16a34a']
  let h = 0
  for (const ch of seed) h = ((h << 5) - h) + ch.charCodeAt(0)
  return palette[Math.abs(h) % palette.length]
}

function InfoRow({ label, value, link }: { label: string; value?: string; link?: boolean }) {
  return (
    <div className="cv2-info-row">
      <span className="cv2-info-label">{label}</span>
      {value
        ? link
          ? <a className="cv2-info-value cv2-info-link" href={`mailto:${value}`}>{value}</a>
          : <span className="cv2-info-value">{value}</span>
        : <span className="cv2-info-value cv2-info-empty">—</span>
      }
    </div>
  )
}

function PersoanaCard({ p }: { p: Persoana }) {
  const fullName = [p.prenume, p.nume].filter(Boolean).join(' ')
  const initials = fullName ? getInitials(fullName) : '?'
  const avatarBg = getAvatarColor(fullName || p.cnp || 'x')
  const adresaFull = [p.adresa, p.judet].filter(Boolean).join(', ')

  const details: { label: string; value: string }[] = [
    p.cnp              ? { label: 'CNP',               value: p.cnp }              : null,
    p.serie_numar      ? { label: 'Serie / Nr. CI',    value: p.serie_numar }      : null,
    p.data_nasterii    ? { label: 'Data nașterii',     value: p.data_nasterii }    : null,
    p.locul_nasterii   ? { label: 'Locul nașterii',    value: p.locul_nasterii }   : null,
    p.cetatenia        ? { label: 'Cetățenia',         value: p.cetatenia }        : null,
    p.emisa_de         ? { label: 'Emis de',           value: p.emisa_de }         : null,
    p.valabila_pana_la ? { label: 'Valabil până la',   value: p.valabila_pana_la } : null,
    adresaFull         ? { label: 'Adresa',            value: adresaFull }         : null,
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <div className="cv2-persoana-card">
      <div className="cv2-persoana-header">
        <div className="cv2-avatar" style={{ background: avatarBg }}>{initials}</div>
        <div className="cv2-persoana-meta">
          <div className="cv2-persoana-name">{fullName || '—'}</div>
          <div className="cv2-persoana-roles">
            {p.calitate && <span className="cv2-calitate-badge">{p.calitate}</span>}
            {p.cotaParticipare && <span className="cv2-cota-badge">{p.cotaParticipare}</span>}
          </div>
        </div>
      </div>
      {details.length > 0 && (
        <div className="cv2-persoana-details">
          {details.map(d => (
            <div key={d.label} className="cv2-detail-row">
              <span className="cv2-detail-label">{d.label}</span>
              <span className="cv2-detail-value">{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ClientView({ client, onClose, onEdit, onDelete, onSaveNotite, embedded }: Props) {
  const hasAnaf = !!client.dataAnafActualizat

  const [editingNotite, setEditingNotite] = useState(false)
  const [notiteValue, setNotiteValue] = useState(client.notite)
  const [savingNotite, setSavingNotite] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editingNotite) setNotiteValue(client.notite)
  }, [client.notite, editingNotite])

  useEffect(() => {
    if (editingNotite) textareaRef.current?.focus()
  }, [editingNotite])

  const handleSaveNotite = async () => {
    setSavingNotite(true)
    try {
      await onSaveNotite(notiteValue)
      setEditingNotite(false)
    } finally {
      setSavingNotite(false)
    }
  }

  const handleCancelNotite = () => {
    setNotiteValue(client.notite)
    setEditingNotite(false)
  }

  return (
    <div className={embedded ? 'cv2-embed' : 'cv2-panel'}>

      {/* ── Header ── */}
      <div className="cv2-header">
        <div className="cv2-header-row">
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ flexShrink: 0 }}>← Înapoi</button>
          <div className="cv2-header-title">
            {client.formaJuridica && <span className="cv2-forma-badge">{client.formaJuridica}</span>}
            <span className="cv2-company-name" title={client.denumire}>{client.denumire}</span>
          </div>
          <div className="cv2-header-actions">
            <button className="btn btn-ghost btn-sm" onClick={onEdit} title="Editează">✏️ Editează</button>
            <button className="btn btn-ghost btn-sm" onClick={onDelete} title="Șterge" style={{ color: 'var(--r500)' }}>🗑️</button>
          </div>
        </div>

        {hasAnaf && (
          <div className="cv2-header-anaf">
            <div className="cv2-status-badges">
              {client.statutFiscal && (
                <span className={`badge badge-${client.statutFiscal}`}>
                  {client.statutFiscal.charAt(0).toUpperCase() + client.statutFiscal.slice(1)}
                </span>
              )}
              {client.platitorTva
                ? <span className="badge badge-tva">TVA {client.periodaTva || ''}</span>
                : <span className="badge badge-notva">Non-TVA</span>
              }
            </div>
            <span className="cv2-anaf-note">
              Date ANAF — actualizat la {new Date(client.dataAnafActualizat!).toLocaleDateString('ro-RO')}
            </span>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="cv2-body">

        {/* Identificare fiscală + Contact */}
        <div className="cv2-section">
          <div className="cv2-two-col">
            <div className="cv2-col">
              <div className="cv2-col-title">Identificare fiscală</div>
              <InfoRow label="Cod fiscal" value={client.codFiscal} />
              <InfoRow label="Nr. reg. comerțului" value={client.nrRegistrul} />
              <InfoRow
                label="CAEN"
                value={client.caenCod
                  ? `${client.caenCod}${client.caenDescriere ? ` — ${client.caenDescriere}` : ''}`
                  : undefined}
              />
            </div>
            <div className="cv2-col">
              <div className="cv2-col-title">Contact</div>
              <InfoRow label="Telefon" value={client.telefon} />
              <InfoRow label="Email" value={client.email} link={!!client.email} />
            </div>
          </div>
        </div>

        {/* Sediu social */}
        <div className="cv2-section">
          <div className="cv2-section-label">Sediu social</div>
          {client.sediuSocial
            ? <div className="cv2-address">{client.sediuSocial}</div>
            : <span className="cv2-info-empty">—</span>
          }
        </div>

        {/* Notițe interne */}
        <div className="cv2-section cv2-section--notes">
          <div className="cv2-section-label">
            📌 Notițe interne
            {!editingNotite && (
              <button className="cv2-notes-edit-btn" onClick={() => setEditingNotite(true)} title="Editează notițe">
                ✏️
              </button>
            )}
          </div>
          {editingNotite ? (
            <div className="cv2-notes-editor">
              <textarea
                ref={textareaRef}
                className="field-textarea cv2-notes-textarea"
                value={notiteValue}
                onChange={e => setNotiteValue(e.target.value)}
                rows={4}
                placeholder="Adaugă notițe interne…"
              />
              <div className="cv2-notes-actions">
                <button className="btn btn-ghost btn-sm" onClick={handleCancelNotite} disabled={savingNotite}>
                  Anulează
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleSaveNotite} disabled={savingNotite}>
                  {savingNotite ? <span className="spin" /> : 'Salvează'}
                </button>
              </div>
            </div>
          ) : (
            client.notite
              ? <div className="cv2-notes-body">{client.notite}</div>
              : <span className="cv2-info-empty cv2-notes-placeholder" onClick={() => setEditingNotite(true)}>
                  Apasă pentru a adăuga o notiță...
                </span>
          )}
        </div>

        {/* Asociați */}
        <div className="cv2-section">
          <div className="cv2-section-label">
            Asociați
            {client.asociati.length > 0 && <span className="cv2-count-chip">{client.asociati.length}</span>}
          </div>
          {client.asociati.length > 0
            ? <div className="cv2-persons-list">
                {client.asociati.map((p, i) => <PersoanaCard key={i} p={p} />)}
              </div>
            : <span className="cv2-info-empty">Niciun asociat adăugat.</span>
          }
        </div>

        {/* Administratori */}
        <div className="cv2-section">
          <div className="cv2-section-label">
            Administratori
            {client.administratori.length > 0 && <span className="cv2-count-chip">{client.administratori.length}</span>}
          </div>
          {client.administratori.length > 0
            ? <div className="cv2-persons-list">
                {client.administratori.map((p, i) => <PersoanaCard key={i} p={p} />)}
              </div>
            : <span className="cv2-info-empty">Niciun administrator adăugat.</span>
          }
        </div>
      </div>
    </div>
  )
}
