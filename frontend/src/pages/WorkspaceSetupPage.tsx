import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Navigate, Link } from 'react-router-dom'
import InvitationsPanel from '../components/InvitationsPanel'
import { useApp } from '../AppContext'
import { PROVIDER } from '../lib/legalConfig'
import { fetchSignupStatus } from '../lib/superAdmin'

export default function WorkspaceSetupPage() {
  const { workspaceCtx, toast } = useApp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [accepted, setAccepted] = useState(false)
  // null = încă se verifică; false = crearea de cabinete e pe invitație și utilizatorul nu are drept încă
  const [canCreate, setCanCreate] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchSignupStatus()
      .then(r => { if (!cancelled) setCanCreate(r.canCreate) })
      .catch(() => { if (!cancelled) setCanCreate(true) })   // la eroare lăsăm formularul; serverul refuză oricum ce nu e permis
    return () => { cancelled = true }
  }, [])

  // Cine are deja un spațiu de lucru nu vede pagina de creare (nici la intrare directă pe adresa ei);
  // ajunge aici doar cerând explicit „Spațiu de lucru nou” din meniu (?nou=1).
  if (!workspaceCtx.loading && workspaceCtx.workspaces.length > 0 && searchParams.get('nou') !== '1') {
    return <Navigate to="/" replace />
  }

  const handleCreate = async () => {
    if (!name.trim() || !accepted) return
    setSaving(true)
    try {
      await workspaceCtx.createWorkspace(name.trim())
      toast('Spațiu de lucru creat cu succes!', 'ok')
      navigate('/')
    } catch (e) {
      const code = (e as { code?: string }).code
      toast(code === 'workspace_limit'
        ? 'Ai atins numărul maxim de spații de lucru create'
        : code === 'creation_not_allowed'
          ? `Crearea de cabinete noi se face pe invitație. Solicită acces la ${PROVIDER.contactEmail}.`
          : 'Eroare la crearea spațiului de lucru', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="setup-page">
      <div style={{ maxWidth: 440, width: '100%' }}>
      <InvitationsPanel />
      {canCreate === false ? (
        <div className="card" style={{ width: '100%' }}>
          <div className="card-body" style={{ padding: '2rem 2rem 2.25rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '.625rem' }}>🔑</div>
            <h1 style={{ fontWeight: 800, fontSize: '1.375rem', letterSpacing: '-.025em', color: 'var(--s900)', marginBottom: '.5rem' }}>
              Acces pe invitație
            </h1>
            <p style={{ color: 'var(--s500)', fontSize: '.875rem', lineHeight: 1.55, marginBottom: '1rem' }}>
              Contul dumneavoastră nu este încă asociat niciunui cabinet. Dacă un coleg v-a invitat, invitația apare mai sus.
              Pentru un cabinet nou, solicitați acces pilot și revenim cu pașii următori.
            </p>
            <a className="btn btn-primary" style={{ textDecoration: 'none' }}
              href={`mailto:${PROVIDER.contactEmail}?subject=${encodeURIComponent('Solicitare acces pilot Cabinio')}`}>
              Solicită acces pilot
            </a>
          </div>
        </div>
      ) : (
      <div className="card" style={{ width: '100%' }}>
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

          <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', fontSize: '.78rem', color: 'var(--s500)', lineHeight: 1.45, marginBottom: '1rem' }}>
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} style={{ marginTop: '.2rem' }} />
            <span>
              Am citit și accept <Link to="/termeni" target="_blank">Termenii și condițiile</Link> și{' '}
              <Link to="/dpa" target="_blank">Acordul de prelucrare a datelor (DPA)</Link>. Înțeleg că sunt
              operator al datelor clienților mei și că <Link to="/confidentialitate" target="_blank">Politica de confidențialitate</Link> se aplică conturilor utilizatorilor.
            </span>
          </label>

          <button
            className="btn btn-primary btn-full"
            onClick={handleCreate}
            disabled={!name.trim() || !accepted || saving}
            style={{ fontSize: '.9375rem', padding: '.625rem 1.25rem' }}
          >
            {saving ? <><span className="spin" />Se creează...</> : 'Creează spațiu de lucru'}
          </button>

          <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '1.125rem', textAlign: 'center' }}>
            Dacă ați primit o invitație, o găsiți mai sus, în „Invitații primite” — o puteți accepta sau refuza.
          </p>
        </div>
      </div>
      )}
      </div>
    </div>
  )
}
