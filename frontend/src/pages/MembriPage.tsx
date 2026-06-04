import { useApp } from '../AppLayout'
import MembriPanel from '../components/MembriPanel'

export default function MembriPage() {
  const { activeWorkspace, userRole } = useApp()

  if (userRole !== 'admin') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--s400)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>🔒</div>
          <p>Acces permis doar administratorilor.</p>
        </div>
      </div>
    )
  }

  if (!activeWorkspace) return null

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--s900)', letterSpacing: '-.025em', margin: 0 }}>
          Gestionare utilizatori
        </h1>
        <p style={{ color: 'var(--s400)', fontSize: '.875rem', marginTop: '.375rem' }}>
          Spațiu de lucru: <strong>{activeWorkspace.name}</strong>
        </p>
      </div>
      <div className="card">
        <div className="card-body">
          <MembriPanel workspace={activeWorkspace} />
        </div>
      </div>
    </div>
  )
}
