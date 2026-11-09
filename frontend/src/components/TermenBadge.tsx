import { termenText, type StareTermen } from '../lib/durata'

/** Eticheta colorată doar pentru ce cere atenție (expiră curând / a expirat); altfel text discret. */
export default function TermenBadge({ stare, prefix }: { stare: StareTermen; prefix?: string }) {
  const text = prefix ? `${prefix}: ${termenText(stare).charAt(0).toLowerCase()}${termenText(stare).slice(1)}` : termenText(stare)
  if (stare.stare === 'curand' || stare.stare === 'expirat') {
    return <span className={`badge badge-termen-${stare.stare}`}>{stare.stare === 'expirat' ? '⚠' : '⏳'} {text}</span>
  }
  return <span style={{ fontSize: '.75rem', color: 'var(--s500)' }}>{text}</span>
}
