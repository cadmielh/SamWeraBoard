import { useEffect, useMemo, useRef, useState } from 'react'
import type { Client, ToastItem } from '../../types'
import { extractStoredFile, type IDFields } from '../../lib/api'
import { fetchPii, type PiiMap } from '../../lib/pii'
import {
  aplicaAct, cotaPropusa, cotaValida, diferente, etichetaNoua, etichetaTinta, intrari, listeNoi, tintaPropusa, type Tinta,
} from '../../lib/actPersoana'
import { isCotaTotalValid, sumCota } from '../../lib/cota'
import type { Fisier } from '../../lib/fisiere'
import Modal from '../Modal'
import BtnLabel from '../BtnLabel'
import PersonScanModal from '../PersonScanModal'

interface Props {
  client: Client
  fisier: Fisier
  onSaveClient: (patch: Partial<Client>) => Promise<void>
  onClose: () => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

const cheie = (t: Tinta) => t.fel === 'existenta' ? `e:${t.lista}:${t.index}` : `n:${t.lista}`

/** „Extrage datele” dintr-un act păstrat: serverul îl citește (OCR), utilizatorul verifică datele în fereastra obișnuită
 * de scanare, apoi alege persoana din fișă pe care o actualizează (propusă automat) sau o persoană nouă. */
export default function ExtrageAct({ client, fisier, onSaveClient, onClose, onToast }: Props) {
  const [faza, setFaza] = useState<'citire' | 'verificare' | 'tinta'>('citire')
  const [fields, setFields] = useState<IDFields | null>(null)
  const [tinta, setTinta] = useState<Tinta | null>(null)
  const [busy, setBusy] = useState(false)
  const [cota, setCota] = useState(() => cotaPropusa(client))
  // OCR-ul costă: pornește o singură dată per document, nu la fiecare funcție nouă primită de la părinte.
  const inchide = useRef(onClose)
  const mesaj = useRef(onToast)
  useEffect(() => { inchide.current = onClose; mesaj.current = onToast })

  useEffect(() => {
    let anulat = false
    extractStoredFile(fisier.id)
      .then(f => {
        if (anulat) return
        // Un act citit are măcar CNP sau nume; câmpurile precompletate (ex. cetățenia) nu înseamnă că s-a citit ceva.
        if (!f.cnp && !f.nume && !f.prenume) {
          mesaj.current('Nu s-au putut citi date din acest document. Verifică dacă e un act de identitate lizibil.', 'err')
          inchide.current()
          return
        }
        setFields(f)
        setFaza('verificare')
      })
      .catch((e: Error) => { if (!anulat) { mesaj.current(e.message, 'err'); inchide.current() } })
    return () => { anulat = true }
  }, [fisier.id])

  const optiuni = useMemo(() => [
    ...intrari(client).map(i => ({ t: { fel: 'existenta', lista: i.lista, index: i.index } as Tinta, eticheta: `Actualizează: ${i.eticheta}` })),
    ...listeNoi(client).map(l => ({ t: { fel: 'noua', lista: l } as Tinta, eticheta: etichetaNoua(l) })),
  ], [client])

  if (faza === 'citire') {
    return (
      <Modal onClose={onClose} className="modal-box--sm" ariaLabel="Se citește actul">
        <div className="modal-body doc-preview-msg" style={{ justifyContent: 'center' }}>
          <span className="spin spin-dark" /> Se citesc datele din „{fisier.nume}”…
        </div>
      </Modal>
    )
  }

  if (faza === 'verificare' && fields) {
    return (
      <PersonScanModal personLabel={`Din „${fisier.nume}”`} initialFields={fields} onToast={onToast} onClose={onClose}
        onConfirm={f => { setFields(f); setTinta(tintaPropusa(client, f)); setFaza('tinta') }} />
    )
  }

  const schimbari = fields && tinta ? diferente(client, tinta, fields) : []
  const asociatNou = tinta?.fel === 'noua' && tinta.lista === 'asociati'
  const salveaza = async () => {
    if (!fields || !tinta) return
    const cine = etichetaTinta(client, tinta)
    if (tinta.fel === 'existenta' && !schimbari.length) {
      onToast(`Datele din act sunt deja în fișă (${cine}). Nu era nimic de actualizat.`, 'info')
      onClose()
      return
    }
    setBusy(true)
    try {
      // CNP-ul și seria actuale (citire înregistrată în jurnal, ca la editare): un câmp pe care OCR-ul nu l-a citit nu
      // trebuie să-l șteargă pe cel din vault, iar cele două se salvează mereu împreună.
      const pii: PiiMap | undefined = tinta.fel === 'existenta' ? await fetchPii(client.id, 'edit') : undefined
      const patch = aplicaAct(client, tinta, fields, cota, pii)
      await onSaveClient(patch)
      const coteGresite = patch.asociati && !isCotaTotalValid(patch.asociati.map(a => a.cotaParticipare))
        ? ` Cotele asociaților însumează acum ${sumCota(patch.asociati.map(a => a.cotaParticipare))}%: ajustează-le din „Editează”.` : ''
      onToast(tinta.fel === 'noua'
        ? `${[fields.prenume, fields.nume].filter(Boolean).join(' ')} a fost adăugat(ă) în fișă (${cine}).${coteGresite}`
        : `${cine}: actualizat ${schimbari.join(', ')}.${coteGresite}`, coteGresite ? 'info' : 'ok')
      onClose()
    } catch (e) {
      onToast((e as Error).message || 'Datele nu au putut fi salvate în fișă.', 'err')
      setBusy(false)
    }
  }

  const propusa = fields ? cheie(tintaPropusa(client, fields)) : ''
  return (
    <Modal onClose={onClose} className="modal-box--sm" ariaLabel="Unde salvezi datele">
      <div className="modal-head">
        <span className="modal-title">Unde salvezi datele?</span>
        <button className="modal-close" onClick={onClose} aria-label="Închide">×</button>
      </div>
      <div className="modal-body">
        <fieldset className="doc-choice-group">
          <legend>{fields ? [fields.prenume, fields.nume].filter(Boolean).join(' ') || 'Persoana din act' : ''}</legend>
          {optiuni.map(o => (
            <label key={cheie(o.t)} className={`doc-choice${tinta && cheie(tinta) === cheie(o.t) ? ' is-selected' : ''}`}>
              <input type="radio" name="tinta-act" checked={!!tinta && cheie(tinta) === cheie(o.t)} onChange={() => setTinta(o.t)} />
              <span>
                <strong>{o.eticheta}</strong>
                {cheie(o.t) === propusa && <span className="doc-choice-desc">Propus: aceeași persoană (după nume sau CNP).</span>}
                {fields && tinta && cheie(tinta) === cheie(o.t) && o.t.fel === 'existenta' && (
                  <span className="doc-choice-desc doc-choice-schimbari">
                    {schimbari.length ? `Se vor actualiza: ${schimbari.join(', ')}.` : 'Datele coincid deja cu cele din fișă.'}
                  </span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
        {asociatNou && (
          <div className="field" style={{ marginTop: '.875rem' }}>
            <label className="field-label" htmlFor="cota-act">Cota de participare a noului asociat (%)</label>
            <input id="cota-act" className="field-input" inputMode="decimal" value={cota} placeholder="ex. 25"
              onChange={e => setCota(e.target.value)} aria-invalid={!!cota && !cotaValida(cota)} />
            <div className="card-sub">
              Ca la adăugarea din „Editează”: implicit partea egală, iar asociații cu partea egală de dinainte trec la noua parte egală.
            </div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Anulează</button>
        <button className="btn btn-primary" onClick={salveaza} disabled={!tinta || busy || (asociatNou && !cotaValida(cota))}>
          <BtnLabel busy={busy}>Salvează în fișă</BtnLabel>
        </button>
      </div>
    </Modal>
  )
}
