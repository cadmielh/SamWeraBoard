import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Dosar, SarcinaStatus, StadiuDosar } from '../../types'
import { SARCINA_STATUS_LABELS, STADIU_DOSAR_LABELS, PRIORITATE_LABELS, PRIORITATE_COLOR, STADII_DOSAR_FINALE, nextSarcinaStatus } from '../../types'
import type { Sarcina } from '../../types'
import { fetchSarciniByDosar, moveSarcina, useSarcini } from '../../lib/sarcini'
import { buildSarcinaForObiect } from '../../lib/dosarSarcini'
import { useApp } from '../../AppContext'

interface Props {
  dosar: Dosar
  onUpdateStadiu: (stadiu: StadiuDosar) => Promise<void>
}

const STATUS_BADGE_CLASS: Record<SarcinaStatus, string> = {
  deschis: 'chip-muted',
  in_lucru: 'priority-chip-blue',
  finalizat: 'chip-success',
}

/**
 * Sarcinile legate de acest dosar — relația e 1:N, deci citită live din
 * Sarcina.dosarId (nu dintr-un id singular ținut pe Dosar). Cu acțiuni rapide
 * per sarcină (avansare/finalizare), creare rapidă a uneia noi, și sugestii
 * (nu automatisme) când obiectele cererii se editează ulterior pe dosar:
 * un obiect nou fără sarcină corespunzătoare → propune crearea ei; o sarcină
 * al cărei obiect a fost șters din dosar → propune ștergerea ei. Potrivirea
 * se face prin Sarcina.obiectCererii, nu prin titlu (editabil liber).
 */
export default function DosarSarciniList({ dosar, onUpdateStadiu }: Props) {
  const { user, activeWorkspace, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const { add: addSarcina, remove: removeSarcina } = useSarcini(workspaceId)
  const navigate = useNavigate()

  const [sarcini, setSarcini] = useState<Sarcina[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [suggestDismissed, setSuggestDismissed] = useState(false)
  const [suggestStadiu, setSuggestStadiu] = useState<StadiuDosar>('depus_in_solutionare')
  const [updatingStadiu, setUpdatingStadiu] = useState(false)
  const [dismissedAdd, setDismissedAdd] = useState<Set<string>>(new Set())
  const [dismissedRemove, setDismissedRemove] = useState<Set<string>>(new Set())
  const [busyLabel, setBusyLabel] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      setSarcini(await fetchSarciniByDosar(workspaceId, dosar.id))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, dosar.id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload() }, [reload])

  const isFinalStadiu = STADII_DOSAR_FINALE.includes(dosar.stadiu)
  const allFinalized = sarcini.length > 0 && sarcini.every(s => s.status === 'finalizat')

  // Obiecte ale dosarului fără nicio sarcină legată prin obiectCererii.
  const obiecteFaraSarcina = useMemo(() => {
    const legate = new Set(sarcini.map(s => s.obiectCererii).filter(Boolean))
    return dosar.obiecteCererii.filter(o => !legate.has(o.label) && !dismissedAdd.has(o.label))
  }, [dosar.obiecteCererii, sarcini, dismissedAdd])

  // Sarcini generate pentru un obiect care nu mai există în dosar.
  const sarciniOrfane = useMemo(() => {
    const curente = new Set(dosar.obiecteCererii.map(o => o.label))
    return sarcini.filter(s => s.obiectCererii && !curente.has(s.obiectCererii) && !dismissedRemove.has(s.id))
  }, [dosar.obiecteCererii, sarcini, dismissedRemove])

  const handleCreateForObiect = async (label: string) => {
    if (!workspaceId || !user) return
    setBusyLabel(label)
    try {
      await addSarcina(workspaceId, buildSarcinaForObiect(dosar, dosar.id, label), user.uid)
      toast(`Sarcină creată pentru „${label}"`, 'ok')
      await reload()
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la crearea sarcinii', 'err')
    } finally {
      setBusyLabel(null)
    }
  }

  const handleDeleteOrphan = async (s: Sarcina) => {
    if (!workspaceId) return
    setBusyLabel(s.id)
    try {
      await removeSarcina(workspaceId, s.id)
      toast('Sarcină ștearsă', 'ok')
      setSarcini(prev => prev.filter(x => x.id !== s.id))
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la ștergere', 'err')
    } finally {
      setBusyLabel(null)
    }
  }

  const handleQuickCreate = async () => {
    if (!workspaceId || !user) return
    setCreating(true)
    try {
      await addSarcina(workspaceId, {
        titlu: 'Sarcină nouă', titluLower: 'sarcină nouă',
        descriere: '', status: 'deschis', prioritate: 'medie',
        termenLimita: dosar.dataPlanificare,
        assigneeUid: dosar.responsabilUid ?? null, assigneeNume: dosar.responsabilNume,
        clientId: dosar.clientId, clientDenumire: dosar.clientDenumire,
        clientDenumireLibera: dosar.clientId ? undefined : dosar.clientDenumireLibera,
        dosarId: dosar.id, dosarLabel: dosar.nrInregistrareDosar || dosar.clientDenumire || '',
        order: Date.now(), completedAt: null,
      }, user.uid)
      toast('Sarcină creată și legată de dosar', 'ok')
      await reload()
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la crearea sarcinii', 'err')
    } finally {
      setCreating(false)
    }
  }

  const handleQuickMove = useCallback(async (s: Sarcina, newStatus: SarcinaStatus) => {
    if (!workspaceId) return
    await moveSarcina(workspaceId, s.id, newStatus, Date.now())
    setSarcini(prev => prev.map(x => x.id === s.id ? { ...x, status: newStatus } : x))
  }, [workspaceId])

  return (
    <div className="cv2-section">
      <div className="cv2-section-label">
        Sarcini legate
        {sarcini.length > 0 && <span className="cv2-count-chip">{sarcini.length}</span>}
      </div>

      {!loading && obiecteFaraSarcina.map(o => (
        <div key={o.label} style={{ background: 'var(--p50)', border: '1px solid var(--p200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
          <span style={{ fontSize: '.8125rem', color: 'var(--p700)' }}>„{o.label}" e un obiect nou al cererii — creezi o sarcină pentru el?</span>
          <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
            <button className="btn btn-ghost btn-xs" onClick={() => setDismissedAdd(prev => new Set(prev).add(o.label))}>Ignoră</button>
            <button className="btn btn-primary btn-xs" onClick={() => handleCreateForObiect(o.label)} disabled={busyLabel === o.label}>
              {busyLabel === o.label ? <span className="spin" /> : 'Creează'}
            </button>
          </div>
        </div>
      ))}

      {!loading && sarciniOrfane.map(s => (
        <div key={s.id} style={{ background: 'var(--a50)', border: '1px solid var(--a200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
          <span style={{ fontSize: '.8125rem', color: 'var(--a800)' }}>„{s.obiectCererii}" nu mai e în obiectele cererii — ștergi sarcina „{s.titlu}"?</span>
          <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
            <button className="btn btn-ghost btn-xs" onClick={() => setDismissedRemove(prev => new Set(prev).add(s.id))}>Păstrează</button>
            <button className="btn btn-xs" style={{ background: 'var(--r500)', color: '#fff' }} onClick={() => handleDeleteOrphan(s)} disabled={busyLabel === s.id}>
              {busyLabel === s.id ? <span className="spin" /> : 'Șterge'}
            </button>
          </div>
        </div>
      ))}

      {allFinalized && !isFinalStadiu && !suggestDismissed && (
        <div style={{ background: 'var(--g50)', border: '1px solid var(--g200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          <span style={{ fontSize: '.8125rem', color: 'var(--g700)' }}>Toate sarcinile legate sunt finalizate — muți dosarul în ce stadiu?</span>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            <select className="field-input" style={{ flex: 1 }} value={suggestStadiu} onChange={e => setSuggestStadiu(e.target.value as StadiuDosar)}>
              {(Object.entries(STADIU_DOSAR_LABELS) as [StadiuDosar, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <button className="btn btn-ghost btn-xs" onClick={() => setSuggestDismissed(true)}>Nu acum</button>
            <button
              className="btn btn-success btn-xs"
              disabled={updatingStadiu}
              onClick={async () => {
                setUpdatingStadiu(true)
                try {
                  await onUpdateStadiu(suggestStadiu)
                  toast(`Dosar actualizat — ${STADIU_DOSAR_LABELS[suggestStadiu]}`, 'ok')
                  setSuggestDismissed(true)
                } catch (e: unknown) {
                  toast((e as Error).message ?? 'Eroare la actualizarea dosarului', 'err')
                } finally {
                  setUpdatingStadiu(false)
                }
              }}
            >
              {updatingStadiu ? <span className="spin" /> : 'Actualizează'}
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{ fontSize: '.8125rem', color: 'var(--s400)' }}>Se încarcă...</div>}

      {!loading && sarcini.length === 0 && (
        <div style={{ fontSize: '.8125rem', color: 'var(--s400)' }}>Nicio sarcină legată încă.</div>
      )}

      {!loading && sarcini.map(s => {
        const next = nextSarcinaStatus(s.status)
        return (
          <div key={s.id} className="persoana-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
              <button
                type="button"
                onClick={() => navigate(`/sarcini?open=${s.id}`)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontWeight: 600, fontSize: '.875rem', color: 'var(--s900)' }}
              >
                {s.titlu}
              </button>
              <span className={`chip ${STATUS_BADGE_CLASS[s.status]}`}>{SARCINA_STATUS_LABELS[s.status]}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <span className={`chip priority-chip-${PRIORITATE_COLOR[s.prioritate]}`}>{PRIORITATE_LABELS[s.prioritate]}</span>
              {next && (
                <button className="btn btn-ghost btn-xs" onClick={() => handleQuickMove(s, next)}>▶ {SARCINA_STATUS_LABELS[next]}</button>
              )}
            </div>
          </div>
        )
      })}

      <button type="button" className="btn btn-outline-primary btn-sm" onClick={handleQuickCreate} disabled={creating}>
        {creating ? <span className="spin spin-dark" /> : '+ Sarcină nouă legată de acest dosar'}
      </button>
    </div>
  )
}
