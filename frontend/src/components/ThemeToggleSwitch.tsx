import { useSettingsCtx } from '../SettingsCtx'

function IconSun() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  )
}

/** Comutator light/dark, montat sus în Sidebar (sub logo) — vizibil din orice
 * pagină, la fel ca sidebar-ul însuși. Comută direct light/dark; preferința
 * "Sistem" rămâne o alegere deliberată, doar din Setări. */
export default function ThemeToggleSwitch() {
  const { resolvedTheme, setTheme } = useSettingsCtx()
  const isDark = resolvedTheme === 'dark'
  const label = isDark ? 'Comută la modul deschis' : 'Comută la modul întunecat'

  return (
    <button
      type="button"
      className="theme-toggle-switch"
      data-dark={isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={label}
      aria-label={label}
      role="switch"
      aria-checked={isDark}
    >
      <span className="theme-toggle-switch-thumb">
        {isDark ? <IconMoon /> : <IconSun />}
      </span>
    </button>
  )
}
