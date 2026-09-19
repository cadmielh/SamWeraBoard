import { useState } from 'react'
import { useApp } from '../AppContext'
import type { WorkspaceRole } from '../types'

const ROLE_LABEL: Record<WorkspaceRole, string> = { admin: 'Administrator', member: 'Membru', viewer: 'Doar citire' }

/** Invitațiile primite. Acceptarea e explicită: se afișează cine te-a invitat și
 * în ce spațiu, iar tu alegi dacă accepți. Nu există alăturare automată. */
export default function InvitationsPanel() {
  const { workspaceCtx, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const { invitations } = workspaceCtx
  if (invitations.length === 0) return null

  const act = async (id: string, kind: 'accept' | 'decline') => {
    setBusy(id)
    try {
      if (kind === 'accept') {
        await workspaceCtx.acceptInvitation(id)
        toast('Te-ai alăturat spațiului de lucru', 'ok')
      } else {
        await workspaceCtx.declineInvitation(id)
      }
    } catch {
      toast('Invitația nu mai este validă', 'err')
      await workspaceCtx.reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div className="card-head"><div className="card-title">Invitații primite</div></div>
      <div className="card-body">
        {invitations.map(inv => (
          <div key={inv.id} className="member-row">
            <div className="member-info">
              <div className="member-email">{inv.workspaceName}</div>
              <div className="member-role">Invitat de {inv.invitedByEmail} · {ROLE_LABEL[inv.role]}</div>
            </div>
            <div style={{ display: 'flex', gap: '.375rem' }}>
              <button className="btn btn-primary btn-xs" disabled={busy === inv.id} onClick={() => act(inv.id, 'accept')}>Acceptă</button>
              <button className="btn btn-ghost btn-xs" disabled={busy === inv.id} onClick={() => act(inv.id, 'decline')}>Refuză</button>
            </div>
          </div>
        ))}
        <p style={{ fontSize: '.72rem', color: 'var(--s400)', margin: '.5rem 0 0' }}>
          Acceptă doar invitațiile de la persoane pe care le cunoști: după acceptare, membrii spațiului pot vedea datele introduse în el.
        </p>
      </div>
    </div>
  )
}
