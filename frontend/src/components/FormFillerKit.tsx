// Piese vizuale partajate de fillerele de formulare fiscale dedicate (Anexa1Filler,
// BeneficiariRealiFiller, Anexa2aFiller) — era duplicată byte-identic în fiecare fișier.
//
// Notă: `RadioRow` NU e extras aici, deși numele e identic în ambele fișiere — Anexa1Filler
// are un layout orizontal/wrap (opțiuni scurte), BeneficiariRealiFiller unul vertical/coloană
// (6 opțiuni, etichete lungi); sunt variante vizuale diferite, nu cod duplicat.

export interface CollapsibleSectionProps {
  /** Numărul punctului din formular (ex. „IV”, „4.1”), afișat înaintea titlului. */
  nr?: string
  title: string
  open: boolean
  onToggle: () => void
  /** Rezumatul afișat cât timp secțiunea e restrânsă (ex. persoana aleasă). */
  summary?: string
  /** Câte câmpuri obligatorii lipsesc; 0 = completă (bifă verde), undefined = fără stare. */
  missing?: number
  /** Secțiune imbricată: chenar mai discret, fără umbră. */
  nested?: boolean
  children: React.ReactNode
}

/** Secțiune care se poate restrânge, cu starea vizibilă și când e închisă — pentru formularele lungi
 * (Anexa2aFiller), unde se completează câte un punct pe rând. */
export function CollapsibleSection({ nr, title, open, onToggle, summary, missing, nested, children }: CollapsibleSectionProps) {
  const done = missing === 0
  return (
    <div style={{
      border: `1px solid ${open && !nested ? 'var(--p200)' : 'var(--s200)'}`,
      borderRadius: 'var(--r-sm)', background: open && !nested ? 'var(--p50)' : undefined,
    }}>
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '.5rem', padding: nested ? '.4rem .6rem' : '.55rem .75rem',
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit',
        }}
      >
        <span aria-hidden style={{ fontSize: '.7rem', color: 'var(--s400)', width: '.8rem', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        {nr && <span style={{ fontWeight: 700, fontSize: '.78rem', color: 'var(--p700)', flexShrink: 0 }}>{nr}</span>}
        <span style={{ fontWeight: 700, fontSize: nested ? '.8rem' : '.83rem', color: 'var(--s700)', flexShrink: 0 }}>{title}</span>
        {!open && summary && (
          <span style={{ fontSize: '.75rem', color: 'var(--s500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {summary}
          </span>
        )}
        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: '.72rem', fontWeight: 600 }}>
          {done && <span style={{ color: 'var(--g600)' }} title="Complet">✓</span>}
          {!!missing && <span style={{ color: 'var(--y700)' }}>{missing} de completat</span>}
        </span>
      </button>
      {open && (
        <div style={{ padding: nested ? '0 .6rem .6rem' : '0 .75rem .75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {children}
        </div>
      )}
    </div>
  )
}

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
