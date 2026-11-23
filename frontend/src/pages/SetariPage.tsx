import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FONT_OPTIONS } from '../lib/settings'
import type { Theme } from '../lib/settings'
import { useSettingsCtx } from '../SettingsCtx'
import { useApp } from '../AppContext'
import AccountCard from '../components/AccountCard'
import PrivacyCard from '../components/PrivacyCard'
import AuditLogCard from '../components/AuditLogCard'
import NotificariCard from '../components/NotificariCard'
import { resolveFacturareConfig } from '../types'
import type { FacturareConfig } from '../types'
import { blurNumberInputOnWheel } from '../lib/inputEvents'
import NotificariBell from '../components/NotificariBell'
import PlanSection from '../components/PlanSection'
import DocumenteSetari from '../components/documente/DocumenteSetari'
import DangerZoneCard from '../components/DangerZoneCard'
import MembriPanel from '../components/MembriPanel'
import ConfirmModal from '../components/ConfirmModal'
import BtnLabel from '../components/BtnLabel'
import { formatDate, planSummary, toDate } from '../lib/billing'
import type { BillingTime } from '../types'

const THEME_OPTIONS: { key: Theme; label: string; desc: string }[] = [
  { key: 'light', label: 'Deschis', desc: 'Fundal alb, potrivit pentru lucru ziua' },
  { key: 'dark', label: 'Întunecat', desc: 'Fundal închis, mai odihnitor seara' },
  { key: 'system', label: 'Sistem', desc: 'Urmează preferința sistemului de operare' },
]

function ThemeSwatchPreview({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark'
  const bg = isDark ? '#0f172a' : '#f1f5f9'
  const surface = isDark ? '#1e293b' : '#ffffff'
  const accent = '#6366f1'
  if (theme === 'system') {
    return (
      <div className="settings-swatch-preview">
        <div style={{ flex: 1, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, background: '#ffffff', border: '1px solid #cbd5e1' }} />
        </div>
        <div style={{ flex: 1, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, background: '#1e293b', border: '1px solid #334155' }} />
        </div>
      </div>
    )
  }
  return (
    <div className="settings-swatch-preview" style={{ background: bg, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '70%', height: 22, borderRadius: 5, background: surface, display: 'flex', alignItems: 'center', padding: '0 6px', gap: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />
        <div style={{ flex: 1, height: 4, borderRadius: 2, background: isDark ? '#475569' : '#e2e8f0' }} />
      </div>
    </div>
  )
}

function PercentField({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={Math.round(value * 1000) / 10}
        onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value) / 100)}
        onWheel={blurNumberInputOnWheel}
      />
      <div className="card-sub" style={{ marginTop: '.25rem' }}>{hint}</div>
    </div>
  )
}

function RonField({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        onWheel={blurNumberInputOnWheel}
      />
      <div className="card-sub" style={{ marginTop: '.25rem' }}>{hint}</div>
    </div>
  )
}

function FacturareConfigCard({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { activeWorkspace, workspaceCtx, toast } = useApp()
  const saved = resolveFacturareConfig(activeWorkspace?.facturareConfig)
  const [form, setForm] = useState<FacturareConfig>(saved)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  // Modificări nesalvate: pagina le semnalează la schimbarea secțiunii, iar browserul la închidere/reîncărcare.
  useEffect(() => {
    onDirtyChange(dirty)
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const set = <K extends keyof FacturareConfig>(key: K, val: number) => setForm(prev => ({ ...prev, [key]: val }))

  const handleSave = async () => {
    if (!activeWorkspace) return
    setSaving(true)
    try {
      await workspaceCtx.updateFacturareConfig(activeWorkspace.id, form)
      toast('Procentaje salvate', 'ok')
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la salvare', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">💰 Facturare Sami / Adi</span>
        </div>
        <div className="card-body">
          <div className="card-sub" style={{ marginBottom: '.875rem' }}>
            Cotele folosite la împărțirea profitului dosarelor cu semnătură electronică.
          </div>
          <div className="form-grid">
            <PercentField label="Cota Sami — clienți Adi" hint="Ce revine lui Sami din dosarele clienților lui Adi" value={form.cotaSamiClientiAdi} onChange={v => set('cotaSamiClientiAdi', v)} />
            <PercentField label="Cota Sami — clienți proprii" hint="Ce revine lui Sami din dosarele proprii" value={form.cotaSamiClientiProprii} onChange={v => set('cotaSamiClientiProprii', v)} />
            <PercentField label="CAA per dosar (% din valoare)" hint="Contribuția CAA — mereu % din valoarea dosarului (calculul per dosar)" value={form.caaProcent} onChange={v => set('caaProcent', v)} />
            <PercentField label="Impozit pe profit (Adi)" hint="Se aplică pe partea lui Adi (cuvenit Adi)" value={form.impozitProfitCota} onChange={v => set('impozitProfitCota', v)} />
          </div>

          <div className="form-subsection-label" style={{ marginTop: '1.25rem' }}>Sumar lunar — CAA reală, cu prag</div>
          <div className="card-sub" style={{ marginTop: '.5rem', marginBottom: '.625rem' }}>
            Folosite doar de cardul „Sumar lunar" — CAA lunară reală se calculează cu prag, nu ca simplul % de mai sus.
          </div>
          <div className="form-grid">
            <RonField label="CAA — prag minim (RON/lună)" hint="Sub acest prag, CAA lunară e fixă (nu procentuală)" value={form.caaMin} onChange={v => set('caaMin', v)} />
            <RonField label="CAA — plafon maxim (RON/lună)" hint="CAA lunară nu depășește această sumă" value={form.caaPlafon} onChange={v => set('caaPlafon', v)} />
            <RonField label="Barou — taxă fixă (RON/lună)" hint="Taxă lunară fixă, doar în lunile cu venit" value={form.barouFix} onChange={v => set('barouFix', v)} />
          </div>
        </div>
      </div>

      {(dirty || saving) && (
        <div className="unsaved-bar" role="region" aria-label="Modificări nesalvate">
          <span>Ai modificări nesalvate.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setForm(saved)} disabled={saving}>Renunță</button>
          <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
            <BtnLabel busy={saving}>Salvează</BtnLabel>
          </button>
        </div>
      )}
    </>
  )
}

function AspectCard() {
  const { theme, setTheme, font, setFont } = useSettingsCtx()
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">🎨 Aspect</span>
      </div>
      <div className="card-body">
        <div className="settings-section">
          <div>
            <div className="field-label" style={{ marginBottom: '.625rem' }}>Temă</div>
            <div className="settings-option-grid">
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  className={`settings-swatch${theme === opt.key ? ' settings-swatch--active' : ''}`}
                  aria-pressed={theme === opt.key}
                  onClick={() => setTheme(opt.key)}
                >
                  <ThemeSwatchPreview theme={opt.key} />
                  <div>
                    <div className="settings-swatch-label">{opt.label}</div>
                    <div className="card-sub" style={{ marginTop: '.15rem' }}>{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: '1.25rem' }}>
            <div className="field-label" style={{ marginBottom: '.625rem' }}>Font</div>
            <div className="settings-option-grid">
              {FONT_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  className={`settings-swatch${font === opt.key ? ' settings-swatch--active' : ''}`}
                  aria-pressed={font === opt.key}
                  onClick={() => setFont(opt.key)}
                >
                  <div className="settings-font-preview" style={{ fontFamily: opt.stack }}>Aa</div>
                  <div>
                    <div className="settings-swatch-label" style={{ fontFamily: opt.stack }}>{opt.label}</div>
                    <div className="card-sub" style={{ marginTop: '.15rem', fontFamily: opt.stack }}>
                      Popescu Ion SRL — CIF RO12345678
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="card-sub" style={{ marginTop: '1rem' }}>Se aplică imediat și se păstrează pe acest dispozitiv.</div>
        </div>
      </div>
    </div>
  )
}

const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', member: 'Membru', viewer: 'Doar citire' }

/** Cabinet › General: numele (modificabil de administrator), data deschiderii, rolul tău. */
function GeneralCard({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { activeWorkspace, userRole, workspaceCtx, toast, user } = useApp()
  const saved = activeWorkspace?.name ?? ''
  const [name, setName] = useState(saved)
  const [saving, setSaving] = useState(false)
  const isAdmin = userRole === 'admin'
  const dirty = name.trim() !== saved && !!name.trim()
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  if (!activeWorkspace) return null
  const created = toDate(activeWorkspace.createdAt as BillingTime)
  const owner = activeWorkspace.members[activeWorkspace.ownerId]

  const save = async () => {
    setSaving(true)
    try {
      await workspaceCtx.renameWorkspace(activeWorkspace.id, name.trim())
      toast('Numele cabinetului a fost schimbat', 'ok')
    } catch (e) {
      toast((e as Error).message || 'Nu s-a putut salva', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head"><span className="card-title">🏛️ Cabinet</span></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="field" style={{ maxWidth: 420 }}>
            <label className="field-label" htmlFor="ws-name">Numele cabinetului</label>
            <input id="ws-name" className="field-input" value={name} onChange={e => setName(e.target.value)} disabled={!isAdmin || saving}
              onKeyDown={e => { if (e.key === 'Enter' && dirty) void save() }} />
            {!isAdmin && <div className="card-sub" style={{ marginTop: '.25rem' }}>Numele se schimbă de un administrator.</div>}
          </div>
          <dl className="settings-facts">
            <div><dt>Deschis pe</dt><dd>{created ? formatDate(created) : '—'}</dd></div>
            <div><dt>Proprietar</dt><dd>{owner?.displayName || owner?.email || '—'}</dd></div>
            <div><dt>Rolul tău</dt><dd>{ROLE_LABEL[activeWorkspace.members[user.uid]?.role ?? ''] ?? '—'}</dd></div>
            <div><dt>Membri</dt><dd>{Object.keys(activeWorkspace.members).length}</dd></div>
          </dl>
        </div>
      </div>
      {isAdmin && (dirty || saving) && (
        <div className="unsaved-bar" role="region" aria-label="Modificări nesalvate">
          <span>Ai modificări nesalvate.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setName(saved)} disabled={saving}>Renunță</button>
          <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}><BtnLabel busy={saving}>Salvează</BtnLabel></button>
        </div>
      )}
    </>
  )
}

type SectionKey = 'cont' | 'aspect' | 'notificari' | 'confidentialitate' | 'general' | 'membri' | 'plan' | 'documente' | 'facturare' | 'jurnal' | 'stergere'

interface Section {
  key: SectionKey
  label: string
  icon?: string
  title: string
  desc: string
  group: 'Personal' | 'Cabinet' | ''
  danger?: boolean
}

export default function SetariPage() {
  const { userRole, activeWorkspace, hasFeature, billing } = useApp()
  const { sectiune } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const isAdmin = userRole === 'admin'
  const cabinet = activeWorkspace?.name ? `„${activeWorkspace.name}”` : 'cabinetului'

  // Secțiunile vizibile depind de rol și de funcțiile activate pentru cabinet.
  const sections: Section[] = [
    { key: 'cont', icon: '👤', group: 'Personal', label: 'Cont și securitate', title: 'Cont și securitate', desc: 'Parola, conexiunea cu Google Drive și sesiunile deschise.' },
    { key: 'aspect', icon: '🎨', group: 'Personal', label: 'Aspect', title: 'Aspect', desc: 'Tema și fontul aplicației.' },
    ...(activeWorkspace && hasFeature('alerte')
      ? [{ key: 'notificari', icon: '🔔', group: 'Personal', label: 'Notificări', title: 'Notificări', desc: 'Ce alerte primești și pe ce canale.' } as Section] : []),
    { key: 'confidentialitate', icon: '🛡️', group: 'Personal', label: 'Date și confidențialitate', title: 'Date și confidențialitate', desc: 'Textele legale acceptate și exportul datelor tale.' },
    ...(activeWorkspace ? [
      { key: 'general', icon: '🏛️', group: 'Cabinet', label: 'General', title: 'General', desc: `Numele și datele de bază ale ${cabinet}.` } as Section,
      { key: 'membri', icon: '👥', group: 'Cabinet', label: 'Membri', title: 'Membri',
        desc: isAdmin ? 'Colegii din cabinet, rolurile lor și invitațiile.' : 'Colegii din cabinet și rolurile lor.' } as Section,
    ] : []),
    ...(activeWorkspace ? [{ key: 'plan', icon: '💳', group: 'Cabinet', label: 'Plan și credite', title: 'Plan și credite', desc: `Abonamentul, creditele și datele de facturare ale ${cabinet}.` } as Section] : []),
    ...(activeWorkspace && hasFeature('documente')
      ? [{ key: 'documente', icon: '📁', group: 'Cabinet', label: 'Documente', title: 'Documente', desc: 'Spațiul folosit de documentele clienților și Arhiva.' } as Section] : []),
    ...(isAdmin && activeWorkspace && hasFeature('facturareSamiAdi')
      ? [{ key: 'facturare', icon: '💰', group: 'Cabinet', label: 'Facturare Sami / Adi', title: 'Facturare Sami / Adi', desc: 'Cotele de împărțire și pragurile pentru sumarul lunar.' } as Section] : []),
    ...(isAdmin && activeWorkspace
      ? [{ key: 'jurnal', icon: '📜', group: 'Cabinet', label: 'Jurnal de acces', title: 'Jurnal de acces', desc: 'Cine a văzut sau a modificat date sensibile, și când.' } as Section] : []),
    { key: 'stergere', icon: '🗑️', group: '', label: 'Ștergerea contului', title: 'Zonă periculoasă', desc: 'Acțiuni ireversibile.', danger: true },
  ]

  // Modificări nesalvate în secțiunea curentă: schimbarea secțiunii cere confirmare.
  const dirtyRef = useRef(false)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const onDirtyChange = useCallback((d: boolean) => { dirtyRef.current = d }, [])

  // Legături vechi: /setari?notificari=… (clopoțel) duc la secțiunea Notificări.
  if (!sectiune) {
    const target = params.get('notificari') && sections.some(s => s.key === 'notificari') ? 'notificari' : 'cont'
    return <Navigate to={{ pathname: `/setari/${target}`, search: params.toString() ? `?${params}` : '' }} replace />
  }
  const current = sections.find(s => s.key === sectiune)
  if (!current) return <Navigate to="/setari/cont" replace />

  const plan = planSummary(billing)
  const go = (e: React.MouseEvent, path: string) => {
    if (!dirtyRef.current) return
    e.preventDefault()
    setPendingPath(path)
  }

  let content: ReactNode
  switch (current.key) {
    case 'cont': content = <AccountCard />; break
    case 'aspect': content = <AspectCard />; break
    // key=workspace id: editoarele nu rămân cu starea altui cabinet.
    case 'notificari': content = activeWorkspace && <NotificariCard key={`notificari-${activeWorkspace.id}`} />; break
    case 'confidentialitate': content = <PrivacyCard />; break
    case 'general': content = activeWorkspace && <GeneralCard key={activeWorkspace.id} onDirtyChange={onDirtyChange} />; break
    case 'membri': content = activeWorkspace && (
      <div className="card"><div className="card-body"><MembriPanel key={activeWorkspace.id} workspace={activeWorkspace} readOnly={!isAdmin} /></div></div>
    ); break
    case 'plan': content = <PlanSection />; break
    case 'documente': content = activeWorkspace && <DocumenteSetari key={activeWorkspace.id} />; break
    // key=workspace id — forțează remount la schimbarea workspace-ului activ, ca `form` să nu rămână cu valorile
    // vechiului workspace (altfel Save ar suprascrie configul noului workspace cu date stale).
    case 'facturare': content = activeWorkspace && <FacturareConfigCard key={activeWorkspace.id} onDirtyChange={onDirtyChange} />; break
    // Jurnal de acces: key=workspace id ca să nu rămână intrările altui workspace.
    case 'jurnal': content = activeWorkspace && <AuditLogCard key={activeWorkspace.id} />; break
    case 'stergere': content = <DangerZoneCard />; break
  }

  const groups = ['Personal', 'Cabinet', ''] as const
  return (
    <div className="page--data">
      <div className="page-top">
        <div className="page-header">
          <div>
            <div className="page-title">Setări</div>
            <div className="page-subtitle">Contul tău și setările {cabinet}</div>
          </div>
          <div className="page-actions"><NotificariBell /></div>
        </div>
      </div>

      <div className="page-body" style={{ overflowY: 'auto' }}>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Secțiuni setări">
            {groups.map(g => {
              const items = sections.filter(s => s.group === g)
              if (!items.length) return null
              return (
                <div key={g || 'danger'} className={`settings-nav-block${g ? '' : ' settings-nav-block--danger'}`}>
                  {g && <div className="settings-nav-group">{g}</div>}
                  {items.map(s => (
                    <NavLink key={s.key} to={`/setari/${s.key}`} onClick={e => go(e, `/setari/${s.key}`)}
                      className={({ isActive }) => `settings-nav-item${s.danger ? ' settings-nav-item--danger' : ''}${isActive ? ' active' : ''}`}>
                      <span className="settings-nav-icon" aria-hidden>{s.icon}</span>
                      {s.label}
                      {/* Planul cere atenție (probă pe final, credite puține, plată eșuată): semnal lângă secțiune. */}
                      {s.key === 'plan' && plan.tone !== 'ok' && (
                        <span className={`settings-nav-badge${plan.tone === 'warn' ? ' settings-nav-badge--warn' : ''}`} title={`${plan.label} · ${plan.sub}`}>!</span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )
            })}
          </nav>

          <div key={current.key} className="settings-content">
            <div className="settings-section-head">
              <h2 style={current.danger ? { color: 'var(--r600)' } : undefined}>{current.title}</h2>
              <p>{current.desc}</p>
            </div>
            {content}
          </div>
        </div>
      </div>

      {pendingPath && (
        <ConfirmModal
          title="Pleci fără să salvezi?"
          message="Modificările din această secțiune nu au fost salvate și se pierd."
          confirmLabel="Pleacă fără salvare"
          danger
          onConfirm={() => { const p = pendingPath; setPendingPath(null); dirtyRef.current = false; navigate(p) }}
          onCancel={() => setPendingPath(null)}
        />
      )}
    </div>
  )
}
