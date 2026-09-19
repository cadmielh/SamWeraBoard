import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../AppContext'
import { FEATURE_REGISTRY, hasFeature } from '../lib/features'
import { listAllWorkspaces, writeWorkspaceFeature } from '../lib/workspace'
import {
  grantSuperAdmin, listSuperAdminGrants, type SuperAdminGrant,
  listWorkspaceCreators, addWorkspaceCreator, removeWorkspaceCreator, type WorkspaceCreator,
} from '../lib/superAdmin'
import type { Workspace } from '../types'

const ROLE_LABEL: Record<'admin' | 'member' | 'viewer', string> = { admin: 'Admin', member: 'Membru', viewer: 'Doar citire' }

export default function SuperAdminPage() {
  const { user, isSuperAdmin, workspaceCtx } = useApp()

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsLoading, setWsLoading] = useState(true)
  const [wsError, setWsError] = useState<string | null>(null)

  const [grants, setGrants] = useState<SuperAdminGrant[]>([])
  const [grantsLoading, setGrantsLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [granting, setGranting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [creators, setCreators] = useState<WorkspaceCreator[]>([])
  const [creatorEmail, setCreatorEmail] = useState('')
  const [creatorError, setCreatorError] = useState<string | null>(null)

  const loadWorkspaces = useCallback(async () => {
    setWsLoading(true)
    setWsError(null)
    try {
      setWorkspaces(await listAllWorkspaces())
    } catch (e: unknown) {
      setWsError((e as Error).message ?? 'Eroare la încărcarea spațiilor de lucru')
    } finally {
      setWsLoading(false)
    }
  }, [])

  const loadGrants = useCallback(async () => {
    setGrantsLoading(true)
    try {
      setGrants(await listSuperAdminGrants())
    } finally {
      setGrantsLoading(false)
    }
  }, [])

  const loadCreators = useCallback(async () => {
    try {
      setCreators(await listWorkspaceCreators())
    } catch (e: unknown) {
      setCreatorError((e as Error).message ?? 'Eroare la încărcarea listei')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isSuperAdmin) { void loadWorkspaces(); void loadGrants(); void loadCreators() }
  }, [isSuperAdmin, loadWorkspaces, loadGrants, loadCreators])

  if (!isSuperAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--s400)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>🔒</div>
          <p>Acces permis doar super administratorilor aplicației.</p>
        </div>
      </div>
    )
  }

  const handleToggleFeature = async (workspaceId: string, key: typeof FEATURE_REGISTRY[number]['key'], enabled: boolean) => {
    // Optimist — scrierea în Firestore se face în paralel, fără să aștepți răspunsul ca să bifezi.
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, features: { ...w.features, [key]: enabled } } : w))
    try {
      // Dacă super adminul e și el membru al acestui workspace (inclusiv cel
      // activ), trecem prin workspaceCtx.setWorkspaceFeature — singurul mod ca
      // AppContext.activeWorkspace (deci hasFeature() peste tot în aplicație,
      // ex. pe pagina Dosare) să reflecte schimbarea imediat, fără refresh.
      // Altfel (workspace din care nu face parte), doar scriem în Firestore —
      // nu există stare locală de-a lui de sincronizat.
      const isOwnWorkspace = workspaceCtx.workspaces.some(w => w.id === workspaceId)
      if (isOwnWorkspace) {
        await workspaceCtx.setWorkspaceFeature(workspaceId, key, enabled)
      } else {
        await writeWorkspaceFeature(workspaceId, key, enabled)
      }
    } catch (e: unknown) {
      // Revenim la starea anterioară dacă scrierea a eșuat.
      setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, features: { ...w.features, [key]: !enabled } } : w))
      setWsError((e as Error).message ?? 'Eroare la salvarea feature-ului')
    }
  }

  const handleAddCreator = async () => {
    if (!creatorEmail.trim()) return
    setCreatorError(null)
    try {
      await addWorkspaceCreator(creatorEmail)
      setCreatorEmail('')
      await loadCreators()
    } catch (e: unknown) {
      setCreatorError((e as Error).message === 'invalid_email' ? 'Adresă de e-mail nevalidă' : ((e as Error).message ?? 'Eroare la adăugare'))
    }
  }

  const handleRemoveCreator = async (id: string) => {
    setCreatorError(null)
    try {
      await removeWorkspaceCreator(id)
      await loadCreators()
    } catch (e: unknown) {
      setCreatorError((e as Error).message ?? 'Eroare la ștergere')
    }
  }

  const handleGrant = async () => {
    const trimmed = email.trim()
    if (!trimmed || !user) return
    setGranting(true)
    setError(null)
    try {
      await grantSuperAdmin(trimmed, user.uid)
      setEmail('')
      await loadGrants()
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Eroare la acordarea rolului')
    } finally {
      setGranting(false)
    }
  }

  return (
    <div className="page--data">
      <div className="page-top">
        <div className="page-header">
          <div>
            <div className="page-title">Super admin</div>
            <div className="page-subtitle">Toate conturile și spațiile de lucru din aplicație, cu feature flags per workspace</div>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 860 }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title">🗂️ Toate spațiile de lucru</span>
            </div>
            <div className="card-body">
              {wsError && <div style={{ color: 'var(--r600)', fontSize: '.8125rem', marginBottom: '.75rem' }}>{wsError}</div>}
              {wsLoading ? (
                <div className="card-sub">Se încarcă...</div>
              ) : workspaces.length === 0 ? (
                <div className="card-sub">Niciun spațiu de lucru în aplicație.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {workspaces.map(w => (
                    <div key={w.id} style={{ border: '1px solid var(--s200)', borderRadius: 'var(--radius-md, 8px)', padding: '.875rem 1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.625rem', flexWrap: 'wrap', gap: '.5rem' }}>
                        <div style={{ fontWeight: 700, color: 'var(--s900)' }}>{w.name}</div>
                        <div className="card-sub">{Object.keys(w.members ?? {}).length} cont{Object.keys(w.members ?? {}).length !== 1 ? 'uri' : ''}</div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', marginBottom: '.75rem' }}>
                        {Object.entries(w.members ?? {}).map(([uid, m]) => (
                          <div key={uid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8125rem', color: 'var(--s600)' }}>
                            <span>{m.displayName ? `${m.displayName} — ${m.email}` : m.email}</span>
                            <span className={`chip ${m.role === 'admin' ? 'chip-success' : 'chip-muted'}`}>{ROLE_LABEL[m.role]}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ borderTop: '1px solid var(--s100)', paddingTop: '.625rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                        {FEATURE_REGISTRY.map(def => (
                          <label key={def.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={hasFeature(w.features, def.key)}
                              onChange={e => void handleToggleFeature(w.id, def.key, e.target.checked)}
                              style={{ marginTop: '.2rem' }}
                            />
                            <span>
                              <div style={{ fontWeight: 600, color: 'var(--s800)' }}>{def.label}</div>
                              <div className="card-sub">{def.description}</div>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">🔑 Cine poate crea cabinete noi</span>
            </div>
            <div className="card-body">
              <div className="card-sub" style={{ marginBottom: '.75rem' }}>
                Înregistrarea e pe invitație: doar adresele de mai jos (și cine are deja un cabinet) pot crea un cabinet nou. Utilizatorii invitați într-un cabinet existent nu au nevoie de aprobare.
              </div>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <input
                  className="field-input"
                  type="email"
                  placeholder="adresa Google a cabinetului"
                  value={creatorEmail}
                  onChange={e => setCreatorEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleAddCreator() }}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleAddCreator} disabled={!creatorEmail.trim()}>Aprobă</button>
              </div>
              {creatorError && <div style={{ color: 'var(--r600)', fontSize: '.8125rem', marginTop: '.5rem' }}>{creatorError}</div>}
              <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
                {creators.length === 0 ? (
                  <div className="card-sub">Nicio adresă aprobată încă.</div>
                ) : creators.map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.8125rem', color: 'var(--s600)' }}>
                    <span>{c.email}</span>
                    <button className="btn btn-sm" onClick={() => void handleRemoveCreator(c.id)}>Retrage</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">👑 Adaugă super admin</span>
            </div>
            <div className="card-body">
              <div className="card-sub" style={{ marginBottom: '.75rem' }}>
                Acordă rolul de super admin unui alt cont, după adresa de email — se aplică automat la următoarea autentificare a acelui cont.
              </div>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <input
                  className="field-input"
                  type="email"
                  placeholder="email@exemplu.ro"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleGrant() }}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleGrant} disabled={!email.trim() || granting}>
                  {granting ? <span className="spin" /> : 'Adaugă'}
                </button>
              </div>
              {error && <div style={{ color: 'var(--r600)', fontSize: '.8125rem', marginTop: '.5rem' }}>{error}</div>}

              <div style={{ marginTop: '1rem' }}>
                {grantsLoading ? (
                  <div className="card-sub">Se încarcă...</div>
                ) : grants.length === 0 ? (
                  <div className="card-sub">Niciun grant acordat încă.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
                    {grants.map(g => (
                      <div key={g.email} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8125rem', color: 'var(--s600)' }}>
                        <span>{g.email}</span>
                        <span className={`chip ${g.used ? 'chip-success' : 'chip-muted'}`}>{g.used ? 'Aplicat' : 'În așteptare'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
