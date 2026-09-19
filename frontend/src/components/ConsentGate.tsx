import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import { hasCurrentConsent } from '../lib/legal'
import Modal from './Modal'

/** Acceptarea termenilor și a DPA pentru spațiul de lucru activ.
 *  - Administratorul vede un ecran care blochează aplicația până acceptă (workspace-urile migrate
 *    din proiectul vechi și cele cu texte revizuite nu au încă acceptarea versiunii curente).
 *  - Ceilalți membri văd doar un avertisment: nu ei sunt operatorul datelor. */
export default function ConsentGate({ onSignOut }: { onSignOut: () => void }) {
  const { activeWorkspace, userRole, workspaceCtx, toast } = useApp()
  const [accepted, setAccepted] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!activeWorkspace || hasCurrentConsent(activeWorkspace.consent)) return null

  if (userRole !== 'admin') {
    return (
      <div role="alert" style={{ background: 'var(--y50, #fffbeb)', borderBottom: '1px solid var(--y200, #fde68a)', color: 'var(--y700, #b45309)', fontSize: '.8125rem', padding: '.5rem 1rem' }}>
        Administratorul spațiului „{activeWorkspace.name}" nu a acceptat încă termenii și DPA. Până atunci,
        scanarea actelor și lucrul cu CNP nu sunt disponibile.
      </div>
    )
  }

  const accept = async () => {
    setSaving(true)
    try {
      await workspaceCtx.acceptConsent(activeWorkspace.id)
      toast('Termenii și DPA au fost acceptate', 'ok')
    } catch (e) {
      const code = (e as { code?: string }).code
      toast(code === 'invalid_consent'
        ? 'Textele legale au fost actualizate între timp. Reîncarcă pagina (Cmd+Shift+R) și încearcă din nou.'
        : 'Nu s-a putut înregistra acceptarea. Încearcă din nou.', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={() => { /* blocant: nu se poate închide fără acceptare */ }} className="modal-box--sm" ariaLabel="Acceptarea termenilor și a DPA">
      <div className="modal-head"><span className="modal-title">Termeni și acord de prelucrare a datelor</span></div>
      <div className="modal-body">
        <p style={{ color: 'var(--s600)', fontSize: '.9rem', lineHeight: 1.55, marginBottom: '.75rem' }}>
          Spațiul de lucru <strong>{activeWorkspace.name}</strong> conține date personale ale clienților dumneavoastră (inclusiv CNP).
          Pentru a continua, în calitate de administrator, confirmați termenii și acordul de prelucrare a datelor (DPA).
        </p>
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', fontSize: '.8125rem', color: 'var(--s600)', lineHeight: 1.45 }}>
          <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} style={{ marginTop: '.2rem' }} />
          <span>
            Am citit și accept <Link to="/termeni" target="_blank">Termenii și condițiile</Link> și{' '}
            <Link to="/dpa" target="_blank">Acordul de prelucrare a datelor (DPA)</Link>, în numele cabinetului.
            Datele existente rămân neschimbate.
          </span>
        </label>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onSignOut} disabled={saving}>Deconectare</button>
        <button className="btn btn-primary" onClick={accept} disabled={!accepted || saving}>
          {saving ? <span className="spin" /> : 'Accept și continui'}
        </button>
      </div>
    </Modal>
  )
}
