import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Persoana } from '../types'
import { inferTipClient } from '../types'
import { computeScadente } from '../lib/scadente'
import { findCaenDescriere } from '../data/caen'
import { formatDateRo } from '../lib/dates'
import { getInitials, getAvatarColor } from '../lib/avatar'
import IconTrash from './IconTrash'
import IconPencil from './IconPencil'
import ClientDosareSarcini from './ClientDosareSarcini'

interface Props {
  client: Client
  onEdit: () => void
  onDelete: () => void
  onSaveNotite: (notite: string) => Promise<void>
  onSaveField: (patch: Partial<Client>) => Promise<void>
  embedded?: boolean
}

const SUBTIP_LABELS: Record<string, string> = {
  PFA: 'PFA',
  IF: 'IF',
  II: 'II',
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

// Direct data manipulation — click pe valoare, editezi pe loc, Enter/✓ salvează,
// Esc/✕ anulează. Fără modal, fără să navigheze departe de restul profilului.
function EditableInfoRow({ label, value, onSave, type = 'text', multiline = false }: {
  label?: string
  value: string
  onSave: (v: string) => Promise<void>
  type?: 'text' | 'tel' | 'email'
  multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sincronizează valoarea afișată cu prop-ul, cât timp nu editează userul.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!editing) setVal(value) }, [value, editing])
  useEffect(() => { if (editing) (multiline ? textareaRef.current : inputRef.current)?.focus() }, [editing, multiline])

  const commit = async () => {
    if (val === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(val)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }
  const cancel = () => { setVal(value); setEditing(false) }

  if (editing) {
    return (
      <div className="cv2-info-row">
        {label && <span className="cv2-info-label">{label}</span>}
        <div className="cv2-inline-edit">
          {multiline ? (
            <textarea
              ref={textareaRef} className="field-textarea" value={val} rows={2}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') cancel() }}
            />
          ) : (
            <input
              ref={inputRef} className="field-input" type={type} value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') cancel() }}
            />
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
      {label && <span className="cv2-info-label">{label}</span>}
      <span className={`cv2-info-value${value ? '' : ' cv2-info-empty'}`}>
        {value || 'Apasă pentru a completa…'}
        <span className="cv2-info-edit-hint">✏️</span>
      </span>
    </button>
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
    p.valabila_de_la   ? { label: 'Valabil de la',     value: p.valabila_de_la }   : null,
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

export default function ClientView({ client, onEdit, onDelete, onSaveNotite, onSaveField, embedded }: Props) {
  const navigate = useNavigate()
  const tipClient = inferTipClient(client)
  const isPF = tipClient === 'PF'
  const isIF = isPF && client.subtipPF === 'IF'
  const hasAnaf = !!client.dataAnafActualizat
  const scadente = useMemo(() => computeScadente(client), [client])

  const [editingNotite, setEditingNotite] = useState(false)
  const [notiteValue, setNotiteValue] = useState(client.notite)
  const [savingNotite, setSavingNotite] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sincronizează notițele afișate cu clientul curent, cât timp nu editează userul.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const headerBadge = isPF
    ? <span style={{
        padding: '.125rem .5rem', borderRadius: '4px', fontSize: '.6875rem', fontWeight: 700,
        background: 'var(--b100)', color: 'var(--b700)', border: '1px solid var(--b200)',
      }}>
        {SUBTIP_LABELS[client.subtipPF ?? 'PFA'] ?? 'PF'}
      </span>
    : <span style={{
        padding: '.125rem .5rem', borderRadius: '4px', fontSize: '.6875rem', fontWeight: 700,
        background: 'var(--g100)', color: 'var(--g700)', border: '1px solid var(--g200)',
      }}>
        {client.formaJuridica || 'PJ'}
      </span>

  return (
    <div className={embedded ? 'cv2-embed' : 'cv2-panel'}>

      {/* ── Header ── */}
      <div className="cv2-header">
        <div className="cv2-header-row">
          <div className="cv2-header-title">
            {headerBadge}
            <span className="cv2-company-name" title={client.denumire}>{client.denumire}</span>
          </div>
          <div className="cv2-header-actions">
            <button
              className="btn btn-outline-primary btn-sm"
              onClick={() => navigate(`/extragere?clientId=${client.id}&mode=client`)}
              title="Generează documente pentru acest client"
            >
              📄 Generează documente
            </button>
            <button className="btn btn-primary btn-sm" onClick={onEdit} title="Editează"><IconPencil /> Editează</button>
            <button className="btn btn-danger btn-sm" onClick={onDelete} title="Șterge"><IconTrash /> Șterge</button>
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
              {client.inactivAnaf && <span className="badge badge-inactiv-anaf">⚠ Inactiv fiscal ANAF</span>}
              {client.splitTva && <span className="badge badge-split-tva">Split TVA</span>}
              {client.eFactura && <span className="badge badge-efactura">RO e-Factura</span>}
            </div>
            <span className="cv2-anaf-note">
              Date ANAF — actualizat la {formatDateRo(new Date(client.dataAnafActualizat!))}
            </span>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="cv2-body">

        <ClientDosareSarcini client={client} />

        {/* ── Bloc Date persoană (CI) — orice PF ── */}
        {isPF && client.titular && (
          <div className="cv2-section">
            <div className="cv2-section-label" style={{ color: 'var(--b600)' }}>
              Date persoană (CI)
            </div>
            <PersoanaCard p={client.titular} />
          </div>
        )}

        {/* ── Bloc Date entitate — PF autorizată și PJ ── */}
        <div className="cv2-section">
          <div className="cv2-two-col">
            <div className="cv2-col">
              <div className="cv2-col-title">
                {isPF ? 'Date entitate' : 'Identificare fiscală'}
              </div>
              <InfoRow label="Cod fiscal (CIF)" value={client.codFiscal} />
              <InfoRow label="Nr. reg. comerțului" value={client.nrRegistrul} />
              <InfoRow
                label="CAEN principal"
                value={client.caenCod
                  ? `${client.caenCod} — ${client.caenDescriere || findCaenDescriere(client.caenCod)}`
                  : undefined}
              />
              {client.caenSecundare && client.caenSecundare.length > 0 && (
                <InfoRow
                  label="CAEN secundare"
                  value={client.caenSecundare.map(c => `${c.cod} — ${c.descriere || findCaenDescriere(c.cod)}`).join('; ')}
                />
              )}
            </div>
            <div className="cv2-col">
              <div className="cv2-col-title">Contact</div>
              <EditableInfoRow label="Telefon" value={client.telefon} type="tel" onSave={v => onSaveField({ telefon: v })} />
              <EditableInfoRow label="Email" value={client.email ?? ''} type="email" onSave={v => onSaveField({ email: v })} />
            </div>
          </div>
        </div>

        {/* Sediu social / profesional */}
        <div className="cv2-section">
          <div className="cv2-section-label">{isPF ? 'Sediu profesional' : 'Sediu social'}</div>
          <EditableInfoRow value={client.sediuSocial} multiline onSave={v => onSaveField({ sediuSocial: v })} />
        </div>

        {/* Date fiscale */}
        <div className="cv2-section">
          <div className="cv2-two-col">
            <div className="cv2-col">
              <div className="cv2-col-title">TVA</div>
              <InfoRow label="TVA la încasare" value={client.platitorTva ? (client.tvaLaIncasare ? 'Da' : 'Nu') : undefined} />
            </div>
            {!isPF && (
              <div className="cv2-col">
                <div className="cv2-col-title">Capital</div>
                <InfoRow label="Capital social" value={client.capitalSocial != null ? `${client.capitalSocial.toLocaleString('ro-RO')} lei` : undefined} />
                <InfoRow label="Părți sociale" value={client.capitalSocial != null ? (client.capitalSocial / 10).toLocaleString('ro-RO') : undefined} />
              </div>
            )}
          </div>
        </div>

        {/* Scadențe fiscale */}
        {scadente.length > 0 && (
          <div className="cv2-section">
            <div className="cv2-section-label">📅 Scadențe fiscale</div>
            <div className="cv2-scadente-list">
              {scadente.map(s => (
                <div key={s.cod} className="cv2-scadenta-row">
                  <div>
                    <div className="cv2-scadenta-titlu">{s.titlu}</div>
                    <div className="cv2-scadenta-descriere">{s.descriere}</div>
                  </div>
                  <span className="cv2-scadenta-data">
                    {formatDateRo(s.urmatoarea)}
                  </span>
                </div>
              ))}
            </div>
            <p className="cv2-scadente-disclaimer">
              Termene orientative, calculate din datele completate mai sus — verifică reglementările ANAF în vigoare pentru cazuri speciale.
            </p>
          </div>
        )}

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

        {/* ── Asociați (doar PJ) ── */}
        {!isPF && (
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
        )}

        {/* ── Administratori (doar PJ) ── */}
        {!isPF && (
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
            {client.administratoriAnaf && client.administratoriAnaf.length > 0 && (
              <p className="cv2-anaf-note" style={{ marginTop: '.5rem' }}>
                Conform ANAF (informativ, verifică CNP/CI separat): {client.administratoriAnaf.map(a => a.nume).join(', ')}
              </p>
            )}
          </div>
        )}

        {/* ── Membri familie (doar IF) ── */}
        {isIF && (
          <div className="cv2-section">
            <div className="cv2-section-label">
              Membri familie IF
              {(client.membriIF?.length ?? 0) > 0 && <span className="cv2-count-chip">{client.membriIF!.length}</span>}
            </div>
            {(client.membriIF?.length ?? 0) > 0
              ? <div className="cv2-persons-list">
                  {client.membriIF!.map((p, i) => <PersoanaCard key={i} p={p} />)}
                </div>
              : <span className="cv2-info-empty">Niciun membru adăugat.</span>
            }
          </div>
        )}
      </div>
    </div>
  )
}
