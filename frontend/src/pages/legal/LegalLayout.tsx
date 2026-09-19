import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TOS_VERSION } from '../../lib/legal'
import { LEGAL_UPDATED, PROVIDER, providerName, contactEmail } from '../../lib/legalConfig'

const LINKS: [string, string][] = [
  ['/termeni', 'Termeni și condiții'],
  ['/confidentialitate', 'Confidențialitate'],
  ['/dpa', 'Acord de prelucrare (DPA)'],
  ['/sub-imputerniciti', 'Sub-împuterniciți'],
  ['/securitate', 'Securitate'],
]

/** Cadru comun pentru paginile legale publice (fără autentificare). */
export default function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '2rem 1.25rem 4rem', color: 'var(--s700)', lineHeight: 1.6 }}>
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '.375rem 1rem', fontSize: '.8125rem', marginBottom: '1.5rem' }}>
        <Link to="/">← Aplicația</Link>
        {LINKS.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
      </nav>
      <h1 style={{ fontWeight: 800, fontSize: '1.5rem', letterSpacing: '-.02em', color: 'var(--s900)', marginBottom: '.25rem' }}>{title}</h1>
      <p style={{ fontSize: '.78rem', color: 'var(--s400)', margin: '0 0 1rem' }}>
        Versiunea {TOS_VERSION} · actualizată la {LEGAL_UPDATED}
      </p>
      {children}
      <ProviderContact />
    </div>
  )
}

/** Datele Furnizorului, din lib/legalConfig.ts; câmpurile necompletate nu apar. */
export function ProviderContact() {
  const rows: [string, string][] = ([
    ['Furnizor', providerName()],
    ['Înregistrare', PROVIDER.registration],
    ['Sediu', PROVIDER.address],
    ['Contact', contactEmail()],
  ] as [string, string][]).filter(([, v]) => v)
  return (
    <div className="card" style={{ marginTop: '2rem' }}>
      <div className="card-body" style={{ fontSize: '.8125rem', color: 'var(--s500)' }}>
        {rows.map(([k, v]) => <div key={k}><strong style={{ color: 'var(--s700)' }}>{k}:</strong> {v}</div>)}
      </div>
    </div>
  )
}

export function H({ children }: { children: ReactNode }) {
  return <h2 style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--s900)', margin: '1.75rem 0 .5rem' }}>{children}</h2>
}
export function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: '0 0 .75rem' }}>{children}</p>
}
export function UL({ children }: { children: ReactNode }) {
  return <ul style={{ margin: '0 0 .75rem', paddingLeft: '1.25rem' }}>{children}</ul>
}
