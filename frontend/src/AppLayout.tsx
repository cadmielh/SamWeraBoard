import { useState, useEffect, useCallback } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, auth, signIn, signOut } from './lib/firebase'
import { useWorkspace } from './lib/workspace'
import type { ToastItem } from './types'
import { AppCtx, type AppContextType } from './AppContext'
import Sidebar from './components/Sidebar'
import Toast from './components/Toast'

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
        setUser(u)
        setAuthLoading(false)
        try {
          await workspaceCtx.checkAndJoinInvitations({
            uid: u.uid,
            email: u.email ?? '',
            displayName: u.displayName ?? '',
          })
        } catch {
          // Non-blocking — user may not have pending invitations
        }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redirect to workspace setup if no workspace
  useEffect(() => {
    if (!workspaceCtx.loading && user && workspaceCtx.workspaces.length === 0) {
      navigate('/workspace/setup')
    }
  }, [workspaceCtx.loading, workspaceCtx.workspaces.length, user, navigate])

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

  const { activeWorkspace, workspaces } = workspaceCtx
  const userRole = activeWorkspace && user
    ? (activeWorkspace.members[user.uid]?.role ?? null)
    : null

  const ctx: AppContextType = {
    user,
    accessToken,
    toast,
    activeWorkspace,
    userRole,
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
          onSignOut={handleSignOut}
          onWorkspaceChange={w => workspaceCtx.setActiveWorkspace(w)}
          onWorkspaceCreate={async name => {
            await workspaceCtx.createWorkspace(name, {
              uid: user.uid,
              email: user.email ?? '',
              displayName: user.displayName ?? user.email ?? '',
            })
          }}
          onWorkspaceRename={workspaceCtx.renameWorkspace}
        />
        <div className="main-area">
          <Outlet />
        </div>
      </div>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </AppCtx.Provider>
  )
}

function SignInView({ onSignIn, toasts, onDismiss }: { onSignIn: () => Promise<void>; toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  const [signing, setSigning] = useState(false)
  const handle = async () => {
    setSigning(true)
    await onSignIn()
    setSigning(false)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', background: 'var(--s100)' }}>
      <div className="card" style={{ maxWidth: 380, width: '100%' }}>
        <div className="card-body" style={{ textAlign: 'center', padding: '2rem 1.75rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '.75rem' }}>📋</div>
          <h1 style={{ fontWeight: 800, fontSize: '1.5rem', letterSpacing: '-.025em', color: 'var(--s900)', marginBottom: '.5rem' }}>
            SamWera<span style={{ color: 'var(--p500)' }}>Board</span>
          </h1>
          <p style={{ color: 'var(--s400)', fontSize: '.875rem', marginBottom: '1.5rem' }}>
            CRM contabil — clienți, generare documente, șabloane
          </p>
          <button className="btn btn-primary btn-full" onClick={handle} disabled={signing} style={{ fontSize: '.9375rem', padding: '.625rem 1.25rem' }}>
            {signing ? <><span className="spin" />Se conectează...</> : 'Autentificare cu Google'}
          </button>
          <p style={{ fontSize: '.72rem', color: 'var(--s300)', marginTop: '.875rem' }}>
            Necesită acces Google Drive pentru salvarea documentelor
          </p>
        </div>
      </div>
      <Toast toasts={toasts} onDismiss={onDismiss} />
    </div>
  )
}
