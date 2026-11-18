// Stilurile comune ale formularelor ONRC dedicate (vezi OnrcFormKit).
import type { CSSProperties } from 'react'

export const ROW: CSSProperties = { display: 'flex', gap: '.5rem', flexWrap: 'wrap' }
export const NOTE: CSSProperties = { fontSize: '.72rem', color: 'var(--s500)' }
export const AUTO_NOTE: CSSProperties = {
  fontSize: '.72rem', color: 'var(--y700)', background: 'var(--y50)',
  border: '1px solid var(--y200)', borderRadius: 4, padding: '.25rem .5rem',
}
