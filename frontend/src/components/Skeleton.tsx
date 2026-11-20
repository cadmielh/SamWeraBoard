import type { CSSProperties } from 'react'

/** Bloc gri animat în forma conținutului care urmează (text, rând, card). */
export function Skeleton({ w = '100%', h = 12, r, style }: { w?: number | string; h?: number | string; r?: number | string; style?: CSSProperties }) {
  return <span className="skel" aria-hidden style={{ width: w, height: h, borderRadius: r, ...style }} />
}

/** Rânduri de listă în curs de încărcare (Clienți, Dosare): avatar, două linii, o etichetă. */
export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Se încarcă" className="skel-rows">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel-row">
          <Skeleton w={32} h={32} r="50%" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Lățimi diferite pe rând, ca lista să nu pară o grilă rigidă. */}
            <Skeleton w={`${45 + ((i * 17) % 30)}%`} h={11} />
            <Skeleton w={`${25 + ((i * 11) % 20)}%`} h={9} />
          </div>
          <Skeleton w={64} h={18} r={999} />
        </div>
      ))}
    </div>
  )
}

/** Coloanele board-ului de sarcini în curs de încărcare. */
export function SkeletonBoard({ columns = 4 }: { columns?: number }) {
  return (
    <div role="status" aria-label="Se încarcă" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '1rem' }}>
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
          <Skeleton w="50%" h={12} />
          {Array.from({ length: 3 - (c % 2) }, (_, i) => <Skeleton key={i} h={72} r={10} />)}
        </div>
      ))}
    </div>
  )
}

/** Pagina în curs de încărcare (codul ei se descarcă): antet + conținut generic. */
export function PageSkeleton() {
  return (
    <div className="page--data" role="status" aria-label="Se încarcă pagina">
      <div className="page-top">
        <Skeleton w={180} h={20} />
        <Skeleton w={280} h={11} style={{ marginTop: 8 }} />
      </div>
      <div className="page-body skel-delayed"><SkeletonRows rows={6} /></div>
    </div>
  )
}
