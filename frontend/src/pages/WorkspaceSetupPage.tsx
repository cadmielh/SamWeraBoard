import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../AppLayout'

export default function WorkspaceSetupPage() {
  const { user, workspaceCtx, toast } = useApp()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || !user) return
    setSaving(true)
    try {
      await workspaceCtx.createWorkspace(name.trim(), {
        uid: user.uid,
        email: user.email ?? '',
        displayName: user.displayName ?? user.email ?? '',
      })
      toast('Spațiu de lucru creat cu succes!', 'ok')
      navigate('/')
    } catch {
      toast('Eroare la crearea spațiului de lucru', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="setup-page">
      <div className="card" style={{ maxWidth: 440, width: '100%' }}>
        <div className="card-body" style={{ padding: '2rem 2rem 2.25rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '.625rem' }}>🏢</div>
            <h1 style={{ fontWeight: 800, fontSize: '1.375rem', letterSpacing: '-.025em', color: 'var(--s900)', marginBottom: '.5rem' }}>
              Creați un spațiu de lucru
            </h1>
            <p style={{ color: 'var(--s400)', fontSize: '.875rem', lineHeight: 1.55 }}>
              Un spațiu de lucru conține baza de date de clienți.<br />
              Puteți invita colegi ulterior.
            </p>
          </div>

          <div className="field" style={{ marginBottom: '1.25rem' }}>
            <label className="field-label">Numele cabinetului / firmei</label>
            <input
              className="field-input"
              placeholder="ex: Cabinet Contabil Popescu"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>

          <button
            className="btn btn-primary btn-full"
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            style={{ fontSize: '.9375rem', padding: '.625rem 1.25rem' }}
          >
            {saving ? <><span className="spin" />Se creează...</> : 'Creează spațiu de lucru'}
          </button>

          <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '1.125rem', textAlign: 'center' }}>
            Dacă ați primit o invitație, autentificați-vă cu adresa de email invitată și veți fi adăugat automat.
          </p>
        </div>
      </div>
    </div>
  )
}
