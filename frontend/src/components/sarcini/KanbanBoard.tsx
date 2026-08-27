import { useState, useEffect, useRef } from 'react'
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCorners } from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import type { Sarcina, SarcinaStatus } from '../../types'
import { SARCINA_STATUS_ORDER, STADII_DOSAR_FINALE } from '../../types'
import { moveSarcina, reorderColumn, fetchSarciniByDosar, archiveSarcinaNow } from '../../lib/sarcini'
import { fetchDosarById } from '../../lib/dosare'
import { useApp } from '../../AppContext'
import KanbanColumn from './KanbanColumn'
import TaskCard from './TaskCard'
import QuickAddRow from './QuickAddRow'

interface Props {
  workspaceId: string
  sarcini: Sarcina[]
  onOpenTask: (task: Sarcina) => void
  onQuickAdd: (titlu: string) => Promise<void>
  onDeleteTask: (task: Sarcina) => void
  /** Apelat după ce o sarcină legată de un dosar e finalizată și TOATE
   * celelalte sarcini ale aceluiași dosar sunt deja finalizate — sugestia
   * "marchezi și dosarul ca eliberat?" nu poate aștepta ca userul să
   * navigheze înapoi la fișa dosarului, dacă declanșarea se întâmplă chiar
   * aici, pe board. */
  onDosarMaybeComplete: (dosarId: string, dosarLabel: string) => void
  /** Apelat după o arhivare manuală reușită (din TaskCard) — ArchivedSarciniSection
   * folosește un hook one-shot, nu live, deci fără asta noul item ar apărea
   * doar la reload de pagină. */
  onArchived?: () => void
}

function groupByStatus(sarcini: Sarcina[]): Record<SarcinaStatus, Sarcina[]> {
  const groups: Record<SarcinaStatus, Sarcina[]> = { deschis: [], in_lucru: [], finalizat: [] }
  for (const s of sarcini) groups[s.status].push(s)
  for (const status of SARCINA_STATUS_ORDER) groups[status].sort((a, b) => a.order - b.order)
  return groups
}

/**
 * DndContext + 3 coloane. Starea locală (`columns`) e o oglindă a `sarcini`
 * (props, live din onSnapshot) — sincronizată automat cât timp nu e drag activ
 * (`draggingRef`), ca listener-ul live să nu "lupte" cu reordonarea optimistă
 * afișată în timpul unui drag.
 */
export default function KanbanBoard({ workspaceId, sarcini, onOpenTask, onQuickAdd, onDeleteTask, onDosarMaybeComplete, onArchived }: Props) {
  const { toast } = useApp()
  const [columns, setColumns] = useState<Record<SarcinaStatus, Sarcina[]>>(() => groupByStatus(sarcini))
  const [activeId, setActiveId] = useState<string | null>(null)
  const [justCompletedId, setJustCompletedId] = useState<string | null>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    if (draggingRef.current) return
    setColumns(groupByStatus(sarcini))
  }, [sarcini])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findColumn = (id: string): SarcinaStatus | null => {
    if ((SARCINA_STATUS_ORDER as string[]).includes(id)) return id as SarcinaStatus
    for (const status of SARCINA_STATUS_ORDER) {
      if (columns[status].some(t => t.id === id)) return status
    }
    return null
  }

  const activeTask = activeId ? sarcini.find(t => t.id === activeId) ?? null : null

  // Verifică, la finalizarea unei sarcini legate de un dosar, dacă tocmai a
  // devenit ULTIMA sarcină nefinalizată a acelui dosar — dacă da, și dosarul
  // nu e deja într-un stadiu final, declanșează sugestia pe board (nu doar în
  // fișa dosarului, unde userul ar trebui să navigheze separat ca s-o vadă).
  const maybeSuggestDosarComplete = (task: Sarcina) => {
    if (!task.dosarId) return
    const dosarId = task.dosarId
    fetchSarciniByDosar(workspaceId, dosarId).then(async linked => {
      if (linked.length === 0 || !linked.every(s => s.status === 'finalizat')) return
      const dosar = await fetchDosarById(workspaceId, dosarId)
      if (!dosar || STADII_DOSAR_FINALE.includes(dosar.stadiu)) return
      // Identitatea DOSARULUI (client + nr. dosar), nu titlul ultimei sarcini
      // finalizate — task.dosarLabel e per-obiect (ex. "Închidere punct de
      // lucru"), diferit de la o sarcină la alta ale aceluiași dosar, deci
      // nepotrivit ca etichetă pentru dosarul în ansamblu.
      const label = [dosar.clientDenumire || dosar.clientDenumireLibera, dosar.nrInregistrareDosar].filter(Boolean).join(' — ')
      onDosarMaybeComplete(dosarId, label || 'acest dosar')
    }).catch(() => { /* verificare best-effort — nu blochează fluxul principal de pe board */ })
  }

  const handleDragStart = (e: DragStartEvent) => {
    draggingRef.current = true
    setActiveId(e.active.id as string)
  }

  // Drag anulat (ex. Escape în timpul unui drag pornit cu tastatura, prin
  // KeyboardSensor) — dnd-kit apelează onDragCancel, NU onDragEnd, în acest
  // caz. Fără acest handler, draggingRef rămânea blocat pe `true`, iar
  // useEffect-ul de mai sus oprea definitiv sincronizarea coloanelor cu
  // `sarcini` (props, live din Firestore) — orice sarcină nouă/actualizată
  // devenea vizibilă doar după un refresh de pagină (care remontează
  // componenta și resetează ref-ul).
  const handleDragCancel = () => {
    draggingRef.current = false
    setActiveId(null)
    setColumns(groupByStatus(sarcini))
  }

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e
    if (!over) return
    const activeCol = findColumn(active.id as string)
    const overCol = findColumn(over.id as string)
    if (!activeCol || !overCol || activeCol === overCol) return

    setColumns(prev => {
      const activeItems = [...prev[activeCol]]
      const overItems = [...prev[overCol]]
      const activeIndex = activeItems.findIndex(t => t.id === active.id)
      if (activeIndex === -1) return prev
      const [moved] = activeItems.splice(activeIndex, 1)
      const overIndex = overItems.findIndex(t => t.id === over.id)
      const insertAt = overIndex === -1 ? overItems.length : overIndex
      overItems.splice(insertAt, 0, { ...moved, status: overCol })
      return { ...prev, [activeCol]: activeItems, [overCol]: overItems }
    })
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    draggingRef.current = false
    setActiveId(null)
    if (!over) return

    const activeCol = findColumn(active.id as string)
    if (!activeCol) return
    const overCol = findColumn(over.id as string) ?? activeCol

    let finalColumns = columns
    if (activeCol === overCol) {
      const items = columns[activeCol]
      const oldIndex = items.findIndex(t => t.id === active.id)
      const newIndex = items.findIndex(t => t.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        finalColumns = { ...columns, [activeCol]: arrayMove(items, oldIndex, newIndex) }
        setColumns(finalColumns)
      }
    }

    try {
      if (activeCol !== overCol) {
        const task = sarcini.find(t => t.id === active.id)
        if (!task) return
        if (overCol === 'finalizat') {
          setJustCompletedId(task.id)
          setTimeout(() => setJustCompletedId(id => id === task.id ? null : id), 500)
        }
        await moveSarcina(workspaceId, task.id, overCol, finalColumns[overCol].length * 1000)
        if (overCol === 'finalizat') maybeSuggestDosarComplete(task)
        await reorderColumn(workspaceId, finalColumns[overCol])
        if (finalColumns[activeCol].length > 0) await reorderColumn(workspaceId, finalColumns[activeCol])
      } else {
        await reorderColumn(workspaceId, finalColumns[activeCol])
      }
    } catch {
      // onSnapshot readuce starea reală din Firestore la următorul tick —
      // nu e nevoie de rollback manual local.
    }
  }

  // Shortcut-urile "▶"/"✓" de pe card — mutare directă, fără drag. Nu ținem
  // stare optimistă locală separată (ca la handleDragEnd): draggingRef e
  // false aici, deci onSnapshot-ul live actualizează `columns` prin
  // useEffect-ul de mai sus imediat ce scrierea ajunge la Firestore.
  const handleQuickMove = async (task: Sarcina, newStatus: SarcinaStatus) => {
    if (newStatus === task.status) return
    if (newStatus === 'finalizat') {
      setJustCompletedId(task.id)
      setTimeout(() => setJustCompletedId(id => id === task.id ? null : id), 500)
    }
    try {
      await moveSarcina(workspaceId, task.id, newStatus, columns[newStatus].length * 1000)
      if (newStatus === 'finalizat') maybeSuggestDosarComplete(task)
    } catch {
      // onSnapshot readuce starea reală din Firestore la următorul tick.
    }
  }

  const handleArchive = async (task: Sarcina) => {
    try {
      await archiveSarcinaNow(workspaceId, task.id)
      toast('Sarcină arhivată', 'ok')
      onArchived?.()
    } catch (err: unknown) {
      toast((err as Error).message ?? 'Eroare la arhivare', 'err')
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div className="kanban-board">
        {SARCINA_STATUS_ORDER.map(status => (
          <KanbanColumn key={status} status={status} tasks={columns[status]} onOpenTask={onOpenTask} onQuickMove={handleQuickMove} onDeleteTask={onDeleteTask} onArchiveTask={handleArchive} justCompletedId={justCompletedId}>
            {status === 'deschis' ? <QuickAddRow onAdd={onQuickAdd} /> : undefined}
          </KanbanColumn>
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} onOpen={() => {}} onAdvance={() => {}} onFinish={() => {}} onBack={() => {}} onDelete={() => {}} onArchive={() => {}} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
