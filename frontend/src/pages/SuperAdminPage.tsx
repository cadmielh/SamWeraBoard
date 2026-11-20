import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import { type FeatureKey } from '../lib/features'
import { listAllWorkspaces, writeWorkspaceFeature } from '../lib/workspace'
import {
  grantSuperAdmin, revokeSuperAdminGrant, adminRestoreWorkspace, adminRestoreAccount, listAccountDeletions, type AccountDeletion, listSuperAdminGrants, type SuperAdminGrant,
  listWorkspaceCreators, addWorkspaceCreator, removeWorkspaceCreator, type WorkspaceCreator, fetchSignupStatus,
  adminBillingOverview, adminActivity, engagementOf, activityTotals, type WorkspaceActivity, type ActivityDay, type EngagementKey,
} from '../lib/superAdmin'
import SuperAdminPayments from '../components/SuperAdminPayments'
import DeleteWorkspaceModal from '../components/DeleteWorkspaceModal'
import ConfirmModal from '../components/ConfirmModal'
import type { BillingTime, Workspace } from '../types'
import NotificariBell from '../components/NotificariBell'
import { billingAccess, formatDate, toDate, type AccessReason } from '../lib/billing'
import BtnLabel from '../components/BtnLabel'
import { Skeleton, SkeletonRows } from '../components/Skeleton'
import { ActivitySpark, DailyBars } from '../components/superadmin/ActivityCharts'
import WorkspaceDrawer, { Kpi } from '../components/superadmin/WorkspaceDrawer'
import '../styles/superadmin.css'

type PageTab = 'cabinete' | 'incasari' | 'conturi' | 'acces'
const PAGE_TABS: [PageTab, string][] = [['cabinete', 'Cabinete'], ['incasari', 'Încasări'], ['conturi', 'Conturi'], ['acces', 'Acces']]

type Filter = 'toate' | AccessReason | 'inactiv' | 'cui' | 'stergere'
type Sort = 'activitate' | 'creat' | 'expirare' | 'nume'

const STATUS_LABEL: Record<string, string> = {
  trial: 'Probă', subscription: 'Abonament', past_due: 'Plată eșuată', comp: 'Gratuit', credits: 'Credite', expired: 'Mod citire',
}
const DAY = 86_400_000

export default function SuperAdminPage() {
  const { user, isSuperAdmin, workspaceCtx, toast } = useApp()

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsLoading, setWsLoading] = useState(true)
  const [wsError, setWsError] = useState<string | null>(null)
  // Cabinet → cabinetul în care același CUI a mai avut o perioadă de probă.
  const [cuiSeen, setCuiSeen] = useState<Record<string, string>>({})
  const [activity, setActivity] = useState<Record<string, WorkspaceActivity> | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)
  // Fila paginii și cabinetul deschis în panou, în adresă (?fila=…&cabinet=…): se pot trimite ca link, merge Înapoi.
  const [params, setParams] = useSearchParams()
  const pageTab: PageTab = (PAGE_TABS.map(t => t[0]) as string[]).includes(params.get('fila') ?? '') ? params.get('fila') as PageTab : 'cabinete'
  const openId = params.get('cabinet')
  const setParam = (k: string, v: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (v) next.set(k, v)
    else next.delete(k)
    return next
  })

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('toate')
  const [sort, setSort] = useState<Sort>('activitate')

  const [grants, setGrants] = useState<SuperAdminGrant[]>([])
  const [grantsLoading, setGrantsLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [granting, setGranting] = useState(false)
  const [confirmGrant, setConfirmGrant] = useState<string | null>(null)
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

  // Activitatea (din jurnalul de acces) vine separat: lista apare imediat, graficele când sosesc.
  const loadActivity = useCallback(async () => {
    setActivityLoading(true)
    try { setActivity((await adminActivity(90)).workspaces) } catch { /* statisticile rămân goale */ } finally { setActivityLoading(false) }
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
    if (isSuperAdmin) { void loadWorkspaces(); void loadActivity(); void loadGrants(); void loadCreators(); void loadAccountDeletions() }
  }, [isSuperAdmin, loadWorkspaces, loadActivity, loadGrants, loadCreators, loadAccountDeletions])

  // Rândurile listei, cu tot ce trebuie pentru filtre, sortare și „De urmărit”.
  const [now] = useState(() => new Date())
  const rows = useMemo(() => workspaces.map(w => {
    const access = billingAccess(w.billing, now)
    const created = toDate(w.createdAt as BillingTime)
    const act = activity?.[w.id]
    const eng = engagementOf(act, created, now)
    const admin = Object.values(w.members ?? {}).find(m => m.role === 'admin')
    return { w, access, created, act, eng, admin }
  }), [workspaces, activity, now])
  type Row = typeof rows[number]

  const matches = (r: Row, f: Filter) => {
    if (f === 'toate') return true
    if (f === 'inactiv') return r.eng.key === 'inactiv' || r.eng.key === 'incetineste'
    if (f === 'cui') return !!cuiSeen[r.w.id]
    if (f === 'stergere') return r.w.status === 'pendingDeletion'
    return !!r.w.billing && r.access.reason === f
  }
  const q = query.trim().toLowerCase()
  const visible = rows
    .filter(r => matches(r, filter))
    .filter(r => !q || r.w.name.toLowerCase().includes(q) || Object.values(r.w.members ?? {}).some(m => (m.email ?? '').toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort === 'nume') return a.w.name.localeCompare(b.w.name, 'ro')
      if (sort === 'creat') return (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0)
      if (sort === 'expirare') return (a.access.accessUntil?.getTime() ?? Infinity) - (b.access.accessUntil?.getTime() ?? Infinity)
      return (a.eng.daysSince ?? Infinity) - (b.eng.daysSince ?? Infinity)
    })

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

  // Scrierea se face direct; la eroare bifa revine, iar eroarea apare lângă ea (în panou).
  const handleToggleFeature = async (workspaceId: string, key: FeatureKey, enabled: boolean) => {
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
      setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, features: { ...w.features, [key]: !enabled } } : w))
      throw e
    }
  }

  const handleAddCreator = async () => {
    if (!creatorEmail.trim()) return
    setCreatorError(null)
    try {
      await addWorkspaceCreator(creatorEmail)
      setCreatorEmail('')
      await loadCreators()
      toast('Adresa poate crea acum un cabinet', 'ok')
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

  const handleGrant = async (target: string) => {
    if (!user) return
    setGranting(true)
    setError(null)
    try {
      await grantSuperAdmin(target, user.uid)
      setEmail('')
      await loadGrants()
      toast(`Rolul de super admin se aplică la următoarea autentificare a lui ${target}`, 'ok')
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
      toast(`Cabinetul „${w.name}” a fost restaurat`, 'ok')
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Restaurarea a eșuat', 'err')
    }
  }

  const handleRestoreAccount = async (a: AccountDeletion) => {
    try {
      await adminRestoreAccount(a.uid)
      await loadAccountDeletions()
      await loadWorkspaces()
      toast(`Contul ${a.email ?? ''} a fost restaurat`, 'ok')
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Restaurarea a eșuat', 'err')
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

  // ── Indicatori și „De urmărit” ──
  const live = rows.filter(r => r.w.status !== 'pendingDeletion')
  const last30 = (a?: WorkspaceActivity) => a ? activityTotals(a.series, 30) : null
  const kpis = {
    total: live.length,
    active7: live.filter(r => r.eng.daysSince !== null && r.eng.daysSince <= 7).length,
    trial: live.filter(r => r.access.full && r.access.reason === 'trial').length,
    paying: live.filter(r => r.access.full && (r.access.reason === 'subscription' || r.access.reason === 'credits' || r.access.reason === 'past_due')).length,
    docs30: live.reduce((n, r) => n + (last30(r.act)?.documents ?? 0), 0),
  }
  // Seria agregată: câte cabinete au avut activitate în fiecare din ultimele 30 de zile.
  const days30: ActivityDay[] = activity
    ? (Object.values(activity)[0]?.series.slice(-30) ?? []).map((d, i) => {
      const day = live.map(r => r.act?.series.slice(-30)[i]).filter((x): x is ActivityDay => !!x)
      return {
        day: d.day,
        activeUsers: day.filter(x => x.activeUsers > 0).length,
        documents: day.reduce((n, x) => n + x.documents, 0),
        scans: day.reduce((n, x) => n + x.scans, 0),
      }
    })
    : []
  const watch = {
    trialEnding: live.filter(r => r.access.full && r.access.reason === 'trial' && (r.access.daysLeft ?? 99) <= 7)
      .sort((a, b) => (a.access.daysLeft ?? 0) - (b.access.daysLeft ?? 0)),
    pastDue: live.filter(r => r.access.reason === 'past_due'),
    quietTrial: live.filter(r => r.access.full && r.access.reason === 'trial' && r.eng.key !== 'activ' && r.eng.key !== 'nou'),
    expiredRecently: live.filter(r => r.w.billing && !r.access.full && r.access.accessUntil && now.getTime() - r.access.accessUntil.getTime() <= 14 * DAY),
  }
  const watchCount = watch.trialEnding.length + watch.pastDue.length + watch.quietTrial.length + watch.expiredRecently.length
  const counts = (f: Filter) => rows.filter(r => matches(r, f)).length

  const openIndex = openId ? visible.findIndex(r => r.w.id === openId) : -1
  const openRow = openId ? rows.find(r => r.w.id === openId) ?? null : null
  const openAt = (i: number) => setParams(prev => { const n = new URLSearchParams(prev); n.set('cabinet', visible[i].w.id); return n }, { replace: true })

  return (
    <div className="page--data">
      <div className="page-top">
        <div className="page-header">
          <div>
            <div className="page-title">Super admin</div>
            <div className="page-subtitle">Toate cabinetele și conturile din aplicație: activitate, abonamente, încasări, acces</div>
          </div>
          <div className="page-actions"><NotificariBell /></div>
        </div>
        <div className="page-tabs" role="tablist">
          {PAGE_TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={pageTab === key}
              className={`page-tab${pageTab === key ? ' page-tab--active' : ''}`}
              onClick={() => setParams(key === 'cabinete' ? {} : { fila: key })}>
              {label}
              {key === 'conturi' && accountDeletions.length > 0 && <span className="sa-tab-count">{accountDeletions.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body" style={{ overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 1120, margin: '0 auto', width: '100%' }}>
          {pageTab === 'incasari' && <SuperAdminPayments workspaces={workspaces} />}

          {pageTab === 'cabinete' && (<>
            <div className="sa-kpis sa-kpis--top">
              {wsLoading ? [0, 1, 2, 3, 4].map(i => <Skeleton key={i} h={74} r={12} />) : (<>
                <Kpi label="Cabinete" value={`${kpis.total}`} sub="fără cele în ștergere" />
                <Kpi label="Active" value={activityLoading ? '…' : `${kpis.active7}`} sub="în ultimele 7 zile" />
                <Kpi label="În probă" value={`${kpis.trial}`} sub="acum" />
                <Kpi label="Plătitoare" value={`${kpis.paying}`} sub="abonament sau credite" />
                <Kpi label="Documente" value={activityLoading ? '…' : `${kpis.docs30}`} sub="generate în 30 de zile" />
              </>)}
            </div>

            <div className="card">
              <div className="card-body">
                {activityLoading && !activity ? <Skeleton h={190} r={10} />
                  : days30.length > 0 ? (
                    <DailyBars title="Cabinete active pe zi (ultimele 30 de zile)" data={days30} value={d => d.activeUsers}
                      unit={['cabinet activ', 'cabinete active']}
                      summary={`în medie ${(days30.reduce((n, d) => n + d.activeUsers, 0) / days30.length).toFixed(1).replace('.', ',')} pe zi`}
                      detail={d => [`${d.documents} ${d.documents === 1 ? 'document' : 'documente'}`, `${d.scans} ${d.scans === 1 ? 'scanare' : 'scanări'}`]} />
                  ) : <div className="card-sub">Activitatea nu s-a putut încărca.</div>}
              </div>
            </div>

            {!wsLoading && watchCount > 0 && (
              <div className="card">
                <div className="card-head"><span className="card-title">De urmărit</span><span className="chip chip-primary">{watchCount}</span></div>
                <div className="card-body sa-watch">
                  <WatchGroup title="Proba se încheie în cel mult 7 zile" rows={watch.trialEnding} onOpen={id => setParam('cabinet', id)}
                    note={r => `${r.access.daysLeft === 1 ? 'ultima zi' : `${r.access.daysLeft} zile`} · ${r.eng.label.toLowerCase()}`} />
                  <WatchGroup title="Plată eșuată" rows={watch.pastDue} onOpen={id => setParam('cabinet', id)}
                    note={r => `acces până pe ${formatDate(r.access.accessUntil)}`} />
                  <WatchGroup title="În probă, dar nu lucrează" rows={watch.quietTrial} onOpen={id => setParam('cabinet', id)}
                    note={r => r.eng.daysSince === null ? 'nicio acțiune' : `ultima acțiune acum ${r.eng.daysSince} zile`} />
                  <WatchGroup title="Au trecut în modul citire (14 zile)" rows={watch.expiredRecently} onOpen={id => setParam('cabinet', id)}
                    note={r => `din ${formatDate(r.access.accessUntil)}`} />
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-head" style={{ flexWrap: 'wrap', gap: '.625rem' }}>
                <span className="card-title">Toate cabinetele</span>
                <input className="field-input sa-search" type="search" placeholder="Caută după nume sau e-mail…" value={query}
                  onChange={e => setQuery(e.target.value)} aria-label="Caută cabinete" />
                <select className="field-input sa-sort" value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Ordonează">
                  <option value="activitate">Activitate recentă</option>
                  <option value="creat">Cele mai noi</option>
                  <option value="expirare">Accesul expiră primul</option>
                  <option value="nume">Nume</option>
                </select>
              </div>
              <div className="card-body">
                <div className="sa-filters" role="group" aria-label="Filtrează după stare">
                  {([['toate', 'Toate'], ['trial', 'Probă'], ['credits', 'Credite'], ['subscription', 'Abonament'], ['past_due', 'Plată eșuată'],
                    ['comp', 'Gratuit'], ['expired', 'Mod citire'], ['inactiv', 'Inactive'], ['cui', 'CUI refolosit'], ['stergere', 'În ștergere']] as [Filter, string][])
                    .map(([f, label]) => {
                      const n = counts(f)
                      if (n === 0 && f !== 'toate' && filter !== f) return null
                      return <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label} <span>{n}</span></button>
                    })}
                </div>
                {wsError && <div style={{ color: 'var(--r600)', fontSize: '.8125rem', marginBottom: '.75rem' }}>{wsError}</div>}
                {wsLoading ? <SkeletonRows rows={6} /> : visible.length === 0 ? (
                  <div className="card-sub" style={{ padding: '1rem 0' }}>{workspaces.length === 0 ? 'Niciun spațiu de lucru în aplicație.' : 'Niciun cabinet nu corespunde filtrelor.'}</div>
                ) : (
                  <div className="sa-list">
                    <div className="sa-row-head" aria-hidden>
                      <span>Cabinet</span><span>Plan</span><span>Activitate (30 zile)</span><span>Semnale</span>
                    </div>
                    {visible.map(r => (
                      <WorkspaceRow key={r.w.id} r={r} cuiWarning={!!cuiSeen[r.w.id]} activityLoading={activityLoading}
                        active={r.w.id === openId} onOpen={() => setParam('cabinet', r.w.id)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>)}

          {pageTab === 'conturi' && (<>
            {signupMode === 'invite' && <div className="card">
              <div className="card-head">
                <span className="card-title">🔑 Cine poate crea cabinete noi</span>
              </div>
              <div className="card-body">
                <div className="card-sub" style={{ marginBottom: '.75rem' }}>
                  Înregistrarea e pe invitație: doar adresele de mai jos (și cine are deja un cabinet) pot crea un cabinet nou. Utilizatorii invitați într-un cabinet existent nu au nevoie de aprobare.
                </div>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <input className="field-input" type="email" placeholder="adresa de e-mail a cabinetului" value={creatorEmail}
                    onChange={e => setCreatorEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void handleAddCreator() }} style={{ flex: 1 }} />
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

            <div className="card">
              <div className="card-head">
                <span className="card-title">🗑️ Conturi programate pentru ștergere</span>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
                {accountDeletions.length === 0 ? <div className="card-sub">Niciun cont programat pentru ștergere.</div> : (<>
                  <div className="card-sub" style={{ marginBottom: '.375rem' }}>
                    Conturile sunt dezactivate. Restaurarea le reactivează, împreună cu cabinetele în care erau singurii membri.
                  </div>
                  {accountDeletions.map(a => (
                    <div key={a.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', fontSize: '.8125rem', color: 'var(--s600)' }}>
                      <span style={{ flex: 1 }}>{a.email} · ștergere pe {a.deleteAfter ? new Date(a.deleteAfter).toLocaleDateString('ro-RO') : '—'}</span>
                      <button className="btn btn-sm" onClick={() => void handleRestoreAccount(a)}>Restaurează</button>
                    </div>
                  ))}
                </>)}
              </div>
            </div>
          </>)}

          {pageTab === 'acces' && (
            <div className="card">
              <div className="card-head">
                <span className="card-title">👑 Super admini</span>
              </div>
              <div className="card-body">
                <div className="card-sub" style={{ marginBottom: '.75rem' }}>
                  Acordă rolul de super admin unui alt cont, după adresa de email — se aplică automat la următoarea autentificare a acelui cont.
                  Rolul vede toate cabinetele și încasările, deci se acordă doar oamenilor de încredere.
                </div>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <input className="field-input" type="email" placeholder="email@exemplu.ro" value={email}
                    onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && email.trim()) setConfirmGrant(email.trim()) }} style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-sm" onClick={() => setConfirmGrant(email.trim())} disabled={!email.trim() || granting}>
                    <BtnLabel busy={granting}>Adaugă</BtnLabel>
                  </button>
                </div>
                {error && <div style={{ color: 'var(--r600)', fontSize: '.8125rem', marginTop: '.5rem' }}>{error}</div>}

                <div style={{ marginTop: '1rem' }}>
                  {grantsLoading ? <Skeleton h={40} r={8} /> : grants.length === 0 ? (
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
          )}
        </div>
      </div>

      {openRow && (
        <WorkspaceDrawer
          key="drawer"
          w={openRow.w}
          activity={openRow.act}
          activityLoading={activityLoading}
          cuiSeenName={cuiSeen[openRow.w.id] ? (workspaces.find(x => x.id === cuiSeen[openRow.w.id])?.name ?? cuiSeen[openRow.w.id]) : null}
          onPrev={openIndex > 0 ? () => openAt(openIndex - 1) : undefined}
          onNext={openIndex >= 0 && openIndex < visible.length - 1 ? () => openAt(openIndex + 1) : undefined}
          onClose={() => setParam('cabinet', null)}
          onBillingChange={b => setWorkspaces(prev => prev.map(x => x.id === openRow.w.id ? { ...x, billing: b } : x))}
          onToggleFeature={(key, enabled) => handleToggleFeature(openRow.w.id, key, enabled)}
          onRestore={() => handleRestoreWorkspace(openRow.w)}
          onDelete={() => setDeleting(openRow.w)}
        />
      )}
      {confirmGrant && (
        <ConfirmModal
          title="Acorzi rolul de super admin?"
          message={`${confirmGrant} va vedea toate cabinetele, conturile și încasările și va putea modifica abonamente, credite și funcții. Se aplică la următoarea autentificare cu Google.`}
          confirmLabel="Acordă rolul"
          danger
          onConfirm={() => { const t = confirmGrant; setConfirmGrant(null); void handleGrant(t) }}
          onCancel={() => setConfirmGrant(null)}
        />
      )}
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

interface RowData {
  w: Workspace
  access: ReturnType<typeof billingAccess>
  created: Date | null
  act: WorkspaceActivity | undefined
  eng: { key: EngagementKey; label: string; daysSince: number | null }
  admin: { email?: string } | undefined
}

/** Un grup din „De urmărit”: cabinetele lui, fiecare deschide panoul. */
function WatchGroup({ title, rows, note, onOpen }: { title: string; rows: RowData[]; note: (r: RowData) => string; onOpen: (id: string) => void }) {
  if (!rows.length) return null
  return (
    <div>
      <div className="sa-watch-title">{title} <span>{rows.length}</span></div>
      {rows.slice(0, 6).map(r => (
        <button key={r.w.id} type="button" className="sa-watch-item" onClick={() => onOpen(r.w.id)}>
          <b>{r.w.name}</b><span>{note(r)}</span>
        </button>
      ))}
      {rows.length > 6 && <div className="card-sub">și încă {rows.length - 6}</div>}
    </div>
  )
}

/** Rândul unui cabinet: nume, stare, detaliul accesului, cât de folosit e, activitatea pe 30 de zile, administratorul. */
function WorkspaceRow({ r, cuiWarning, activityLoading, active, onOpen }: {
  r: RowData; cuiWarning: boolean; activityLoading: boolean; active: boolean; onOpen: () => void
}) {
  const { w, access, created, act, eng, admin } = r
  const members = Object.keys(w.members ?? {}).length
  let detail: string
  if (!w.billing) detail = 'nemigrat'
  else if (!access.full) detail = 'fără acces complet'
  else if (access.reason === 'credits') detail = `${access.credits.balance} credite${access.credits.firstExpiry ? ` · expiră ${formatDate(access.credits.firstExpiry)}` : ''}`
  else if (access.reason === 'subscription') detail = `${access.interval === 'year' ? 'anual' : 'lunar'} · ${access.cancelAtPeriodEnd ? 'se încheie' : 'plata'} ${formatDate(access.currentPeriodEnd)}`
  else if (access.reason === 'trial') detail = `${access.daysLeft} ${access.daysLeft === 1 ? 'zi rămasă' : 'zile rămase'}`
  else detail = `până pe ${formatDate(access.accessUntil)}`
  const tone = !access.full ? 'chip chip-muted' : access.reason === 'past_due' ? 'badge badge-inactiv' : access.reason === 'trial' ? 'chip chip-primary' : 'chip chip-success'
  const t30 = act ? activityTotals(act.series, 30) : null
  return (
    <button type="button" className={`sa-row${active ? ' sa-row--active' : ''}`} onClick={onOpen}>
      <span className="sa-row-name">
        <b>{w.name}</b>
        <small>{admin?.email ?? '—'}{members > 1 ? ` +${members - 1}` : ''}{created ? ` · din ${created.toLocaleDateString('ro-RO')}` : ''}</small>
      </span>
      <span className="sa-row-status">
        <span className={tone}>{w.billing ? STATUS_LABEL[access.reason] : 'Nemigrat'}</span>
        <small>{detail}</small>
      </span>
      <span className="sa-row-activity">
        {act ? <ActivitySpark data={act.series.slice(-30)} /> : activityLoading ? <Skeleton w={90} h={18} /> : null}
        {t30 && <small>{t30.activeDays} {t30.activeDays === 1 ? 'zi activă' : 'zile active'} · {t30.documents} doc.</small>}
      </span>
      <span className="sa-row-flags">
        {act && <span className={`sa-eng sa-eng--${eng.key}`}>{eng.label}</span>}
        {w.status === 'pendingDeletion' && <span className="badge badge-inactiv">În ștergere</span>}
        {cuiWarning && <span className="chip sa-chip-warn" title="Același CUI a mai avut o perioadă de probă în alt cabinet">CUI refolosit</span>}
      </span>
    </button>
  )
}
