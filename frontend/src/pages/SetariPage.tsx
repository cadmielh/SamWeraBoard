import { useState } from 'react'
import { FONT_OPTIONS } from '../lib/settings'
import type { Theme } from '../lib/settings'
import { useSettingsCtx } from '../SettingsCtx'
import { useApp } from '../AppContext'
import { resolveFacturareConfig } from '../types'
import type { FacturareConfig } from '../types'

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
      />
      <div className="card-sub" style={{ marginTop: '.25rem' }}>{hint}</div>
    </div>
  )
}

function FacturareConfigCard() {
  const { activeWorkspace, workspaceCtx, toast } = useApp()
  const saved = resolveFacturareConfig(activeWorkspace?.facturareConfig)
  const [form, setForm] = useState<FacturareConfig>(saved)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

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

        <button className="btn btn-primary btn-sm" style={{ marginTop: '1rem' }} onClick={handleSave} disabled={!dirty || saving}>
          {saving ? <span className="spin" /> : 'Salvează'}
        </button>
      </div>
    </div>
  )
}

export default function SetariPage() {
  const { theme, setTheme, font, setFont } = useSettingsCtx()
  const { userRole, activeWorkspace } = useApp()

  return (
    <div className="page--data">
      <div className="page-top">
        <div className="page-header">
          <div>
            <div className="page-title">Setări</div>
            <div className="page-subtitle">Aspectul aplicației</div>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 720 }}>
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
              </div>
            </div>
          </div>

          {/* key=workspace id — forțează remount la schimbarea workspace-ului activ,
              ca `form` să nu rămână cu valorile vechiului workspace (altfel Save
              ar suprascrie configul noului workspace cu date stale). */}
          {userRole === 'admin' && activeWorkspace && <FacturareConfigCard key={activeWorkspace.id} />}
        </div>
      </div>
    </div>
  )
}
