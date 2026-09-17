import { useState } from 'react'
import type { Client, Dosar, DosarInput, ObiectCerereItem, StadiuDosar } from '../types'
import { STADIU_DOSAR_LABELS } from '../types'
import { useClienti, EMPTY_CLIENT } from '../lib/clienti'
import { toDateSafe, formatDateRo } from '../lib/dates'
import { formatRon } from '../lib/format'
import { useApp } from '../AppContext'
import { useDosarFinanciar } from '../lib/useDosarFinanciar'
import ClientLinkPicker from './ClientLinkPicker'
import ObiectCereriiTags from './ObiectCereriiTags'
import ResponsabilCombobox from './ResponsabilCombobox'
import Modal from './Modal'

interface Props {
  initial: Dosar | null
  onSave: (data: DosarInput, creeazaSarcina: boolean) => Promise<void>
  onClose: () => void
  /** Pre-completează clientul la creare — folosit de deep-link-ul „+ Dosar nou"
   * din fișa unui client (ClientView). Ignorat la editare. */
  prefillClient?: { id: string; denumire: string; cui?: string }
}

const EMPTY: DosarInput = {
  clientId: undefined, clientDenumire: undefined, clientDenumireLibera: undefined, clientCui: undefined,
  nrInregistrareDosar: '',
  responsabilUid: undefined, responsabilNume: '',
  obiecteCererii: [],
  stadiu: 'in_lucru',
  dataAdmiterii: null, dataPlanificare: null,
  observatii: '',
  taxeOnrc: null, certificatConstatator: null, tarifClient: null,
  esteClientAdi: false, semnaturaElectronica: false,
  facturat: false,
  dataFacturarii: null,
  documentePredateAt: null,
}

/**
 * Formular progresiv — la creare, doar 4 câmpuri esențiale sunt vizibile
 * (Client, Obiectul cererii, Responsabil, Stadiu); restul stau într-o
 * secțiune "Detalii" restrânsă implicit, redeschisă automat la editare.
 * Un registru se completează des și rapid — a cere toate cele 13 câmpuri
 * dintr-un foc contrazice exact ce xlsx-ul face deja prost (rânduri goale,
 * completate ulterior). Restul rămâne oricum editabil inline din DosarView.
 */
export default function DosarModal({ initial, onSave, onClose, prefillClient }: Props) {
  const { user, activeWorkspace, toast, hasFeature } = useApp()
  const samiAdiEnabled = hasFeature('facturareSamiAdi')
  const workspaceId = activeWorkspace?.id ?? null
  const { clienti, loading: clientiLoading, add: addClient } = useClienti(workspaceId)

  // { ...EMPTY, ...initial } (nu doar initial) — dosarele salvate înainte de
  // introducerea unor câmpuri noi (ex. esteClientAdi) nu le au în Firestore,
  // și un checkbox controlat cu value undefined dă avertisment React.
  const [form, setForm] = useState<DosarInput>(() => {
    if (initial) return { ...EMPTY, ...initial }
    if (prefillClient) return { ...EMPTY, clientId: prefillClient.id, clientDenumire: prefillClient.denumire, clientCui: prefillClient.cui }
    return { ...EMPTY }
  })
  const [saving, setSaving] = useState(false)
  const [creatingClient, setCreatingClient] = useState(false)
  const [creeazaSarcina, setCreeazaSarcina] = useState(true)
  const [detaliiOpen, setDetaliiOpen] = useState(!!initial)

  const isEditing = !!initial
  const set = <K extends keyof DosarInput>(key: K, val: DosarInput[K]) => setForm(prev => ({ ...prev, [key]: val }))

  // Previzualizare live a split-ului Sami/Adi, ca în DosarView — recalculată
  // la fiecare schimbare din formular (tarif, taxe, Client Adi, semnătură).
  const { facturareConfig, financiar, cotaSami, pct } = useDosarFinanciar(form)

  const clientPickerValue = form.clientDenumire ?? form.clientDenumireLibera ?? ''

  const selectClient = (c: Client) => {
    set('clientId', c.id)
    set('clientDenumire', c.denumire)
    set('clientCui', c.codFiscal)
    set('clientDenumireLibera', undefined)
  }
  const freeTextClient = (text: string) => {
    set('clientId', undefined); set('clientDenumire', undefined); set('clientCui', undefined)
    set('clientDenumireLibera', text || undefined)
  }

  const canUpgradeToClient = isEditing && !!form.clientDenumireLibera && !form.clientId

  const handleUpgradeToClient = async () => {
    if (!workspaceId || !user || !form.clientDenumireLibera) return
    setCreatingClient(true)
    try {
      await addClient(workspaceId, { ...EMPTY_CLIENT, denumire: form.clientDenumireLibera }, user.uid)
      set('clientDenumire', form.clientDenumireLibera)
      set('clientDenumireLibera', undefined)
      toast('Client creat — se leagă de dosar la salvare', 'ok')
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la crearea clientului', 'err')
    } finally {
      setCreatingClient(false)
    }
  }

  const canSave = (!!form.clientId || !!form.clientDenumireLibera) && form.obiecteCererii.length > 0 && !!form.responsabilNume.trim()

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      let clientId = form.clientId
      // Ca la Sarcini: dacă upgrade-ul tocmai a creat clientul, id-ul real
      // poate să nu fi ajuns încă în closure-ul curent — fallback după denumire.
      if (!clientId && form.clientDenumire) {
        clientId = clienti.find(c => c.denumire === form.clientDenumire)?.id
      }
      await onSave({ ...form, clientId }, creeazaSarcina)
      onClose()
    } catch (e: unknown) {
      toast((e as Error).message ?? 'Eroare la salvare', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} ariaLabel={isEditing ? 'Editează dosar' : 'Adaugă dosar'}>
      <div className="modal-head">
        <span className="modal-title">{isEditing ? 'Editează dosar' : 'Dosar nou'}</span>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>

      <form onSubmit={e => { e.preventDefault(); handleSave() }}>
        <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          <div className="form-grid">
            <div className="field full">
              <label className="field-label">Client <span style={{ color: 'var(--r500)' }}>*</span></label>
              <ClientLinkPicker clients={clienti} loading={clientiLoading} value={clientPickerValue} onSelectClient={selectClient} onFreeText={freeTextClient} />
              {canUpgradeToClient && (
                <button type="button" className="btn btn-outline-primary btn-sm" style={{ marginTop: '.5rem' }} onClick={handleUpgradeToClient} disabled={creatingClient}>
                  {creatingClient ? <span className="spin spin-dark" /> : `+ Creează client din „${form.clientDenumireLibera}"`}
                </button>
              )}
            </div>

            <div className="field full">
              <label className="field-label">Obiectul cererii <span style={{ color: 'var(--r500)' }}>*</span></label>
              <ObiectCereriiTags value={form.obiecteCererii} onChange={(items: ObiectCerereItem[]) => set('obiecteCererii', items)} />
            </div>

            <div className="field">
              <label className="field-label">Responsabil <span style={{ color: 'var(--r500)' }}>*</span></label>
              <ResponsabilCombobox
                workspace={activeWorkspace}
                value={form.responsabilNume}
                onChange={(uid, nume) => { set('responsabilUid', uid ?? undefined); set('responsabilNume', nume) }}
              />
            </div>

            <div className="field">
              <label className="field-label">Stadiu</label>
              <select className="field-input" value={form.stadiu} onChange={e => set('stadiu', e.target.value as StadiuDosar)}>
                {(Object.entries(STADIU_DOSAR_LABELS) as [StadiuDosar, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <details open={detaliiOpen} onToggle={e => setDetaliiOpen((e.target as HTMLDetailsElement).open)} style={{ marginTop: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '.8125rem', fontWeight: 700, color: 'var(--s600)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '.25rem 0' }}>
              Detalii (număr dosar, date, taxe, tarif)
            </summary>
            <div className="form-grid" style={{ marginTop: '.75rem' }}>
              <div className="field full">
                <label className="field-label">Nr. înreg. dosar</label>
                <input className="field-input" placeholder="ex: 3088169/05.08.2026" value={form.nrInregistrareDosar} onChange={e => set('nrInregistrareDosar', e.target.value)} />
              </div>

              <div className="field">
                <label className="field-label">Data admiterii</label>
                <input className="field-input" type="date" value={form.dataAdmiterii ?? ''} onChange={e => set('dataAdmiterii', e.target.value || null)} />
              </div>
              <div className="field">
                <label className="field-label">Data planificare</label>
                <input className="field-input" type="date" value={form.dataPlanificare ?? ''} onChange={e => set('dataPlanificare', e.target.value || null)} />
              </div>

              <div className="form-subsection-label">Financiar</div>

              <div className="field">
                <label className="field-label">Tarif client (RON)</label>
                <input className="field-input" type="number" min={0} value={form.tarifClient ?? ''} onChange={e => set('tarifClient', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div className="field">
                <label className="field-label" style={{ visibility: 'hidden' }}>Facturat</label>
                <label className="field-checkbox-row">
                  <input type="checkbox" className="field-checkbox" checked={form.facturat} onChange={e => set('facturat', e.target.checked)} />
                  Facturat
                </label>
              </div>

              {samiAdiEnabled ? (
                <div className="field">
                  <label className="field-checkbox-row">
                    <input type="checkbox" className="field-checkbox" checked={form.semnaturaElectronica} onChange={e => set('semnaturaElectronica', e.target.checked)} />
                    Semnătură electronică
                  </label>
                </div>
              ) : <div className="field" aria-hidden="true" />}
              <div className="field">
                <label className="field-label">Data facturării</label>
                <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)' }}>
                  {form.facturat ? (toDateSafe(form.dataFacturarii) ? formatDateRo(toDateSafe(form.dataFacturarii)!) : '—') : '—'}
                </div>
              </div>

              {samiAdiEnabled && (
                <>
                  <div className="field">
                    <label className="field-label">Taxe ONRC (RON)</label>
                    <input className="field-input" type="number" min={0} value={form.taxeOnrc ?? ''} onChange={e => set('taxeOnrc', e.target.value === '' ? null : Number(e.target.value))} />
                  </div>
                  <div className="field" aria-hidden="true" />

                  <div className="field">
                    <label className="field-label">Taxe Certificat Constatator (RON)</label>
                    <input className="field-input" type="number" min={0} value={form.certificatConstatator ?? ''} onChange={e => set('certificatConstatator', e.target.value === '' ? null : Number(e.target.value))} />
                  </div>
                  <div className="field">
                    <label className="field-checkbox-row">
                      <input type="checkbox" className="field-checkbox" checked={form.esteClientAdi} onChange={e => set('esteClientAdi', e.target.checked)} />
                      Client Adi
                    </label>
                  </div>

                  {form.semnaturaElectronica && (
                    <>
                      <div className="field">
                        <label className="field-label" data-tooltip={`${pct(cotaSami)} din valoare`}>Cuvenit Sami (RON)</label>
                        <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)' }}>{formatRon(financiar.cuvenitSami)}</div>
                      </div>
                      <div className="field">
                        <label className="field-label" data-tooltip={`${pct(1 - cotaSami)} din valoare`}>Cuvenit Adi (RON)</label>
                        <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)' }}>{formatRon(financiar.cuvenitAdi)}</div>
                      </div>
                      <div className="field">
                        <label className="field-label" data-tooltip={`${pct(facturareConfig.caaProcent)} din valoare`}>CAA (RON)</label>
                        <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)' }}>{formatRon(financiar.caa)}</div>
                      </div>
                      <div className="field">
                        <label className="field-label" data-tooltip={`${pct(facturareConfig.impozitProfitCota)} din cuvenit Adi`}>Impozit profit — Adi (RON)</label>
                        <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)' }}>{formatRon(financiar.impozitProfit)}</div>
                      </div>
                    </>
                  )}

                  <div className="field">
                    <label className="field-label">Profit Sami (RON)</label>
                    <div className="field-input" style={{ background: 'var(--s50)', color: financiar.profitSami >= 0 ? 'var(--g700)' : 'var(--r600)', fontWeight: 700 }}>
                      {formatRon(financiar.profitSami)}
                    </div>
                  </div>
                  {form.semnaturaElectronica && (
                    <div className="field">
                      <label className="field-label">De facturat către Adi (RON)</label>
                      <div className="field-input" style={{ background: 'var(--s50)', color: financiar.profitAdi <= 0 ? 'var(--g700)' : 'var(--r600)', fontWeight: 700 }}>
                        {formatRon(financiar.profitAdi)}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="field full">
                <label className="field-label">Observații</label>
                <textarea className="field-textarea" rows={2} value={form.observatii} onChange={e => set('observatii', e.target.value)} />
              </div>
            </div>
          </details>

          {!isEditing && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8125rem', color: 'var(--s600)', marginTop: '1rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={creeazaSarcina} onChange={e => setCreeazaSarcina(e.target.checked)} />
              Creează și o sarcină pe board
            </label>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Anulează</button>
          <button type="submit" className="btn btn-primary" disabled={!canSave || saving}>
            {saving ? <><span className="spin" />Se salvează...</> : (isEditing ? 'Salvează' : 'Adaugă dosar')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
