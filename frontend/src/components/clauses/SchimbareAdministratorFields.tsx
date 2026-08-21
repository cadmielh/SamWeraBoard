import { useEffect, useState } from 'react'
import type { Client, Persoana } from '../../types'
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
  const vechiNume = fields.ADMINISTRATOR_VECHI_NUME ?? ''

  // Candidați pentru "administrator nou" — asociați + administratori
  // existenți (poate fi oricare), fără cel care tocmai se retrage.
  const candidati: Persoana[] = []
  const seen = new Set<string>()
  for (const p of [...(client?.asociati ?? []), ...administratori]) {
    const numeComplet = `${p.nume} ${p.prenume}`.trim()
    if (!numeComplet || numeComplet === vechiNume || seen.has(numeComplet)) continue
    seen.add(numeComplet)
    candidati.push(p)
  }

  const [nouMode, setNouMode] = useState<'existent' | 'nou'>('existent')
  const [nouNume, setNouNume] = useState('')
  const [nouPrenume, setNouPrenume] = useState('')

  useEffect(() => {
    if (!fields.DURATA_MANDAT_ANI) onField('DURATA_MANDAT_ANI', '99')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const nouComplet = nouMode === 'nou' ? `${nouNume} ${nouPrenume}`.trim() : (fields.ADMINISTRATOR_NOU_NUME ?? '')
    if (!vechiNume && !nouComplet) { onClientPatch(null); return }
    const ramasi = administratori.filter(a => `${a.nume} ${a.prenume}`.trim() !== vechiNume)
    let noi: Persoana[] = ramasi
    if (nouComplet) {
      const existent = nouMode === 'existent' ? candidati.find(c => `${c.nume} ${c.prenume}`.trim() === nouComplet) : undefined
      noi = [...ramasi, { ...(existent ?? EMPTY_PERSOANA), calitate: 'Administrator', nume: existent?.nume ?? nouNume, prenume: existent?.prenume ?? nouPrenume }]
    }
    onClientPatch({
      label: `Schimbă administrator: ${vechiNume || '—'} → ${nouComplet || '—'}`,
      patch: { administratori: noi },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vechiNume, nouMode, nouNume, nouPrenume, fields.ADMINISTRATOR_NOU_NUME])

  const handleNouExistentChange = (numeComplet: string) => onField('ADMINISTRATOR_NOU_NUME', numeComplet)

  const handleNouNouChange = (nume: string, prenume: string) => {
    setNouNume(nume); setNouPrenume(prenume)
    onField('ADMINISTRATOR_NOU_NUME', `${nume} ${prenume}`.trim())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div className="field">
        <label className="field-label">Administrator care se retrage</label>
        <select className="field-input" value={vechiNume} onChange={e => onField('ADMINISTRATOR_VECHI_NUME', e.target.value)}>
          <option value="">— alege —</option>
          {administratori.map((a, i) => (
            <option key={i} value={`${a.nume} ${a.prenume}`.trim()}>{a.nume} {a.prenume}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label">Administrator nou</label>
        <div style={{ display: 'flex', gap: '.375rem', marginBottom: '.3rem' }}>
          <button type="button" className={`btn btn-sm ${nouMode === 'existent' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setNouMode('existent')}>Persoană existentă</button>
          <button type="button" className={`btn btn-sm ${nouMode === 'nou' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setNouMode('nou')}>+ Persoană nouă</button>
        </div>
        {nouMode === 'existent' ? (
          <select className="field-input" value={fields.ADMINISTRATOR_NOU_NUME ?? ''} onChange={e => handleNouExistentChange(e.target.value)}>
            <option value="">— alege —</option>
            {candidati.map((p, i) => (
              <option key={i} value={`${p.nume} ${p.prenume}`.trim()}>{p.nume} {p.prenume}</option>
            ))}
          </select>
        ) : (
          <div style={{ display: 'flex', gap: '.375rem' }}>
            <input className="field-input" placeholder="Nume" value={nouNume} onChange={e => handleNouNouChange(e.target.value, nouPrenume)} />
            <input className="field-input" placeholder="Prenume" value={nouPrenume} onChange={e => handleNouNouChange(nouNume, e.target.value)} />
          </div>
        )}
      </div>

      <div className="field">
        <label className="field-label">Durata mandatului (ani)</label>
        <input className="field-input" value={fields.DURATA_MANDAT_ANI ?? '99'} onChange={e => onField('DURATA_MANDAT_ANI', e.target.value)} />
      </div>
    </div>
  )
}
