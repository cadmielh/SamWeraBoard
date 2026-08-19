import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Client } from '../../types'
import { EMPTY_PERSOANA } from '../../lib/clienti'
import type { ClientPatchProposal } from '../../lib/clauseFieldSpecs'

interface Props {
  client?: Partial<Client> | null
  fields: Record<string, string>
  onField: (key: string, value: string) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
}

export default function SchimbareAdministratorFields({ client, fields, onField, onClientPatch }: Props) {
  const administratori = client?.administratori ?? []
  const [nouNume, setNouNume] = useState('')
  const [nouPrenume, setNouPrenume] = useState('')

  useEffect(() => {
    if (!fields.DURATA_MANDAT_ANI) onField('DURATA_MANDAT_ANI', '99')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const vechi = fields.ADMINISTRATOR_VECHI_NUME
    const nouComplet = `${nouNume} ${nouPrenume}`.trim()
    if (!vechi && !nouComplet) { onClientPatch(null); return }
    const ramasi = administratori.filter(a => `${a.nume} ${a.prenume}`.trim() !== vechi)
    const noi = nouComplet ? [...ramasi, { ...EMPTY_PERSOANA, calitate: 'Administrator', nume: nouNume, prenume: nouPrenume }] : ramasi
    onClientPatch({
      label: `Schimbă administrator: ${vechi || '—'} → ${nouComplet || '—'}`,
      patch: { administratori: noi },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.ADMINISTRATOR_VECHI_NUME, nouNume, nouPrenume])

  const handleNouChange = (nume: string, prenume: string) => {
    setNouNume(nume); setNouPrenume(prenume)
    onField('ADMINISTRATOR_NOU_NUME', `${nume} ${prenume}`.trim())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div>
        <label style={LABEL}>Administrator care se retrage</label>
        <select style={INPUT} value={fields.ADMINISTRATOR_VECHI_NUME ?? ''} onChange={e => onField('ADMINISTRATOR_VECHI_NUME', e.target.value)}>
          <option value="">— alege —</option>
          {administratori.map((a, i) => (
            <option key={i} value={`${a.nume} ${a.prenume}`.trim()}>{a.nume} {a.prenume}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: '.5rem' }}>
        <div style={{ flex: 1 }}>
          <label style={LABEL}>Nume administrator nou</label>
          <input style={INPUT} value={nouNume} onChange={e => handleNouChange(e.target.value, nouPrenume)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={LABEL}>Prenume administrator nou</label>
          <input style={INPUT} value={nouPrenume} onChange={e => handleNouChange(nouNume, e.target.value)} />
        </div>
      </div>
      <div>
        <label style={LABEL}>Durata mandatului (ani)</label>
        <input style={INPUT} value={fields.DURATA_MANDAT_ANI ?? '99'} onChange={e => onField('DURATA_MANDAT_ANI', e.target.value)} />
      </div>
    </div>
  )
}

const LABEL: CSSProperties = { fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.04em', textTransform: 'uppercase', display: 'block', marginBottom: '.25rem' }
const INPUT: CSSProperties = { padding: '.375rem .625rem', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--s300)', fontSize: '.85rem', color: 'var(--s800)', background: '#fff', width: '100%', fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box' }
