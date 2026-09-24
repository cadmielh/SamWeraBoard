import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import type { CaenActivitate, Persoana, ToastItem } from '../types'
import { fetchAnafCompany } from '../lib/api'
import { FORME_JURIDICE_PJ } from '../lib/formeJuridice'
import { findCaenDescriere } from '../data/caen'
import { formatAdresa, parseAdresa, stripAdresaLabel, extractJudet, type AdresaStructurata } from '../lib/adresa'
import { blurNumberInputOnWheel } from '../lib/inputEvents'
import CAENCombobox from './CAENCombobox'
import Modal from './Modal'
import IconTrash from './IconTrash'
import SediuSocialFields from './SediuSocialFields'

export interface CompanyData {
  denumire: string
  formaJuridica: string
  codFiscal: string
  nrRegistrul: string
  sediuSocial: AdresaStructurata
  caenCod: string
  caenDescriere: string
  caenSecundare: CaenActivitate[]
  puncteLucru: string[]
  capitalSocial: number | null
}

interface Props {
  value: CompanyData
  onChange: (patch: Partial<CompanyData>) => void
  asociati: Persoana[]
  onToast: (msg: string, type: ToastItem['type']) => void
}

export interface CompanyInfoFormHandle {
  /** Derulează/focalizează primul câmp obligatoriu necompletat; returnează
   * eticheta fiecărui câmp lipsă, în ordinea vizuală din formular (listă goală
   * dacă totul e complet). Folosit de MultiPersonPreview la click pe
   * "Continuă", ca butonul să rămână mereu activ în loc de disabled. */
  scrollToFirstMissing: () => string[]
}

const CompanyInfoForm = forwardRef<CompanyInfoFormHandle, Props>(function CompanyInfoForm(
  { value, onChange, asociati, onToast }, ref,
) {
  const [anafLoading, setAnafLoading] = useState(false)
  const [sediuPicker, setSediuPicker] = useState(false)
  // Efemer, doar pentru sesiunea curentă de completare — CompanyData (folosit
  // și pentru un client nou, fără fișă persistată încă) nu ține proveniența
  // ANAF; hint-ul dispare dacă formularul se resetează/închide.
  const [anafSnapshot, setAnafSnapshot] = useState<AdresaStructurata | null>(null)
  const [anafSyncedAt, setAnafSyncedAt] = useState<string | null>(null)
  const [anafRawText, setAnafRawText] = useState<string | null>(null)

  const denumireRef = useRef<HTMLInputElement>(null)
  const formaJuridicaRef = useRef<HTMLSelectElement>(null)
  const codFiscalRef = useRef<HTMLInputElement>(null)
  const nrRegistrulRef = useRef<HTMLInputElement>(null)
  const sediuSocialRef = useRef<HTMLInputElement>(null)
  const capitalSocialRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof CompanyData>(key: K, val: CompanyData[K]) => onChange({ [key]: val } as Partial<CompanyData>)
  const setSediu = (patch: Partial<AdresaStructurata>) => onChange({ sediuSocial: { ...value.sediuSocial, ...patch } })

  const cifTrimmed = value.codFiscal.trim()
  const cifError = cifTrimmed && !/^(RO)?\d{2,10}$/i.test(cifTrimmed)
    ? 'CIF invalid (ex: RO12345678 sau 12345678)'
    : ''

  useImperativeHandle(ref, () => ({
    scrollToFirstMissing: () => {
      const checks: { invalid: boolean; ref: React.RefObject<HTMLElement | null>; message: string }[] = [
        { invalid: !value.denumire.trim(), ref: denumireRef, message: 'denumirea' },
        { invalid: !value.formaJuridica.trim(), ref: formaJuridicaRef, message: 'forma juridică' },
        { invalid: !cifTrimmed || !!cifError, ref: codFiscalRef, message: 'CIF' },
        { invalid: !value.nrRegistrul.trim(), ref: nrRegistrulRef, message: 'nr. registrul comerțului' },
        { invalid: !formatAdresa(value.sediuSocial).trim(), ref: sediuSocialRef, message: 'sediul social' },
        { invalid: value.capitalSocial == null || value.capitalSocial <= 0, ref: capitalSocialRef, message: 'capitalul social' },
      ]
      const failing = checks.filter(c => c.invalid)
      if (failing.length > 0) {
        failing[0].ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        failing[0].ref.current?.focus()
      }
      return failing.map(c => c.message)
    },
  }))

  const preiaAnaf = async () => {
    if (!value.codFiscal.trim()) return
    setAnafLoading(true)
    try {
      const result = await fetchAnafCompany(value.codFiscal)
      if (!result.found) { onToast('CIF-ul nu a fost găsit în baza de date ANAF', 'info'); return }
      const c = result.adresaSediuComponente
      const totalGoale = !c || (!c.strada && !c.numar && !c.localitate && !c.judet && !c.detaliiAdresa)
      const dinDetalii = c?.detaliiAdresa ? parseAdresa(c.detaliiAdresa) : null
      const detaliiNeetichetate = dinDetalii?.localitate
      const judetRezolvat = c
        ? extractJudet(`${c.judet ?? ''} ${c.localitate ?? ''}`) || extractJudet(result.adresa) || value.sediuSocial.judet
        : value.sediuSocial.judet
      const sediuNou = totalGoale
        ? (result.adresa ? parseAdresa(result.adresa) : value.sediuSocial)
        : {
            localitate: stripAdresaLabel('localitate', c!.localitate)
              || (judetRezolvat.startsWith('București') ? 'București' : '')
              || value.sediuSocial.localitate,
            strada:     stripAdresaLabel('strada', c!.strada)         || value.sediuSocial.strada,
            numar:      stripAdresaLabel('numar', c!.numar)           || value.sediuSocial.numar,
            judet:      judetRezolvat,
            bloc:       dinDetalii?.bloc       || value.sediuSocial.bloc,
            scara:      dinDetalii?.scara      || value.sediuSocial.scara,
            etaj:       dinDetalii?.etaj       || value.sediuSocial.etaj,
            apartament: [dinDetalii?.apartament, detaliiNeetichetate].filter(Boolean).join(' ').trim()
              || value.sediuSocial.apartament,
          }
      setAnafSnapshot(sediuNou)
      setAnafSyncedAt(new Date().toISOString())
      setAnafRawText(result.adresa || null)
      onChange({
        denumire: result.denumire || value.denumire,
        formaJuridica: result.formaJuridica || value.formaJuridica,
        sediuSocial: sediuNou,
        nrRegistrul: result.nrRegCom || value.nrRegistrul,
        caenCod: result.caenCod || value.caenCod,
        caenDescriere: result.caenCod ? findCaenDescriere(result.caenCod) : value.caenDescriere,
        caenSecundare: result.caenSecundare
          ? result.caenSecundare.map(cod => ({ cod, descriere: findCaenDescriere(cod) }))
          : value.caenSecundare,
      })
      onToast('Date preluate de la ANAF', 'ok')
    } catch (e: unknown) {
      onToast((e as Error).message ?? 'Eroare ANAF', 'err')
    } finally {
      setAnafLoading(false)
    }
  }

  const addCaenSecundar = () => set('caenSecundare', [...value.caenSecundare, { cod: '', descriere: '' }])
  const updateCaenSecundar = (i: number, cod: string, descriere: string) => {
    const arr = [...value.caenSecundare]; arr[i] = { cod, descriere }; set('caenSecundare', arr)
  }
  const removeCaenSecundar = (i: number) => {
    const arr = [...value.caenSecundare]; arr.splice(i, 1); set('caenSecundare', arr)
  }

  const addPunctLucru = () => set('puncteLucru', [...value.puncteLucru, ''])
  const updatePunctLucru = (i: number, adresa: string) => {
    const arr = [...value.puncteLucru]; arr[i] = adresa; set('puncteLucru', arr)
  }
  const removePunctLucru = (i: number) => {
    const arr = [...value.puncteLucru]; arr.splice(i, 1); set('puncteLucru', arr)
  }

  const partiSocialeTotal = value.capitalSocial != null ? value.capitalSocial / 10 : null

  if (sediuPicker) {
    return (
      <Modal onClose={() => setSediuPicker(false)} ariaLabel="Alege adresa asociatului">
        <div className="modal-head">
          <span className="modal-title">Copiază sediul de la un asociat</span>
          <button className="modal-close" onClick={() => setSediuPicker(false)}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: '.8125rem', color: 'var(--s400)', marginTop: 0 }}>
            Selectează asociatul a cărui adresă de domiciliu devine sediul social.
          </p>
          {asociati.map((a, i) => {
            const adresaFull = [a.adresa, a.judet].filter(Boolean).join(', ')
            return (
              <button
                key={i}
                type="button"
                className="persoana-card"
                disabled={!adresaFull}
                style={{ width: '100%', textAlign: 'left', cursor: adresaFull ? 'pointer' : 'not-allowed', marginBottom: '.375rem', border: '1px solid var(--s200)', background: 'transparent', opacity: adresaFull ? 1 : .5 }}
                onClick={() => { setSediu({ ...parseAdresa(a.adresa), judet: a.judet }); setSediuPicker(false) }}
              >
                <div>
                  <div className="persoana-card-name">{a.prenume} {a.nume}</div>
                  <div className="persoana-card-sub">{adresaFull || 'Fără adresă completată'}</div>
                </div>
              </button>
            )
          })}
          {asociati.length === 0 && (
            <p style={{ fontSize: '.8125rem', color: 'var(--s400)' }}>Niciun asociat configurat încă.</p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={() => setSediuPicker(false)}>Anulează</button>
        </div>
      </Modal>
    )
  }

  return (
    <div className="form-grid">
      <div className="field full">
        <label className="field-label">Denumire <span style={{ color: 'var(--r500)' }}>*</span></label>
        <input ref={denumireRef} className="field-input" value={value.denumire} onChange={e => set('denumire', e.target.value)} placeholder="Denumirea firmei" />
      </div>

      <div className="field">
        <label className="field-label">Forma juridică <span style={{ color: 'var(--r500)' }}>*</span></label>
        <select ref={formaJuridicaRef} className="field-input" value={value.formaJuridica} onChange={e => set('formaJuridica', e.target.value)}>
          <option value="">— selectați —</option>
          {FORME_JURIDICE_PJ.map(f => <option key={f}>{f}</option>)}
        </select>
      </div>

      <div className="field">
        <label className="field-label">Cod fiscal (CIF) <span style={{ color: 'var(--r500)' }}>*</span></label>
        <div className="field-with-btn">
          <input ref={codFiscalRef} className="field-input" placeholder="ex: RO12345678"
            value={value.codFiscal} onChange={e => set('codFiscal', e.target.value)}
            aria-invalid={!!cifError} />
          <button type="button" className="btn btn-outline-primary btn-sm"
            onClick={preiaAnaf} disabled={!value.codFiscal.trim() || anafLoading}
            title="Preia date de la ANAF" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            {anafLoading ? <span className="spin spin-dark" /> : '🔍 ANAF'}
          </button>
        </div>
        {cifError && <span className="field-error">{cifError}</span>}
      </div>

      <div className="field full">
        <label className="field-label">Nr. registrul comerțului <span style={{ color: 'var(--r500)' }}>*</span></label>
        <input ref={nrRegistrulRef} className="field-input" placeholder="ex: J40/123/2020" value={value.nrRegistrul} onChange={e => set('nrRegistrul', e.target.value)} />
      </div>

      <div className="field full">
        <label className="field-label">Activitate principală (CAEN)</label>
        <CAENCombobox value={value.caenCod} descriere={value.caenDescriere || findCaenDescriere(value.caenCod)}
          onChange={(cod, desc) => onChange({ caenCod: cod, caenDescriere: desc })} />
      </div>

      <div className="field full">
        <label className="field-label">Activități secundare (CAEN)</label>
        {value.caenSecundare.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.375rem' }}>
            <div style={{ flex: 1 }}>
              <CAENCombobox value={a.cod} descriere={a.descriere || findCaenDescriere(a.cod)} onChange={(cod, desc) => updateCaenSecundar(i, cod, desc)} />
            </div>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => removeCaenSecundar(i)} style={{ color: 'var(--r500)' }}><IconTrash /></button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-xs" onClick={addCaenSecundar}>+ Adaugă activitate secundară</button>
      </div>

      <SediuSocialFields
        value={value.sediuSocial}
        onChange={setSediu}
        label="Sediu social"
        required
        anafSnapshot={anafSnapshot}
        anafSyncedAt={anafSyncedAt}
        anafRawText={anafRawText}
        firstFieldRef={sediuSocialRef}
        extraHeaderAction={asociati.length > 0 && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSediuPicker(true)}>
            📍 Folosește adresa unui asociat
          </button>
        )}
      />

      <div className="field full">
        <label className="field-label">Puncte de lucru</label>
        {value.puncteLucru.map((adresa, i) => (
          <div key={i} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.375rem' }}>
            <input className="field-input" style={{ flex: 1 }} value={adresa}
              onChange={e => updatePunctLucru(i, e.target.value)} placeholder="Adresă punct de lucru" />
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => removePunctLucru(i)} style={{ color: 'var(--r500)' }}><IconTrash /></button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-xs" onClick={addPunctLucru}>+ Adaugă punct de lucru</button>
      </div>

      <div className="field">
        <label className="field-label">Capital social (lei) <span style={{ color: 'var(--r500)' }}>*</span></label>
        <input ref={capitalSocialRef} className="field-input" type="number" min={0} placeholder="-"
          value={value.capitalSocial ?? ''}
          onChange={e => set('capitalSocial', e.target.value === '' ? null : Number(e.target.value))}
          onWheel={blurNumberInputOnWheel} />
      </div>
      <div className="field">
        <label className="field-label">Părți sociale</label>
        <div className="field-input" style={{ background: 'var(--s50)', color: 'var(--s600)' }}>
          {partiSocialeTotal != null ? partiSocialeTotal.toLocaleString('ro-RO') : '—'}
        </div>
      </div>
    </div>
  )
})

export default CompanyInfoForm
