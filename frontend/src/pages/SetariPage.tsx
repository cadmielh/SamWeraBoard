import { FONT_OPTIONS } from '../lib/settings'
import type { Theme } from '../lib/settings'
import { useSettingsCtx } from '../SettingsCtx'

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

export default function SetariPage() {
  const { theme, setTheme, font, setFont } = useSettingsCtx()

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
        </div>
      </div>
    </div>
  )
}
