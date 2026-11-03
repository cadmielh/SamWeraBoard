import { useState } from 'react'
import { useApp } from '../AppContext'
import { apiJson } from '../lib/api'
import { authErrorMessage } from '../lib/authErrors'
import { reauthenticate, signOut } from '../lib/firebase'
import IconTrash from './IconTrash'
import Modal from './Modal'

/** Ștergerea contului propriu: cabinetele în care e singur, calitatea de membru în celelalte, profilul și contul. */
export default function DeleteAccountModal({ hasPassword, onClose }: { hasPassword: boolean; onClose: () => void }) {
  const { user } = useApp()
  const email = (user.email ?? '').toLowerCase()
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [blockers, setBlockers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setError(null)
    setBlockers([])
    setBusy(true)
    try {
      await reauthenticate(user, hasPassword ? password : undefined)
      await apiJson('POST', '/account/delete', { confirm: typed.trim() })
      await signOut()
    } catch (e) {
      const err = e as Error & { status?: number; code?: string; data?: { workspaces?: string[] } }
      if (err.code === 'workspace_blockers') setBlockers(err.data?.workspaces ?? [])
      else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') setError('Parola este incorectă.')
      else setError(err.status ? err.message : authErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} className="modal-box--sm" ariaLabel="Șterge contul">
      <div className="modal-head">
        <span className="modal-title">Șterge contul</span>
        <button className="modal-close" onClick={onClose} disabled={busy}>×</button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', fontSize: '.875rem', color: 'var(--s600)' }}>
        <p style={{ margin: 0 }}>
          Contul se dezactivează imediat și se șterge definitiv după 14 zile. Dacă te răzgândești în acest interval, scrie-ne și îl putem restaura.
          După 14 zile se șterg:
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          <li>cabinetele în care ești singurul membru, cu toate datele lor;</li>
          <li>calitatea de membru din celelalte cabinete;</li>
          <li>profilul și contul tău de autentificare.</li>
        </ul>
        <p style={{ margin: 0 }}>
          Dacă ești proprietarul sau singurul administrator al unui cabinet cu alți membri, numește întâi alt administrator sau elimină ceilalți membri.
        </p>
        <label className="field">
          <span className="field-label">Scrie adresa ta de e-mail pentru confirmare</span>
          <input className="field-input" type="email" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" placeholder={email} />
        </label>
        {hasPassword ? (
          <label className="field">
            <span className="field-label">Parola</span>
            <input className="field-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
        ) : <p className="card-sub" style={{ margin: 0 }}>La confirmare ți se cere din nou autentificarea Google.</p>}
        {blockers.length > 0 && (
          <div role="alert" style={{ color: 'var(--r600)' }}>
            Nu poți șterge contul cât timp aceste cabinete ar rămâne fără administrator: {blockers.join(', ')}.
          </div>
        )}
        {error && <div role="alert" style={{ color: 'var(--r600)' }}>{error}</div>}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Anulează</button>
        <button className="btn btn-danger" onClick={() => void remove()}
          disabled={busy || typed.trim().toLowerCase() !== email || (hasPassword && !password)}>
          {busy ? <span className="spin" /> : <><IconTrash size={14} /> Șterge contul</>}
        </button>
      </div>
    </Modal>
  )
}
