import { useState, type FormEvent } from 'react'
import { useApp } from '../AppContext'
import { apiJson } from '../lib/api'
import { authErrorMessage, MIN_PASSWORD_LENGTH } from '../lib/authErrors'
import { clearDriveToken, ensureDriveToken, getDriveToken } from '../lib/driveAuth'
import { changePassword, signOut } from '../lib/firebase'
import ConfirmModal from './ConfirmModal'

function PasswordForm() {
  const { user, toast } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < MIN_PASSWORD_LENGTH) { setError(`Parola nouă trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.`); return }
    if (next !== confirmation) { setError('Parolele nu coincid.'); return }
    setError(null)
    setSaving(true)
    try {
      await changePassword(user, current, next)
      setCurrent('')
      setNext('')
      setConfirmation('')
      toast('Parola a fost schimbată', 'ok')
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'Parola curentă este incorectă.' : authErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={e => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '.625rem', maxWidth: 360 }}>
      <input type="email" name="email" autoComplete="username" value={user.email ?? ''} readOnly hidden />
      <label className="field">
        <span className="field-label">Parola curentă</span>
        <input className="field-input" type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Parola nouă</span>
        <input className="field-input" type="password" autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Confirmă parola nouă</span>
        <input className="field-input" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} />
      </label>
      {error && <div role="alert" style={{ color: 'var(--r600)', fontSize: '.8125rem' }}>{error}</div>}
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? <span className="spin" /> : 'Schimbă parola'}
        </button>
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
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--s800)' }}>{user.displayName ?? user.email}</div>
          <div className="card-sub">
            {user.email} · Autentificare cu {[hasGoogle && 'Google', hasPassword && 'parolă'].filter(Boolean).join(' și ') || 'cont extern'}
          </div>
        </div>

        {hasPassword && <PasswordForm />}

        <div>
          <div style={{ fontWeight: 600, color: 'var(--s800)', marginBottom: '.25rem' }}>Google Drive</div>
          <div className="card-sub" style={{ marginBottom: '.5rem' }}>
            {driveConnected
              ? 'Conectat în acest tab. Aplicația vede doar fișierele alese de tine sau create de ea.'
              : 'Neconectat în acest tab. Conectarea pornește și automat, când folosești o funcție Drive.'}
          </div>
          {driveConnected
            ? <button className="btn btn-sm" onClick={disconnectDrive}>Deconectează Drive</button>
            : <button className="btn btn-sm" onClick={() => void connectDrive()} disabled={connecting}>{connecting ? <span className="spin spin-dark" /> : 'Conectează Google Drive'}</button>}
        </div>

        <div>
          <div style={{ fontWeight: 600, color: 'var(--s800)', marginBottom: '.25rem' }}>Sesiuni</div>
          <div className="card-sub" style={{ marginBottom: '.5rem' }}>
            Încheie sesiunile de pe toate dispozitivele, inclusiv cea curentă. Folosește opțiunea dacă ai pierdut un dispozitiv sau suspectezi un acces neautorizat.
          </div>
          <button className="btn btn-sm" onClick={() => setConfirmRevoke(true)} disabled={revoking}>
            {revoking ? <span className="spin spin-dark" /> : 'Deconectează toate dispozitivele'}
          </button>
        </div>
      </div>

      {confirmRevoke && (
        <ConfirmModal
          title="Deconectezi toate dispozitivele?"
          message="Va trebui să te autentifici din nou, inclusiv aici."
          confirmLabel="Deconectează"
          danger
          onConfirm={() => void revokeSessions()}
          onCancel={() => setConfirmRevoke(false)}
        />
      )}
    </div>
  )
}
