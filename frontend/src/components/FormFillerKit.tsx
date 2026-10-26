// Piese vizuale partajate de fillerele de formulare fiscale dedicate (Anexa1Filler,
// BeneficiariRealiFiller) — era duplicată byte-identic în fiecare fișier.
//
// Notă: `RadioRow` NU e extras aici, deși numele e identic în ambele fișiere — Anexa1Filler
// are un layout orizontal/wrap (opțiuni scurte), BeneficiariRealiFiller unul vertical/coloană
// (6 opțiuni, etichete lungi); sunt variante vizuale diferite, nu cod duplicat.

export interface SectionCardProps { title: string; children: React.ReactNode; accent?: boolean }

export function SectionCard({ title, children, accent }: SectionCardProps) {
  return (
    <div style={{
      border: `1px solid ${accent ? 'var(--p200)' : 'var(--s200)'}`,
      background: accent ? 'var(--p50)' : undefined,
      borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', display: 'flex', flexDirection: 'column', gap: '.5rem',
    }}>
      <div style={{ fontWeight: 700, fontSize: '.75rem', color: accent ? 'var(--p700)' : 'var(--s600)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</div>
      {children}
    </div>
  )
}
