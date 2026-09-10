import { useState } from 'react'
import type { Client, Dosar, Sarcina, SarcinaInput, SarcinaPrioritate, SarcinaStatus } from '../../types'
import { PRIORITATE_LABELS, SARCINA_STATUS_LABELS, SARCINA_STATUS_ORDER, STADIU_DOSAR_LABELS, obiecteCereriiText } from '../../types'
import { useClienti, EMPTY_CLIENT } from '../../lib/clienti'
import { useDosare } from '../../lib/dosare'
import { useApp } from '../../AppContext'
import ClientLinkPicker from '../ClientLinkPicker'
import DosarLinkPicker from '../DosarLinkPicker'
import ResponsabilCombobox from '../ResponsabilCombobox'
import Modal from '../Modal'
import IconTrash from '../IconTrash'

interface Props {
  initial: Sarcina | null
  onSave: (data: SarcinaInput) => Promise<void>
  onClose: () => void
  onDelete?: () => void
  /** Pre-completează clientul la creare — folosit de deep-link-ul „+ Sarcină
   * nouă" din fișa unui client (ClientView). Ignorat la editare. */
  prefillClient?: { id: string; denumire: string }
}

const EMPTY: SarcinaInput = {
  titlu: '', titluLower: '', descriere: '',
  status: 'deschis', prioritate: 'medie',
  termenLimita: null,
  assigneeUid: null, assigneeNume: '',
  clientId: undefined, clientDenumire: undefined, clientDenumireLibera: undefined,
  dosarId: undefined, dosarLabel: undefined,
  order: 0,
  completedAt: null,
}

export default function TaskModal({ initial, onSave, onClose, onDelete, prefillClient }: Props) {
  const { user, activeWorkspace, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const { clienti, loading: clientiLoading, add: addClient } = useClienti(workspaceId)
  const { dosare, loading: dosareLoading } = useDosare(workspaceId)

  const [form, setForm] = useState<SarcinaInput>(() => {
    if (!initial) {
      return {
        ...EMPTY, order: Date.now(), assigneeUid: user?.uid ?? null, assigneeNume: user?.displayName ?? user?.email ?? '',
        clientId: prefillClient?.id, clientDenumire: prefillClient?.denumire,
      }
    }
    // Sarcina are toate câmpurile lui SarcinaInput plus id/createdAt/createdBy —
    // atribuirea e validă structural fără destructurare.
    return initial
  })
  const [saving, setSaving] = useState(false)
  const [creatingClient, setCreatingClient] = useState(false)

  const isEditing = !!initial
  const set = <K extends keyof SarcinaInput>(key: K, val: SarcinaInput[K]) => setForm(prev => ({ ...prev, [key]: val }))

  const clientPickerValue = form.clientDenumire ?? form.clientDenumireLibera ?? ''

  const selectClient = (c: Client) => {
    set('clientId', c.id)
    set('clientDenumire', c.denumire)
    set('clientDenumireLibera', undefined)
  }
  const freeTextClient = (text: string) => {
    if (!text) {
      set('clientId', undefined); set('clientDenumire', undefined); set('clientDenumireLibera', undefined)
      return
    }
    set('clientId', undefined); set('clientDenumire', undefined); set('clientDenumireLibera', text)
  }

  // Legarea de un dosar preia clientul dosarului — sarcina și dosarul ei
  // trebuie să rămână despre același client, altfel legătura e contradictorie.
  const selectDosar = (d: Dosar) => {
    set('dosarId', d.id)
    set('dosarLabel', d.nrInregistrareDosar || obiecteCereriiText(d.obiecteCererii))
    set('clientId', d.clientId)
    set('clientDenumire', d.clientDenumire)
    set('clientDenumireLibera', d.clientId ? undefined : d.clientDenumireLibera)
  }
  const unlinkDosar = () => { set('dosarId', undefined); set('dosarLabel', undefined) }
  const linkedDosar = form.dosarId ? dosare.find(d => d.id === form.dosarId) : undefined

  const canUpgradeToClient = isEditing && !!form.clientDenumireLibera && !form.clientId

  const handleUpgradeToClient = async () => {
    if (!workspaceId || !user || !form.clientDenumireLibera) return
    setCreatingClient(true)
    try {
      await addClient(workspaceId, { ...EMPTY_CLIENT, denumire: form.clientDenumireLibera }, user.uid)
      // Clientul nou apare cu id temporar în starea optimistă a hook-ului local
      // (nu al acestui modal) — cel mai simplu e să legăm sarcina prin denumire
      // și să o lăsăm pe useClienti să rezolve id-ul real la refresh; totuși,
      // pentru UX imediat, căutăm clientul proaspăt adăugat după denumire.
      set('clientDenumire', form.clientDenumireLibera)
      set('clientDenumireLibera', undefined)
      toast('Client creat — se leagă de sarcină la salvare', 'ok')
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la crearea clientului', 'err')
    } finally {
      setCreatingClient(false)
    }
  }

  const canSave = !!form.titlu.trim()

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const titlu = form.titlu.trim()
      let clientId = form.clientId
      // Dacă upgrade-ul tocmai a creat clientul, id-ul lui real poate să nu fi
      // ajuns încă în `clienti` (state async) — îl căutăm după denumire exactă
      // ca fallback, ca legătura să nu rămână orfană.
      if (!clientId && form.clientDenumire) {
        clientId = clienti.find(c => c.denumire === form.clientDenumire)?.id
      }
      await onSave({ ...form, titlu, titluLower: titlu.toLowerCase(), clientId })
      onClose()
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la salvare', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} ariaLabel={isEditing ? 'Editează sarcină' : 'Sarcină nouă'}>
      <div className="modal-head">
        <span className="modal-title">{isEditing ? 'Editează sarcină' : 'Sarcină nouă'}</span>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>

      <form onSubmit={e => { e.preventDefault(); handleSave() }}>
        <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          <div className="form-grid">
            <div className="field full">
              <label className="field-label">Titlu <span style={{ color: 'var(--r500)' }}>*</span></label>
              <input className="field-input" autoFocus value={form.titlu} onChange={e => set('titlu', e.target.value)} required />
            </div>

            <div className="field full">
              <label className="field-label">Descriere</label>
              <textarea className="field-textarea" rows={3} value={form.descriere} onChange={e => set('descriere', e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Stare</label>
              <select className="field-input" value={form.status} onChange={e => set('status', e.target.value as SarcinaStatus)}>
                {SARCINA_STATUS_ORDER.map(key => (
                  <option key={key} value={key}>{SARCINA_STATUS_LABELS[key]}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">Prioritate</label>
              <select className="field-input" value={form.prioritate} onChange={e => set('prioritate', e.target.value as SarcinaPrioritate)}>
                {(Object.entries(PRIORITATE_LABELS) as [SarcinaPrioritate, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">Termen limită</label>
              <input className="field-input" type="date" value={form.termenLimita ?? ''} onChange={e => set('termenLimita', e.target.value || null)} />
            </div>

            <div className="field full">
              <label className="field-label">Responsabil</label>
              <ResponsabilCombobox
                workspace={activeWorkspace}
                value={form.assigneeNume}
                onChange={(uid, nume) => { set('assigneeUid', uid); set('assigneeNume', nume) }}
              />
            </div>

            <div className="field full">
              <label className="field-label">Dosar legat (opțional)</label>
              {linkedDosar ? (
                <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                  <span>{form.dosarLabel} <span style={{ color: 'var(--s400)' }}>— {STADIU_DOSAR_LABELS[linkedDosar.stadiu]}</span></span>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={unlinkDosar} title="Dezleagă dosarul">✕</button>
                </div>
              ) : (
                <DosarLinkPicker dosare={dosare} loading={dosareLoading} value="" onSelect={selectDosar} />
              )}
            </div>

            <div className="field full">
              <label className="field-label">Client (opțional)</label>
              {form.dosarId ? (
                <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)' }}>
                  {clientPickerValue} <span style={{ color: 'var(--s400)' }}>— legat automat de dosarul {form.dosarLabel}</span>
                </div>
              ) : (
                <>
                  <ClientLinkPicker
                    clients={clienti}
                    loading={clientiLoading}
                    value={clientPickerValue}
                    onSelectClient={selectClient}
                    onFreeText={freeTextClient}
                  />
                  {canUpgradeToClient && (
                    <button type="button" className="btn btn-outline-primary btn-sm" style={{ marginTop: '.5rem' }} onClick={handleUpgradeToClient} disabled={creatingClient}>
                      {creatingClient ? <span className="spin spin-dark" /> : `+ Creează client din „${form.clientDenumireLibera}"`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          {isEditing && onDelete && (
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--r500)', marginRight: 'auto' }} onClick={onDelete}><IconTrash /> Șterge</button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Anulează</button>
          <button type="submit" className="btn btn-primary" disabled={!canSave || saving}>
            {saving ? <><span className="spin" />Se salvează...</> : (isEditing ? 'Salvează' : 'Adaugă sarcină')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
