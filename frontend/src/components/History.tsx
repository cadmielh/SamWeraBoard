import { useState, useEffect } from 'react'
import type { User } from 'firebase/auth'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { IDFields } from '../lib/api'

interface Extraction {
  id: string
  sourceFile: string
  seconds: number | null
  fields: IDFields
}

interface Props {
  user: User
  open: boolean
  onSelect: (fields: IDFields, filename: string) => void
  onClose: () => void
}

export default function History({ user, open, onSelect, onClose }: Props) {
  const [items, setItems] = useState<Extraction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const q = query(
      collection(db, 'users', user.uid, 'extractions'),
      orderBy('createdAt', 'desc'),
      limit(30),
    )
    const unsub = onSnapshot(q, snap => {
      setItems(snap.docs.map(d => {
        const data = d.data()
        return {
          id: d.id,
          sourceFile: (data.sourceFile as string) ?? 'Unknown',
          seconds: (data.createdAt as { seconds: number } | null)?.seconds ?? null,
          fields: data.fields as IDFields,
        }
      }))
      setLoading(false)
    })
    return unsub
  }, [user.uid, open])

  if (!open) return null

  const formatDate = (seconds: number | null) => {
    if (!seconds) return ''
    return new Date(seconds * 1000).toLocaleDateString('ro-RO', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.25)', zIndex: 200, backdropFilter: 'blur(2px)' }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 340,
        background: '#fff', boxShadow: 'var(--sh-xl)', zIndex: 201,
        display: 'flex', flexDirection: 'column',
        animation: 'slideUp .2s var(--ease)',
      }}>
        <div style={{ padding: '1.125rem 1.5rem', borderBottom: '1px solid var(--s200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: '.9375rem', color: 'var(--s900)' }}>Extraction History</span>
          <button className="btn btn-ghost btn-xs" onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 60, borderRadius: 'var(--r-sm)', background: 'linear-gradient(90deg,var(--s100) 25%,var(--s50) 50%,var(--s100) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--s400)', padding: '2.5rem 1rem', fontSize: '.875rem' }}>
              No extractions yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
              {items.map(item => (
                <button
                  key={item.id}
                  onClick={() => { onSelect(item.fields, item.sourceFile); onClose() }}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: '.2rem', alignItems: 'flex-start',
                    padding: '.75rem', borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--s200)', background: 'transparent',
                    cursor: 'pointer', textAlign: 'left', transition: 'all var(--t)', width: '100%',
                    fontFamily: 'var(--font)',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--p50)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--p200)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--s200)' }}
                >
                  <span style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--s800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                    {item.fields.nume} {item.fields.prenume}
                  </span>
                  <span style={{ fontSize: '.72rem', color: 'var(--s400)' }}>
                    {item.sourceFile}{item.seconds ? ` · ${formatDate(item.seconds)}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
