import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../AppContext'
import { FEATURE_REGISTRY, hasFeature } from '../lib/features'
import { listAllWorkspaces, writeWorkspaceFeature } from '../lib/workspace'
import {
  grantSuperAdmin, revokeSuperAdminGrant, adminRestoreWorkspace, adminRestoreAccount, listAccountDeletions, type AccountDeletion, listSuperAdminGrants, type SuperAdminGrant,
  listWorkspaceCreators, addWorkspaceCreator, removeWorkspaceCreator, type WorkspaceCreator, fetchSignupStatus,
  adminBillingOverview,
} from '../lib/superAdmin'
import SuperAdminBilling from '../components/SuperAdminBilling'
import DeliveredTemplatesPanel from '../components/DeliveredTemplatesPanel'
import DeleteWorkspaceModal from '../components/DeleteWorkspaceModal'
import IconTrash from '../components/IconTrash'
import type { BillingTime, Workspace } from '../types'
import NotificariBell from '../components/NotificariBell'
import { billingAccess, formatDate, toDate } from '../lib/billing'

const ROLE_LABEL: Record<'admin' | 'member' | 'viewer', string> = { admin: 'Admin', member: 'Membru', viewer: 'Doar citire' }

export default function SuperAdminPage() {
  const { user, isSuperAdmin, workspaceCtx } = useApp()

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsLoading, setWsLoading] = useState(true)
  const [wsError, setWsError] = useState<string | null>(null)
  // Cabinet → cabinetul în care același CUI a mai avut o perioadă de probă.
  const [cuiSeen, setCuiSeen] = useState<Record<string, string>>({})
  // Cardurile cabinetelor sunt restrânse implicit (doar esențialul); aici, cele deschise.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // Fila deschisă în fiecare card (implicit Abonament).
  const [tabs, setTabs] = useState<Record<string, WsTab>>({})
  const tabOf = (id: string): WsTab => tabs[id] ?? 'abonament'
  const toggleExpanded = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const [grants, setGrants] = useState<SuperAdminGrant[]>([])
  const [grantsLoading, setGrantsLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [granting, setGranting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [creators, setCreators] = useState<WorkspaceCreator[]>([])
  const [creatorEmail, setCreatorEmail] = useState('')
  const [creatorError, setCreatorError] = useState<string | null>(null)
  const [signupMode, setSignupMode] = useState<'open' | 'invite' | null>(null)
  const [deleting, setDeleting] = useState<Workspace | null>(null)
  const [accountDeletions, setAccountDeletions] = useState<AccountDeletion[]>([])

  const loadAccountDeletions = useCallback(async () => {
    try { setAccountDeletions(await listAccountDeletions()) } catch { /* lista e doar informativă */ }
  }, [])

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
    // Doar un semnal: dacă API-ul nu răspunde, lista de cabinete rămâne utilizabilă.
    adminBillingOverview()
      .then(rows => setCuiSeen(Object.fromEntries(rows.flatMap(r => r.cuiSeenInWorkspace ? [[r.id, r.cuiSeenInWorkspace]] : []))))
      .catch(() => {})
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
      setSignupMode((await fetchSignupStatus()).mode)
      setCreators(await listWorkspaceCreators())
    } catch (e: unknown) {
      setCreatorError((e as Error).message ?? 'Eroare la încărcarea listei')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isSuperAdmin) { void loadWorkspaces(); void loadGrants(); void loadCreators(); void loadAccountDeletions() }
  }, [isSuperAdmin, loadWorkspaces, loadGrants, loadCreators, loadAccountDeletions])

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

  const handleRestoreWorkspace = async (w: Workspace) => {
    try {
      await adminRestoreWorkspace(w.id)
      await loadWorkspaces()
    } catch (e: unknown) {
      setWsError((e as Error).message ?? 'Restaurarea a eșuat')
    }
  }

  const handleRestoreAccount = async (uid: string) => {
    try {
      await adminRestoreAccount(uid)
      await loadAccountDeletions()
      await loadWorkspaces()
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Restaurarea a eșuat')
    }
  }

  const handleRevokeGrant = async (grantEmail: string) => {
    setError(null)
    try {
      await revokeSuperAdminGrant(grantEmail)
      await loadGrants()
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Eroare la retragerea rolului')
    }
  }

  return (
    <div className="page--data">
      <div className="page-top">
        <div className="page-header">
          <div>
            <div className="page-title">Super admin</div>
            <div className="page-subtitle">Toate conturile și spațiile de lucru din aplicație: abonamente și feature flags per workspace</div>
          </div>
          <div className="page-actions"><NotificariBell /></div>
        </div>
      </div>

      <div className="page-body" style={{ overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 1120, margin: '0 auto', width: '100%' }}>
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
                    <div key={w.id} style={{ border: '1px solid var(--s200)', borderRadius: 'var(--radius-md, 8px)', padding: expanded.has(w.id) ? '.875rem 1rem' : '.5rem 1rem' }}>
                      <WorkspaceSummary w={w} open={expanded.has(w.id)} cuiWarning={!!cuiSeen[w.id]} onToggle={() => toggleExpanded(w.id)} />
                      {expanded.has(w.id) && (<div style={{ marginTop: '.625rem' }}>
                      {w.status === 'pendingDeletion' && (
                        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.5rem' }}>
                          <span role="status" style={{ color: 'var(--r600)', fontSize: '.8125rem', flex: 1 }}>
                            Programat pentru ștergere{w.deleteAfter ? ` pe ${w.deleteAfter.toDate().toLocaleDateString('ro-RO')}` : ''}. Membrii nu mai au acces.
                          </span>
                          <button className="btn btn-sm" onClick={() => void handleRestoreWorkspace(w)}>Restaurează</button>
                        </div>
                      )}
                      <div className="page-tabs" role="tablist" style={{ padding: 0, background: 'transparent', marginBottom: '.75rem' }}>
                        {WS_TABS.map(([key, label]) => (
                          <button key={key} type="button" role="tab" aria-selected={tabOf(w.id) === key}
                            className={`page-tab${tabOf(w.id) === key ? ' page-tab--active' : ''}`}
                            onClick={() => setTabs(prev => ({ ...prev, [w.id]: key }))}>
                            {label}{key === 'membri' ? ` (${Object.keys(w.members ?? {}).length})` : ''}
                          </button>
                        ))}
                      </div>

                      {tabOf(w.id) === 'abonament' && (<>
                        {cuiSeen[w.id] && (
                          <div role="status" style={{ color: 'var(--a800, #92400e)', fontSize: '.8125rem', marginBottom: '.5rem' }}>
                            Atenție: acest CUI a mai avut o perioadă de probă în cabinetul „{workspaces.find(x => x.id === cuiSeen[w.id])?.name ?? cuiSeen[w.id]}”.
                          </div>
                        )}
                        <SuperAdminBilling workspaceId={w.id} billing={w.billing}
                          onChange={b => setWorkspaces(prev => prev.map(x => x.id === w.id ? { ...x, billing: b } : x))} />
                      </>)}

                      {tabOf(w.id) === 'membri' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                          {Object.entries(w.members ?? {}).map(([uid, m]) => (
                            <div key={uid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8125rem', color: 'var(--s600)' }}>
                              <span>{m.displayName ? `${m.displayName} — ${m.email}` : m.email}</span>
                              <span className={`chip ${m.role === 'admin' ? 'chip-success' : 'chip-muted'}`}>{ROLE_LABEL[m.role]}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {tabOf(w.id) === 'sabloane' && (w.status !== 'pendingDeletion'
                        ? <DeliveredTemplatesPanel workspaceId={w.id} />
                        : <div className="card-sub">Cabinet programat pentru ștergere: nu se mai livrează șabloane.</div>)}

                      {tabOf(w.id) === 'setari' && (<>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
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
                        <div style={{ borderTop: '1px solid var(--s100)', marginTop: '.75rem', paddingTop: '.625rem' }}>
                          <button className="btn btn-danger btn-sm" onClick={() => setDeleting(w)}><IconTrash size={14} /> Șterge cabinetul</button>
                        </div>
                      </>)}
                      </div>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {signupMode === 'invite' && <div className="card">
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
                  placeholder="adresa de e-mail a cabinetului"
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
          </div>}

          {accountDeletions.length > 0 && <div className="card">
            <div className="card-head">
              <span className="card-title">🗑️ Conturi programate pentru ștergere</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
              <div className="card-sub" style={{ marginBottom: '.375rem' }}>
                Conturile sunt dezactivate. Restaurarea le reactivează, împreună cu cabinetele în care erau singurii membri.
              </div>
              {accountDeletions.map(a => (
                <div key={a.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', fontSize: '.8125rem', color: 'var(--s600)' }}>
                  <span style={{ flex: 1 }}>{a.email} · ștergere pe {a.deleteAfter ? new Date(a.deleteAfter).toLocaleDateString('ro-RO') : '—'}</span>
                  <button className="btn btn-sm" onClick={() => void handleRestoreAccount(a.uid)}>Restaurează</button>
                </div>
              ))}
            </div>
          </div>}

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
                      <div key={g.email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', fontSize: '.8125rem', color: 'var(--s600)' }}>
                        <span style={{ flex: 1 }}>{g.email}</span>
                        <span className={`chip ${g.used ? 'chip-success' : 'chip-muted'}`}>{g.used ? 'Aplicat' : 'În așteptare'}</span>
                        {!g.used && <button className="btn btn-sm" onClick={() => void handleRevokeGrant(g.email)}>Retrage</button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {deleting && (
        <DeleteWorkspaceModal
          workspaceId={deleting.id}
          name={deleting.name}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            void loadWorkspaces()
            if (workspaceCtx.workspaces.some(x => x.id === deleting.id)) void workspaceCtx.reload()
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

type WsTab = 'abonament' | 'membri' | 'sabloane' | 'setari'
const WS_TABS: [WsTab, string][] = [['abonament', 'Abonament'], ['membri', 'Membri'], ['sabloane', 'Șabloane'], ['setari', 'Setări']]

const STATUS_LABEL: Record<string, string> = {
  trial: 'Probă', subscription: 'Abonament', past_due: 'Plată eșuată', comp: 'Gratuit', credits: 'Credite', expired: 'Mod citire',
}

/** Rândul restrâns al unui cabinet: nume, stare, până când are acces, administratorul, semnale. Click = detalii. */
function WorkspaceSummary({ w, open, cuiWarning, onToggle }: {
  w: Workspace; open: boolean; cuiWarning: boolean; onToggle: () => void
}) {
  const access = billingAccess(w.billing)
  const members = Object.values(w.members ?? {})
  const admin = members.find(m => m.role === 'admin')
  // Firestore întoarce un Timestamp (tipul din Workspace e mai larg); cabinetele foarte vechi pot să nu-l aibă.
  const created = toDate(w.createdAt as BillingTime)
  let detail: string
  if (!w.billing) detail = 'nemigrat'
  else if (!access.full) detail = 'fără acces complet'
  else if (access.reason === 'credits') detail = `${access.credits.balance} credite${access.credits.firstExpiry ? ` · expiră ${formatDate(access.credits.firstExpiry)}` : ''}`
  else if (access.reason === 'subscription') detail = `${access.interval === 'year' ? 'anual' : 'lunar'} · ${access.cancelAtPeriodEnd ? 'se încheie' : 'următoarea plată'} ${formatDate(access.currentPeriodEnd)}`
  else detail = `până pe ${formatDate(access.accessUntil)}`
  const tone = !access.full ? 'chip chip-muted' : access.reason === 'past_due' ? 'badge badge-inactiv' : access.reason === 'trial' ? 'chip chip-primary' : 'chip chip-success'
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      style={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.625rem', flexWrap: 'wrap' }}>
      <span aria-hidden style={{ color: 'var(--s400)', fontSize: '.7rem', width: '.75rem', transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}>▶</span>
      <span style={{ fontWeight: 700, color: 'var(--s900)', minWidth: 0 }}>{w.name}</span>
      <span className={tone}>{w.billing ? STATUS_LABEL[access.reason] : 'Nemigrat'}</span>
      <span style={{ color: 'var(--s600)', fontSize: '.8125rem' }}>{detail}</span>
      {w.status === 'pendingDeletion' && <span className="badge badge-inactiv">Programat pentru ștergere</span>}
      {cuiWarning && <span className="chip" style={{ background: 'var(--y50)', color: 'var(--a800, #92400e)' }} title="Același CUI a mai avut o perioadă de probă în alt cabinet">CUI refolosit</span>}
      <span style={{ marginLeft: 'auto', color: 'var(--s500)', fontSize: '.75rem', whiteSpace: 'nowrap' }}
        title={created ? `Cabinet deschis pe ${formatDate(created)}` : 'Data deschiderii nu e înregistrată'}>
        {created ? `deschis ${created.toLocaleDateString('ro-RO')} · ` : ''}{admin?.email ?? '—'}{members.length > 1 ? ` +${members.length - 1}` : ''}
      </span>
    </button>
  )
}
