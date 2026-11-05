import { useEffect, useState } from 'react'
import type { Client, Persoana } from '../../types'
import { valoareParteSociala } from '../../lib/cota'
import { calculeazaMajorareMulti, numeAsociat } from '../../lib/majorareCapital'
import type { ClientPatchProposal } from '../../lib/clauseFieldSpecs'
import IconTrash from '../IconTrash'

interface Props {
  client?: Partial<Client> | null
  onField: (key: string, value: string) => void
  onRows: (rows: Record<string, string>[]) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
}

const pct = (n: number) => String(+n.toFixed(2))

/** Majorare de capital cu aport de la mai mulți asociați (Hotărârea AGA): câte un rând per asociat care aportă,
 * capitalul nou = capitalul actual + suma aporturilor. Varianta cu un singur aportator e MajorareCapitalFields. */
export default function MajorareCapitalMultiFields({ client, onField, onRows, onClientPatch }: Props) {
  const asociati = client?.asociati ?? []
  const capitalVechi = client?.capitalSocial ?? 0
  const valoareParte = valoareParteSociala(client)
  const [rows, setRows] = useState<{ nume: string; aport: string }[]>([{ nume: '', aport: '' }])

  const calc = calculeazaMajorareMulti(asociati, capitalVechi,
    rows.map(r => ({ nume: r.nume, aport: Number(r.aport) || 0 })), valoareParte)

  useEffect(() => {
    if (!calc.ok) {
      onField('CAPITAL_SOCIAL_NOU', '')
      onField('PARTI_SOCIALE_NOI', '')
      onRows([])
      onClientPatch(null)
      return
    }
    onField('CAPITAL_SOCIAL_NOU', String(calc.capitalNou))
    onField('PARTI_SOCIALE_NOI', String(calc.partiNoiTotal))
    onRows(calc.aporturi.map(a => ({
      NUME: a.nume, APORT: String(a.aport), PARTI_APORT: String(a.partiAport), COTA_PARTICIPARE: pct(a.cotaNoua),
    })))
    const noi: Persoana[] = asociati.map(a => {
      const s = calc.structura.find(x => x.nume === numeAsociat(a))
      return s ? { ...a, cotaParticipare: pct(s.cotaNoua) } : a
    })
    onClientPatch({
      label: `Majorare capital la ${calc.capitalNou} RON (aport ${calc.aporturi.map(a => a.nume).join(', ')})`,
      patch: { capitalSocial: calc.capitalNou, asociati: noi },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rows)])

  const update = (i: number, patch: Partial<{ nume: string; aport: string }>) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const folositi = new Set(rows.map(r => r.nume).filter(Boolean))
  const touched = rows.some(r => r.nume || r.aport)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <label className="field-label">Asociați care aportă (aport în numerar, RON)</label>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <select className="field-input" style={{ flex: 2, minWidth: 0 }} value={r.nume} onChange={e => update(i, { nume: e.target.value })}>
            <option value="">— alege asociatul —</option>
            {asociati.map((a, j) => {
              const nume = numeAsociat(a)
              return <option key={j} value={nume} disabled={folositi.has(nume) && nume !== r.nume}>{nume}</option>
            })}
          </select>
          <input className="field-input" style={{ flex: 1, minWidth: 0 }} type="number" min={valoareParte} step={valoareParte}
            value={r.aport} onChange={e => update(i, { aport: e.target.value })} placeholder="aport RON" />
          <button type="button" className="btn btn-ghost btn-xs" style={{ color: 'var(--r500)' }} title="Elimină"
            disabled={rows.length === 1} onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))}>
            <IconTrash />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-xs" style={{ alignSelf: 'flex-start' }}
        disabled={rows.length >= asociati.length} onClick={() => setRows(prev => [...prev, { nume: '', aport: '' }])}>
        + Adaugă asociat
      </button>

      {calc.ok ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
          <label className="field-label">
            Capital social: {capitalVechi} RON → {calc.capitalNou} RON ({calc.partiNoiTotal} părți a câte {valoareParte} RON)
          </label>
          <span style={{ fontSize: '.75rem', color: 'var(--s500)' }}>Structură rezultată (informativ)</span>
          {calc.structura.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '.8rem', color: 'var(--s700)' }}>
              <span style={{ flex: 1 }}>{s.nume}</span>
              <span>{s.partiNoi} părți</span>
              <span>{s.cotaNoua.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      ) : touched && (
        <p style={{ fontSize: '.78rem', color: 'var(--y700)', margin: 0 }}>{calc.error}</p>
      )}
    </div>
  )
}
