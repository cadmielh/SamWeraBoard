import { useMemo, useState } from 'react'
import type { Client } from '../../types'
import { useApp } from '../../AppContext'
import Modal from '../Modal'
import BtnLabel from '../BtnLabel'
import TrimiteLink from './TrimiteLink'
import IconPlus from '../IconPlus'
import { IconLink } from '../documente/icons'
import {
  MAX_ACTE, ZILE_IMPLICIT, ZILE_VALABILITATE, creeazaCerere, propuneriActe, type ActNou, type PropunereAct,
} from '../../lib/cereri'

/** „Cere documente”: actele (propuse din fișa clientului + adăugate liber), un mesaj și valabilitatea linkului; după
 * creare, aceeași fereastră arată linkul și căile de trimitere. */
export default function CerereNoua({ client, onClose }: { client: Client; onClose: () => void }) {
  const { activeWorkspace, toast } = useApp()
  const propuneri = useMemo(() => propuneriActe(client), [client])
  const [bifate, setBifate] = useState<Set<string>>(() => new Set(propuneri.filter(p => p.bifat).map(p => p.cheie)))
  const [libere, setLibere] = useState<string[]>([])
  // Actele marcate „dacă există” (cheia propunerii sau `l:<act liber>`): cererea se poate încheia și fără ele.
  const [optionale, setOptionale] = useState<Set<string>>(() => new Set())
  const [nou, setNou] = useState('')
  const [mesaj, setMesaj] = useState('')
  const [zile, setZile] = useState<number>(ZILE_IMPLICIT)
  const [busy, setBusy] = useState(false)
  const [gata, setGata] = useState<{ link: string; expiraLa: Date | null } | null>(null)

  const acte: ActNou[] = [
    ...propuneri.filter(p => bifate.has(p.cheie)).map(({ cheie, eticheta, tip, persoanaPid }: PropunereAct) =>
      ({ eticheta, tip, persoanaPid, ...(optionale.has(cheie) ? { optional: true } : {}) })),
    ...libere.map(eticheta => ({ eticheta, tip: 'altul' as const, ...(optionale.has(`l:${eticheta}`) ? { optional: true } : {}) })),
  ]
  const comutaOptional = (cheie: string) => setOptionale(prev => {
    const n = new Set(prev)
    if (n.has(cheie)) n.delete(cheie)
    else n.add(cheie)
    return n
  })
  const optional = (cheie: string, nume: string) => (
    <label className="cer-optional" title="Clientul îl trimite doar dacă îl are; cererea se poate încheia și fără el">
      <input type="checkbox" checked={optionale.has(cheie)} onChange={() => comutaOptional(cheie)} aria-label={`${nume}: doar dacă există`} />
      dacă există
    </label>
  )
  const comuta = (cheie: string) => setBifate(prev => {
    const n = new Set(prev)
    if (n.has(cheie)) n.delete(cheie)
    else n.add(cheie)
    return n
  })
  const adauga = () => {
    const e = nou.trim().replace(/\s+/g, ' ')
    if (!e) return
    if (!libere.some(x => x.toLowerCase() === e.toLowerCase())) setLibere(prev => [...prev, e])
    setNou('')
  }
  const trimite = async () => {
    if (!acte.length || acte.length > MAX_ACTE) return
    setBusy(true)
    try {
      const r = await creeazaCerere(client.id, acte, mesaj.trim(), zile)
      setGata({ link: r.link, expiraLa: r.cerere.expiraLa ? new Date(r.cerere.expiraLa) : null })
    } catch (e) {
      toast((e as Error).message || 'Cererea nu a putut fi creată', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="cer-modal" ariaLabel="Cere documente">
      <div className="modal-head">
        <span className="modal-title">{gata ? 'Trimite linkul clientului' : `Cere documente · ${client.denumire}`}</span>
        <button className="modal-close" onClick={onClose} aria-label="Închide">×</button>
      </div>

      {gata ? (
        <div className="modal-body">
          <p className="cer-intro">
            Cererea e gata. Trimite linkul clientului: îl deschide pe telefon, fotografiază sau alege actele, iar ele apar aici
            ca „de verificat”.
          </p>
          <TrimiteLink link={gata.link} expiraLa={gata.expiraLa} cabinet={activeWorkspace?.name ?? ''} emailClient={client.email}
            onCopiat={ce => toast(ce === 'link' ? 'Linkul a fost copiat.' : 'Mesajul a fost copiat.', 'ok')} />
        </div>
      ) : (
        <div className="modal-body cer-form">
          <fieldset className="cer-grup">
            <legend className="field-label">Ce acte ceri</legend>
            {propuneri.length === 0 && libere.length === 0 && (
              <p className="doc-meta">Fișa nu are persoane cu nume; adaugă mai jos actele cerute.</p>
            )}
            {propuneri.map(p => (
              <div key={p.cheie} className="cer-optiune">
                <label className="cer-optiune-alege">
                  <input type="checkbox" className="cer-check" checked={bifate.has(p.cheie)} onChange={() => comuta(p.cheie)} />
                  <span>
                    <span className="cer-optiune-nume">{p.eticheta}</span>
                    {p.nota && <span className="doc-meta"> · {p.nota}</span>}
                  </span>
                </label>
                {bifate.has(p.cheie) && optional(p.cheie, p.eticheta)}
              </div>
            ))}
            {libere.map(e => (
              <div key={e} className="cer-optiune cer-optiune--liber">
                <input type="checkbox" className="cer-check" checked readOnly aria-label={e} />
                <span className="cer-optiune-nume">{e}</span>
                {optional(`l:${e}`, e)}
                <button type="button" className="doc-icon-btn" onClick={() => setLibere(prev => prev.filter(x => x !== e))}
                  aria-label={`Scoate ${e}`} title="Scoate">×</button>
              </div>
            ))}
            <div className="cer-adauga">
              <input className="field-input" value={nou} maxLength={120} placeholder="Alt act (ex. certificat de căsătorie)"
                onChange={e => setNou(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adauga() } }} aria-label="Alt act" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={adauga} disabled={!nou.trim()}><IconPlus size={12} /> Adaugă</button>
            </div>
          </fieldset>

          <label className="cer-grup">
            <span className="field-label">Mesaj pentru client <span className="doc-meta">(opțional)</span></span>
            <textarea className="field-textarea" rows={2} maxLength={1000} value={mesaj} onChange={e => setMesaj(e.target.value)}
              placeholder="Ex. Pentru schimbarea sediului avem nevoie de actele de mai jos." />
          </label>

          <label className="cer-grup cer-zile">
            <span className="field-label">Linkul e valabil</span>
            <select className="field-input" value={zile} onChange={e => setZile(Number(e.target.value))}>
              {ZILE_VALABILITATE.map(z => <option key={z} value={z}>{z} zile</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="modal-footer">
        {gata ? (
          <button className="btn btn-primary" onClick={onClose}>Gata</button>
        ) : (<>
          <span className="doc-meta cer-numar">{acte.length === 0 ? 'Niciun act ales' : acte.length === 1 ? 'Un act' : `${acte.length} acte`}</span>
          <button className="btn btn-ghost" onClick={onClose}>Renunță</button>
          <button className="btn btn-primary" onClick={() => void trimite()} disabled={busy || !acte.length || acte.length > MAX_ACTE}>
            <BtnLabel busy={busy}><IconLink /> Creează linkul</BtnLabel>
          </button>
        </>)}
      </div>
    </Modal>
  )
}
