import { useState, useEffect, useCallback } from 'react'
import type { Sarcina, SarcinaStatus } from '../../types'
import { PRIORITATE_LABELS, PRIORITATE_COLOR, SARCINA_STATUS_LABELS } from '../../types'
import { useArchivedSarcini } from '../../lib/sarcini'
import { useApp } from '../../AppContext'
import { formatDateRo, toDateSafe } from '../../lib/dates'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function fmtCompletedAt(value: unknown): string {
  const d = toDateSafe(value)
  return d ? formatDateRo(d) : '—'
}

const RESTORE_STATUS_OPTIONS: SarcinaStatus[] = ['deschis', 'in_lucru']

interface Props {
  /** Incrementat de SarciniPage după o arhivare reușită (din TaskCard), ca
   * noul item să apară fără reload — hook-ul de dedesubt e one-shot. */
  refreshKey?: number
}

/**
 * Secțiune pliabilă de arhivă, jos de tot pe SarciniPage — nu mai e pagină
 * separată (fostul ArchivedTasksView + ruta /sarcini/arhiva). Sarcinile
 * finalizate ajung aici automat la finalul săptămânii (useArchivedSarcini),
 * sau imediat dacă au fost arhivate manual din TaskCard.
 */
export default function ArchivedSarciniSection({ refreshKey = 0 }: Props) {
  const { activeWorkspace, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const { sarcini, loading, loadingMore, hasMore, loadMore, search, restore } = useArchivedSarcini(workspaceId, refreshKey)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Sarcina[] | null>(null)
  const debouncedQ = useDebounce(query, 300)
  const [restoreStatus, setRestoreStatus] = useState<Record<string, SarcinaStatus>>({})

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!workspaceId || debouncedQ.trim().length < 2) { setSearchResults(null); return }
    search(workspaceId, debouncedQ).then(setSearchResults).catch(() => {})
  }, [debouncedQ, workspaceId, search])

  const displayed = searchResults ?? sarcini

  const handleRestore = useCallback(async (s: Sarcina) => {
    if (!workspaceId) return
    const target = restoreStatus[s.id] ?? 'deschis'
    await restore(workspaceId, s.id, target, Date.now())
    toast(`Sarcină restaurată — ${SARCINA_STATUS_LABELS[target]}`, 'ok')
  }, [workspaceId, restore, toast, restoreStatus])

  if (!workspaceId) return null

  return (
    <div className="card" style={{ marginTop: '1rem', flexShrink: 0 }}>
      <button
        type="button"
        className="card-head"
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', padding: '1rem 1.125rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
      >
        <span className="card-title">🗄 Arhivă sarcini{sarcini.length > 0 ? ` · ${sarcini.length}${hasMore ? '+' : ''}` : ''}</span>
        <span style={{ color: 'var(--s400)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--t)' }}>▾</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--s200)' }}>
          <div style={{ padding: '.875rem 1.125rem 0' }}>
            <div className="search-box">
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="var(--s400)" strokeWidth="2" strokeLinecap="round">
                <circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" />
              </svg>
              <input placeholder="Caută în arhivă după titlu..." value={query} onChange={e => setQuery(e.target.value)} />
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
                      {['Titlu', 'Client', 'Prioritate', 'Finalizat', ''].map(h => (
                        <th key={h} style={{ padding: '.5rem .75rem', textAlign: 'left', fontWeight: 700, color: 'var(--s500)', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map(s => (
                      <tr key={s.id} style={{ borderBottom: '1px solid var(--s100)' }}>
                        <td style={{ padding: '.625rem .75rem', fontWeight: 600, color: 'var(--s900)' }}>{s.titlu}</td>
                        <td style={{ padding: '.625rem .75rem', color: 'var(--s500)' }}>{s.clientDenumire || s.clientDenumireLibera || '—'}</td>
                        <td style={{ padding: '.625rem .75rem' }}><span className={`chip priority-chip-${PRIORITATE_COLOR[s.prioritate]}`}>{PRIORITATE_LABELS[s.prioritate]}</span></td>
                        <td style={{ padding: '.625rem .75rem', color: 'var(--s500)' }}>{fmtCompletedAt(s.completedAt)}</td>
                        <td style={{ padding: '.625rem .75rem', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
                            <select
                              className="field-input"
                              style={{ padding: '.2rem .4rem', fontSize: '.75rem' }}
                              value={restoreStatus[s.id] ?? 'deschis'}
                              onChange={e => setRestoreStatus(prev => ({ ...prev, [s.id]: e.target.value as SarcinaStatus }))}
                            >
                              {RESTORE_STATUS_OPTIONS.map(st => (
                                <option key={st} value={st}>{SARCINA_STATUS_LABELS[st]}</option>
                              ))}
                            </select>
                            <button className="btn btn-ghost btn-xs" onClick={() => handleRestore(s)}>↩️ Restaurează</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && searchResults === null && hasMore && (
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
