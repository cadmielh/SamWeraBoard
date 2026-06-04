import { useState } from 'react'
import type { Workspace } from '../types'
import { useApp } from '../AppLayout'

interface Props {
  workspace: Workspace
}

export default function MembriPanel({ workspace }: Props) {
  const { user, workspaceCtx, toast } = useApp()
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [inviting, setSending] = useState(false)

  const members = Object.entries(workspace.members)

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setSending(true)
    try {
      await workspaceCtx.inviteMember(workspace.id, inviteEmail.trim(), inviteRole, workspace.name, user.uid)
      toast(`Invitație trimisă către ${inviteEmail.trim()}`, 'ok')
      setInviteEmail('')
    } catch {
      toast('Eroare la trimiterea invitației', 'err')
    } finally {
      setSending(false)
    }
  }

  const handleRemove = async (uid: string, email: string) => {
    if (!confirm(`Elimini utilizatorul ${email}?`)) return
    try {
      await workspaceCtx.removeMember(workspace.id, uid)
      toast('Utilizator eliminat', 'ok')
    } catch {
      toast('Eroare la eliminarea utilizatorului', 'err')
    }
  }

  const handleToggleRole = async (uid: string, currentRole: 'admin' | 'member') => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin'
    try {
      await workspaceCtx.changeMemberRole(workspace.id, uid, newRole)
      toast(`Rol schimbat în ${newRole === 'admin' ? 'Admin' : 'Membru'}`, 'ok')
    } catch {
      toast('Eroare la schimbarea rolului', 'err')
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
              <div className="member-role">{m.email} · {m.role === 'admin' ? 'Administrator' : 'Membru'}</div>
            </div>
            {uid !== workspace.ownerId && uid !== user.uid && (
              <div style={{ display: 'flex', gap: '.375rem', flexShrink: 0 }}>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => handleToggleRole(uid, m.role)}
                  title={m.role === 'admin' ? 'Retrogradează la Membru' : 'Promovează la Admin'}
                >
                  {m.role === 'admin' ? '▽ Membru' : '△ Admin'}
                </button>
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
          <select className="field-input" style={{ width: 'auto' }} value={inviteRole} onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}>
            <option value="member">Membru</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
            {inviting ? <span className="spin" /> : 'Trimite invitație'}
          </button>
        </div>
        <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '.5rem', margin: '.5rem 0 0' }}>
          Invitatul va fi adăugat automat la primul login cu adresa de email invitată.
        </p>
      </div>
    </div>
  )
}
