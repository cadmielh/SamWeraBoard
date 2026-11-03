import { useState } from 'react'
import { listDeliveredTemplates, revokeDeliveredTemplate, type DeliveredTemplate } from '../lib/api'
import ConfirmModal from './ConfirmModal'

/** Super admin: șabloanele livrate unui cabinet, cu retragerea unei livrări greșite. Lista (fără fișiere) se
 * încarcă doar la cerere, ca pagina cu toate cabinetele să nu facă o cerere pentru fiecare. */
export default function DeliveredTemplatesPanel({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<DeliveredTemplate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<DeliveredTemplate | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      setItems(await listDeliveredTemplates(workspaceId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const revoke = async (t: DeliveredTemplate) => {
    setRevoking(null); setError(null)
    try {
      await revokeDeliveredTemplate(workspaceId, t.id)
      setItems(prev => prev?.filter(x => x.id !== t.id) ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--s100)', marginTop: '.625rem', paddingTop: '.625rem', fontSize: '.8125rem' }}>
      {items === null ? (
        <button className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? <span className="spin" /> : 'Șabloane livrate…'}
        </button>
      ) : items.length === 0 ? (
        <div className="card-sub">Niciun șablon livrat acestui cabinet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--s700)' }}>Șabloane livrate</div>
          {items.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', color: 'var(--s600)' }}>
              <span style={{ flex: 1 }}>
                {t.name}
                {t.deliveredAt && <span className="card-sub"> · {new Date(t.deliveredAt).toLocaleDateString('ro-RO')}</span>}
                {t.revision > 0 && <span className="card-sub"> · modificat de cabinet</span>}
              </span>
              <button className="btn btn-ghost btn-xs" style={{ color: 'var(--r500)' }} onClick={() => setRevoking(t)}>Retrage</button>
            </div>
          ))}
        </div>
      )}
      {error && <div role="alert" style={{ color: 'var(--r600)', marginTop: '.375rem' }}>{error}</div>}
      {revoking && (
        <ConfirmModal
          title="Retragi șablonul livrat?"
          message={revoking.revision > 0
            ? `„${revoking.name}” a fost modificat de cabinet după livrare. Retragerea șterge și modificările lor, definitiv. Folosește-o doar pentru o livrare greșită.`
            : `„${revoking.name}” va fi șters din cabinetul clientului. Folosește retragerea doar pentru o livrare greșită.`}
          confirmLabel="Retrage"
          danger
          onConfirm={() => void revoke(revoking)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  )
}
