import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Persoana } from '../types'
import { inferTipClient } from '../types'
import { computeScadente } from '../lib/scadente'

const REGIM_FISCAL_LABELS: Record<string, string> = {
  microintreprindere: 'Microîntreprindere',
  impozit_profit: 'Impozit pe profit',
}

interface Props {
  client: Client
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onSaveNotite: (notite: string) => Promise<void>
  embedded?: boolean
}

const SUBTIP_LABELS: Record<string, string> = {
  PFA: 'PFA',
  IF: 'IF',
  II: 'II',
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

  const headerBadge = isPF
    ? <span style={{
        padding: '.125rem .5rem', borderRadius: '4px', fontSize: '.6875rem', fontWeight: 700,
        background: 'var(--b100, #dbeafe)', color: 'var(--b700, #1d4ed8)', border: '1px solid var(--b200, #bfdbfe)',
      }}>
        {SUBTIP_LABELS[client.subtipPF ?? 'PFA'] ?? 'PF'}
      </span>
    : <span style={{
        padding: '.125rem .5rem', borderRadius: '4px', fontSize: '.6875rem', fontWeight: 700,
        background: 'var(--g100, #dcfce7)', color: 'var(--g700, #15803d)', border: '1px solid var(--g200, #bbf7d0)',
      }}>
        {client.formaJuridica || 'PJ'}
      </span>

  return (
    <div className={embedded ? 'cv2-embed' : 'cv2-panel'}>

      {/* ── Header ── */}
      <div className="cv2-header">
        <div className="cv2-header-row">
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ flexShrink: 0 }}>← Înapoi</button>
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

        {/* ── Bloc Date persoană (CI) — orice PF ── */}
        {isPF && client.titular && (
          <div className="cv2-section">
            <div className="cv2-section-label" style={{ color: 'var(--b600, #2563eb)' }}>
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

        {/* Sediu social / profesional */}
        <div className="cv2-section">
          <div className="cv2-section-label">{isPF ? 'Sediu profesional' : 'Sediu social'}</div>
          {client.sediuSocial
            ? <div className="cv2-address">{client.sediuSocial}</div>
            : <span className="cv2-info-empty">—</span>
          }
        </div>

        {/* Date fiscale */}
        <div className="cv2-section">
          <div className="cv2-two-col">
            <div className="cv2-col">
              <div className="cv2-col-title">Regim fiscal</div>
              <InfoRow label="Regim de impunere" value={client.regimFiscal ? REGIM_FISCAL_LABELS[client.regimFiscal] : undefined} />
              <InfoRow label="TVA la încasare" value={client.platitorTva ? (client.tvaLaIncasare ? 'Da' : 'Nu') : undefined} />
              <InfoRow label="Plafon TVA anual" value={client.plafonTvaAnual != null ? `${client.plafonTvaAnual.toLocaleString('ro-RO')} lei` : undefined} />
            </div>
            <div className="cv2-col">
              <div className="cv2-col-title">Altele</div>
              <InfoRow label="Nr. salariați" value={client.nrSalariati != null ? String(client.nrSalariati) : undefined} />
              {!isPF && <InfoRow label="Capital social" value={client.capitalSocial != null ? `${client.capitalSocial.toLocaleString('ro-RO')} lei` : undefined} />}
              <InfoRow label="An fiscal" value={client.anFiscal || undefined} />
            </div>
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
                    {s.urmatoarea.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })}
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
