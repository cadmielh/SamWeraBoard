import { useState, useEffect, useCallback } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, auth, signIn, signOut } from './lib/firebase'
import { useWorkspace } from './lib/workspace'
import { setApiWorkspace } from './lib/api'
import { hasFeature as hasFeatureFn, type FeatureKey } from './lib/features'
import { applyPendingSuperAdminGrant } from './lib/superAdmin'
import type { ToastItem } from './types'
import { AppCtx, type AppContextType } from './AppContext'
import Sidebar from './components/Sidebar'
import Toast from './components/Toast'
import ConsentGate from './components/ConsentGate'
import LandingPage from './pages/LandingPage'

export default function AppLayout() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem('gat') ?? '')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [authLoading, setAuthLoading] = useState(true)

  const workspaceCtx = useWorkspace(user?.uid ?? null)

  // Auth listener
  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      if (!u) {
        setUser(null)
        setAccessToken('')
        sessionStorage.removeItem('gat')
        setAuthLoading(false)
      } else {
        // Cont șters/dezactivat între timp: sesiunea locală mai e „validă” până expiră tokenul,
        // dar fără cont nu există spații de lucru. O încheiem, ca să se poată reconecta corect.
        try {
          await u.getIdToken(true)
        } catch (e) {
          const code = (e as { code?: string }).code ?? ''
          if (['auth/user-token-expired', 'auth/user-not-found', 'auth/user-disabled', 'auth/invalid-user-token'].includes(code)) {
            await signOut()
            return
          }
        }
        setUser(u)
        setAuthLoading(false)
        // Invitațiile NU se mai acceptă automat: utilizatorul le vede și decide
        // explicit (vezi InvitationsPanel).
        try {
          if (u.email) await applyPendingSuperAdminGrant(u.uid, u.email)
        } catch {
          // Non-blocking — user may not have a pending super-admin grant
        }
      }
    })
  }, [])

  // Workspace-ul activ e trimis la fiecare cerere către API (autorizare server-side).
  const activeWorkspaceId = workspaceCtx.activeWorkspace?.id ?? null
  useEffect(() => { setApiWorkspace(activeWorkspaceId) }, [activeWorkspaceId])

  // Redirect to workspace setup if no workspace
  useEffect(() => {
    if (!workspaceCtx.loading && !workspaceCtx.loadError && user && workspaceCtx.workspaces.length === 0) {
      navigate('/workspace/setup')
    }
  }, [workspaceCtx.loading, workspaceCtx.loadError, workspaceCtx.workspaces.length, user, navigate])

  // Poziția cursorului, expusă ca variabile CSS — tooltip-urile [data-tooltip]
  // (tokens.css) le folosesc ca să apară chiar de lângă mouse, nu centrate
  // sub tot elementul cu hover (care putea fi mult mai lat decât cursorul).
  // Urmărirea pornește doar cât timp mouse-ul e deasupra unui element cu
  // [data-tooltip] (mouseover/mouseout, delegat pe window) — nu tot timpul cât
  // aplicația e deschisă, ca să nu scrie 2 proprietăți CSS la fiecare mousemove
  // pe pagini fără niciun tooltip (ex. ecranul de login).
  useEffect(() => {
    let tracking = false
    const onMove = (e: MouseEvent) => {
      if (!tracking) return
      document.documentElement.style.setProperty('--mx', `${e.clientX}px`)
      document.documentElement.style.setProperty('--my', `${e.clientY}px`)
    }
    const onOver = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-tooltip]')) tracking = true
    }
    const onOut = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-tooltip]')) tracking = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseover', onOver)
    window.addEventListener('mouseout', onOut)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseover', onOver)
      window.removeEventListener('mouseout', onOut)
    }
  }, [])

  const toast = useCallback((message: string, type: ToastItem['type'] = 'info', opts?: Pick<ToastItem, 'onExpire' | 'action'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, message, type, onExpire: opts?.onExpire, action: opts?.action }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const handleSignOut = () => {
    void signOut()
    setUser(null)
    setAccessToken('')
    sessionStorage.removeItem('gat')
  }

  // Auth loading sau workspace loading
  if (authLoading || (user && workspaceCtx.loading)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <span className="spin spin-dark" style={{ width: 24, height: 24, borderWidth: 3 }} />
      </div>
    )
  }

  // Not authenticated
  if (!user) {
    return <SignInView onSignIn={async () => {
      try {
        const { user: u, accessToken: at } = await signIn()
        setUser(u)
        setAccessToken(at)
        sessionStorage.setItem('gat', at)
      } catch (err: unknown) {
        toast((err as Error).message ?? 'Autentificare eșuată', 'err')
      }
    }} toasts={toasts} onDismiss={dismissToast} />
  }

  // Încărcarea spațiilor de lucru a eșuat: nu presupunem că nu există (ar duce la ecranul de creare).
  if (workspaceCtx.loadError && workspaceCtx.workspaces.length === 0) {
    return <LoadErrorView onRetry={() => void workspaceCtx.reload()} onSignOut={handleSignOut} />
  }

  const { activeWorkspace, workspaces, isSuperAdmin } = workspaceCtx
  const userRole = activeWorkspace && user
    ? (activeWorkspace.members[user.uid]?.role ?? null)
    : null
  const hasFeature = (key: FeatureKey) => hasFeatureFn(activeWorkspace?.features, key)

  const ctx: AppContextType = {
    user,
    accessToken,
    toast,
    activeWorkspace,
    userRole,
    hasFeature,
    isSuperAdmin,
    workspaceCtx,
  }

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app-shell">
        <Sidebar
          user={user}
          activeWorkspace={activeWorkspace}
          workspaces={workspaces}
          userRole={userRole}
          isSuperAdmin={isSuperAdmin}
          onSignOut={handleSignOut}
          onWorkspaceChange={w => workspaceCtx.setActiveWorkspace(w)}
          onWorkspaceRename={workspaceCtx.renameWorkspace}
        />
        <div className="main-area">
          <ConsentGate onSignOut={handleSignOut} />
          <Outlet />
        </div>
      </div>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </AppCtx.Provider>
  )
}

function SignInView({ onSignIn, toasts, onDismiss }: { onSignIn: () => Promise<void>; toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <>
      <LandingPage onSignIn={onSignIn} />
      <Toast toasts={toasts} onDismiss={onDismiss} />
    </>
  )
}

function LoadErrorView({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', background: 'var(--s100)' }}>
      <div className="card" style={{ maxWidth: 420, width: '100%' }}>
        <div className="card-body" style={{ textAlign: 'center', padding: '2rem 1.75rem' }}>
          <h1 style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--s900)', marginBottom: '.5rem' }}>Nu am putut încărca spațiile de lucru</h1>
          <p style={{ color: 'var(--s500)', fontSize: '.875rem', lineHeight: 1.55, marginBottom: '1.25rem' }}>
            Datele tale nu au dispărut: încărcarea a eșuat (conexiune sau permisiuni). Reîncearcă sau reconectează-te.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={onRetry}>Reîncearcă</button>
            <button className="btn btn-ghost" onClick={onSignOut}>Deconectare</button>
          </div>
        </div>
      </div>
    </div>
  )
}
