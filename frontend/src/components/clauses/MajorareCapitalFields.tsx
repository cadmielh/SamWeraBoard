import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { Client, Persoana } from '../../types'
import { parsePercent } from '../../lib/cota'
import type { ClientPatchProposal } from '../../lib/clauseFieldSpecs'

interface Props {
  client?: Partial<Client> | null
  fields: Record<string, string>
  onField: (key: string, value: string) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
}

interface Calc {
  partiNoiTotal: number
  cotaAportator: number
  rezultat: { nume: string; partiNoi: number; cotaNoua: number }[]
}

/** Aportatorul primește restul de părți din aport; ceilalți asociați rămân
 * cu același nominal de părți, dar cota li se recalculează proporțional la
 * capitalul nou, mai mare. */
function calculeaza(asociati: Persoana[], capitalVechi: number, capitalNou: number, aportatorNume: string): Calc | null {
  if (capitalNou <= 0 || capitalNou <= capitalVechi || !aportatorNume || asociati.length === 0) return null
  const partiAport = (capitalNou - capitalVechi) / 10
  const partiNoiTotal = capitalNou / 10

  const rezultat = asociati.map(a => {
    const numeComplet = `${a.nume} ${a.prenume}`.trim()
    const partiVechi = Math.round(capitalVechi * parsePercent(a.cotaParticipare) / 100 / 10)
    const partiNoi = partiVechi + (numeComplet === aportatorNume ? partiAport : 0)
    return { nume: numeComplet, partiNoi, cotaNoua: partiNoiTotal > 0 ? partiNoi / partiNoiTotal * 100 : 0 }
  })
  const aportatorRezultat = rezultat.find(r => r.nume === aportatorNume)
  if (!aportatorRezultat) return null
  return { partiNoiTotal, cotaAportator: aportatorRezultat.cotaNoua, rezultat }
}

export default function MajorareCapitalFields({ client, fields, onField, onClientPatch }: Props) {
  const asociati = client?.asociati ?? []
  const capitalVechi = client?.capitalSocial ?? 0
  const capitalNou = parseFloat(fields.CAPITAL_SOCIAL_NOU ?? '') || 0
  const aportatorNume = fields.ASOCIAT_APORT_NUME ?? ''

  const calc = calculeaza(asociati, capitalVechi, capitalNou, aportatorNume)

  useEffect(() => {
    if (!calc) {
      onField('PARTI_SOCIALE_NOI', '')
      onField('ASOCIAT_APORT_COTA_PARTICIPARE', '')
      onClientPatch(null)
      return
    }
    onField('PARTI_SOCIALE_NOI', String(calc.partiNoiTotal))
    onField('ASOCIAT_APORT_COTA_PARTICIPARE', String(+calc.cotaAportator.toFixed(2)))
    const noi: Persoana[] = asociati.map(a => {
      const numeComplet = `${a.nume} ${a.prenume}`.trim()
      const r = calc.rezultat.find(x => x.nume === numeComplet)
      return r ? { ...a, cotaParticipare: String(+r.cotaNoua.toFixed(2)) } : a
    })
    onClientPatch({
      label: `Majorare capital la ${capitalNou} RON (aport ${aportatorNume})`,
      patch: { capitalSocial: capitalNou, asociati: noi },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.CAPITAL_SOCIAL_NOU, fields.ASOCIAT_APORT_NUME])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div>
        <label style={LABEL}>Asociat care aportă</label>
        <select style={INPUT} value={aportatorNume} onChange={e => onField('ASOCIAT_APORT_NUME', e.target.value)}>
          <option value="">— alege —</option>
          {asociati.map((a, i) => (
            <option key={i} value={`${a.nume} ${a.prenume}`.trim()}>{a.nume} {a.prenume}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={LABEL}>Capital social nou (total) — actual: {capitalVechi} RON</label>
        <input style={INPUT} value={fields.CAPITAL_SOCIAL_NOU ?? ''} onChange={e => onField('CAPITAL_SOCIAL_NOU', e.target.value)} placeholder={`> ${capitalVechi}`} />
      </div>

      {calc && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
          <label style={LABEL}>Structură rezultată (informativ)</label>
          {calc.rezultat.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '.8rem', color: 'var(--s700)' }}>
              <span style={{ flex: 1 }}>{r.nume}</span>
              <span>{r.partiNoi} părți</span>
              <span>{r.cotaNoua.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      )}
      {fields.CAPITAL_SOCIAL_NOU && !calc && (
        <p style={{ fontSize: '.78rem', color: 'var(--y700, #a16207)' }}>
          Capitalul nou trebuie să fie mai mare decât cel actual ({capitalVechi} RON) și trebuie ales asociatul care aportă.
        </p>
      )}
    </div>
  )
}

const LABEL: CSSProperties = { fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.04em', textTransform: 'uppercase', display: 'block', marginBottom: '.25rem' }
const INPUT: CSSProperties = { padding: '.375rem .625rem', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--s300)', fontSize: '.85rem', color: 'var(--s800)', background: '#fff', width: '100%', fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box' }
