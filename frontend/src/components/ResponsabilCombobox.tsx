import type { Workspace } from '../types'
import Combobox from './Combobox'

interface Props {
  workspace: Workspace | null
  /** Numele afișat — al membrului legat sau textul liber. */
  value: string
  onChange: (uid: string | null, nume: string) => void
  disabled?: boolean
}

/**
 * Combobox pentru "Responsabil" — alegi un membru existent al workspace-ului
 * (leagă `uid`) SAU scrii orice nume, fără cont în aplicație (doar text,
 * `uid: null`). Spre deosebire de client, aici nu există un flux de "upgrade"
 * — accesul în aplicație se dă doar prin invitație pe email, deci un nume
 * liber rămâne mereu text liber.
 */
export default function ResponsabilCombobox({ workspace, value, onChange, disabled }: Props) {
  const members = Object.entries(workspace?.members ?? {})
  const options = members.map(([, m]) => m.displayName || m.email)

  return (
    <Combobox
      value={value}
      options={options}
      disabled={disabled}
      placeholder="Membru existent sau nume liber"
      onChange={val => {
        const match = members.find(([, m]) => (m.displayName || m.email) === val)
        onChange(match ? match[0] : null, val)
      }}
    />
  )
}
