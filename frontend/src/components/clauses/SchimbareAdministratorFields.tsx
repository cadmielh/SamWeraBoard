import { useEffect, useState } from 'react'
import type { Client, Persoana } from '../../types'
import { EMPTY_PERSOANA } from '../../lib/clienti'
import type { ClientPatchProposal } from '../../lib/clauseFieldSpecs'
import { avertizareMandat, durataComuna, durataFraza, durataScurta, mandatImplicit, tipuriMandat, type Durata, type Mandat } from '../../lib/durata'
import DurataFields from './DurataFields'
import MiniOCR from '../MiniOCR'

interface Props {
  client?: Partial<Client> | null
  fields: Record<string, string>
  onField: (key: string, value: string) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
  /** Șablonul scrie durata ca frază ({{DURATA_MANDAT_NOU_TEXT}}, poate fi și nedeterminată); altfel doar anii
   * („pe o durată de {{DURATA_MANDAT_ANI}} de ani”, șabloanele mai vechi). */
  durataCompleta?: boolean
  /** Data hotărârii — de la ea curge mandatul noului administrator. */
  dataDocument: string
}

export default function SchimbareAdministratorFields({ client, fields, onField, onClientPatch, durataCompleta, dataDocument }: Props) {
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

  // Varianta cu frază pornește de la mandatul actual al administratorilor (dacă e același la toți), altfel de la cel implicit
  const [durata, setDurata] = useState<Durata>(() => durataComuna(administratori) ?? mandatImplicit(client?.formaJuridica).durata)

  // Doar eticheta clauzei: {{DURATA_MANDAT}}/{{DURATA_MANDAT_TEXT}} pot fi ale clauzei „Durata mandat administrator” din același act
  const setDurataFields = (d: Durata) => onField('DURATA_MANDAT_NOU_TEXT', durataFraza(d))

  useEffect(() => {
    if (durataCompleta) setDurataFields(durata)
    else if (!fields.DURATA_MANDAT_ANI) onField('DURATA_MANDAT_ANI', '99')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const durataAleasa: Durata = durataCompleta ? durata : { tip: 'ani', ani: fields.DURATA_MANDAT_ANI ?? '', data: '' }
  const mandatNou: Mandat = { durata: durataAleasa, inceput: 'data', dataNumire: dataDocument }
  const avertizare = avertizareMandat(client?.formaJuridica, mandatNou)

  useEffect(() => {
    const nouComplet = nouMode === 'nou' ? `${nouNume} ${nouPrenume}`.trim() : (fields.ADMINISTRATOR_NOU_NUME ?? '')
    if (!vechiNume && !nouComplet) { onClientPatch(null); return }
    // Peste fișa din acel moment (vezi ClientPatchProposal.update): lista poate fi deja schimbată de altă clauză
    const aplica = (current: Partial<Client>): Persoana[] => {
      const ramasi = (current.administratori ?? []).filter(a => ![vechiNume, nouComplet].includes(`${a.nume} ${a.prenume}`.trim()))
      if (!nouComplet) return ramasi
      const existent = nouMode === 'existent'
        ? [...(current.asociati ?? []), ...(current.administratori ?? [])].find(c => `${c.nume} ${c.prenume}`.trim() === nouComplet)
        : undefined
      return [...ramasi, {
        ...(existent ?? EMPTY_PERSOANA), calitate: 'Administrator', cotaParticipare: '',
        nume: existent?.nume ?? nouNume, prenume: existent?.prenume ?? nouPrenume,
        ...(durataScurta(durataAleasa) ? { mandat: mandatNou } : {}),
      }]
    }
    onClientPatch({
      label: `Schimbă administrator: ${vechiNume || '—'} → ${nouComplet || '—'}${nouComplet && durataFraza(durataAleasa) ? `, mandat ${durataFraza(durataAleasa)}` : ''}`,
      patch: { administratori: aplica(client ?? {}) },
      update: current => ({ administratori: aplica(current) }),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vechiNume, nouMode, nouNume, nouPrenume, fields.ADMINISTRATOR_NOU_NUME, fields.DURATA_MANDAT_ANI, durata, durataCompleta, dataDocument])

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
          <>
            <MiniOCR compact onExtracted={f => handleNouNouChange(f.nume || nouNume, f.prenume || nouPrenume)} />
            <div style={{ display: 'flex', gap: '.375rem', marginTop: '.3rem' }}>
              <input className="field-input" placeholder="Nume" value={nouNume} onChange={e => handleNouNouChange(e.target.value, nouPrenume)} />
              <input className="field-input" placeholder="Prenume" value={nouPrenume} onChange={e => handleNouNouChange(nouNume, e.target.value)} />
            </div>
          </>
        )}
      </div>

      {durataCompleta ? (
        <div className="field">
          <label className="field-label">Durata mandatului</label>
          <DurataFields tipuri={tipuriMandat(client?.formaJuridica)} value={durata} onChange={d => { setDurata(d); setDurataFields(d) }} />
          <span style={{ fontSize: '.75rem', color: 'var(--s500)' }}>Mandatul curge de la data hotărârii ({dataDocument}).</span>
        </div>
      ) : (
        <div className="field">
          <label className="field-label">Durata mandatului (ani)</label>
          <input className="field-input" value={fields.DURATA_MANDAT_ANI ?? '99'} onChange={e => onField('DURATA_MANDAT_ANI', e.target.value)} />
        </div>
      )}
      {avertizare && <span style={{ fontSize: '.75rem', color: 'var(--y700)' }}>⚠ {avertizare}</span>}
    </div>
  )
}
