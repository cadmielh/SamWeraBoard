import { useState, useRef, useCallback } from 'react'
import { extractFile } from '../lib/api'
import type { IDFields } from '../lib/api'
import type { ToastItem } from '../types'

interface Props {
  accessToken: string
  onExtracted: (fields: IDFields, filename: string) => void
  onToast: (msg: string, type: ToastItem['type']) => void
  onShowDrivePicker: () => void
  onManualEntry: () => void
}

const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf'

export default function UploadZone({ accessToken, onExtracted, onToast, onShowDrivePicker, onManualEntry }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const setFileAndPreview = useCallback((f: File) => {
    setFile(f)
    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f))
    } else {
      setPreview(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) setFileAndPreview(f)
  }, [setFileAndPreview])

  const handleExtract = async () => {
    if (!file) return
    if (!accessToken) { onToast('Please sign in first', 'err'); return }
    setLoading(true)
    try {
      const result = await extractFile(file, accessToken)
      onExtracted(result, file.name)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Extraction failed', 'err')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          <span className="step-chip">1</span>
          Upload ID Card
        </span>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={onManualEntry}>Enter Manually</button>
          <button className="btn btn-outline-primary btn-sm" onClick={onShowDrivePicker}>Browse Drive</button>
        </div>
      </div>
      <div className="card-body">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragging ? 'var(--p500)' : 'var(--s300)'}`,
            borderRadius: 'var(--r-md)', padding: '2.5rem 1.5rem',
            textAlign: 'center', cursor: 'pointer',
            background: dragging ? 'var(--p50)' : 'var(--s50)',
            transition: 'all var(--t)',
          }}
        >
          {preview ? (
            <img src={preview} alt="preview" style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 'var(--r-sm)', marginBottom: '.75rem' }} />
          ) : (
            <div style={{ fontSize: '2.5rem', marginBottom: '.5rem', opacity: .4 }}>⬆</div>
          )}
          <div style={{ fontWeight: 600, color: 'var(--s700)', marginBottom: '.25rem' }}>
            {file ? file.name : 'Drop an ID card here, or click to browse'}
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--s400)' }}>
            {file ? `${(file.size / 1024).toFixed(0)} KB` : 'JPG, PNG, WEBP, PDF supported'}
          </div>
          <input
            ref={inputRef} type="file" accept={ACCEPT} style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) setFileAndPreview(f) }}
          />
        </div>

        {file && (
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setFile(null); setPreview(null) }}>Clear</button>
            <button className="btn btn-primary" onClick={handleExtract} disabled={loading}>
              {loading ? <><span className="spin" />&nbsp;Extracting…</> : 'Extract Fields'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
