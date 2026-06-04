import { useState, useEffect, useCallback } from 'react'
import { listDriveFiles, extractFromDrive } from '../lib/api'
import type { DriveFile, IDFields } from '../lib/api'
import type { ToastItem } from '../types'

interface Props {
  accessToken: string
  onExtracted: (fields: IDFields, filename: string) => void
  onToast: (msg: string, type: ToastItem['type']) => void
  onClose: () => void
}

interface Crumb { id: string; name: string }

export default function DriveFilePicker({ accessToken, onExtracted, onToast, onClose }: Props) {
  const [files, setFiles] = useState<DriveFile[]>([])
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: 'root', name: 'My Drive' }])
  const [loading, setLoading] = useState(false)
  const [extracting, setExtracting] = useState<string | null>(null)
  const [nextPage, setNextPage] = useState<string | undefined>()

  const currentFolder = crumbs[crumbs.length - 1]

  const loadFiles = useCallback(async (folderId: string, pageToken?: string) => {
    if (!accessToken) return
    setLoading(true)
    try {
      const result = await listDriveFiles(accessToken, folderId, pageToken)
      setFiles(prev => pageToken ? [...prev, ...result.files] : result.files)
      setNextPage(result.nextPageToken)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Drive error', 'err')
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

  const handleFileClick = async (f: DriveFile) => {
    if (f.is_folder) { openFolder(f); return }
    setExtracting(f.id)
    try {
      const result = await extractFromDrive(f.id, accessToken)
      onExtracted(result, f.name)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Extraction failed', 'err')
    } finally {
      setExtracting(null)
    }
  }

  const fileIcon = (f: DriveFile) => {
    if (f.id === 'sharedWithMe') return '🤝'
    if (f.is_folder) return '📁'
    if (f.mimeType.includes('image')) return '🖼'
    if (f.mimeType.includes('pdf')) return '📄'
    return '📎'
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          <span className="step-chip">1</span>
          Google Drive
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>← Upload a file instead</button>
      </div>
      <div className="card-body">
        {/* Breadcrumb */}
        <div style={{ display: 'flex', gap: '.25rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.875rem' }}>
          {crumbs.map((c, i) => (
            <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
              {i > 0 && <span style={{ color: 'var(--s300)', fontSize: '.75rem' }}>›</span>}
              <button
                onClick={() => navigateTo(i)}
                style={{
                  background: 'none', border: 'none',
                  cursor: i < crumbs.length - 1 ? 'pointer' : 'default',
                  color: i < crumbs.length - 1 ? 'var(--p600)' : 'var(--s700)',
                  fontWeight: i === crumbs.length - 1 ? 600 : 400,
                  fontSize: '.8rem', padding: '.1rem .2rem', fontFamily: 'var(--font)',
                }}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        {/* File list */}
        {loading && files.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ height: 44, borderRadius: 'var(--r-sm)', background: 'linear-gradient(90deg,var(--s100) 25%,var(--s50) 50%,var(--s100) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--s400)', padding: '2rem', fontSize: '.875rem' }}>
            This folder is empty
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', maxHeight: 360, overflowY: 'auto' }}>
            {files.map(f => (
              <button
                key={f.id}
                onClick={() => handleFileClick(f)}
                disabled={extracting === f.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '.625rem',
                  padding: '.5rem .625rem', borderRadius: 'var(--r-sm)',
                  background: 'transparent', border: '1px solid transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'all var(--t)', width: '100%',
                  fontFamily: 'var(--font)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--s50)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--s200)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent' }}
              >
                <span style={{ fontSize: '1rem', flexShrink: 0 }}>{fileIcon(f)}</span>
                <span style={{ flex: 1, fontSize: '.875rem', color: 'var(--s800)', fontWeight: f.is_folder ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                {extracting === f.id ? (
                  <span className="spin spin-dark" />
                ) : f.is_folder ? (
                  <span style={{ color: 'var(--s300)', fontSize: '.8rem' }}>›</span>
                ) : (
                  <span style={{ fontSize: '.7rem', color: 'var(--p600)', fontWeight: 600, flexShrink: 0 }}>Extract</span>
                )}
              </button>
            ))}
          </div>
        )}

        {nextPage && (
          <div style={{ marginTop: '.875rem', textAlign: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => loadFiles(currentFolder.id, nextPage)} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
