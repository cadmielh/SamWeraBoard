import { useEffect, useState } from 'react'
import type { Client, Persoana } from '../../types'
import type { ClientPatchProposal } from '../../lib/clauseFieldSpecs'
import {
  avertizareMandat, durataAni, durataFraza, durataScurta, stareDurataSocietate, stareMandat, tipuriMandat, type Durata, type Mandat,
} from '../../lib/durata'
import { mandateActualizate, persoaneActualizate } from '../../lib/placeholders'
import DurataFields from './DurataFields'
import TermenBadge from '../TermenBadge'

const numeComplet = (p: Persoana) => `${p.nume} ${p.prenume}`.trim()

interface DurataSocietateProps {
  client?: Partial<Client> | null
  onField: (key: string, value: string) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
}

/** Clauza „Durata societății”: noua durată, cu cea din fișă alături; după generare se propune actualizarea fișei.
 * Scrie ambele forme, ca să meargă și „ca fiind {{DURATA_SOCIETATE}}”, și „{{DURATA_SOCIETATE_TEXT}}”. */
export function DurataSocietateClauseFields({ client, onField, onClientPatch }: DurataSocietateProps) {
  const [durata, setDurata] = useState<Durata | null>(null)
  const actuala = durataFraza(client?.durataSocietate)

  const change = (d: Durata) => {
    setDurata(d)
    onField('DURATA_SOCIETATE', durataScurta(d))
    onField('DURATA_SOCIETATE_TEXT', durataFraza(d))
    onClientPatch(durataFraza(d) ? { label: `Durata societății: ${durataFraza(d)}`, patch: { durataSocietate: d } } : null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
      <span style={{ fontSize: '.75rem', color: 'var(--s500)' }}>
        În fișă: {actuala || 'necompletată'}
        {client?.durataSocietate && client.durataSocietate.tip !== 'nedeterminata' && (
          <> · <TermenBadge stare={stareDurataSocietate(client.durataSocietate, client.dataInmatricularii)} /></>
        )}
      </span>
      <DurataFields tipuri={['nedeterminata', 'ani', 'data']} value={durata} onChange={change} />
    </div>
  )
}

interface MandatNouProps {
  client?: Partial<Client> | null
  dataDocument: string
  onField: (key: string, value: string) => void
}

/** Durata mandatului unui administrator numit prin clauză (persoana se alege separat, din lista rolului) — scrie
 * forma de frază și pe celelalte, pentru șabloanele care le folosesc. Fișa se actualizează din formularul clientului. */
export function MandatNouClauseFields({ client, dataDocument, onField }: MandatNouProps) {
  const [durata, setDurata] = useState<Durata | null>(null)
  const avertizare = durata ? avertizareMandat(client?.formaJuridica, { durata, inceput: 'data', dataNumire: dataDocument }) : ''
  const change = (d: Durata) => {
    setDurata(d)
    onField('DURATA_MANDAT_TEXT', durataFraza(d))
    onField('DURATA_MANDAT', durataScurta(d))
    onField('DURATA_MANDAT_ANI', durataAni(d))
  }
  return (
    <div className="field">
      <label className="field-label">Durata mandatului</label>
      <DurataFields tipuri={tipuriMandat(client?.formaJuridica)} value={durata} onChange={change} />
      {avertizare && <span style={{ fontSize: '.75rem', color: 'var(--y700)' }}>⚠ {avertizare}</span>}
    </div>
  )
}

interface DurataMandatProps {
  client?: Partial<Client> | null
  /** Data hotărârii (a documentului) — de la ea curge noul mandat. */
  dataDocument: string
  /** Clauza scrie numele administratorilor („durata mandatului {{ADMINISTRATORI_MANDAT_ROL}} {{ADMINISTRATORI_MANDAT}} ca fiind
   * {{DURATA_MANDAT}}”) — doar atunci fiecare poate primi altă durată; fraza „mandatul fiind stabilit …” are una singură. */
  cuNume: boolean
  onField: (key: string, value: string) => void
  onClientPatch: (proposal: ClientPatchProposal | null) => void
}

const AVERTIZARE = { fontSize: '.75rem', color: 'var(--y700)' } as const

/** Clauza „Durata mandatului administratorului”: noua durată și administratorii vizați (toți, implicit). Noul mandat
 * curge de la data hotărârii; după generare se propune actualizarea mandatului lor în fișă. Numele celor bifați intră
 * și în document, pentru șabloanele care le scriu ({{ADMINISTRATORI_MANDAT_ROL}} {{ADMINISTRATORI_MANDAT}}) — acolo
 * fiecare administrator poate primi și altă durată (vezi mandateActualizate). */
export function DurataMandatClauseFields({ client, dataDocument, cuNume, onField, onClientPatch }: DurataMandatProps) {
  const administratori = (client?.administratori ?? []).filter(p => numeComplet(p))
  const [durata, setDurata] = useState<Durata | null>(null)
  const [alesi, setAlesi] = useState<Set<string>>(() => new Set(administratori.map(numeComplet)))
  // Durate diferite: câte una pe administrator (pornind de la cea comună, dacă era aleasă)
  const [separat, setSeparat] = useState(false)
  const [durate, setDurate] = useState<Record<string, Durata>>({})

  const bifati = administratori.filter(p => alesi.has(numeComplet(p)))
  const durataLui = (p: Persoana): Durata | null => (separat ? durate[numeComplet(p)] : durata) ?? null
  const complet = bifati.length > 0 && bifati.every(p => !!durataFraza(durataLui(p)))
  const mandatNou = (d: Durata): Mandat => ({ durata: d, inceput: 'data', dataNumire: dataDocument })
  const avertizare = (d: Durata | null) => d ? avertizareMandat(client?.formaJuridica, mandatNou(d)) : ''

  useEffect(() => {
    if (separat) {
      // Fraza se compune doar când fiecare bifat are durata lui; altfel rămâne de completat (formularul o semnalează)
      const r = complet
        ? mandateActualizate(bifati.map(p => ({ persoana: p, durata: durataLui(p)! })))
        : { ...persoaneActualizate(bifati, 'administrator'), durata: '' }
      onField('ADMINISTRATORI_MANDAT_ROL', r.rol)
      onField('ADMINISTRATORI_MANDAT', r.nume)
      onField('DURATA_MANDAT', r.durata)
      onField('DURATA_MANDAT_TEXT', '')
    } else {
      const { rol, nume } = persoaneActualizate(bifati, 'administrator')
      onField('ADMINISTRATORI_MANDAT_ROL', rol)
      onField('ADMINISTRATORI_MANDAT', nume)
      onField('DURATA_MANDAT', durataScurta(durata))
      onField('DURATA_MANDAT_TEXT', durataFraza(durata))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alesi, separat, durata, durate])

  useEffect(() => {
    if (!complet) { onClientPatch(null); return }
    const aplica = (lista: Persoana[] = []) => lista.map(p => alesi.has(numeComplet(p)) ? { ...p, mandat: mandatNou(durataLui(p)!) } : p)
    const descriere = separat
      ? bifati.map(p => `${numeComplet(p)} ${durataFraza(durataLui(p))}`).join('; ')
      : `${durataFraza(durata)}: ${bifati.map(numeComplet).join(', ')}`
    onClientPatch({
      label: `Mandat de la ${dataDocument} — ${descriere}`,
      patch: { administratori: aplica(client?.administratori) },
      update: current => ({ administratori: aplica(current.administratori) }),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alesi, separat, durata, durate, dataDocument])

  const toggle = (nume: string) => setAlesi(prev => {
    const next = new Set(prev)
    if (next.has(nume)) next.delete(nume); else next.add(nume)
    return next
  })

  const comutaSeparat = (on: boolean) => {
    if (on && durata) setDurate(Object.fromEntries(administratori.map(p => [numeComplet(p), durate[numeComplet(p)] ?? durata])))
    setSeparat(on)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      {!separat && (
        <>
          <DurataFields tipuri={tipuriMandat(client?.formaJuridica)} value={durata} onChange={setDurata} />
          {avertizare(durata) && <span style={AVERTIZARE}>⚠ {avertizare(durata)}</span>}
        </>
      )}
      {administratori.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
          <div className="field-label">Se aplică administratorilor</div>
          {cuNume && (alesi.size > 1 || separat) && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer',
              paddingBottom: '.375rem', borderBottom: '1px solid var(--s200)' }}>
              <input type="checkbox" checked={!separat} onChange={e => comutaSeparat(!e.target.checked)} />
              Aceeași durată pentru toți
            </label>
          )}
          {administratori.map(p => {
            const nume = numeComplet(p)
            const d = durate[nume] ?? null
            return (
              <div key={nume} style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.85rem', cursor: 'pointer', flexWrap: 'wrap' }}>
                  <input type="checkbox" checked={alesi.has(nume)} onChange={() => toggle(nume)} />
                  {p.nume} {p.prenume}
                  <TermenBadge stare={stareMandat(p.mandat)} prefix="acum" />
                </label>
                {separat && alesi.has(nume) && (
                  <div style={{ paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                    <DurataFields tipuri={tipuriMandat(client?.formaJuridica)} value={d}
                      onChange={nou => setDurate(prev => ({ ...prev, [nume]: nou }))} />
                    {avertizare(d) && <span style={AVERTIZARE}>⚠ {avertizare(d)}</span>}
                  </div>
                )}
              </div>
            )
          })}
          {alesi.size === 0 && <span style={AVERTIZARE}>Niciun administrator ales — fișa nu se va actualiza.</span>}
        </div>
      )}
      <span style={{ fontSize: '.75rem', color: 'var(--s500)' }}>Noul mandat curge de la data hotărârii ({dataDocument}).</span>
    </div>
  )
}
