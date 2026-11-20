import { useState } from 'react'
import { useApp } from '../AppContext'
import DeleteAccountModal from './DeleteAccountModal'
import IconTrash from './IconTrash'

/** Zona periculoasă din Setări: acțiunile ireversibile, separate vizual de restul. */
export default function DangerZoneCard() {
  const { user } = useApp()
  const hasPassword = user.providerData.some(p => p.providerId === 'password')
  const [deleting, setDeleting] = useState(false)
  return (
    <div className="card settings-danger">
      <div className="card-head"><span className="card-title" style={{ color: 'var(--r600)' }}>Ștergerea contului</span></div>
      <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="card-sub" style={{ flex: '1 1 18rem', fontSize: '.875rem' }}>
          Contul se dezactivează imediat și se șterge definitiv după 14 zile, împreună cu cabinetele în care ești singurul membru.
          Descarcă înainte o copie a datelor tale din „Date și confidențialitate”.
        </div>
        <button className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}><IconTrash size={14} /> Șterge contul</button>
      </div>
      {deleting && <DeleteAccountModal hasPassword={hasPassword} onClose={() => setDeleting(false)} />}
    </div>
  )
}
