import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Sarcina, SarcinaInput, StadiuDosar } from '../types'
import { STADIU_DOSAR_LABELS } from '../types'
import { useSarcini } from '../lib/sarcini'
import { updateDosarStadiu } from '../lib/dosare'
import { useClienti } from '../lib/clienti'
import { startOfWeek, endOfWeek } from '../lib/dateWeek'
import { useApp } from '../AppContext'
import KanbanBoard from '../components/sarcini/KanbanBoard'
import TaskModal from '../components/sarcini/TaskModal'
import ArchivedSarciniSection from '../components/sarcini/ArchivedSarciniSection'
import ClientDocSelector from '../components/ClientDocSelector'
import Modal from '../components/Modal'

type ModalState = 'add' | Sarcina | null
/** 'mele'/'toate' sau uid-ul unui membru anume. */
type AssigneeFilter = 'mele' | 'toate' | string
type TermenFilter = 'toate' | 'restante' | 'azi' | 'saptamana' | 'pana_la'

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function todayISO(): string {
  return toISO(new Date())
}

export default function SarciniPage() {
  const { user, activeWorkspace, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const { sarcini, loading, add, update, remove } = useSarcini(workspaceId)
  const { clienti, loading: clientiLoading } = useClienti(workspaceId)

  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('mele')
  const [clientFilter, setClientFilter] = useState<{ id: string; denumire: string } | null>(null)
  const [termenFilter, setTermenFilter] = useState<TermenFilter>('toate')
  const [termenPanaLa, setTermenPanaLa] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [deleteConf, setDeleteConf] = useState<Sarcina | null>(null)
  // Ștergere amânată (Undo din toast) — vezi handleDelete.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const [prefillClient, setPrefillClient] = useState<{ id: string; denumire: string } | undefined>(undefined)
  // Incrementat după o arhivare manuală reușită — ArchivedSarciniSection
  // folosește un hook one-shot, nu live, deci fără asta noul item ar apărea
  // doar la reload de pagină.
  const [archiveRefreshKey, setArchiveRefreshKey] = useState(0)
  const [suggestDosar, setSuggestDosar] = useState<{ id: string; label: string } | null>(null)
  const [suggestStadiu, setSuggestStadiu] = useState<StadiuDosar>('depus_in_solutionare')
  const [markingDosar, setMarkingDosar] = useState(false)

  // Deep-link din ClientView/DosarView: ?open=<sarcinaId> deschide direct
  // cardul acelei sarcini; ?newForClient=<id>&denumire=<nume> deschide
  // formularul de creare cu clientul deja ales; ?filterClient=<id>&denumire=
  // filtrează board-ul la sarcinile acelui client. Consumate o singură dată —
  // ?open= așteaptă până se termină încărcarea live înainte să caute ținta
  // (și renunță, fără să rămână agățat, dacă sarcina nu se găsește — poate fi
  // arhivată, deci în afara listei live a board-ului).
  const [searchParams, setSearchParams] = useSearchParams()
  const [handledOnce, setHandledOnce] = useState(false)
  useEffect(() => {
    const openId = searchParams.get('open')
    const newForClient = searchParams.get('newForClient')
    const filterClientId = searchParams.get('filterClient')
    const denumire = searchParams.get('denumire')
    if (!openId && !newForClient && !filterClientId) return
    if (openId && loading) return // reîncearcă la următoarea actualizare a listei live

    if (!handledOnce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (newForClient && denumire) { setPrefillClient({ id: newForClient, denumire }); setModal('add') }
      if (filterClientId && denumire) { setClientFilter({ id: filterClientId, denumire }); setAssigneeFilter('toate') }
      if (openId) {
        const target = sarcini.find(s => s.id === openId)
        if (target) {
          setModal(target)
          // Sarcina poate fi a altcuiva (ex. deep-link din dosarul unui coleg)
          // — dacă rămâne filtrul implicit „mele", sarcina dispare din board
          // imediat după orice editare (nemaifiind găsită prin `open`).
          if (target.assigneeUid !== user?.uid) setAssigneeFilter('toate')
        }
      }
      setHandledOnce(true)
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('open'); next.delete('newForClient'); next.delete('filterClient'); next.delete('denumire')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, sarcini, handledOnce])

  const filtered = useMemo(() => {
    const today = todayISO()
    const weekStartISO = toISO(startOfWeek())
    const weekEndISO = toISO(endOfWeek())
    const q = searchQuery.trim().toLowerCase()

    return sarcini.filter(s => {
      if (pendingDeleteIds.has(s.id)) return false
      if (assigneeFilter === 'mele' && user && s.assigneeUid !== user.uid) return false
      if (assigneeFilter !== 'mele' && assigneeFilter !== 'toate' && s.assigneeUid !== assigneeFilter) return false
      if (clientFilter && s.clientId !== clientFilter.id) return false

      if (termenFilter !== 'toate' && s.status === 'finalizat') return false
      if (termenFilter === 'restante' && !(s.termenLimita && s.termenLimita < today)) return false
      if (termenFilter === 'azi' && s.termenLimita !== today) return false
      if (termenFilter === 'saptamana' && !(s.termenLimita && s.termenLimita >= weekStartISO && s.termenLimita < weekEndISO)) return false
      if (termenFilter === 'pana_la' && (!termenPanaLa || !s.termenLimita || s.termenLimita > termenPanaLa)) return false

      if (q) {
        const hay = `${s.titlu} ${s.obiectCererii ?? ''} ${s.dosarLabel ?? ''} ${s.clientDenumire ?? s.clientDenumireLibera ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [sarcini, assigneeFilter, clientFilter, termenFilter, termenPanaLa, searchQuery, user, pendingDeleteIds])

  const hasActiveFilters = assigneeFilter !== 'mele' || !!clientFilter || termenFilter !== 'toate' || !!searchQuery.trim()

  const resetFilters = useCallback(() => {
    setAssigneeFilter('mele'); setClientFilter(null); setTermenFilter('toate'); setTermenPanaLa(''); setSearchQuery('')
  }, [])

  const summary = useMemo(() => {
    const today = todayISO()
    const active = filtered.filter(s => s.status !== 'finalizat')
    const restante = active.filter(s => s.termenLimita && s.termenLimita < today).length
    const azi = active.filter(s => s.termenLimita === today).length
    return { restante, azi, totalActive: active.length }
  }, [filtered])

  const handleQuickAdd = useCallback(async (titlu: string) => {
    if (!workspaceId || !user) return
    await add(workspaceId, {
      titlu, titluLower: titlu.toLowerCase(), descriere: '',
      status: 'deschis', prioritate: 'medie',
      termenLimita: null,
      assigneeUid: user.uid, assigneeNume: user.displayName ?? user.email ?? '',
      order: Date.now(),
      completedAt: null,
    }, user.uid)
  }, [workspaceId, user, add])

  const handleSave = useCallback(async (data: SarcinaInput) => {
    if (!workspaceId || !user) return
    if (modal && typeof modal === 'object') {
      await update(workspaceId, modal.id, data)
      toast('Sarcină actualizată', 'ok')
    } else {
      await add(workspaceId, data, user.uid)
      toast('Sarcină adăugată', 'ok')
    }
  }, [modal, workspaceId, user, add, update, toast])

  // Ștergere amânată — sarcina dispare imediat din UI (pendingDeleteIds,
  // filtrat în `filtered`), dar scrierea reală în Firestore se întâmplă abia
  // când expiră toast-ul; "Anulează" doar scoate id-ul din pendingDeleteIds —
  // nimic n-a fost șters vreodată.
  const handleDelete = useCallback(() => {
    if (!deleteConf || !workspaceId) return
    const id = deleteConf.id
    const titlu = deleteConf.titlu
    setPendingDeleteIds(prev => new Set(prev).add(id))
    setDeleteConf(null)
    toast(`Sarcina „${titlu}" a fost ștearsă`, 'ok', {
      onExpire: async () => {
        try {
          await remove(workspaceId, id)
        } catch (err: unknown) {
          setPendingDeleteIds(prev => { const next = new Set(prev); next.delete(id); return next })
          toast((err as Error).message ?? 'Eroare la ștergerea sarcinii', 'err')
        }
      },
      action: {
        label: 'Anulează',
        onClick: () => setPendingDeleteIds(prev => { const next = new Set(prev); next.delete(id); return next }),
      },
    })
  }, [deleteConf, workspaceId, remove, toast])

  const handleUpdateDosarStadiu = useCallback(async () => {
    if (!suggestDosar || !workspaceId) return
    setMarkingDosar(true)
    try {
      await updateDosarStadiu(workspaceId, suggestDosar.id, suggestStadiu)
      toast(`Dosar actualizat — ${STADIU_DOSAR_LABELS[suggestStadiu]}`, 'ok')
      setSuggestDosar(null)
    } catch (err: unknown) {
      toast((err as Error).message ?? 'Eroare la actualizarea dosarului', 'err')
    } finally {
      setMarkingDosar(false)
    }
  }, [suggestDosar, suggestStadiu, workspaceId, toast])

  if (!workspaceId) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <div className="empty-state-text">Selectați un spațiu de lucru pentru a vedea sarcinile.</div>
      </div>
    )
  }

  return (
    <>
      <div className="page--data">
        <div className="page-top">
          <div className="page-header">
            <div>
              <div className="page-title">Sarcini</div>
              <div className="page-subtitle">Board de lucru — dosare ONRC și orice altă sarcină</div>
            </div>
            <div className="page-actions">
              <button className="btn btn-primary" onClick={() => { setPrefillClient(undefined); setModal('add') }}>+ Sarcină</button>
            </div>
          </div>

          <div className="toolbar" style={{ flexWrap: 'wrap', rowGap: '.5rem' }}>
            <div className="search-box" style={{ maxWidth: 220 }}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="var(--s400)" strokeWidth="2" strokeLinecap="round">
                <circle cx="9" cy="9" r="6" /><path d="M15 15l3 3" />
              </svg>
              <input placeholder="Caută titlu, obiect, dosar..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
              )}
            </div>

            <select className="field-input" style={{ width: 'auto', maxWidth: 180 }} value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}>
              <option value="mele">Sarcinile mele</option>
              <option value="toate">Toți responsabilii</option>
              {Object.entries(activeWorkspace?.members ?? {}).map(([uid, m]) => (
                <option key={uid} value={uid}>{m.displayName || m.email}</option>
              ))}
            </select>

            <div style={{ maxWidth: 200, position: 'relative' }}>
              <ClientDocSelector clients={clienti} loading={clientiLoading} value={clientFilter?.denumire} onSelect={c => setClientFilter({ id: c.id, denumire: c.denumire })} />
              {clientFilter && (
                <button
                  type="button"
                  onClick={() => setClientFilter(null)}
                  title="Elimină filtrul de client"
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1 }}
                >×</button>
              )}
            </div>

            <select className="field-input" style={{ width: 'auto', maxWidth: 160 }} value={termenFilter} onChange={e => setTermenFilter(e.target.value as TermenFilter)}>
              <option value="toate">Orice termen</option>
              <option value="restante">Restante</option>
              <option value="azi">Azi</option>
              <option value="saptamana">Săptămâna asta</option>
              <option value="pana_la">Până la dată...</option>
            </select>
            {termenFilter === 'pana_la' && (
              <input type="date" className="field-input" style={{ width: 'auto' }} value={termenPanaLa} onChange={e => setTermenPanaLa(e.target.value)} />
            )}

            {hasActiveFilters && (
              <button className="btn btn-ghost btn-sm" onClick={resetFilters}>× Resetează filtre</button>
            )}

            <div style={{ flex: 1 }} />
            <div className="tasks-summary-strip">
              {summary.restante > 0 && <span className="tasks-summary-item tasks-summary-item--overdue">{summary.restante} restante</span>}
              {summary.azi > 0 && <span className="tasks-summary-item tasks-summary-item--today">{summary.azi} azi</span>}
              <span className="tasks-summary-item">{summary.totalActive} active</span>
            </div>
          </div>
        </div>

        {/* overflow:auto (nu :hidden, ca implicit .page-body) — necesar ca
            secțiunea de arhivă de mai jos să rămână accesibilă prin scroll
            odată extinsă, fără să deformeze înălțimea board-ului de sus. */}
        <div className="page-body" style={{ padding: '1.25rem 1.5rem', overflow: 'auto' }}>
          <div style={{ flex: '1 0 480px', display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
                <span className="spin spin-dark" style={{ width: 24, height: 24 }} />
              </div>
            ) : (
              <KanbanBoard
                workspaceId={workspaceId}
                sarcini={filtered}
                onOpenTask={setModal}
                onQuickAdd={handleQuickAdd}
                onDeleteTask={setDeleteConf}
                onDosarMaybeComplete={(id, label) => { setSuggestDosar({ id, label }); setSuggestStadiu('depus_in_solutionare') }}
                onArchived={() => setArchiveRefreshKey(k => k + 1)}
              />
            )}
          </div>
          <ArchivedSarciniSection refreshKey={archiveRefreshKey} />
        </div>
      </div>

      {modal && (
        <TaskModal
          initial={typeof modal === 'object' ? modal : null}
          onSave={handleSave}
          onClose={() => { setModal(null); setPrefillClient(undefined) }}
          onDelete={typeof modal === 'object' ? () => { setDeleteConf(modal); setModal(null) } : undefined}
          prefillClient={prefillClient}
        />
      )}

      {deleteConf && (
        <Modal onClose={() => setDeleteConf(null)} className="modal-box--sm" ariaLabel="Șterge sarcină">
          <div className="modal-head">
            <span className="modal-title">Șterge sarcină</span>
            <button className="modal-close" onClick={() => setDeleteConf(null)}>×</button>
          </div>
          <div className="modal-body">
            <p style={{ color: 'var(--s600)', fontSize: '.9375rem' }}>
              Ești sigur că vrei să ștergi <strong>{deleteConf.titlu}</strong>?
            </p>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setDeleteConf(null)}>Anulează</button>
            <button className="btn" style={{ background: 'var(--r500)', color: '#fff' }} onClick={handleDelete}>Șterge</button>
          </div>
        </Modal>
      )}

      {suggestDosar && (
        <Modal onClose={() => setSuggestDosar(null)} className="modal-box--sm" ariaLabel="Sugestie dosar">
          <div className="modal-head">
            <span className="modal-title">Toate sarcinile dosarului sunt finalizate</span>
            <button className="modal-close" onClick={() => setSuggestDosar(null)}>×</button>
          </div>
          <div className="modal-body">
            <p style={{ color: 'var(--s600)', fontSize: '.9375rem', marginBottom: '.875rem' }}>
              Ultima sarcină legată de dosarul <strong>{suggestDosar.label}</strong> a fost finalizată. În ce stadiu dorești să muți dosarul?
            </p>
            <div className="field">
              <label className="field-label">Stadiu nou</label>
              <select className="field-input" value={suggestStadiu} onChange={e => setSuggestStadiu(e.target.value as StadiuDosar)}>
                {(Object.entries(STADIU_DOSAR_LABELS) as [StadiuDosar, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setSuggestDosar(null)}>Nu acum</button>
            <button className="btn btn-success" onClick={handleUpdateDosarStadiu} disabled={markingDosar}>
              {markingDosar ? <span className="spin" /> : 'Actualizează dosarul'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
