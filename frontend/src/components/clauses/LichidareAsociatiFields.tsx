import { useEffect, useState } from 'react'
import type { Client } from '../../types'
import { cotaCuProcent, isCotaTotalValid, sumCota } from '../../lib/cota'
import { numeAsociat } from '../../lib/majorareCapital'

interface Props {
  client?: Partial<Client> | null
  onRows: (rows: Record<string, string>[]) => void
}

/** Asociații cărora le revine capitalul social la lichidare — bifați din fișa clientului (implicit toți), fiecare
 * cu o cotă editabilă, pornită de la cota lui de participare. */
export default function LichidareAsociatiFields({ client, onRows }: Props) {
  const asociati = client?.asociati ?? []
  const [cote, setCote] = useState<Record<number, string>>(() =>
    Object.fromEntries(asociati.map((a, i) => [i, a.cotaParticipare ?? ''])))

  const alesi = Object.entries(cote).map(([i, cota]) => ({ a: asociati[Number(i)], cota: cotaCuProcent(cota) })).filter(x => x.a)

  useEffect(() => {
    // O cotă necompletată lasă lista goală — clauza apare „incompletă” în loc să iasă un rând fără cotă
    onRows(alesi.length > 0 && alesi.every(x => x.cota)
      ? alesi.map(x => ({ NUME: numeAsociat(x.a), COTA_PARTICIPARE: x.cota }))
      : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cote)])

  const toggle = (i: number) => setCote(prev => {
    const next = { ...prev }
    if (i in next) delete next[i]; else next[i] = asociati[i].cotaParticipare ?? ''
    return next
  })

  const valori = alesi.map(x => x.cota)

  return (
    <div className="field">
      <label className="field-label">Asociații cărora le revine capitalul social și cota fiecăruia</label>
      {asociati.map((a, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flex: 1, minWidth: 0, cursor: 'pointer' }}>
            <input type="checkbox" checked={i in cote} onChange={() => toggle(i)} />
            {numeAsociat(a) || `Asociatul ${i + 1}`}
          </label>
          {i in cote && (
            <input className="field-input" style={{ width: '6rem' }} value={cote[i]} placeholder="cota, ex. 50%"
              onChange={e => setCote(prev => ({ ...prev, [i]: e.target.value }))} />
          )}
        </div>
      ))}
      {asociati.length === 0 && (
        <p style={{ fontSize: '.78rem', color: 'var(--s400)', marginTop: '.25rem' }}>Clientul nu are niciun asociat înregistrat în profil.</p>
      )}
      {valori.length > 0 && valori.every(Boolean) && !isCotaTotalValid(valori) && (
        <p style={{ fontSize: '.78rem', color: 'var(--y700)', margin: '.25rem 0 0' }}>⚠️ Cotele însumează {sumCota(valori)}%, nu 100%.</p>
      )}
    </div>
  )
}
