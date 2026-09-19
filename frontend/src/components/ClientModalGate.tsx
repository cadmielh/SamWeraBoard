import { useEffect, useState } from 'react'
import type { Client } from '../types'
import type { ClientInput } from '../lib/clienti'
import { clientNeedsReveal, revealClient } from '../lib/pii'
import ClientModal from './ClientModal'
import Modal from './Modal'

interface Props {
  initial: Client | null
  legacyRaw?: string | null
  onSave: (data: ClientInput) => Promise<void>
  onClose: () => void
}

/** Deschide ClientModal doar după ce CNP/serie CI ale persoanelor au fost aduse din
 * vault (cererea e auditată pe server ca „edit”). Fără asta, formularul ar afișa
 * câmpuri goale și salvarea ar suprascrie valorile reale. Pentru clienți noi sau
 * fără date sensibile stocate, randează modalul imediat. */
export default function ClientModalGate({ initial, legacyRaw, onSave, onClose }: Props) {
  const needs = !!initial && clientNeedsReveal(initial)
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; client: Client } | { status: 'error' }>(
    needs ? { status: 'loading' } : { status: 'ready', client: initial as Client },
  )

  useEffect(() => {
    if (!needs || !initial) return
    let cancelled = false
    revealClient(initial, 'edit')
      .then(client => { if (!cancelled) setState({ status: 'ready', client }) })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
    // Se rulează o singură dată per deschidere (componenta e montată doar cât e deschis modalul).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state.status === 'ready') {
    return <ClientModal initial={state.client} legacyRaw={legacyRaw} onSave={onSave} onClose={onClose} />
  }
  return (
    <Modal onClose={onClose} className="modal-box--sm" ariaLabel="Se încarcă datele clientului">
      <div className="modal-body" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
        {state.status === 'loading' ? (
          <>
            <span className="spin spin-dark" style={{ width: 22, height: 22, borderWidth: 3 }} />
            <p style={{ color: 'var(--s500)', fontSize: '.875rem', marginTop: '.75rem' }}>Se încarcă datele sensibile…</p>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--r500)', fontSize: '.9375rem', marginBottom: '.75rem' }}>
              Nu s-au putut încărca datele sensibile ale clientului. Ca să nu suprascriem valorile existente, editarea a fost oprită.
            </p>
            <button className="btn btn-ghost" onClick={onClose}>Închide</button>
          </>
        )}
      </div>
    </Modal>
  )
}
