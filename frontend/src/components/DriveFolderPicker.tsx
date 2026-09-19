import { useEffect, useRef } from 'react'
import { pickFolder, pickerConfigured } from '../lib/picker'
import type { ToastItem } from '../types'

interface Props {
  accessToken: string
  onSelect: (folder: { id: string; name: string } | null) => void
  onCancel?: () => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

/** Alege folderul de destinație prin Google Picker. Se deschide imediat; aplicația primește acces doar la folderul ales. */
export default function DriveFolderPicker({ accessToken, onSelect, onCancel, onToast }: Props) {
  const started = useRef(false)
  const configured = pickerConfigured()

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!configured) {
      onToast('Alegerea folderului din Google Drive nu este activată pentru această aplicație.', 'err')
      onCancel?.()
      return
    }
    pickFolder(accessToken)
      .then(folder => { if (folder) onSelect({ id: folder.id, name: folder.name }); else onCancel?.() })
      .catch(err => { onToast((err as Error).message ?? 'Google Drive indisponibil', 'err'); onCancel?.() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.8125rem', color: 'var(--s500)' }}>
      <span className="spin spin-dark" /> Se deschide Google Drive…
      <button className="btn btn-ghost btn-xs" onClick={() => onCancel?.()}>Anulează</button>
    </div>
  )
}
