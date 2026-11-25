import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../AppContext'
import Modal from '../Modal'
import { formatDateRo } from '../../lib/dates'
import { useCereriDeVerificat } from '../../lib/cereri'
import '../../styles/cereri.css'

/** „Documente primite”: tot ce au trimis clienții prin link și așteaptă verificarea, la toți clienții. Butonul apare
 * doar când e ceva de verificat; fiecare rând deschide documentele clientului. Merge și fără alerte pornite. */
export default function DocumentePrimite() {
  const { activeWorkspace } = useApp()
  const cereri = useCereriDeVerificat(activeWorkspace?.id ?? null)
  const navigate = useNavigate()
  const [deschis, setDeschis] = useState(false)
  const total = cereri.reduce((n, c) => n + c.deVerificat, 0)
  if (!total) return null
  const ultima = (acte: { primitLa: Date | null }[]) =>
    acte.reduce<Date | null>((m, a) => (a.primitLa && (!m || a.primitLa > m) ? a.primitLa : m), null)

  return (
    <>
      <button type="button" className="btn btn-ghost cer-primite-btn" onClick={() => setDeschis(true)}
        title="Acte trimise de clienți prin link, de verificat">
        <span className="cer-primite-punct" aria-hidden />
        <span className="btn-label">{total === 1 ? 'Un act primit' : `${total} acte primite`}</span>
        <span className="btn-label-m">{total}</span>
      </button>
      {deschis && (
        <Modal onClose={() => setDeschis(false)} className="cer-modal" ariaLabel="Documente primite">
          <div className="modal-head">
            <span className="modal-title">Documente primite de la clienți</span>
            <button className="modal-close" onClick={() => setDeschis(false)} aria-label="Închide">×</button>
          </div>
          <div className="modal-body">
            <p className="cer-intro">Acte trimise prin linkurile de cerere. Deschide clientul ca să le vezi și să le accepți sau să le respingi.</p>
            <ul className="cer-primite">
              {cereri.map(c => {
                const cand = ultima(c.acte)
                return (
                  <li key={c.id}>
                    <button type="button" className="cer-primite-rand" onClick={() => {
                      setDeschis(false)
                      navigate(`/?open=${encodeURIComponent(c.clientId)}&sectiune=documente`)
                    }}>
                      <span className="cer-primite-client">{c.clientNume || 'Client'}</span>
                      <span className="doc-meta">
                        {c.deVerificat === 1 ? 'un act de verificat' : `${c.deVerificat} acte de verificat`}
                        {cand ? ` · primit pe ${formatDateRo(cand)}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </Modal>
      )}
    </>
  )
}
