import { useState, useMemo, useCallback } from 'react'
import type { Dosar } from '../../types'
import { obiecteCereriiText } from '../../types'
import { useArchivedDosare } from '../../lib/dosare'
import { formatDateRo, toDateSafe } from '../../lib/dates'
import { useApp } from '../../AppContext'

function fmtDocumentePredate(value: unknown): string {
  const d = toDateSafe(value)
  return d ? formatDateRo(d) : '—'
}

interface Props {
  workspaceId: string
  /** Incrementat de DosarePage după o schimbare de stadiu, ca noul item să
   * apară/dispară din arhivă fără reload — hook-ul de dedesubt e one-shot. */
  refreshKey?: number
  /** Deschide dosarul ca tab, cu toate detaliile (DosarView). */
  onOpenDosar: (dosar: Dosar) => void
  /** Restaurare rapidă, direct în „În lucru", fără a deschide dosarul —
   * pentru restaurări cu alt stadiu decât „În lucru", se deschide dosarul și
   * se schimbă din selectorul obișnuit de stadiu. */
  onRestore: (dosar: Dosar) => Promise<void>
}

/**
 * Secțiune pliabilă de arhivă, jos de tot pe DosarePage — dosarele ajunse în
 * „Documente predate client" intră aici instant (useArchivedDosare). Căutare
 * client-side (nu server-side, ca la arhiva de Sarcini) — Dosar nu are un
 * câmp *Lower pentru prefix-search, iar volumul e modest. Rândurile sunt doar
 * clicabile (deschid dosarul complet) — nicio stare/acțiune de restaurare
 * afișată aici, ca să nu dubleze selectorul de stadiu din DosarView.
 */
export default function ArchivedDosareSection({ workspaceId, refreshKey = 0, onOpenDosar, onRestore }: Props) {
  const { toast } = useApp()
  const { dosare, loading, loadingMore, hasMore, loadMore } = useArchivedDosare(workspaceId, refreshKey)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dosare.filter(d => !q ||
      (d.clientDenumire || d.clientDenumireLibera || '').toLowerCase().includes(q) ||
      obiecteCereriiText(d.obiecteCererii).toLowerCase().includes(q) ||
      d.nrInregistrareDosar.toLowerCase().includes(q)
    )
  }, [dosare, query])

  const handleRestore = useCallback(async (e: React.MouseEvent, d: Dosar) => {
    e.stopPropagation()
    setRestoringId(d.id)
    try {
      await onRestore(d)
    } catch (err: unknown) {
      toast((err as Error).message ?? 'Eroare la restaurare', 'err')
    } finally {
      setRestoringId(null)
    }
  }, [onRestore, toast])

  return (
    <div className="card" style={{ marginTop: '1rem', flexShrink: 0 }}>
      <button
        type="button"
        className="card-head"
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', padding: '1rem 1.125rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
      >
        <span className="card-title">🗄 Arhivă dosare{dosare.length > 0 ? ` · ${dosare.length}${hasMore ? '+' : ''}` : ''}</span>
        <span style={{ color: 'var(--s400)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--t)' }}>▾</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--s200)' }}>
          <div style={{ padding: '.875rem 1.125rem 0' }}>
            <div className="search-box">
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="var(--s400)" strokeWidth="2" strokeLinecap="round">
                <circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" />
              </svg>
              <input placeholder="Caută în arhivă după client, obiectul cererii, nr. dosar..." value={query} onChange={e => setQuery(e.target.value)} />
              {query && <button onClick={() => setQuery('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>}
            </div>
          </div>

          <div style={{ padding: '.875rem 1.125rem' }}>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
                <span className="spin spin-dark" style={{ width: 22, height: 22 }} />
              </div>
            )}
            {!loading && displayed.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">🗄️</div>
                <div className="empty-state-text">{query ? 'Niciun rezultat pentru căutare.' : 'Arhiva e goală.'}</div>
              </div>
            )}
            {!loading && displayed.length > 0 && (
              <div style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--s200)' }}>
                      {['Client', 'Nr. dosar', 'Documente predate la', ''].map(h => (
                        <th key={h} style={{ padding: '.5rem .75rem', textAlign: 'left', fontWeight: 700, color: 'var(--s500)', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map(d => (
                      <tr
                        key={d.id}
                        onClick={() => onOpenDosar(d)}
                        style={{ borderBottom: '1px solid var(--s100)', cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <td style={{ padding: '.625rem .75rem', fontWeight: 600, color: 'var(--s900)' }}>{d.clientDenumire || d.clientDenumireLibera || '—'}</td>
                        <td style={{ padding: '.625rem .75rem', color: 'var(--s500)' }}>{d.nrInregistrareDosar || '—'}</td>
                        <td style={{ padding: '.625rem .75rem', color: 'var(--s500)' }}>{fmtDocumentePredate(d.documentePredateAt)}</td>
                        <td style={{ padding: '.625rem .75rem', textAlign: 'right' }}>
                          <button
                            className="btn btn-ghost btn-xs"
                            disabled={restoringId === d.id}
                            onClick={e => handleRestore(e, d)}
                            title="Restaurează în «În lucru»"
                          >
                            {restoringId === d.id ? <span className="spin" /> : '↩️ Restaurează'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && hasMore && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '.75rem', borderTop: '1px solid var(--s100)' }}>
                <button className="btn btn-ghost btn-sm" disabled={loadingMore} onClick={() => loadMore(workspaceId)}>
                  {loadingMore ? 'Se încarcă...' : 'Încarcă mai multe'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
