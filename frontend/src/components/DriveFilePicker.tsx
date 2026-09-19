import { useEffect, useRef, useState } from 'react'
import { extractFile } from '../lib/api'
import type { IDFields } from '../lib/api'
import { DriveError, driveDownload } from '../lib/drive'
import { PickerNotConfigured, pickIdDocument, pickerConfigured } from '../lib/picker'
import type { ToastItem } from '../types'

interface Props {
  accessToken: string
  onExtracted: (fields: IDFields, filename: string) => void
  onToast: (msg: string, type: ToastItem['type']) => void
  onClose: () => void
}

type Phase = 'idle' | 'picking' | 'downloading' | 'extracting'
const PHASE_TEXT: Record<Phase, string> = {
  idle: '',
  picking: 'Se deschide Google Drive…',
  downloading: 'Se descarcă fișierul ales…',
  extracting: 'Se extrag datele din act…',
}

/** Alege un act de identitate din Google Drive prin Google Picker (aplicația vede doar fișierul ales, nu tot Drive-ul),
 * îl descarcă în browser și îl trimite la OCR ca pe un fișier încărcat. Tokenul Google nu ajunge pe serverele noastre. */
export default function DriveFilePicker({ accessToken, onExtracted, onToast, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const started = useRef(false)
  const configured = pickerConfigured()

  const run = async () => {
    if (!accessToken) { onToast('Autentifică-te din nou pentru a folosi Google Drive.', 'err'); return }
    setPhase('picking')
    try {
      const item = await pickIdDocument(accessToken)
      if (!item) { setPhase('idle'); return }
      setPhase('downloading')
      const f = await driveDownload(item.id, accessToken)
      setPhase('extracting')
      const file = new File([f.blob], f.name, { type: f.mimeType })
      const result = await extractFile(file, 'drive')
      onExtracted(result, item.name)
    } catch (err) {
      const msg = err instanceof PickerNotConfigured || err instanceof DriveError || err instanceof Error ? err.message : 'Extragere eșuată'
      onToast(msg, 'err')
      setPhase('idle')
    }
  }

  useEffect(() => {
    if (started.current || !configured) return
    started.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = phase !== 'idle'
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          <span className="step-chip">1</span>
          Google Drive
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={phase === 'extracting'}>← Încarcă un fișier în schimb</button>
      </div>
      <div className="card-body" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
        {!configured ? (
          <p style={{ color: 'var(--s500)', fontSize: '.875rem', lineHeight: 1.55, margin: 0 }}>
            Alegerea din Google Drive nu este activată pentru această aplicație. Încarcă actul de pe dispozitiv sau cere administratorului aplicației să o activeze.
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--s500)', fontSize: '.875rem', lineHeight: 1.55, margin: '0 0 1rem' }}>
              {busy
                ? <><span className="spin spin-dark" style={{ marginRight: '.5rem' }} />{PHASE_TEXT[phase]}</>
                : 'Aplicația vede doar fișierul pe care îl alegi, nu întreg Drive-ul.'}
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => void run()} disabled={busy}>
              {busy ? 'Se lucrează…' : 'Alege un fișier din Drive'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
