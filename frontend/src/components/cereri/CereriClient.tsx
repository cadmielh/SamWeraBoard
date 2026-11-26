import { useState } from 'react'
import type { Client } from '../../types'
import { useApp } from '../../AppContext'
import Modal from '../Modal'
import ConfirmModal from '../ConfirmModal'
import BtnLabel from '../BtnLabel'
import TrimiteLink from './TrimiteLink'
import { IconBifa, IconPrelungeste, IconTrimite, IconX } from '../documente/icons'
import { formatDateRo } from '../../lib/dates'
import { formatMarime, type Fisier } from '../../lib/fisiere'
import {
  ETICHETA_STARE_ACT, ZILE_IMPLICIT, acceptaAct, activa, anuleazaCerere, expirata, linkCerere, prelungesteCerere,
  respingeAct, stareCerere, useCereriClient, type ActCerere, type Cerere,
} from '../../lib/cereri'
import '../../styles/cereri.css'

const TON_CHIP = { ok: 'chip chip-success', info: 'chip chip-primary', atentie: 'chip cer-chip-atentie', stins: 'chip chip-muted' }

/** Cererile de documente ale clientului, în secțiunea „Documente”: cele în lucru deasupra fișierelor,
 * cele încheiate (restrânse) sub ele. Actele primite se verifică aici (previzualizare, Acceptă / Respinge cu motiv). */
export default function CereriClient({ parte, client, fisiere, onPreview, onExtrage }: {
  parte: 'inLucru' | 'incheiate'
  client: Client
  /** Documentele clientului (cele primite prin link sunt printre ele, „de verificat”). */
  fisiere: Fisier[]
  onPreview: (lista: Fisier[], index: number) => void
  /** După acceptarea unui buletin: propune extragerea datelor în fișă din fișierele lui. */
  onExtrage?: (fisiere: string[]) => void
}) {
  const { activeWorkspace } = useApp()
  const cereri = useCereriClient(activeWorkspace?.id ?? null, client.id)
  if (!cereri?.length) return null
  const inLucru = cereri.filter(c => c.stare === 'deschisa' || c.deVerificat > 0)
  const istoric = cereri.filter(c => !inLucru.includes(c))
  if (parte === 'incheiate') {
    if (!istoric.length) return null
    return (
      <details className="cer-istoric">
        <summary className="doc-meta">Cereri încheiate ({istoric.length})</summary>
        {istoric.map(c => <CerereCard key={c.id} c={c} client={client} fisiere={fisiere} onPreview={onPreview} onExtrage={onExtrage} />)}
      </details>
    )
  }
  if (!inLucru.length) return null
  return (
    <div className="cer-lista" aria-label="Cereri de documente">
      {inLucru.map(c => <CerereCard key={c.id} c={c} client={client} fisiere={fisiere} onPreview={onPreview} onExtrage={onExtrage} />)}
    </div>
  )
}

function CerereCard({ c, client, fisiere, onPreview, onExtrage }: {
  c: Cerere; client: Client; fisiere: Fisier[]; onPreview: (lista: Fisier[], index: number) => void
  onExtrage?: (fisiere: string[]) => void
}) {
  const { activeWorkspace, canEdit, toast } = useApp()
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [anuleaza, setAnuleaza] = useState(false)
  const [acum] = useState(() => new Date())        // „expiră curând” se evaluează la deschiderea fișei
  const st = stareCerere(c, acum)
  const deschisa = c.stare === 'deschisa'

  const ruleaza = async (cheie: string, fn: () => Promise<unknown>, ok?: string, actiune?: { label: string; onClick: () => void }) => {
    setBusy(cheie)
    try {
      await fn()
      if (ok) toast(ok, 'ok', actiune ? { action: actiune } : undefined)
    } catch (e) { toast((e as Error).message || 'Operația nu a reușit', 'err') } finally { setBusy(null) }
  }
  const arataLink = () => ruleaza('link', async () => setLink((await linkCerere(c.id)).link))

  return (
    <div className={`cer-card${c.deVerificat > 0 ? ' cer-card--atentie' : ''}`}>
      <div className="cer-card-cap">
        <span className="cer-card-titlu">Cerere{c.creataLa ? ` din ${formatDateRo(c.creataLa)}` : ''}</span>
        <span className={TON_CHIP[st.ton]}>{st.text}</span>
      </div>
      {deschisa && c.expiraLa && (
        <div className="doc-meta">{expirata(c, acum) ? `Linkul a expirat pe ${formatDateRo(c.expiraLa)}` : `Link valabil până pe ${formatDateRo(c.expiraLa)}`}</div>
      )}

      <ul className="cer-acte">
        {c.acte.map(a => (
          <ActRand key={a.id} a={a} fisiere={fisiere} onPreview={onPreview} busy={busy} poateVerifica={canEdit}
            onAccepta={() => ruleaza(`a:${a.id}`, () => acceptaAct(c.id, a.id), `„${a.eticheta}” a fost acceptat.`,
              a.tip === 'ci' && onExtrage ? { label: 'Extrage datele în fișă', onClick: () => onExtrage(a.fisiere) } : undefined)}
            onRespinge={motiv => ruleaza(`r:${a.id}`, () => respingeAct(c.id, a.id, motiv),
              `„${a.eticheta}” a fost respins. Trimite din nou linkul clientului, ca să-l refacă.`)} />
        ))}
      </ul>

      {canEdit && deschisa && (
        <div className="cer-card-actiuni">
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => void arataLink()} disabled={busy === 'link'}>
            <BtnLabel busy={busy === 'link'} dark><IconTrimite size={12} /> Retrimite</BtnLabel>
          </button>
          {(expirata(c, acum) || (c.expiraLa && c.expiraLa.getTime() - acum.getTime() < 3 * 86_400_000)) && (
            <button type="button" className="btn btn-ghost btn-xs" disabled={busy === 'prelungeste'}
              onClick={() => void ruleaza('prelungeste', () => prelungesteCerere(c.id, ZILE_IMPLICIT), `Linkul e valabil încă ${ZILE_IMPLICIT} zile.`)}>
              <IconPrelungeste size={12} /> Prelungește {ZILE_IMPLICIT} zile
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-xs cer-anuleaza" onClick={() => setAnuleaza(true)}><IconX size={11} /> Anulează</button>
        </div>
      )}

      {link && (
        <Modal onClose={() => setLink(null)} className="cer-modal" ariaLabel="Trimite linkul clientului">
          <div className="modal-head">
            <span className="modal-title">Trimite linkul clientului</span>
            <button className="modal-close" onClick={() => setLink(null)} aria-label="Închide">×</button>
          </div>
          <div className="modal-body">
            {!activa(c, acum) && <p className="cer-intro">Linkul a expirat: prelungește cererea, altfel clientul nu poate încărca.</p>}
            <TrimiteLink link={link} expiraLa={c.expiraLa} cabinet={activeWorkspace?.name ?? ''} emailClient={client.email}
              onCopiat={ce => toast(ce === 'link' ? 'Linkul a fost copiat.' : 'Mesajul a fost copiat.', 'ok')} />
          </div>
          <div className="modal-footer"><button className="btn btn-primary" onClick={() => setLink(null)}>Gata</button></div>
        </Modal>
      )}
      {anuleaza && (
        <ConfirmModal title="Anulezi cererea?" confirmLabel="Anulează cererea" danger
          message="Linkul nu va mai funcționa. Actele trimise deja rămân și le poți verifica în continuare."
          onCancel={() => setAnuleaza(false)}
          onConfirm={() => { setAnuleaza(false); void ruleaza('anuleaza', () => anuleazaCerere(c.id), 'Cererea a fost anulată.') }} />
      )}
    </div>
  )
}

function ActRand({ a, fisiere, onPreview, busy, poateVerifica, onAccepta, onRespinge }: {
  a: ActCerere; fisiere: Fisier[]; onPreview: (lista: Fisier[], index: number) => void
  busy: string | null; poateVerifica: boolean; onAccepta: () => void; onRespinge: (motiv: string) => void
}) {
  const [respinge, setRespinge] = useState(false)
  const [motiv, setMotiv] = useState('')
  // Primite: de verificat; acceptate: rămân deschise de aici (au fost mutate și redenumite între documente).
  const primite = a.stare === 'primit' || a.stare === 'acceptat'
    ? a.fisiere.map(id => fisiere.find(f => f.id === id)).filter((f): f is Fisier => !!f) : []
  const ocupat = busy === `a:${a.id}` || busy === `r:${a.id}`
  return (
    <li className={`cer-act cer-act--${a.stare}`}>
      <div className="cer-act-cap">
        <span className="cer-act-nume">{a.eticheta}{a.optional && <span className="doc-meta"> · opțional</span>}</span>
        <span className={`cer-act-stare cer-act-stare--${a.stare}`}>{ETICHETA_STARE_ACT[a.stare]}</span>
      </div>
      {a.stare === 'respins' && a.motiv && <div className="doc-meta">Motiv: {a.motiv}</div>}
      {a.stare === 'lipsa' && <div className="cer-nota-client">{a.notaClient ? <>Nota clientului: „{a.notaClient}”</> : 'Clientul a spus că nu îl are, fără o notă.'}</div>}
      {primite.length > 0 && (
        <>
          <ul className="cer-fisiere">
            {primite.map((f, i) => (
              <li key={f.id}>
                <button type="button" className="doc-link" onClick={() => onPreview(primite, i)}>{f.nume}</button>
                <span className="doc-meta"> · {formatMarime(f.marime)}</span>
              </li>
            ))}
          </ul>
          {poateVerifica && a.stare === 'primit' ? (
            respinge ? (
              <div className="cer-respinge">
                <input className="field-input" autoFocus maxLength={300} value={motiv} placeholder="Motivul, văzut de client (ex. poza e neclară)"
                  onChange={e => setMotiv(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && motiv.trim()) { setRespinge(false); onRespinge(motiv.trim()) }
                    if (e.key === 'Escape') { e.stopPropagation(); setRespinge(false) }
                  }} aria-label="Motivul respingerii" />
                <button type="button" className="btn btn-danger btn-xs" disabled={!motiv.trim()}
                  onClick={() => { setRespinge(false); onRespinge(motiv.trim()) }}><IconX size={11} /> Respinge</button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setRespinge(false)}>Renunță</button>
              </div>
            ) : (
              <div className="cer-verifica">
                <button type="button" className="btn btn-success btn-xs" onClick={onAccepta} disabled={ocupat}>
                  <BtnLabel busy={busy === `a:${a.id}`}><IconBifa size={12} /> Acceptă</BtnLabel>
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setMotiv(''); setRespinge(true) }} disabled={ocupat}><IconX size={11} /> Respinge</button>
              </div>
            )
          ) : null}
        </>
      )}
    </li>
  )
}
