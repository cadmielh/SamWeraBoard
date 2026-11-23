import { useEffect, useState } from 'react'
import Modal from './Modal'
import { numarDocumenteClient } from '../lib/fisiere'
import '../styles/documente.css'

export type ModFisiere = 'arhiveaza' | 'sterge'

interface Props {
  workspaceId: string
  client: { id: string; denumire: string }
  onConfirm: (fisiere: ModFisiere) => void
  onCancel: () => void
}

/** Confirmarea ștergerii unui client. Dacă are documente, utilizatorul alege ce se întâmplă cu ele; implicit trec în
 * Arhiva cabinetului (Setări › Documente), ca nimic să nu se piardă fără o alegere explicită. */
export default function StergeClientModal({ workspaceId, client, onConfirm, onCancel }: Props) {
  const [numar, setNumar] = useState<number | null>(null)
  const [mod, setMod] = useState<ModFisiere>('arhiveaza')

  useEffect(() => {
    let anulat = false
    numarDocumenteClient(workspaceId, client.id)
      .then(n => { if (!anulat) setNumar(n) })
      .catch(() => { if (!anulat) setNumar(0) })      // fără răspuns: serverul arhivează oricum implicit
    return () => { anulat = true }
  }, [workspaceId, client.id])

  const documente = numar === 1 ? 'un document' : `${numar} documente`

  return (
    <Modal onClose={onCancel} className="modal-box--sm" ariaLabel="Șterge client">
      <div className="modal-head">
        <span className="modal-title">Șterge client</span>
        <button className="modal-close" onClick={onCancel} aria-label="Închide">×</button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
        <p style={{ color: 'var(--s600)', fontSize: '.9375rem' }}>
          Ești sigur că vrei să ștergi <strong>{client.denumire}</strong>?
        </p>
        {numar !== null && numar > 0 && (
          <fieldset className="doc-choice-group">
            <legend>
              Clientul are {documente}. Ce faci cu {numar === 1 ? 'el' : 'ele'}?
            </legend>
            <label className={`doc-choice${mod === 'arhiveaza' ? ' is-selected' : ''}`}>
              <input type="radio" name="mod-fisiere" checked={mod === 'arhiveaza'} onChange={() => setMod('arhiveaza')} />
              <span>
                <strong>Păstrează în Arhivă</strong>
                <span className="doc-choice-desc">Le găsești în Setări › Documente, cu numele clientului. Le poți descărca sau șterge oricând.</span>
              </span>
            </label>
            <label className={`doc-choice doc-choice--danger${mod === 'sterge' ? ' is-selected' : ''}`}>
              <input type="radio" name="mod-fisiere" checked={mod === 'sterge'} onChange={() => setMod('sterge')} />
              <span>
                <strong>Șterge definitiv</strong>
                <span className="doc-choice-desc">Documentele se șterg împreună cu clientul și nu mai pot fi recuperate.</span>
              </span>
            </label>
          </fieldset>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onCancel}>Anulează</button>
        <button className="btn" style={{ background: 'var(--r500)', color: '#fff' }} disabled={numar === null} onClick={() => onConfirm(mod)}>
          {numar && mod === 'sterge' ? 'Șterge clientul și documentele' : 'Șterge'}
        </button>
      </div>
    </Modal>
  )
}
