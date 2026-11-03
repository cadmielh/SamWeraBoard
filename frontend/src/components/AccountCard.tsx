import { useState, type FormEvent, type ReactNode } from 'react'
import { useApp } from '../AppContext'
import { apiJson } from '../lib/api'
import { authErrorMessage, PASSWORD_REQUIREMENTS, passwordMeetsRules } from '../lib/authErrors'
import { clearDriveToken, ensureDriveToken, getDriveToken } from '../lib/driveAuth'
import { changePassword, signOut } from '../lib/firebase'
import ConfirmModal from './ConfirmModal'
import PasswordRules from './PasswordRules'

/** Un rând al cardului: titlu și o explicație scurtă în stânga, acțiunea în dreapta. */
function Row({ title, desc, action }: { title: string; desc: ReactNode; action: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 14rem' }}>
        <div style={{ fontWeight: 600, color: 'var(--s800)' }}>{title}</div>
        <div className="card-sub">{desc}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{action}</div>
    </div>
  )
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const { user, toast } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!passwordMeetsRules(next)) { setError(PASSWORD_REQUIREMENTS); return }
    if (next !== confirmation) { setError('Parolele nu coincid.'); return }
    setError(null)
    setSaving(true)
    try {
      await changePassword(user, current, next)
      setCurrent('')
      setNext('')
      setConfirmation('')
      toast('Parola a fost schimbată', 'ok')
      onDone()
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'Parola curentă este incorectă.' : authErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={e => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '.625rem', maxWidth: 360, padding: '.875rem 1rem', border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)' }}>
      <input type="email" name="email" autoComplete="username" value={user.email ?? ''} readOnly hidden />
      <label className="field">
        <span className="field-label">Parola curentă</span>
        <input className="field-input" type="password" autoComplete="current-password" required autoFocus value={current} onChange={e => setCurrent(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Parola nouă</span>
        <input className="field-input" type="password" autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} />
        {next && <PasswordRules password={next} />}
      </label>
      <label className="field">
        <span className="field-label">Confirmă parola nouă</span>
        <input className="field-input" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} />
      </label>
      {error && <div role="alert" style={{ color: 'var(--r600)', fontSize: '.8125rem' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '.5rem' }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? <span className="spin" /> : 'Salvează parola'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone} disabled={saving}>Anulează</button>
      </div>
    </form>
  )
}

/** Contul utilizatorului: parolă, conexiunea cu Google Drive și sesiunile deschise. */
export default function AccountCard() {
  const { user, toast } = useApp()
  const hasPassword = user.providerData.some(p => p.providerId === 'password')
  const hasGoogle = user.providerData.some(p => p.providerId === 'google.com')
  const [driveConnected, setDriveConnected] = useState(() => !!getDriveToken())
  const [connecting, setConnecting] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  const connectDrive = async () => {
    setConnecting(true)
    try {
      await ensureDriveToken()
      setDriveConnected(true)
    } catch (err) {
      toast((err as Error).message, 'err')
    } finally {
      setConnecting(false)
    }
  }

  const disconnectDrive = () => {
    clearDriveToken()
    setDriveConnected(false)
  }

  const revokeSessions = async () => {
    setConfirmRevoke(false)
    setRevoking(true)
    try {
      await apiJson('POST', '/account/revoke-sessions')
      await signOut()
    } catch {
      toast('Nu s-au putut încheia sesiunile. Încearcă din nou.', 'err')
      setRevoking(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">👤 Cont</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--s800)' }}>{user.displayName ?? user.email}</div>
          <div className="card-sub">
            {user.email} · Autentificare cu {[hasGoogle && 'Google', hasPassword && 'parolă'].filter(Boolean).join(' și ') || 'cont extern'}
          </div>
        </div>

        {hasPassword && (
          <>
            <Row title="Parolă" desc="Schimb-o dacă bănuiești că a ajuns la altcineva."
              action={!changingPassword && <button className="btn btn-sm" onClick={() => setChangingPassword(true)}>Schimbă parola</button>} />
            {changingPassword && <PasswordForm onDone={() => setChangingPassword(false)} />}
          </>
        )}

        <Row
          title="Google Drive"
          desc={driveConnected ? 'Conectat în acest tab; aplicația vede doar fișierele alese.' : 'Neconectat în acest tab; se conectează automat la nevoie.'}
          action={driveConnected
            ? <button className="btn btn-sm" onClick={disconnectDrive}>Deconectează</button>
            : <button className="btn btn-sm" onClick={() => void connectDrive()} disabled={connecting}>{connecting ? <span className="spin spin-dark" /> : 'Conectează'}</button>}
        />

        <Row
          title="Sesiuni"
          desc="Pentru un dispozitiv pierdut sau un acces suspect."
          action={<button className="btn btn-sm" onClick={() => setConfirmRevoke(true)} disabled={revoking}>
            {revoking ? <span className="spin spin-dark" /> : 'Deconectează peste tot'}
          </button>}
        />
      </div>

      {confirmRevoke && (
        <ConfirmModal
          title="Deconectezi toate dispozitivele?"
          message="Se încheie sesiunile de pe toate dispozitivele, inclusiv cea curentă. Va trebui să te autentifici din nou."
          confirmLabel="Deconectează"
          danger
          onConfirm={() => void revokeSessions()}
          onCancel={() => setConfirmRevoke(false)}
        />
      )}
    </div>
  )
}
