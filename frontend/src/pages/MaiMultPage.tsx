import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { planSummary } from '../lib/billing'
import { useIsMobile } from '../lib/useIsMobile'
import { withViewTransition } from '../lib/viewTransition'
import ThemeToggleSwitch from '../components/ThemeToggleSwitch'
import NotificariBell from '../components/NotificariBell'
import { IconSettings, IconShield, IconSignOut } from '../components/NavIcons'
import { progresGhid, useGhidVizibil } from '../lib/useGhid'

const LEGAL_LINKS: [string, string][] = [
  ['/termeni', 'Termeni'],
  ['/confidentialitate', 'Confidențialitate'],
  ['/dpa', 'DPA'],
  ['/sub-imputerniciti', 'Sub-împuterniciți'],
  ['/securitate', 'Securitate'],
]

function Chevron() {
  return (
    <svg className="more-row-chevron" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  )
}

/**
 * „Mai mult”, a cincea filă din bara de jos a telefonului: tot ce pe desktop stă în bara laterală
 * în afara celor patru pagini principale (spațiul de lucru, planul, setările, contul, documentele legale).
 */
export default function MaiMultPage() {
  const { user, activeWorkspace, userRole, billing, isSuperAdmin, workspaceCtx, signOut } = useApp()
  const ghid = useGhidVizibil()
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  // Pe desktop totul e deja în bara laterală (ex. adresa deschisă de pe telefon, apoi pe calculator).
  if (!isMobile) return <Navigate to="/setari" replace />

  const plan = planSummary(billing)
  const { workspaces } = workspaceCtx
  const go = (path: string) => (e: React.MouseEvent) => { e.preventDefault(); withViewTransition(() => navigate(path)) }
  const initials = (user.displayName ?? user.email ?? '?')[0].toUpperCase()

  return (
    <div className="more-page">
      <div className="page-top">
        <div className="page-header">
          <div><div className="page-title">Mai mult</div></div>
          <div className="page-actions"><NotificariBell /></div>
        </div>
      </div>

      <div className="more-body">
        <div className="more-user">
          {user.photoURL
            ? <img src={user.photoURL} alt="" />
            : <span className="more-user-initials">{initials}</span>}
          <div style={{ minWidth: 0 }}>
            <div className="more-user-name">{user.displayName ?? 'Utilizator'}</div>
            <div className="more-user-email">{user.email}</div>
          </div>
        </div>

        {activeWorkspace && (
          <section>
            <h2 className="more-heading">Spațiu de lucru</h2>
            <div className="more-group" role="radiogroup" aria-label="Spațiu de lucru">
              {workspaces.map(w => {
                const active = w.id === activeWorkspace.id
                return (
                  <button key={w.id} type="button" role="radio" aria-checked={active}
                    className={`more-row${active ? ' more-row--checked' : ''}`}
                    onClick={() => { if (!active) workspaceCtx.setActiveWorkspace(w) }}>
                    <span className="more-radio" aria-hidden />
                    <span className="more-row-label">{w.name}</span>
                  </button>
                )
              })}
              <Link to="/workspace/setup?nou=1" className="more-row more-row--muted">
                <span className="more-row-plus" aria-hidden>+</span>
                <span className="more-row-label">Spațiu de lucru nou</span>
              </Link>
            </div>
          </section>
        )}

        <section>
          <h2 className="more-heading">Cabinet</h2>
          <div className="more-group">
            {userRole === 'admin' && activeWorkspace && (
              <a href="/setari/plan" onClick={go('/setari/plan')} className={`more-row more-plan more-plan--${plan.tone}`}>
                <span className="sidebar-plan-dot" aria-hidden />
                <span className="more-row-label">
                  <strong>{plan.label}</strong>
                  <small>{plan.sub}</small>
                </span>
                <Chevron />
              </a>
            )}
            {ghid?.activ && (() => {
              const { facuti, total } = progresGhid(ghid)
              return (
                <button type="button" className="more-row" onClick={ghid.deschide}>
                  <span className="ghid-inel" style={{ '--p': facuti / total } as React.CSSProperties} aria-hidden />
                  <span className="more-row-label">
                    <strong>Primii pași</strong>
                    <small>{facuti === total ? 'Gata!' : `${facuti} din ${total} făcuți`}</small>
                  </span>
                  <Chevron />
                </button>
              )
            })()}
            <a href="/setari" onClick={go('/setari')} className="more-row">
              <span className="more-row-icon"><IconSettings /></span>
              <span className="more-row-label">Setări</span>
              <Chevron />
            </a>
            <a href="/setari/noutati" onClick={go('/setari/noutati')} className="more-row">
              <span className="more-row-icon" aria-hidden>✨</span>
              <span className="more-row-label">Noutăți</span>
              <Chevron />
            </a>
            {isSuperAdmin && (
              <a href="/super-admin" onClick={go('/super-admin')} className="more-row">
                <span className="more-row-icon"><IconShield /></span>
                <span className="more-row-label">Super admin</span>
                <Chevron />
              </a>
            )}
          </div>
        </section>

        <section>
          <div className="more-group">
            <div className="more-row more-row--static">
              <span className="more-row-label">Temă întunecată</span>
              <ThemeToggleSwitch />
            </div>
            <button type="button" className="more-row more-row--danger" onClick={signOut}>
              <span className="more-row-icon"><IconSignOut /></span>
              <span className="more-row-label">Deconectare</span>
            </button>
          </div>
        </section>

        {/* Se deschid în filă nouă, ca să nu se piardă ce e completat în aplicație. */}
        <nav className="more-legal" aria-label="Documente legale">
          {LEGAL_LINKS.map(([href, label]) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
          ))}
        </nav>
      </div>
    </div>
  )
}
