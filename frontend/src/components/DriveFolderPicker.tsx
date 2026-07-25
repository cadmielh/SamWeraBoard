import { useState, useEffect, useCallback } from 'react'
import { listDriveFiles } from '../lib/api'
import type { DriveFile } from '../lib/api'
import type { ToastItem } from '../types'

interface Crumb { id: string; name: string }

interface Props {
  accessToken: string
  onSelect: (folder: { id: string; name: string } | null) => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

export default function DriveFolderPicker({ accessToken, onSelect, onToast }: Props) {
  const [files, setFiles] = useState<DriveFile[]>([])
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: 'root', name: 'Drive-ul meu' }])
  const [loading, setLoading] = useState(false)
  const [nextPage, setNextPage] = useState<string | undefined>()

  const currentFolder = crumbs[crumbs.length - 1]

  const loadFiles = useCallback(async (folderId: string, pageToken?: string) => {
    if (!accessToken) return
    setLoading(true)
    try {
      const result = await listDriveFiles(accessToken, folderId, pageToken)
      const folders = result.files.filter(f => f.is_folder)
      setFiles(prev => pageToken ? [...prev, ...folders] : folders)
      setNextPage(result.nextPageToken)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Eroare Drive', 'err')
    } finally {
      setLoading(false)
    }
  }, [accessToken, onToast])

  useEffect(() => {
    loadFiles(currentFolder.id)
  }, [currentFolder.id, loadFiles])

  const openFolder = (f: DriveFile) => {
    setCrumbs(c => [...c, { id: f.id, name: f.name }])
    setFiles([])
    setNextPage(undefined)
  }

  const navigateTo = (index: number) => {
    setCrumbs(c => c.slice(0, index + 1))
    setFiles([])
    setNextPage(undefined)
  }

  return (
    <div style={{ border: '1.5px solid var(--s200)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
      {/* Breadcrumb row + confirm button */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '.5rem',
        padding: '.4rem .625rem', background: 'var(--s50)',
        borderBottom: '1px solid var(--s200)', flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, display: 'flex', gap: '.25rem', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
          {crumbs.map((c, i) => (
            <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '.2rem' }}>
              {i > 0 && <span style={{ color: 'var(--s300)', fontSize: '.75rem' }}>›</span>}
              <button
                onClick={() => navigateTo(i)}
                style={{
                  background: 'none', border: 'none', fontFamily: 'var(--font)',
                  cursor: i < crumbs.length - 1 ? 'pointer' : 'default',
                  color: i < crumbs.length - 1 ? 'var(--p600)' : 'var(--s700)',
                  fontWeight: i === crumbs.length - 1 ? 600 : 400,
                  fontSize: '.8rem', padding: '.1rem .2rem',
                }}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>
        <button
          className="btn btn-success btn-sm"
          style={{ flexShrink: 0 }}
          onClick={() => onSelect(currentFolder.id === 'root' ? null : currentFolder)}
        >
          Selectează aici
        </button>
      </div>

      {/* Folder list */}
      <div style={{ maxHeight: 200, overflowY: 'auto', padding: '.25rem' }}>
        {loading && files.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem', padding: '.375rem' }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                height: 34, borderRadius: 'var(--r-sm)',
                background: 'linear-gradient(90deg,var(--s100) 25%,var(--s50) 50%,var(--s100) 75%)',
                backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
              }} />
            ))}
          </div>
        ) : files.length === 0 && !loading ? (
          <div style={{ textAlign: 'center', color: 'var(--s400)', padding: '1rem', fontSize: '.8rem' }}>
            Niciun subfolder aici
          </div>
        ) : (
          files.map(f => (
            <button
              key={f.id}
              onClick={() => openFolder(f)}
              style={{
                display: 'flex', alignItems: 'center', gap: '.5rem',
                padding: '.375rem .5rem', borderRadius: 'var(--r-sm)',
                background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left', width: '100%',
                fontFamily: 'var(--font)', transition: 'background var(--t)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--s100)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >
              <span style={{ fontSize: '.9rem', flexShrink: 0 }}>
                {f.id === 'sharedWithMe' ? '🤝' : '📁'}
              </span>
              <span style={{
                flex: 1, fontSize: '.8rem', color: 'var(--s800)', fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {f.name}
              </span>
              <span style={{ color: 'var(--s300)', fontSize: '.75rem', flexShrink: 0 }}>›</span>
            </button>
          ))
        )}

        {nextPage && (
          <div style={{ textAlign: 'center', padding: '.375rem' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => loadFiles(currentFolder.id, nextPage)}
              disabled={loading}
            >
              {loading ? 'Se încarcă…' : 'Încarcă mai multe'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
