import type { Workspace } from '../types'

interface Props {
  workspace: Workspace | null
  value: string | null   // uid
  onChange: (uid: string, displayName: string) => void
  placeholder?: string
  disabled?: boolean
}

/** Select peste membrii workspace-ului activ — sursă unică pentru "Responsabil"
 * (Dosare) și "Assignee" (Sarcini), în loc de o listă hardcodată de nume. */
export default function MemberSelect({ workspace, value, onChange, placeholder = '— alege —', disabled }: Props) {
  const members = Object.entries(workspace?.members ?? {})

  return (
    <select
      className="field-input"
      value={value ?? ''}
      disabled={disabled || members.length === 0}
      onChange={e => {
        const uid = e.target.value
        const member = workspace?.members[uid]
        if (uid && member) onChange(uid, member.displayName || member.email)
      }}
    >
      <option value="">{placeholder}</option>
      {members.map(([uid, m]) => (
        <option key={uid} value={uid}>{m.displayName || m.email}</option>
      ))}
    </select>
  )
}
