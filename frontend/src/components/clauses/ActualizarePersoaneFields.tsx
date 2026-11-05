import { useState } from 'react'
import type { Client } from '../../types'
import { persoaneActualizate } from '../../lib/placeholders'

interface Props {
  client?: Partial<Client> | null
  rol: 'asociat' | 'administrator'
  /** Eticheta din șablon: completează `${field}_ROL` („asociatului”/„asociaților”) și `${field}` (numele). */
  field: string
  onField: (key: string, value: string) => void
}

/** Persoanele ale căror date se actualizează — bifate din fișa clientului, nu tastate. */
export default function ActualizarePersoaneFields({ client, rol, field, onField }: Props) {
  const persoane = (rol === 'asociat' ? client?.asociati : client?.administratori) ?? []
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const toggle = (i: number) => {
    const next = new Set(checked)
    if (next.has(i)) next.delete(i); else next.add(i)
    setChecked(next)
    const { rol: forma, nume } = persoaneActualizate(persoane.filter((_, idx) => next.has(idx)), rol)
    onField(`${field}_ROL`, forma)
    onField(field, nume)
  }

  return (
    <div className="field">
      <label className="field-label">{rol === 'asociat' ? 'Asociații' : 'Administratorii'} pentru care se actualizează datele</label>
      {persoane.map((p, i) => (
        <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
          {`${p.nume ?? ''} ${p.prenume ?? ''}`.trim() || `${rol === 'asociat' ? 'Asociatul' : 'Administratorul'} ${i + 1}`}
        </label>
      ))}
      {persoane.length === 0 && (
        <p style={{ fontSize: '.78rem', color: 'var(--s400)', marginTop: '.25rem' }}>
          Clientul nu are niciun {rol} înregistrat în profil.
        </p>
      )}
    </div>
  )
}
