import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import { apiJson } from '../lib/api'
import { contactEmail } from '../lib/legalConfig'
import DeleteAccountModal from './DeleteAccountModal'
import IconExport from './IconExport'
import IconTrash from './IconTrash'

/** Cont și confidențialitate: acceptarea textelor legale de către cabinet, exportul datelor contului, ștergerea contului. */
export default function PrivacyCard() {
  const { user, activeWorkspace, toast } = useApp()
  const hasPassword = user.providerData.some(p => p.providerId === 'password')
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const consent = activeWorkspace?.consent

  const exportData = async () => {
    setExporting(true)
    try {
      const data = await apiJson('GET', '/account/export')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `cabinio-datele-contului-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast((e as Error).message ?? 'Exportul a eșuat', 'err')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">🛡️ Cont și confidențialitate</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', fontSize: '.875rem', color: 'var(--s600)' }}>
        {activeWorkspace && (
          <div>
            {consent
              ? <>Termenii și DPA pentru „{activeWorkspace.name}” sunt acceptați: versiunea <strong>{consent.tos}</strong>
                {consent.acceptedAt ? <> pe {consent.acceptedAt.toDate().toLocaleDateString('ro-RO')}</> : null}.</>
              : <>Termenii și DPA pentru „{activeWorkspace.name}” nu au fost acceptați încă de administrator.</>}
          </div>
        )}
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <Link to="/confidentialitate">Confidențialitate</Link>·<Link to="/termeni">Termeni și condiții</Link>·<Link to="/dpa">DPA</Link>
        </div>

        <div style={{ borderTop: '1px solid var(--s100)', paddingTop: '.75rem' }}>
          Conform GDPR, poți descărca o copie a datelor contului tău sau îți poți șterge contul. Datele clienților aparțin cabinetului și sunt reglementate de DPA.
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => void exportData()} disabled={exporting}>
            {exporting ? <span className="spin spin-dark" /> : <><IconExport size={14} /> Exportă datele mele</>}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}><IconTrash size={14} /> Șterge contul</button>
        </div>
        <div>
          Pentru cereri privind datele personale: <a href={`mailto:${contactEmail()}`}>{contactEmail()}</a>
        </div>
      </div>
      {deleting && <DeleteAccountModal hasPassword={hasPassword} onClose={() => setDeleting(false)} />}
    </div>
  )
}
