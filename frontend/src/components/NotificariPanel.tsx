import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import {
  amana, amanarePana, areIgnorarePersoana, cuIgnorat, cuTipActiv, dataAlerta, dataScurta, faraIgnorat, felSursa,
  filtreazaAmanate, filtreazaVizibile, marcheazaToateVazute, marcheazaVazut,
  type ContextFiltru,
} from '../lib/alerte'
import { TIP_ALERTA, type Notificare, type PreferinteAlerte, type RolCabinet, type SeveritateAlerta } from '../lib/alerteCatalog'

type Fila = 'noi' | 'toate' | 'amanate'
type Meniu = { id: string; fel: 'amana' | 'mai' } | null

interface Props {
  workspaceId: string
  notificari: Notificare[]
  prefs: PreferinteAlerte
  ctx: ContextFiltru
  /** Rolul în cabinet: decide dacă un tip se poate opri („Nu mai vreau acest tip”). */
  role: RolCabinet | null
  actualizeazaPrefs: (modificare: (p: PreferinteAlerte) => PreferinteAlerte) => Promise<void>
  /** restoreFocus = true la Escape / „×”: focusul revine pe butonul care a deschis panoul. */
  onClose: (restoreFocus: boolean) => void
  panelRef: React.RefObject<HTMLDivElement | null>
  /** Poziția panoului pe ecran (sub clopoțel); pe telefon CSS-ul o ignoră și îl deschide de jos. */
  ancora: { top: number; right: number } | null
}

const ICON_SEVERITATE: Record<SeveritateAlerta, string> = { urgent: '⚠', atentie: '⏳', info: '•' }
const ETICHETA_SEVERITATE: Record<SeveritateAlerta, string> = { urgent: 'Urgent', atentie: 'Atenție', info: 'Informare' }

const IGNORA_SURSA: Record<'client' | 'dosar' | 'sarcina', string> = {
  client: 'Nu mă mai anunța pentru acest client',
  dosar: 'Nu mă mai anunța pentru acest dosar',
  sarcina: 'Nu mă mai anunța pentru această sarcină',
}
const IGNORAT_SURSA: Record<'client' | 'dosar' | 'sarcina', string> = {
  client: 'Nu te mai anunțăm pentru acest client',
  dosar: 'Nu te mai anunțăm pentru acest dosar',
  sarcina: 'Nu te mai anunțăm pentru această sarcină',
}

/** „până mâine”, „până pe 20 nov.” */
function panaLa(d: Date, now: Date): string {
  const t = dataScurta(d, now)
  return t === 'azi' || t === 'mâine' ? `până ${t}` : `până pe ${t}`
}

/** yyyy-mm-dd local, pentru input type="date". */
function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Panoul clopoțelului: filele Noi / Toate / Amânate, cu acțiunile pe fiecare alertă. Randat în portal de NotificariBell. */
export default function NotificariPanel({ workspaceId, notificari, prefs, ctx, role, actualizeazaPrefs, onClose, panelRef, ancora }: Props) {
  const navigate = useNavigate()
  const { toast } = useApp()

  const vizibile = useMemo(() => filtreazaVizibile(notificari, prefs, ctx), [notificari, prefs, ctx])
  const amanate = useMemo(() => filtreazaAmanate(notificari, prefs, ctx), [notificari, prefs, ctx])
  const noi = useMemo(() => vizibile.filter(n => !n.vazut), [vizibile])

  // La deschidere: „Noi” dacă e ceva nou, altfel „Toate”.
  const [fila, setFila] = useState<Fila>(() => noi.length > 0 ? 'noi' : 'toate')
  const [meniu, setMeniu] = useState<Meniu>(null)
  const [dataAleasa, setDataAleasa] = useState('')
  const titluRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { titluRef.current?.focus() }, [])

  // Escape închide întâi meniul deschis pe o alertă, apoi panoul.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (meniu) setMeniu(null)
      else onClose(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [meniu, onClose])

  const lista = fila === 'noi' ? noi : fila === 'toate' ? vizibile : amanate

  const eroare = () => toast('Nu am putut salva. Încearcă din nou.', 'err')

  const deschide = (n: Notificare) => {
    if (!n.vazut) marcheazaVazut(workspaceId, n.id).catch(() => {})
    onClose(false)
    // Linkurile sunt rute interne scrise de server; orice altceva se ignoră.
    if (n.link.startsWith('/')) navigate(n.link)
  }

  const toateVazute = () => {
    const ids = noi.map(n => n.id)
    if (ids.length) marcheazaToateVazute(workspaceId, ids).catch(eroare)
  }

  const amanaPana = (n: Notificare, pana: Date | null) => {
    setMeniu(null)
    setDataAleasa('')
    amana(workspaceId, n.id, pana)
      .then(() => toast(pana ? `Amânat ${panaLa(pana, ctx.now)}` : 'Alerta a revenit în listă', 'ok'))
      .catch(eroare)
  }

  const ignoraIntrare = (intrare: string, mesaj: string) => {
    setMeniu(null)
    actualizeazaPrefs(p => cuIgnorat(p, intrare))
      .then(() => toast(mesaj, 'ok', {
        action: { label: 'Anulează', onClick: () => { actualizeazaPrefs(p => faraIgnorat(p, intrare)).catch(eroare) } },
      }))
      .catch(eroare)
  }

  // Oprește tipul direct, cu „Anulează”; alertele lui dispar când serverul recalculează (trigger pe preferințe).
  const poateOpriTipul = (cod: string) => !!role && !!TIP_ALERTA[cod] && !TIP_ALERTA[cod].obligatoriu.includes(role)
  const nuMaiVreauTipul = (n: Notificare) => {
    setMeniu(null)
    if (!role) return
    const eticheta = TIP_ALERTA[n.cod]?.eticheta ?? 'acest tip'
    actualizeazaPrefs(p => cuTipActiv(p, role, n.cod, false))
      .then(() => toast(`Nu mai primești „${eticheta}”`, 'ok', {
        action: { label: 'Anulează', onClick: () => { actualizeazaPrefs(p => cuTipActiv(p, role, n.cod, true)).catch(eroare) } },
      }))
      .catch(eroare)
  }

  const fileDef: { id: Fila; label: string; nr: number | null }[] = [
    { id: 'noi', label: 'Noi', nr: noi.length },
    { id: 'toate', label: 'Toate', nr: null },
    { id: 'amanate', label: 'Amânate', nr: amanate.length },
  ]

  const gol = fila === 'noi'
    ? (vizibile.length ? 'Nimic nou. Le găsești pe toate la „Toate”.' : 'Nimic de semnalat. Totul e la zi.')
    : fila === 'toate' ? 'Nimic de semnalat. Totul e la zi.' : 'Nicio alertă amânată.'

  return (
    <div
      ref={panelRef}
      className="notif-panel"
      style={ancora ? { '--notif-top': `${ancora.top}px`, '--notif-right': `${ancora.right}px` } as React.CSSProperties : undefined}
      role="dialog"
      aria-modal="false"
      aria-labelledby="notif-panel-titlu"
    >
      <div className="notif-panel-head">
        <h2 id="notif-panel-titlu" className="notif-panel-title" tabIndex={-1} ref={titluRef}>Notificări</h2>
        <div className="notif-panel-head-actions">
          {noi.length > 0 && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={toateVazute}>✓ Toate văzute</button>
          )}
          <button type="button" className="modal-close" onClick={() => onClose(true)} aria-label="Închide notificările">×</button>
        </div>
      </div>

      <div className="notif-tabs" role="tablist" aria-label="Filtru notificări">
        {fileDef.map(f => (
          <button
            key={f.id}
            type="button"
            role="tab"
            id={`notif-tab-${f.id}`}
            aria-selected={fila === f.id}
            aria-controls="notif-lista"
            className={`notif-tab${fila === f.id ? ' notif-tab--active' : ''}`}
            onClick={() => { setFila(f.id); setMeniu(null) }}
          >
            {f.label}{f.nr ? <span className="notif-tab-nr">{f.nr}</span> : null}
          </button>
        ))}
      </div>

      <div id="notif-lista" className="notif-list" role="tabpanel" aria-labelledby={`notif-tab-${fila}`}>
        {lista.length === 0 ? (
          <div className="notif-empty">
            <div className="notif-empty-icon" aria-hidden="true">{fila === 'amanate' ? '⏸' : '✓'}</div>
            <div>{gol}</div>
          </div>
        ) : (
          <ul className="notif-items">
            {lista.map(n => {
              const sursa = felSursa(n.sursa)
              const amanata = fila === 'amanate'
              const meniuAmana = meniu?.id === n.id && meniu.fel === 'amana'
              const meniuMai = meniu?.id === n.id && meniu.fel === 'mai'
              const ignoraPersoana = areIgnorarePersoana(n.cod) && n.cheieBaza !== n.sursa
              const areMai = !!sursa || ignoraPersoana || poateOpriTipul(n.cod)
              const data = amanata && n.amanatPana ? panaLa(n.amanatPana, ctx.now) : dataAlerta(n, ctx.now)
              return (
                <li key={n.id} className={`notif-item${n.vazut ? '' : ' notif-item--nou'}`}>
                  <button type="button" className="notif-item-main" onClick={() => deschide(n)}>
                    <span className={`notif-sev notif-sev--${n.severitate}`} aria-label={ETICHETA_SEVERITATE[n.severitate]} role="img">
                      {ICON_SEVERITATE[n.severitate]}
                    </span>
                    <span className="notif-item-text">
                      <span className="notif-item-titlu">
                        {!n.vazut && <span className="notif-dot" aria-label="nouă" role="img" />}
                        {n.titlu}
                      </span>
                      {n.detaliu && <span className="notif-item-detaliu">{n.detaliu}</span>}
                    </span>
                    {data && <span className="notif-item-data">{data}</span>}
                  </button>

                  <div className="notif-item-actions">
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => deschide(n)}>Deschide</button>
                    {amanata ? (
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => amanaPana(n, null)}>Readu acum</button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        aria-expanded={meniuAmana}
                        onClick={() => { setMeniu(meniuAmana ? null : { id: n.id, fel: 'amana' }); setDataAleasa('') }}
                      >
                        Amână ▾
                      </button>
                    )}
                    {areMai && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        aria-label="Mai multe opțiuni"
                        aria-expanded={meniuMai}
                        onClick={() => setMeniu(meniuMai ? null : { id: n.id, fel: 'mai' })}
                      >
                        ⋯
                      </button>
                    )}
                  </div>

                  {meniuAmana && (
                    <div className="notif-item-menu" role="group" aria-label="Amână alerta">
                      <button type="button" className="notif-menu-opt" onClick={() => amanaPana(n, amanarePana(1, ctx.now))}>O zi</button>
                      <button type="button" className="notif-menu-opt" onClick={() => amanaPana(n, amanarePana(7, ctx.now))}>O săptămână</button>
                      <form
                        className="notif-menu-date"
                        onSubmit={e => {
                          e.preventDefault()
                          const [y, m, d] = dataAleasa.split('-').map(Number)
                          if (y && m && d) amanaPana(n, new Date(y, m - 1, d, 8, 0, 0))
                        }}
                      >
                        <label className="notif-menu-date-label" htmlFor={`notif-data-${n.id}`}>Până la</label>
                        <input
                          id={`notif-data-${n.id}`}
                          type="date"
                          className="field-input"
                          min={isoLocal(amanarePana(1, ctx.now))}
                          value={dataAleasa}
                          onChange={e => setDataAleasa(e.target.value)}
                        />
                        <button type="submit" className="btn btn-primary btn-xs" disabled={!dataAleasa}>Amână</button>
                      </form>
                    </div>
                  )}

                  {meniuMai && (
                    <div className="notif-item-menu" role="group" aria-label="Mai multe opțiuni">
                      {sursa && (
                        <button type="button" className="notif-menu-opt" onClick={() => ignoraIntrare(n.sursa, IGNORAT_SURSA[sursa])}>
                          {IGNORA_SURSA[sursa]}
                        </button>
                      )}
                      {ignoraPersoana && (
                        <button type="button" className="notif-menu-opt" onClick={() => ignoraIntrare(n.cheieBaza, 'Nu te mai anunțăm pentru această persoană')}>
                          Nu mă mai anunța pentru această persoană
                        </button>
                      )}
                      {poateOpriTipul(n.cod) && (
                        <button type="button" className="notif-menu-opt" onClick={() => nuMaiVreauTipul(n)}>
                          Nu mai vreau acest tip de alertă
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="notif-panel-foot">
        <button
          type="button"
          className="notif-foot-link"
          onClick={() => { onClose(false); navigate('/setari/notificari?notificari=1') }}
        >
          Setări notificări →
        </button>
      </div>
    </div>
  )
}
