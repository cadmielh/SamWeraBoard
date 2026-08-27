import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Sarcina, SarcinaStatus } from '../../types'
import { SARCINA_STATUS_LABELS, nextSarcinaStatus, previousSarcinaStatus } from '../../types'
import TaskCard from './TaskCard'

interface Props {
  status: SarcinaStatus
  tasks: Sarcina[]
  onOpenTask: (task: Sarcina) => void
  onQuickMove: (task: Sarcina, newStatus: SarcinaStatus) => void
  onDeleteTask: (task: Sarcina) => void
  onArchiveTask: (task: Sarcina) => void
  headerExtra?: React.ReactNode
  children?: React.ReactNode   // QuickAddRow, doar în coloana Deschis
  justCompletedId?: string | null
}

const ACCENT: Record<SarcinaStatus, string> = {
  deschis: 'var(--s400)',
  in_lucru: 'var(--p500)',
  finalizat: 'var(--g500)',
}

export default function KanbanColumn({ status, tasks, onOpenTask, onQuickMove, onDeleteTask, onArchiveTask, headerExtra, children, justCompletedId }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const ids = tasks.map(t => t.id)

  return (
    <div className={`kanban-col${isOver ? ' kanban-col--over' : ''}`}>
      <div className="kanban-col-accent" style={{ background: ACCENT[status] }} />
      <div className="kanban-col-header">
        <span className="kanban-col-title">{SARCINA_STATUS_LABELS[status]}</span>
        <span className="chip chip-muted">{tasks.length}</span>
      </div>
      {headerExtra}
      {children}
      <div ref={setNodeRef} className="kanban-col-body">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={() => onOpenTask(task)}
              onAdvance={() => { const n = nextSarcinaStatus(task.status); if (n) onQuickMove(task, n) }}
              onFinish={() => onQuickMove(task, 'finalizat')}
              onBack={() => { const p = previousSarcinaStatus(task.status); if (p) onQuickMove(task, p) }}
              onDelete={() => onDeleteTask(task)}
              onArchive={() => onArchiveTask(task)}
              justCompleted={task.id === justCompletedId}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="kanban-col-empty">Niciun card aici.</div>
        )}
      </div>
    </div>
  )
}
