import { useApp } from '../AppContext'
import MembriPanel from '../components/MembriPanel'
import NotificariBell from '../components/NotificariBell'

export default function MembriPage() {
  const { activeWorkspace, userRole } = useApp()

  if (!activeWorkspace) return null

  // Același antet ca pe celelalte pagini (titlu, subtitlu, clopoțel în același loc); conținutul rămâne îngust.
  return (
    <div className="page--data">
      <div className="page-top">
        <div className="page-header">
          <div>
            <div className="page-title">Gestionare utilizatori</div>
            <div className="page-subtitle">Spațiu de lucru: <strong>{activeWorkspace.name}</strong></div>
          </div>
          <div className="page-actions"><NotificariBell /></div>
        </div>
      </div>

      <div className="page-body" style={{ overflowY: 'auto' }}>
        {userRole !== 'admin' ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
            <div style={{ textAlign: 'center', color: 'var(--s400)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>🔒</div>
              <p>Acces permis doar administratorilor.</p>
            </div>
          </div>
        ) : (
          <div className="card" style={{ maxWidth: 680 }}>
            <div className="card-body">
              <MembriPanel workspace={activeWorkspace} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
