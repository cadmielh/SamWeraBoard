import type { ReactNode } from 'react'
import Modal from './Modal'

interface Props {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  title, message, confirmLabel = 'Confirmă', cancelLabel = 'Anulează', danger, onConfirm, onCancel,
}: Props) {
  return (
    <Modal onClose={onCancel} className="modal-box--sm" ariaLabel={title}>
      <div className="modal-head">
        <span className="modal-title">{title}</span>
        <button className="modal-close" onClick={onCancel}>×</button>
      </div>
      <div className="modal-body">
        <p style={{ color: 'var(--s600)', fontSize: '.9375rem', margin: 0 }}>{message}</p>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onCancel}>{cancelLabel}</button>
        <button
          className={danger ? 'btn' : 'btn btn-primary'}
          style={danger ? { background: 'var(--r500)', color: '#fff' } : undefined}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
