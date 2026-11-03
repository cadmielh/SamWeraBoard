import { PASSWORD_RULES } from '../lib/authErrors'

/** Cerințele parolei, bifate pe măsură ce utilizatorul scrie. */
export default function PasswordRules({ password }: { password: string }) {
  return (
    <ul aria-label="Cerințe pentru parolă" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '.125rem', fontSize: '.75rem', color: 'var(--s500)' }}>
      {PASSWORD_RULES.map(rule => {
        const ok = rule.test(password)
        return (
          <li key={rule.label} style={{ color: ok ? 'var(--g600, #16a34a)' : undefined }}>
            <span role="img" aria-label={ok ? 'îndeplinit' : 'neîndeplinit'}>{ok ? '✓' : '○'}</span> {rule.label}
          </li>
        )
      })}
    </ul>
  )
}
