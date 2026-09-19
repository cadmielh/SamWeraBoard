import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import {
  CATEGORY_LABELS, actionLabel, categoryOf, describe, fetchAudit, toCsv,
  type AuditEntry, type CategoryFilter,
} from '../lib/audit'

const PAGE = 100

/** Jurnalul de acces al spațiului de lucru (doar administratori): cine a scanat acte, a văzut CNP-uri,
 * a generat documente sau a modificat accesul. Nu conține valorile datelor personale. */
export default function AuditLogCard() {
  const { activeWorkspace } = useApp()
  const wid = activeWorkspace?.id ?? ''
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [category, setCategory] = useState<CategoryFilter>('toate')

  const nameOf = useCallback((uid: string): string => {
    if (uid === 'system') return 'Sistem'
    const m = activeWorkspace?.members?.[uid]
    return m ? (m.displayName || m.email || uid) : `Utilizator eliminat (${uid.slice(0, 6)}…)`
  }, [activeWorkspace])

  const load = useCallback(async () => {
    if (!wid) return
    setLoading(true); setError(false)
    try {
      const rows = await fetchAudit(wid, { limit: PAGE })
      setEntries(rows); setHasMore(rows.length === PAGE)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [wid])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const loadMore = async () => {
    const last = entries[entries.length - 1]
    if (!wid || !last?.ts) return
    setLoadingMore(true)
    try {
      const rows = await fetchAudit(wid, { limit: PAGE, before: last.ts })
      setEntries(prev => [...prev, ...rows]); setHasMore(rows.length === PAGE)
    } catch {
      setError(true)
    } finally {
      setLoadingMore(false)
    }
  }

  const visible = useMemo(
    () => category === 'toate' ? entries : entries.filter(e => categoryOf(e.action) === category),
    [entries, category],
  )

  const exportCsv = () => {
    const blob = new Blob([toCsv(visible, nameOf)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jurnal-acces-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '.5rem', borderBottom: '1px solid var(--s200)', fontWeight: 700, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '.5rem', borderBottom: '1px solid var(--s100)', verticalAlign: 'top' }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">🔎 Jurnal de acces</span>
        <div style={{ display: 'flex', gap: '.375rem' }}>
          <button className="btn btn-ghost btn-xs" onClick={() => void load()} disabled={loading}>Reîmprospătează</button>
          <button className="btn btn-ghost btn-xs" onClick={exportCsv} disabled={visible.length === 0}>Exportă CSV</button>
        </div>
      </div>
      <div className="card-body">
        <p className="card-sub" style={{ marginTop: 0, marginBottom: '.75rem' }}>
          Cine a scanat acte, a văzut CNP-uri, a generat documente sau a modificat accesul în acest spațiu de lucru. Jurnalul se păstrează
          aproximativ 13 luni și nu conține valorile datelor personale, doar acțiunea, momentul și metadate.
        </p>

        <select className="field-input" style={{ width: 'auto', marginBottom: '.75rem' }} value={category}
          onChange={e => setCategory(e.target.value as CategoryFilter)} aria-label="Filtrează după tip de acțiune">
          {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map(k => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
        </select>

        {loading ? (
          <div style={{ padding: '1.5rem', textAlign: 'center' }}><span className="spin spin-dark" /></div>
        ) : error && entries.length === 0 ? (
          <div style={{ color: 'var(--r500)', fontSize: '.875rem' }}>
            Nu s-a putut încărca jurnalul. <button className="btn btn-ghost btn-xs" onClick={() => void load()}>Reîncearcă</button>
          </div>
        ) : visible.length === 0 ? (
          <div style={{ color: 'var(--s400)', fontSize: '.875rem', padding: '1rem 0' }}>Nicio înregistrare pentru filtrul ales.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
              <thead>
                <tr>{['Data și ora', 'Utilizator', 'Acțiune', 'Detalii', 'IP'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {visible.map(e => (
                  <tr key={e.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{e.ts ? new Date(e.ts).toLocaleString('ro-RO') : '—'}</td>
                    <td style={td}>{nameOf(e.actorUid)}</td>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--s800)' }}>{actionLabel(e.action)}</td>
                    <td style={{ ...td, color: 'var(--s600)' }}>{describe(e, nameOf)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--s400)' }}>{e.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && !loading && (
          <div style={{ marginTop: '.75rem', textAlign: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? <span className="spin" /> : 'Încarcă mai multe'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
