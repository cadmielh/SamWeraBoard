import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Dosar, Sarcina } from '../types'
import { STADIU_DOSAR_LABELS, STADIU_DOSAR_COLOR, SARCINA_STATUS_LABELS, obiecteCereriiText } from '../types'
import { fetchDosareByClient } from '../lib/dosare'
import { fetchSarciniByClient } from '../lib/sarcini'
import { useApp } from '../AppContext'

interface Props {
  client: Client
}

const SARCINA_BADGE_CLASS: Record<Sarcina['status'], string> = {
  deschis: 'chip-muted',
  in_lucru: 'priority-chip-blue',
  finalizat: 'chip-success',
}

/**
 * Dosarele și sarcinile acestui client — fișa clientului nu "știa" nimic
 * despre ele până acum, deși Dosar/Sarcina au mereu știut de client
 * (legătura era într-un singur sens). Query-uri directe pe clientId, nu
 * derivate din listele deja încărcate în alte pagini, ca fișa să fie corectă
 * indiferent ce module au fost vizitate în sesiunea curentă.
 */
export default function ClientDosareSarcini({ client }: Props) {
  const { activeWorkspace } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const navigate = useNavigate()

  const [dosare, setDosare] = useState<Dosar[]>([])
  const [sarcini, setSarcini] = useState<Sarcina[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    Promise.all([
      fetchDosareByClient(workspaceId, client.id),
      fetchSarciniByClient(workspaceId, client.id),
    ]).then(([d, s]) => {
      if (cancelled) return
      setDosare(d)
      setSarcini(s)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, client.id])

  const denumireQ = encodeURIComponent(client.denumire)
  const activeSarcini = sarcini.filter(s => s.status !== 'finalizat').length

  return (
    <>
      <div className="cv2-section">
        <div className="cv2-section-label">
          Dosare
          {dosare.length > 0 && <span className="cv2-count-chip">{dosare.length}</span>}
        </div>
        {loading && <div style={{ fontSize: '.8125rem', color: 'var(--s400)' }}>Se încarcă...</div>}
        {!loading && dosare.length === 0 && <div style={{ fontSize: '.8125rem', color: 'var(--s400)' }}>Niciun dosar pentru acest client.</div>}
        {!loading && dosare.slice(0, 6).map(d => (
          <button
            key={d.id}
            type="button"
            onClick={() => navigate(`/dosare?open=${d.id}`)}
            style={{ display: 'flex', alignItems: 'center', gap: '.5rem', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '.35rem 0' }}
          >
            <span className={`badge stadiu-badge-${STADIU_DOSAR_COLOR[d.stadiu]}`} style={{ flexShrink: 0 }}>{STADIU_DOSAR_LABELS[d.stadiu]}</span>
            <span style={{ fontSize: '.8125rem', color: 'var(--s700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {obiecteCereriiText(d.obiecteCererii)}
            </span>
          </button>
        ))}
        {dosare.length > 6 && <div style={{ fontSize: '.75rem', color: 'var(--s400)' }}>+ încă {dosare.length - 6}</div>}
        <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => navigate(`/dosare?newForClient=${client.id}&denumire=${denumireQ}`)}>
          + Dosar nou
        </button>
      </div>

      <div className="cv2-section">
        <div className="cv2-section-label">
          Sarcini
          {sarcini.length > 0 && <span className="cv2-count-chip">{activeSarcini} active</span>}
        </div>
        {loading && <div style={{ fontSize: '.8125rem', color: 'var(--s400)' }}>Se încarcă...</div>}
        {!loading && sarcini.length === 0 && <div style={{ fontSize: '.8125rem', color: 'var(--s400)' }}>Nicio sarcină pentru acest client.</div>}
        {!loading && sarcini.slice(0, 6).map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => navigate(`/sarcini?open=${s.id}`)}
            style={{ display: 'flex', alignItems: 'center', gap: '.5rem', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '.35rem 0' }}
          >
            <span className={`chip ${SARCINA_BADGE_CLASS[s.status]}`} style={{ flexShrink: 0 }}>{SARCINA_STATUS_LABELS[s.status]}</span>
            <span style={{ fontSize: '.8125rem', color: 'var(--s700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.titlu}</span>
          </button>
        ))}
        {sarcini.length > 6 && <div style={{ fontSize: '.75rem', color: 'var(--s400)' }}>+ încă {sarcini.length - 6}</div>}
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/sarcini?filterClient=${client.id}&denumire=${denumireQ}`)}>
            Vezi pe board
          </button>
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => navigate(`/sarcini?newForClient=${client.id}&denumire=${denumireQ}`)}>
            + Sarcină nouă
          </button>
        </div>
      </div>
    </>
  )
}
