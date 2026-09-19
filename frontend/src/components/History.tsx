import { useState, useEffect } from 'react'
import type { User } from 'firebase/auth'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import Modal from './Modal'

interface Extraction {
  id: string
  sourceFile: string
  seconds: number | null
}

interface Props {
  user: User
  open: boolean
  onClose: () => void
}

export default function History({ user, open, onClose }: Props) {
  const [items, setItems] = useState<Extraction[]>([])
  const [loading, setLoading] = useState(true)

  // Abonare la extracțiile recente din Firestore, cât timp panoul e deschis.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
          sourceFile: (data.sourceFile as string) ?? 'Necunoscut',
          seconds: (data.createdAt as { seconds: number } | null)?.seconds ?? null,
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
    <Modal
      onClose={onClose}
      ariaLabel="Istoric extrageri"
      backdropStyle={{ background: 'rgba(15,23,42,.25)', backdropFilter: 'blur(2px)' }}
      boxStyle={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 340,
        borderRadius: 0, boxShadow: 'var(--sh-xl)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideUp .2s var(--ease)',
      }}
    >
        <div style={{ padding: '1.125rem 1.5rem', borderBottom: '1px solid var(--s200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: '.9375rem', color: 'var(--s900)' }}>Istoric extrageri</span>
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
              Nicio extragere încă
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
              {items.map(item => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: '.2rem', alignItems: 'flex-start',
                    padding: '.75rem', borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--s200)', width: '100%',
                  }}
                >
                  <span style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--s800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                    {item.sourceFile}
                  </span>
                  {item.seconds && <span style={{ fontSize: '.72rem', color: 'var(--s400)' }}>{formatDate(item.seconds)}</span>}
                </div>
              ))}
              <p style={{ fontSize: '.72rem', color: 'var(--s400)', margin: '.5rem 0 0' }}>
                Istoricul păstrează doar numele sursei și data, timp de 30 de zile. Datele personale extrase nu se salvează aici.
              </p>
            </div>
          )}
        </div>
    </Modal>
  )
}
