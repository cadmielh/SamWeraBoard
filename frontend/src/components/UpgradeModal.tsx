import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { READ_ONLY_MESSAGE, SUBSCRIPTION_REQUIRED_EVENT } from '../lib/billing'
import Modal from './Modal'

/** Se deschide la orice acțiune refuzată pentru că perioada de probă / abonamentul a expirat
 *  (răspuns `subscription_required` de la API sau o scriere oprită de assertWritable). */
export default function UpgradeModal() {
  const { userRole } = useApp()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(SUBSCRIPTION_REQUIRED_EVENT, show)
    return () => window.removeEventListener(SUBSCRIPTION_REQUIRED_EVENT, show)
  }, [])

  if (!open) return null
  const close = () => setOpen(false)
  return (
    <Modal onClose={close} className="modal-box--sm" ariaLabel="Abonament necesar">
      <div className="modal-head"><span className="modal-title">Abonament necesar</span></div>
      <div className="modal-body">
        <p style={{ color: 'var(--s600)', fontSize: '.9rem', lineHeight: 1.55 }}>{READ_ONLY_MESSAGE}</p>
        {userRole !== 'admin' && (
          <p style={{ color: 'var(--s500)', fontSize: '.8125rem', lineHeight: 1.5, marginTop: '.75rem' }}>
            Abonamentul se activează de administratorul cabinetului.
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={close}>Închide</button>
        {userRole === 'admin' && (
          <button className="btn btn-primary" onClick={() => { close(); navigate('/abonament') }}>Vezi abonamentul</button>
        )}
      </div>
    </Modal>
  )
}
