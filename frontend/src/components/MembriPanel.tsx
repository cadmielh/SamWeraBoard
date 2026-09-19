import { useState, useEffect, useCallback } from 'react'
import type { Workspace, WorkspaceRole } from '../types'
import type { WorkspaceInvite } from '../lib/workspace'
import { useApp } from '../AppContext'

const ROLE_LABEL: Record<WorkspaceRole, string> = { admin: 'Administrator', member: 'Membru', viewer: 'Doar citire' }

interface Props {
  workspace: Workspace
}

export default function MembriPanel({ workspace }: Props) {
  const { user, workspaceCtx, toast } = useApp()
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member')
  const [pending, setPending] = useState<WorkspaceInvite[]>([])
  const [inviting, setSending] = useState(false)

  const members = Object.entries(workspace.members)

  const loadPending = useCallback(async () => {
    try { setPending(await workspaceCtx.listWorkspaceInvites(workspace.id)) } catch { setPending([]) }
  }, [workspaceCtx, workspace.id])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadPending() }, [loadPending])

  const errMsg = (e: unknown, fallback: string) => {
    switch ((e as { code?: string }).code) {
      case 'already_member': return 'Utilizatorul este deja membru'
      case 'last_admin': return 'Trebuie să rămână cel puțin un administrator'
      case 'owner_locked': return 'Proprietarul spațiului nu poate fi modificat'
      case 'invalid_email': return 'Adresa de e-mail nu este validă'
      case 'invite_limit': return 'Prea multe invitații în așteptare'
      default: return fallback
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setSending(true)
    try {
      await workspaceCtx.inviteMember(workspace.id, inviteEmail.trim(), inviteRole)
      toast(`Invitație trimisă către ${inviteEmail.trim()}`, 'ok')
      setInviteEmail('')
      await loadPending()
    } catch (e) {
      toast(errMsg(e, 'Eroare la trimiterea invitației'), 'err')
    } finally {
      setSending(false)
    }
  }

  const handleRemove = async (uid: string, email: string) => {
    if (!confirm(`Elimini utilizatorul ${email}?`)) return
    try {
      await workspaceCtx.removeMember(workspace.id, uid)
      toast('Utilizator eliminat', 'ok')
    } catch (e) {
      toast(errMsg(e, 'Eroare la eliminarea utilizatorului'), 'err')
    }
  }

  const handleRole = async (uid: string, newRole: WorkspaceRole) => {
    try {
      await workspaceCtx.changeMemberRole(workspace.id, uid, newRole)
      toast(`Rol schimbat în ${ROLE_LABEL[newRole]}`, 'ok')
    } catch (e) {
      toast(errMsg(e, 'Eroare la schimbarea rolului'), 'err')
    }
  }

  const handleRevoke = async (id: string) => {
    try {
      await workspaceCtx.revokeInvite(workspace.id, id)
      await loadPending()
    } catch {
      toast('Eroare la anularea invitației', 'err')
    }
  }

  return (
    <div>
      {/* Members list */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontWeight: 700, fontSize: '.875rem', color: 'var(--s700)', marginBottom: '.75rem' }}>
          Membri ({members.length})
        </div>
        {members.map(([uid, m]) => (
          <div key={uid} className="member-row">
            <div className="member-avatar">{(m.displayName || m.email || '?')[0].toUpperCase()}</div>
            <div className="member-info">
              <div className="member-email">{m.displayName || m.email}</div>
              <div className="member-role">{m.email} · {ROLE_LABEL[m.role]}</div>
            </div>
            {uid !== workspace.ownerId && uid !== user.uid && (
              <div style={{ display: 'flex', gap: '.375rem', flexShrink: 0 }}>
                <select
                  className="field-input"
                  style={{ width: 'auto', padding: '.15rem .4rem', fontSize: '.75rem' }}
                  value={m.role}
                  onChange={e => handleRole(uid, e.target.value as WorkspaceRole)}
                >
                  <option value="admin">Administrator</option>
                  <option value="member">Membru</option>
                  <option value="viewer">Doar citire</option>
                </select>
                <button className="btn btn-ghost btn-xs" style={{ color: 'var(--r500)' }} onClick={() => handleRemove(uid, m.email)}>
                  Elimină
                </button>
              </div>
            )}
            {uid === workspace.ownerId && (
              <span className="chip chip-primary" style={{ fontSize: '.68rem' }}>Proprietar</span>
            )}
          </div>
        ))}
      </div>

      {/* Invite form */}
      <div style={{ background: 'var(--s50)', border: '1px solid var(--s200)', borderRadius: 'var(--r-md)', padding: '1rem' }}>
        <div style={{ fontWeight: 700, fontSize: '.875rem', color: 'var(--s700)', marginBottom: '.75rem' }}>
          Invită utilizator
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr auto auto', gap: '.5rem' }}>
          <input
            className="field-input"
            type="email"
            placeholder="email@exemplu.ro"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleInvite()}
          />
          <select className="field-input" style={{ width: 'auto' }} value={inviteRole} onChange={e => setInviteRole(e.target.value as WorkspaceRole)}>
            <option value="member">Membru</option>
            <option value="viewer">Doar citire</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
            {inviting ? <span className="spin" /> : 'Trimite invitație'}
          </button>
        </div>
        <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '.5rem', margin: '.5rem 0 0' }}>
          Invitatul se autentifică cu adresa invitată și vede invitația; se alătură doar dacă o acceptă (valabilă 14 zile).
        </p>
        {pending.length > 0 && (
          <div style={{ marginTop: '.75rem' }}>
            <div style={{ fontWeight: 700, fontSize: '.8rem', color: 'var(--s700)', marginBottom: '.4rem' }}>Invitații în așteptare</div>
            {pending.map(p => (
              <div key={p.id} className="member-row">
                <div className="member-info">
                  <div className="member-email">{p.email}</div>
                  <div className="member-role">{ROLE_LABEL[p.role]}</div>
                </div>
                <button className="btn btn-ghost btn-xs" style={{ color: 'var(--r500)' }} onClick={() => handleRevoke(p.id)}>Anulează</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
