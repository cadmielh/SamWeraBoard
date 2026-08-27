import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Sarcina } from '../../types'
import { PRIORITATE_LABELS, PRIORITATE_COLOR, SARCINA_STATUS_LABELS, nextSarcinaStatus, previousSarcinaStatus } from '../../types'
import { getInitials, getAvatarColor } from '../../lib/avatar'
import IconTrash from '../IconTrash'

interface Props {
  task: Sarcina
  onOpen: () => void
  onAdvance: () => void
  onFinish: () => void
  onBack: () => void
  onDelete: () => void
  /** Doar pentru task-uri finalizate — arhivează imediat, fără să aștepte
   * finalul săptămânii (vezi Sarcina.arhivatManual). */
  onArchive: () => void
  justCompleted?: boolean
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type DueUrgency = 'overdue' | 'today' | 'none'

function dueUrgency(task: Sarcina): DueUrgency {
  if (!task.termenLimita || task.status === 'finalizat') return 'none'
  const today = todayISO()
  if (task.termenLimita < today) return 'overdue'
  if (task.termenLimita === today) return 'today'
  return 'none'
}

function fmtDue(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}.${m}`
}

/** Oprește propagarea la nivel de pointerdown (nu doar click) — altfel
 * PointerSensor-ul dnd-kit (atașat pe cardul-părinte prin `listeners`)
 * interpretează apăsarea pe buton ca început de drag, înainte ca onClick să
 * mai apuce să facă stopPropagation. */
function stopPointer(e: React.PointerEvent | React.MouseEvent) {
  e.stopPropagation()
}

export default function TaskCard({ task, onOpen, onAdvance, onFinish, onBack, onDelete, onArchive, justCompleted }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  }
  const urgency = dueUrgency(task)
  const next = nextSarcinaStatus(task.status)
  const previous = previousSarcinaStatus(task.status)
  // "Redeschide" pentru un card finalizat (revenirea reactivează sarcina, nu
  // doar o mută cu o coloană înapoi); pe restul, eticheta arată direct
  // destinația, la fel ca la "▶".
  const backLabel = task.status === 'finalizat' ? '↺ Redeschide' : `◀ ${previous ? SARCINA_STATUS_LABELS[previous] : ''}`

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`kanban-card kanban-card--priority-${task.prioritate}${isDragging ? ' kanban-card--dragging' : ''}${justCompleted ? ' kanban-card--just-completed' : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
    >
      <button
        type="button"
        className="kanban-card-delete-btn"
        onPointerDown={stopPointer}
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="Șterge sarcina"
        aria-label="Șterge sarcina"
      >
        <IconTrash size={16} />
      </button>

      <div className="kanban-card-title">{task.titlu}</div>

      {(task.clientDenumire || task.clientDenumireLibera) && (
        <div className="kanban-card-client">{task.clientDenumire || task.clientDenumireLibera}</div>
      )}

      {task.dosarLabel && <span className="chip chip-muted kanban-card-dosar-badge">🗂️ {task.dosarLabel}</span>}

      <div className="kanban-card-footer">
        <span className={`chip priority-chip-${PRIORITATE_COLOR[task.prioritate]}`}>{PRIORITATE_LABELS[task.prioritate]}</span>
        {task.termenLimita && (
          <span className={`kanban-card-due${urgency !== 'none' ? ` kanban-card-due--${urgency}` : ''}`}>
            📅 {fmtDue(task.termenLimita)}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {task.assigneeNume && (
          <div className="kanban-card-avatar" style={{ background: getAvatarColor(task.assigneeNume) }} title={task.assigneeNume}>
            {getInitials(task.assigneeNume)}
          </div>
        )}
      </div>

      <div className="kanban-card-actions">
        {previous && (
          <button
            type="button"
            className="kanban-card-action-btn"
            onPointerDown={stopPointer}
            onClick={e => { e.stopPropagation(); onBack() }}
            title={task.status === 'finalizat' ? 'Redeschide — mută înapoi în „În lucru"' : `Mută înapoi în „${SARCINA_STATUS_LABELS[previous]}"`}
          >
            {backLabel}
          </button>
        )}
        {next && (
          <button
            type="button"
            className="kanban-card-action-btn"
            onPointerDown={stopPointer}
            onClick={e => { e.stopPropagation(); onAdvance() }}
            title={`Mută în „${SARCINA_STATUS_LABELS[next]}"`}
          >
            ▶ {SARCINA_STATUS_LABELS[next]}
          </button>
        )}
        {next && next !== 'finalizat' && (
          <button
            type="button"
            className="kanban-card-action-btn kanban-card-action-btn--finish"
            onPointerDown={stopPointer}
            onClick={e => { e.stopPropagation(); onFinish() }}
            title="Marchează direct ca Finalizat"
          >
            ✓ Finalizează
          </button>
        )}
        {task.status === 'finalizat' && (
          <button
            type="button"
            className="kanban-card-action-btn"
            onPointerDown={stopPointer}
            onClick={e => { e.stopPropagation(); onArchive() }}
            title="Arhivează acum, fără să aștepți finalul săptămânii"
          >
            🗄 Arhivează
          </button>
        )}
      </div>
    </div>
  )
}
