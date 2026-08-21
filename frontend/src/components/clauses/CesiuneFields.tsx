import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Client, Persoana } from '../../types'
import { parsePercent } from '../../lib/cota'
import { EMPTY_PERSOANA } from '../../lib/clienti'
import type { ClientPatchProposal } from '../../lib/clauseFieldSpecs'

interface Props {
  client?: Partial<Client> | null
  fields: Record<string, string>
  onField: (key: string, value: string) => void
  rows: Record<string, string>[]
  onRows: (rows: Record<string, string>[]) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
}

/** Best-effort — presupune convenția "NUME PRENUME" folosită peste tot în
 * aplicație; doar pentru rânduri editate manual care nu mai potrivesc nici
 * un asociat existent, nici cesionarul nou introdus prin formular. */
function splitFullName(full: string): { nume: string; prenume: string } {
  const trimmed = full.trim()
  const idx = trimmed.lastIndexOf(' ')
  if (idx === -1) return { nume: trimmed, prenume: '' }
  return { nume: trimmed.slice(0, idx), prenume: trimmed.slice(idx + 1) }
}

function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

/** Scade cota cedentului, o adaugă/majorează pe cea a cesionarului — restul
 * asociaților rămân neschimbați. Rezultatul e mereu editabil manual după. */
function computeStructura(
  asociati: Persoana[], capitalSocial: number,
  cedentNume: string, cesionarNume: string, cesionarIsNew: boolean, nrPartiCedate: number,
): Record<string, string>[] {
  const totalParti = capitalSocial / 10
  const rows = asociati.map(a => ({
    nume: `${a.nume} ${a.prenume}`.trim(),
    parti: Math.round(capitalSocial * parsePercent(a.cotaParticipare) / 100 / 10),
  }))
  const cedentIdx = rows.findIndex(r => r.nume === cedentNume)
  if (cedentIdx >= 0) rows[cedentIdx].parti -= nrPartiCedate

  if (cesionarIsNew) {
    rows.push({ nume: cesionarNume, parti: nrPartiCedate })
  } else {
    const idx = rows.findIndex(r => r.nume === cesionarNume)
    if (idx >= 0) rows[idx].parti += nrPartiCedate
  }

  // Aceleași nume ca în blocul {{#ASOCIATI}} deja existent — nu sinonime noi.
  return rows.filter(r => r.parti > 0).map(r => ({
    NUME: r.nume,
    PARTI_SOCIALE: String(r.parti),
    CAPITAL_SOCIAL: String(r.parti * 10),
    COTA_PARTICIPARE: totalParti > 0 ? String(+(r.parti / totalParti * 100).toFixed(2)) : '0',
  }))
}

export default function CesiuneFields({ client, fields, onField, rows, onRows, onClientPatch }: Props) {
  const asociati = client?.asociati ?? []
  const [cesionarMode, setCesionarMode] = useState<'existent' | 'nou'>('existent')
  const [nouNume, setNouNume] = useState('')
  const [nouPrenume, setNouPrenume] = useState('')

  useEffect(() => {
    if (!fields.VALOARE_NOMINALA) onField('VALOARE_NOMINALA', '10')
    if (!fields.DATA_CONTRACT_CESIUNE) onField('DATA_CONTRACT_CESIUNE', today())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconstruiește client.asociati din structura rezultată — matchat după
  // nume complet cu un asociat existent (păstrându-i CNP/adresă etc.), sau
  // cu cesionarul nou introdus prin formular, ori un fallback minimal.
  useEffect(() => {
    if (rows.length === 0) { onClientPatch(null); return }
    const noua: Persoana[] = rows
      .filter(r => parsePercent(r.COTA_PARTICIPARE ?? '0') > 0 || Number(r.PARTI_SOCIALE ?? '0') > 0)
      .map(r => {
        const existent = asociati.find(a => `${a.nume} ${a.prenume}`.trim() === r.NUME)
        if (existent) return { ...existent, cotaParticipare: r.COTA_PARTICIPARE ?? '' }
        if (cesionarMode === 'nou' && r.NUME === `${nouNume} ${nouPrenume}`.trim()) {
          return { ...EMPTY_PERSOANA, calitate: 'Asociat', nume: nouNume, prenume: nouPrenume, cotaParticipare: r.COTA_PARTICIPARE ?? '' }
        }
        const { nume, prenume } = splitFullName(r.NUME ?? '')
        return { ...EMPTY_PERSOANA, calitate: 'Asociat', nume, prenume, cotaParticipare: r.COTA_PARTICIPARE ?? '' }
      })
    const cesionarNume = cesionarMode === 'nou' ? `${nouNume} ${nouPrenume}`.trim() : (fields.CESIONAR_NUME ?? '')
    onClientPatch({
      label: `Actualizează asociații (cesiune ${fields.NR_PARTI_CEDATE ?? ''} părți către ${cesionarNume})`,
      patch: { asociati: noua },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cesionarMode, nouNume, nouPrenume])

  const handleCesionarNou = (nume: string, prenume: string) => {
    setNouNume(nume); setNouPrenume(prenume)
    onField('CESIONAR_NUME', `${nume} ${prenume}`.trim())
  }

  const handleCalculeaza = () => {
    const capitalSocial = client?.capitalSocial ?? 0
    const nrParti = parseInt(fields.NR_PARTI_CEDATE ?? '0', 10) || 0
    const cesionarNume = cesionarMode === 'nou' ? `${nouNume} ${nouPrenume}`.trim() : (fields.CESIONAR_NUME ?? '')
    onRows(computeStructura(asociati, capitalSocial, fields.CEDENT_NUME ?? '', cesionarNume, cesionarMode === 'nou', nrParti))
  }

  const updateRow = (i: number, patch: Record<string, string>) =>
    onRows(rows.map((row, idx) => idx === i ? { ...row, ...patch } : row))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div className="field">
        <label className="field-label">Cedent</label>
        <select className="field-input" value={fields.CEDENT_NUME ?? ''} onChange={e => onField('CEDENT_NUME', e.target.value)}>
          <option value="">— alege —</option>
          {asociati.map((a, i) => (
            <option key={i} value={`${a.nume} ${a.prenume}`.trim()}>{a.nume} {a.prenume}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label">Cesionar</label>
        <div style={{ display: 'flex', gap: '.375rem', marginBottom: '.3rem' }}>
          <button type="button" className={`btn btn-sm ${cesionarMode === 'existent' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setCesionarMode('existent')}>Asociat existent</button>
          <button type="button" className={`btn btn-sm ${cesionarMode === 'nou' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setCesionarMode('nou')}>+ Persoană nouă</button>
        </div>
        {cesionarMode === 'existent' ? (
          <select className="field-input" value={fields.CESIONAR_NUME ?? ''} onChange={e => onField('CESIONAR_NUME', e.target.value)}>
            <option value="">— alege —</option>
            {asociati.map((a, i) => (
              <option key={i} value={`${a.nume} ${a.prenume}`.trim()}>{a.nume} {a.prenume}</option>
            ))}
          </select>
        ) : (
          <div style={{ display: 'flex', gap: '.375rem' }}>
            <input className="field-input" placeholder="Nume" value={nouNume} onChange={e => handleCesionarNou(e.target.value, nouPrenume)} />
            <input className="field-input" placeholder="Prenume" value={nouPrenume} onChange={e => handleCesionarNou(nouNume, e.target.value)} />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '.5rem' }}>
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="field-label">Nr. părți cedate</label>
          <input className="field-input" value={fields.NR_PARTI_CEDATE ?? ''} onChange={e => onField('NR_PARTI_CEDATE', e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="field-label">Valoare nominală (lei/parte)</label>
          <input className="field-input" value={fields.VALOARE_NOMINALA ?? '10'} onChange={e => onField('VALOARE_NOMINALA', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label className="field-label">Data contractului de cesiune</label>
        <input className="field-input" value={fields.DATA_CONTRACT_CESIUNE ?? today()} onChange={e => onField('DATA_CONTRACT_CESIUNE', e.target.value)} />
      </div>

      <button type="button" className="btn btn-outline-primary btn-sm" onClick={handleCalculeaza} style={{ alignSelf: 'flex-start' }} disabled={!fields.CEDENT_NUME || !fields.NR_PARTI_CEDATE}>
        ⟳ Calculează structura rezultată
      </button>

      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <label className="field-label">Structură rezultată (editabilă)</label>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '.3rem', alignItems: 'center', fontSize: '.8rem' }}>
              <input className="field-input" style={{ flex: 2, minWidth: 0 }} value={r.NUME ?? ''} onChange={e => updateRow(i, { NUME: e.target.value })} placeholder="nume" />
              <input className="field-input" style={{ flex: 1, minWidth: 0 }} value={r.PARTI_SOCIALE ?? ''} onChange={e => updateRow(i, { PARTI_SOCIALE: e.target.value })} placeholder="părți" />
              <input className="field-input" style={{ flex: 1, minWidth: 0 }} value={r.CAPITAL_SOCIAL ?? ''} onChange={e => updateRow(i, { CAPITAL_SOCIAL: e.target.value })} placeholder="lei" />
              <input className="field-input" style={{ flex: 1, minWidth: 0 }} value={r.COTA_PARTICIPARE ?? ''} onChange={e => updateRow(i, { COTA_PARTICIPARE: e.target.value })} placeholder="%" />
              <button type="button" onClick={() => onRows(rows.filter((_, idx) => idx !== i))} style={BTN_X}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const BTN_X: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: '.125rem .25rem' }
