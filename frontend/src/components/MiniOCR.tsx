import { useState, useRef } from 'react'
import type { IDFields } from '../lib/api'
import { extractFile } from '../lib/api'
import { useApp } from '../AppContext'

interface Props {
  /** Poate întoarce mesajul de confirmare (ex. câte câmpuri s-au completat); altfel, mesajul generic. */
  onExtracted: (fields: IDFields) => string | void
  onDrivePick?: () => void
  /** Doar butonul, fără zona de tras fișierul și fără „sau completează manual” — pentru formularele cu puține câmpuri. */
  compact?: boolean
}

export default function MiniOCR({ onExtracted, onDrivePick, compact }: Props) {
  const { toast } = useApp()
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const process = async (file: File) => {
    setLoading(true)
    try {
      const fields = await extractFile(file)
      toast(onExtracted(fields) || 'Câmpuri extrase cu succes', 'ok')
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Extragere eșuată', 'err')
    } finally {
      setLoading(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void process(file)
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void process(file)
    e.target.value = ''
  }

  if (compact) {
    return (
      <div>
        <button type="button" className="btn btn-outline-primary btn-xs" onClick={() => inputRef.current?.click()} disabled={loading}>
          {loading ? <><span className="spin spin-dark" />Se extrage...</> : '📷 Preia din buletin (scanare)'}
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style={{ display: 'none' }} onChange={onFileChange} />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '.625rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
        >
          {loading ? <><span className="spin spin-dark" />Se extrage...</> : '📷 Scanează buletin'}
        </button>
        {onDrivePick && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDrivePick} disabled={loading}>
            🗂️ Din Google Drive
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
      </div>

      <div
        className={`mini-ocr-zone${dragging ? ' dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{ cursor: 'pointer' }}
      >
        {loading
          ? <><span className="spin spin-dark" style={{ verticalAlign: 'middle', marginRight: '.375rem' }} />Se procesează imaginea...</>
          : 'Trage buletin aici sau apasă butoanele de mai sus'
        }
      </div>

      <div className="mini-ocr-divider">sau completează manual</div>
    </div>
  )
}
