import { useState } from 'react'

interface Props {
  onAdd: (titlu: string) => Promise<void>
}

/** Captură cu frecare minimă: doar titlul, Enter salvează instant o sarcină
 * minimă (assignee = userul curent, prioritate Medie, fără termen) — restul
 * se completează ulterior din TaskModal. */
export default function QuickAddRow({ onAdd }: Props) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const titlu = value.trim()
    if (!titlu || saving) return
    setSaving(true)
    try {
      await onAdd(titlu)
      setValue('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="kanban-quickadd">
      <input
        className="field-input"
        placeholder="+ Sarcină rapidă — scrie și apasă Enter"
        value={value}
        disabled={saving}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
      />
    </div>
  )
}
