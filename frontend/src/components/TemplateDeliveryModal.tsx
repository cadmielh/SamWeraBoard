import { useEffect, useMemo, useState } from 'react'
import type { BuiltinTemplate, DocTemplate, ToastItem, Workspace } from '../types'
import { deliverTemplate, type DeliveryBlocker, type DeliveryWarnings } from '../lib/api'
import { formLinkOptions } from '../lib/templateChanges'
import { listAllWorkspaces } from '../lib/workspace'
import Modal from './Modal'

const BLOCKER_LABELS: Record<DeliveryBlocker, string> = {
  personal_data: 'Documentul pare să conțină un CNP real. Șterge datele personale din document.',
  comments: 'Documentul are comentarii. Șterge-le (Word: Revizuire → Ștergere comentarii).',
  tracked_changes: 'Documentul are modificări urmărite. Acceptă-le sau respinge-le (Word: Revizuire → Accept).',
  custom_properties: 'Documentul are proprietăți personalizate. Șterge-le (Word: Fișier → Informații → Proprietăți).',
}

interface Props {
  template: DocTemplate
  sourceWorkspaceId: string
  builtins: BuiltinTemplate[]
  onClose: () => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

type Check = { status: 'ok'; warnings: DeliveryWarnings } | { status: 'blocked'; blocking: DeliveryBlocker[] }

/** Super admin: trimite un șablon pregătit din cabinetul propriu în cabinetul unui client (templates_api.py).
 * Numele cabinetului se retastează și se verifică pe server, iar trimiterea e posibilă doar după o verificare
 * reușită pentru exact aceeași alegere: cabinetul greșit e cel mai grav risc al acestui flux. */
export default function TemplateDeliveryModal({ template, sourceWorkspaceId, builtins, onClose, onToast }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [targetId, setTargetId] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const formOptions = useMemo(() => formLinkOptions(builtins), [builtins])
  // O copie a unui șablon de bază fără efect la livrare (ex. actul constitutiv) pornește de la „fără formular dedicat”.
  const [sourceKey, setSourceKey] = useState(() => formOptions.some(o => o.key === template.sourceKey) ? template.sourceKey! : '')
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<{ key: string; result: Check } | null>(null)
  const [alreadyDelivered, setAlreadyDelivered] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listAllWorkspaces()
      .then(list => {
        if (cancelled) return
        setWorkspaces(list
          .filter(w => w.id !== sourceWorkspaceId && w.status !== 'pendingDeletion')
          .sort((a, b) => a.name.localeCompare(b.name, 'ro')))
      })
      .catch(() => { if (!cancelled) setError('Lista cabinetelor nu s-a putut încărca.') })
    return () => { cancelled = true }
  }, [sourceWorkspaceId])

  const target = workspaces?.find(w => w.id === targetId)
  const ownerEmail = target ? target.members?.[target.ownerId]?.email : undefined
  // Verificarea e valabilă doar pentru combinația exactă cu care a rulat.
  const choiceKey = `${targetId}|${confirmName}|${sourceKey}`
  const checked = check?.key === choiceKey ? check.result : null
  const builtinName = useMemo(() => Object.fromEntries(builtins.map(b => [b.key, b.name])), [builtins])

  const run = async (dryRun: boolean, asNewCopy = false) => {
    setBusy(true); setError(null); setAlreadyDelivered(false)
    try {
      const res = await deliverTemplate({
        targetWorkspaceId: targetId, sourceTemplateId: template.id, confirmName, sourceKey: sourceKey || null, dryRun, asNewCopy,
      })
      if (dryRun) { setCheck({ key: choiceKey, result: { status: 'ok', warnings: res.warnings ?? {} } }); return }
      onToast(`„${template.name}” a fost trimis cabinetului „${target?.name}”. Șterge acum copia din cabinetul tău.`, 'ok')
      onClose()
    } catch (err) {
      const e = err as Error & { code?: string; data?: { blocking?: DeliveryBlocker[] } }
      if (e.code === 'template_blocked') setCheck({ key: choiceKey, result: { status: 'blocked', blocking: e.data?.blocking ?? [] } })
      else if (e.code === 'already_delivered') setAlreadyDelivered(true)
      else setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const canCheck = !!targetId && !!confirmName.trim() && !busy

  return (
    <Modal onClose={onClose} ariaLabel="Trimite șablonul altui cabinet" boxStyle={{ maxWidth: 520 }}>
      <div className="modal-head">
        <span className="modal-title">Trimite „{template.name}” altui cabinet</span>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
        <p style={{ fontSize: '.8rem', color: 'var(--s500)', margin: 0 }}>
          Cabinetul primește o copie, fără autorul și titlul din proprietățile documentului. Doar cabinetele cu abonament
          pot primi șabloane, iar o livrare nu suprascrie niciodată un șablon existent.
        </p>

        <div className="field">
          <label className="field-label" htmlFor="dlv-target">Cabinetul clientului</label>
          <select id="dlv-target" className="field-input" style={{ appearance: 'auto' }} value={targetId}
            disabled={!workspaces} onChange={e => { setTargetId(e.target.value); setConfirmName('') }}>
            <option value="">{workspaces ? 'Alege cabinetul…' : 'Se încarcă…'}</option>
            {workspaces?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {target && (
            <p style={{ fontSize: '.72rem', color: 'var(--s500)', marginTop: '.25rem' }}>
              ID …{target.id.slice(-6)}{ownerEmail ? ` · proprietar ${ownerEmail}` : ''}
            </p>
          )}
        </div>

        {target && (
          <div className="field">
            <label className="field-label" htmlFor="dlv-confirm">Retastează numele cabinetului: <strong>{target.name}</strong></label>
            <input id="dlv-confirm" className="field-input" value={confirmName} autoComplete="off"
              onChange={e => setConfirmName(e.target.value)} onPaste={e => e.preventDefault()} />
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="dlv-form">Formular</label>
          <select id="dlv-form" className="field-input" style={{ appearance: 'auto' }} value={sourceKey} onChange={e => setSourceKey(e.target.value)}>
            <option value="">Fără formular dedicat (câmpuri din etichete)</option>
            {formOptions.map(o => <option key={o.key} value={o.key}>Ca „{o.name}”</option>)}
          </select>
          <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '.25rem' }}>
            {formOptions.find(o => o.key === sourceKey)?.effect
              ?? 'Formularul se construiește din etichetele {{ }} ale documentului. Potrivit pentru majoritatea șabloanelor.'}
          </p>
        </div>

        {checked?.status === 'blocked' && (
          <div role="alert" style={{ background: 'var(--r50)', border: '1.5px solid var(--r200)', borderRadius: 'var(--r-sm)', padding: '.75rem', fontSize: '.8rem', color: 'var(--r600)' }}>
            <strong>Documentul nu poate fi trimis:</strong>
            <ul style={{ margin: '.375rem 0 0', paddingLeft: '1.1rem' }}>
              {checked.blocking.map(b => <li key={b}>{BLOCKER_LABELS[b] ?? b}</li>)}
            </ul>
            Corectează documentul, înlocuiește fișierul șablonului și verifică din nou.
          </div>
        )}
        {checked?.status === 'ok' && (
          <div role="status" style={{ background: 'var(--g50)', border: '1.5px solid var(--g300)', borderRadius: 'var(--r-sm)', padding: '.75rem', fontSize: '.8rem', color: 'var(--s700)' }}>
            <strong style={{ color: 'var(--g700)' }}>✓ Verificare reușită.</strong>
            {checked.warnings.noPlaceholders && <div>⚠️ Șablonul nu are nicio etichetă: nu se va completa nimic automat.</div>}
            {!!checked.warnings.dedicatedFormUnasked?.length && (
              <div>
                ⚠️ Formularul „{builtinName[sourceKey] ?? sourceKey}” nu cere: {checked.warnings.dedicatedFormUnasked.join(', ')}. Aceste câmpuri vor rămâne
                necompletate.
              </div>
            )}
          </div>
        )}
        {alreadyDelivered && (
          <div role="alert" style={{ fontSize: '.8rem', color: 'var(--o700)' }}>
            Șablonul a fost deja trimis acestui cabinet. Copia lui nu se suprascrie; poți trimite o copie nouă, pe care clientul o va vedea
            alături de cea veche.
            <div style={{ marginTop: '.375rem' }}>
              <button className="btn btn-outline-primary btn-sm" disabled={busy} onClick={() => void run(false, true)}>Trimite ca o copie nouă</button>
            </div>
          </div>
        )}
        {error && <div role="alert" style={{ fontSize: '.8rem', color: 'var(--r500)' }}>{error}</div>}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Renunță</button>
        <button className="btn btn-outline-primary" disabled={!canCheck} onClick={() => void run(true)}>
          {busy && !checked ? <span className="spin" /> : 'Verifică'}
        </button>
        <button className="btn btn-primary" disabled={busy || checked?.status !== 'ok'} onClick={() => void run(false)}>
          {busy && checked ? <span className="spin" /> : 'Trimite'}
        </button>
      </div>
    </Modal>
  )
}
