import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Dosar, SarcinaStatus, StadiuDosar } from '../../types'
import { SARCINA_STATUS_LABELS, STADIU_DOSAR_LABELS, PRIORITATE_LABELS, PRIORITATE_COLOR, STADII_DOSAR_FINALE, nextSarcinaStatus } from '../../types'
import type { Sarcina } from '../../types'
import { fetchSarciniByDosar, moveSarcina, useSarcini } from '../../lib/sarcini'
import { serializeObiecte, descriereObiecte } from '../../lib/dosarSarcini'
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
 * per sarcină (avansare/finalizare) și creare rapidă a uneia noi. Sarcina
 * auto-generată la crearea dosarului (una singură, cu toate obiectele cererii
 * în descriere — identificată prin Sarcina.obiectCererii nevid) e resincro-
 * nizată automat, fără confirmare, când obiectele cererii dosarului se editează
 * ulterior — vezi efectul de mai jos.
 */
export default function DosarSarciniList({ dosar, onUpdateStadiu }: Props) {
  const { user, activeWorkspace, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const { add: addSarcina, update: updateSarcina } = useSarcini(workspaceId)
  const navigate = useNavigate()

  const [sarcini, setSarcini] = useState<Sarcina[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [suggestDismissed, setSuggestDismissed] = useState(false)
  const [suggestStadiu, setSuggestStadiu] = useState<StadiuDosar>('depus_in_solutionare')
  const [updatingStadiu, setUpdatingStadiu] = useState(false)
  const syncingObiectRef = useRef<string | null>(null)

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

  // Resincronizează silențios descrierea sarcinii auto-generate (dacă există)
  // când obiectele cererii dosarului diferă de instantaneul stocat pe sarcină
  // la ultima generare/sincronizare — syncingObiectRef evită bucla infinită
  // (reload() aduce sarcina cu obiectCererii deja la zi, deci al doilea
  // rulaj al efectului nu mai găsește diferență).
  useEffect(() => {
    const expected = serializeObiecte(dosar.obiecteCererii)
    const autoTask = sarcini.find(s => s.obiectCererii)
    if (!workspaceId || !autoTask || autoTask.obiectCererii === expected) return
    if (syncingObiectRef.current === autoTask.id + expected) return
    syncingObiectRef.current = autoTask.id + expected
    updateSarcina(workspaceId, autoTask.id, {
      descriere: descriereObiecte(dosar.obiecteCererii),
      obiectCererii: expected,
    }).then(reload)
  }, [dosar.obiecteCererii, sarcini, workspaceId, updateSarcina, reload])

  const isFinalStadiu = STADII_DOSAR_FINALE.includes(dosar.stadiu)
  const allFinalized = sarcini.length > 0 && sarcini.every(s => s.status === 'finalizat')

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

      {allFinalized && !isFinalStadiu && !suggestDismissed && (
        <div style={{ background: 'var(--g50)', border: '1px solid var(--g200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          <span style={{ fontSize: '.8125rem', color: 'var(--g700)' }}>Toate sarcinile legate sunt finalizate — În ce stadiu dorești să muți dosarul?</span>
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
