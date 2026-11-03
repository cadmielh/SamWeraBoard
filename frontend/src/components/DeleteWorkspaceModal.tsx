import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { authErrorMessage } from '../lib/authErrors'
import { reauthenticate } from '../lib/firebase'
import { adminDeleteWorkspace, adminDeletionPreview, type DeletionPreview } from '../lib/superAdmin'
import IconTrash from './IconTrash'
import Modal from './Modal'

const COUNT_LABELS: Record<string, string> = {
  clienti: 'clienți', dosare: 'dosare', sarcini: 'sarcini', docTemplates: 'șabloane', auditLog: 'intrări în jurnal', membri: 'membri', 'invitații': 'invitații',
}

/** Ștergerea unui cabinet de către super admin: programată (cu perioadă de recuperare) sau, la cerere, imediată. */
export default function DeleteWorkspaceModal({ workspaceId, name, onDeleted, onClose }: {
  workspaceId: string; name: string; onDeleted: () => void; onClose: () => void
}) {
  const { user } = useApp()
  const [preview, setPreview] = useState<DeletionPreview | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [immediate, setImmediate] = useState(false)

  useEffect(() => {
    adminDeletionPreview(workspaceId)
      .then(setPreview)
      .catch((e: Error) => setError(e.message))
  }, [workspaceId])

  const remove = async () => {
    setError(null)
    setBusy(true)
    try {
      await reauthenticate(user)          // o sesiune lăsată deschisă nu ajunge pentru o ștergere definitivă
      await adminDeleteWorkspace(workspaceId, typed, immediate)
      onDeleted()
    } catch (e) {
      setError((e as { status?: number }).status ? (e as Error).message : authErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} className="modal-box--sm" ariaLabel="Șterge cabinetul">
      <div className="modal-head">
        <span className="modal-title">Șterge „{name}”</span>
        <button className="modal-close" onClick={onClose} disabled={busy}>×</button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', fontSize: '.875rem', color: 'var(--s600)' }}>
        <p style={{ margin: 0 }}>
          Accesul la cabinet se blochează imediat, iar abonamentul se anulează. Datele se șterg definitiv după{' '}
          {preview?.graceDays ?? 14} zile; până atunci, cabinetul poate fi restaurat de aici.
        </p>
        {preview ? (
          <>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {Object.entries(preview.counts).map(([k, v]) => <li key={k}>{v} {COUNT_LABELS[k] ?? k}</li>)}
            </ul>
            {preview.subscription && <p style={{ margin: 0 }}>Abonamentul Stripe al cabinetului se anulează.</p>}
          </>
        ) : !error && <div className="card-sub">Se încarcă...</div>}
        <label className="field">
          <span className="field-label">Scrie numele cabinetului pentru confirmare</span>
          <input className="field-input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
        </label>
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start' }}>
          <input type="checkbox" checked={immediate} onChange={e => setImmediate(e.target.checked)} style={{ marginTop: '.2rem' }} />
          <span>Șterge <strong>imediat și definitiv</strong>, fără perioadă de recuperare (de ex. la un incident de securitate).</span>
        </label>
        <p className="card-sub" style={{ margin: 0 }}>La confirmare ți se cere din nou autentificarea Google.</p>
        {error && <div role="alert" style={{ color: 'var(--r600)' }}>{error}</div>}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Anulează</button>
        <button className="btn btn-danger" onClick={() => void remove()}
          disabled={busy || !preview || typed.trim() !== name.trim()}>
          {busy ? <span className="spin" /> : <><IconTrash size={14} /> {immediate ? 'Șterge definitiv acum' : 'Programează ștergerea'}</>}
        </button>
      </div>
    </Modal>
  )
}
