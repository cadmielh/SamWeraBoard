import { useEffect, useState } from 'react'
import Modal from '../Modal'
import SuperAdminBilling from '../SuperAdminBilling'
import DeliveredTemplatesPanel from '../DeliveredTemplatesPanel'
import IconTrash from '../IconTrash'
import { Skeleton } from '../Skeleton'
import { DailyBars } from './ActivityCharts'
import { FEATURE_REGISTRY, hasFeature, type FeatureKey } from '../../lib/features'
import { activityTotals, engagementOf, type WorkspaceActivity } from '../../lib/superAdmin'
import { billingAccess, formatDate, toDate } from '../../lib/billing'
import type { BillingTime, Workspace, WorkspaceBilling } from '../../types'

const ROLE_LABEL: Record<'admin' | 'member' | 'viewer', string> = { admin: 'Admin', member: 'Membru', viewer: 'Doar citire' }

type Tab = 'activitate' | 'abonament' | 'membri' | 'sabloane' | 'setari'

/** Panoul lateral al unui cabinet din super admin: activitate, abonament, membri, șabloane livrate, setări.
 *  Lista rămâne în spate; ↑/↓ (sau butoanele din antet) trec la cabinetul anterior/următor. */
export default function WorkspaceDrawer({ w, activity, activityLoading, cuiSeenName, onPrev, onNext, onClose,
  onBillingChange, onToggleFeature, onRestore, onDelete }: {
  w: Workspace
  activity: WorkspaceActivity | undefined
  activityLoading: boolean
  /** Numele cabinetului în care același CUI a mai avut o probă (dacă e cazul). */
  cuiSeenName: string | null
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
  onBillingChange: (b: WorkspaceBilling) => void
  onToggleFeature: (key: FeatureKey, enabled: boolean) => Promise<void>
  onRestore: () => Promise<void>
  onDelete: () => void
}) {
  const [tab, setTab] = useState<Tab>('activitate')
  const [range, setRange] = useState<30 | 90>(30)
  // Starea fiecărei bife de funcție: salvarea și eventuala eroare apar lângă ea, nu în altă parte a paginii.
  const [flagState, setFlagState] = useState<Record<string, { saving?: boolean; saved?: boolean; error?: string }>>({})
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'ArrowUp' && onPrev) { e.preventDefault(); onPrev() }
      if (e.key === 'ArrowDown' && onNext) { e.preventDefault(); onNext() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onPrev, onNext])

  const access = billingAccess(w.billing)
  const members = Object.entries(w.members ?? {})
  const created = toDate(w.createdAt as BillingTime)
  const eng = engagementOf(activity, created)
  const totals = activity ? activityTotals(activity.series, range) : null
  const series = activity?.series.slice(-range) ?? []

  const toggle = async (key: FeatureKey, enabled: boolean) => {
    setFlagState(s => ({ ...s, [key]: { saving: true } }))
    try {
      await onToggleFeature(key, enabled)
      setFlagState(s => ({ ...s, [key]: { saved: true } }))
      setTimeout(() => setFlagState(s => (s[key]?.saved ? { ...s, [key]: {} } : s)), 1800)
    } catch (e) {
      setFlagState(s => ({ ...s, [key]: { error: (e as Error).message || 'Nu s-a salvat' } }))
    }
  }

  return (
    <Modal onClose={onClose} className="drawer-box" ariaLabel={`Cabinetul ${w.name}`}
      backdropStyle={{ padding: 0, justifyContent: 'flex-end', alignItems: 'stretch', overflow: 'hidden' }}>
      <div className="drawer-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="drawer-title">{w.name}</div>
          <div className="card-sub">
            {created ? `Deschis pe ${formatDate(created)}` : 'Data deschiderii nu e înregistrată'} · {members.length} {members.length === 1 ? 'membru' : 'membri'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.25rem' }}>
          <button className="btn btn-ghost btn-xs" onClick={onPrev} disabled={!onPrev} title="Cabinetul anterior (↑)" aria-label="Cabinetul anterior">↑</button>
          <button className="btn btn-ghost btn-xs" onClick={onNext} disabled={!onNext} title="Cabinetul următor (↓)" aria-label="Cabinetul următor">↓</button>
          <button className="modal-close" onClick={onClose} aria-label="Închide">×</button>
        </div>
      </div>

      {w.status === 'pendingDeletion' && (
        <div className="drawer-alert">
          <span>Programat pentru ștergere{w.deleteAfter ? ` pe ${w.deleteAfter.toDate().toLocaleDateString('ro-RO')}` : ''}. Membrii nu mai au acces.</span>
          <button className="btn btn-sm" disabled={restoring}
            onClick={() => { setRestoring(true); void onRestore().finally(() => setRestoring(false)) }}>Restaurează</button>
        </div>
      )}

      <div className="page-tabs drawer-tabs" role="tablist">
        {([['activitate', 'Activitate'], ['abonament', 'Abonament'], ['membri', `Membri (${members.length})`], ['sabloane', 'Șabloane'], ['setari', 'Setări']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`page-tab${tab === k ? ' page-tab--active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div className="drawer-body" key={`${w.id}-${tab}`}>
        {tab === 'activitate' && (activityLoading && !activity ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }} role="status" aria-label="Se încarcă activitatea">
            <div className="sa-kpis">{[0, 1, 2, 3].map(i => <Skeleton key={i} h={58} r={10} />)}</div>
            <Skeleton h={170} r={10} />
          </div>
        ) : !activity ? (
          <div className="card-sub">Activitatea nu s-a putut încărca.</div>
        ) : (<>
          <div className="drawer-range">
            <span className={`sa-eng sa-eng--${eng.key}`}>{eng.label}</span>
            <span className="card-sub" style={{ flex: 1 }}>
              {eng.daysSince === null ? 'Nicio acțiune înregistrată' : eng.daysSince === 0 ? 'Ultima acțiune: azi' : `Ultima acțiune: acum ${eng.daysSince} ${eng.daysSince === 1 ? 'zi' : 'zile'}`}
            </span>
            <div className="seg" role="group" aria-label="Perioada">
              {([30, 90] as const).map(r => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{r} zile</button>)}
            </div>
          </div>
          <div className="sa-kpis">
            <Kpi label="Zile active" value={`${totals!.activeDays}`} sub={`din ${range}`} />
            <Kpi label="Documente" value={`${totals!.documents}`} sub="generate" />
            <Kpi label="Scanări" value={`${totals!.scans}`} sub="acte" />
            <Kpi label="Utilizatori activi" value={`${activity.activeUsers}`} sub={`din ${members.length} (90 zile)`} />
            <Kpi label="Clienți" value={`${activity.clients}`} sub="în portofoliu" />
            <Kpi label="Dosare" value={`${activity.dosare}`} sub="în total" />
            {access.reason === 'trial' && access.daysLeft !== null && <Kpi label="Probă" value={`${access.daysLeft}`} sub="zile rămase" />}
          </div>
          <DailyBars title="Documente generate pe zi" data={series} value={d => d.documents} unit={['document', 'documente']}
            detail={d => [`${d.scans} ${d.scans === 1 ? 'scanare' : 'scanări'}`, `${d.activeUsers} ${d.activeUsers === 1 ? 'utilizator activ' : 'utilizatori activi'}`]} />
          <DailyBars title="Utilizatori activi pe zi" data={series} value={d => d.activeUsers} unit={['utilizator', 'utilizatori']}
            summary={`maxim ${Math.max(0, ...series.map(d => d.activeUsers))} într-o zi`} />
          <p className="card-sub" style={{ margin: 0 }}>
            Din jurnalul de acces: un utilizator e activ într-o zi dacă a generat, a scanat, a deschis date sensibile sau a administrat ceva.
            Timpul petrecut în aplicație nu se măsoară.
          </p>
        </>))}

        {tab === 'abonament' && (<>
          {cuiSeenName && (
            <div role="status" className="drawer-alert drawer-alert--warn">Acest CUI a mai avut o perioadă de probă în cabinetul „{cuiSeenName}”.</div>
          )}
          <SuperAdminBilling workspaceId={w.id} billing={w.billing} onChange={onBillingChange} />
        </>)}

        {tab === 'membri' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
            {members.map(([uid, m]) => (
              <div key={uid} className="sa-member">
                <span>{m.displayName ? <><b>{m.displayName}</b> · {m.email}</> : m.email}</span>
                <button className="btn btn-ghost btn-xs" onClick={() => void navigator.clipboard?.writeText(m.email ?? '')} title="Copiază adresa">Copiază</button>
                <span className={`chip ${m.role === 'admin' ? 'chip-success' : 'chip-muted'}`}>{ROLE_LABEL[m.role]}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'sabloane' && (w.status !== 'pendingDeletion'
          ? <DeliveredTemplatesPanel workspaceId={w.id} />
          : <div className="card-sub">Cabinet programat pentru ștergere: nu se mai livrează șabloane.</div>)}

        {tab === 'setari' && (<>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {FEATURE_REGISTRY.map(def => {
              const st = flagState[def.key] ?? {}
              return (
                <label key={def.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={hasFeature(w.features, def.key)} disabled={st.saving}
                    onChange={e => void toggle(def.key, e.target.checked)} style={{ marginTop: '.2rem' }} />
                  <span style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'var(--s800)' }}>
                      {def.label}
                      {st.saving && <span className="spin spin-dark" style={{ width: 12, height: 12, marginLeft: '.5rem', verticalAlign: 'middle' }} />}
                      {st.saved && <span className="sa-saved">Salvat ✓</span>}
                    </div>
                    <div className="card-sub">{def.description}</div>
                    {st.error && <div role="alert" style={{ color: 'var(--r600)', fontSize: '.8125rem' }}>{st.error}</div>}
                  </span>
                </label>
              )
            })}
          </div>
          <div style={{ borderTop: '1px solid var(--s100)', marginTop: '1rem', paddingTop: '.75rem' }}>
            <button className="btn btn-danger btn-sm" onClick={onDelete}><IconTrash size={14} /> Șterge cabinetul</button>
          </div>
        </>)}
      </div>
    </Modal>
  )
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="sa-kpi">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  )
}
