import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import {
  areFiltruDeLaCine, cuPraguri, cuSursa, cuTipActiv, faraIgnorat, faraModificari, useNotificari, usePreferinteAlerte,
} from '../lib/alerte'
import {
  areModificari, arePraguri, descrierePraguri, normalizeazaPraguri, preferintaEfectiva, sursaEfectiva, tipuriPentruRol,
  type CategorieSursa,
} from '../lib/alerteConfig'
import {
  CATALOG_ALERTE, MAX_PRAGURI, MAX_RESPONSABILI, MAX_ZILE_PRAG, TIP_ALERTA,
  type CategorieAlerta, type Notificare, type PreferinteAlerte, type RolCabinet, type SursaDosare, type TipAlerta,
} from '../lib/alerteCatalog'
import { blurNumberInputOnWheel } from '../lib/inputEvents'
import type { WorkspaceMember } from '../types'
import { marcheazaPas } from '../lib/ghidPornire'
import ConfirmModal from './ConfirmModal'
import '../styles/notificari.css'

/** Setări → Notificări: setările personale ale fiecărui utilizator (aceleași pentru orice rol), câte o sub-filă pe
 * categorie. Fiecare modificare se salvează imediat, doar ca diferență față de implicitele rolului; snapshot-urile
 * Firestore o arată pe loc și revin singure la eroare. Merge și când cabinetul e în citire. */

type Membri = Record<string, WorkspaceMember>

const ETICHETA_TOATE: Record<CategorieSursa, string> = { dosare: 'toate dosarele', sarcini: 'toate sarcinile' }
const FARA_PERSOANE: Record<CategorieSursa, string> = {
  dosare: 'Alege cel puțin un coleg; altfel nu primești alerte de la dosare.',
  sarcini: 'Alege cel puțin un coleg; altfel nu primești alerte de la sarcini.',
}
const TOOLTIP_DE_LA = 'Se aplică alertelor de planificare, blocaj, facturare și termen. Asignările ajung mereu doar la tine.'
const TOOLTIP_LACAT = 'Mereu pornită: ține de accesul la cabinet.'

const esteCategorieSursa = (c: CategorieAlerta): c is CategorieSursa => c === 'dosare' || c === 'sarcini'

const numeMembru = (membri: Membri, uid: string): string => {
  const m = membri[uid]
  return m ? (m.displayName || m.email || 'Membru') : 'Fost membru'
}

/** Eticheta unei ignorări, fără date inventate: tipul entității și, dacă e încă încărcată, detaliul unei alerte a ei. */
function etichetaIgnorata(intrare: string, notificari: Notificare[]): { titlu: string; detaliu: string } {
  const [prefix, , ...rest] = intrare.split(':')
  const exemplu = notificari.find(n => n.sursa === intrare || n.cheieBaza === intrare)
  const detaliu = exemplu?.detaliu ?? ''
  if (rest.length === 0) {
    if (prefix === 'client') return { titlu: 'Client ignorat', detaliu }
    if (prefix === 'dosar') return { titlu: 'Dosar ignorat', detaliu }
    if (prefix === 'sarcina') return { titlu: 'Sarcină ignorată', detaliu }
  }
  const tip = TIP_ALERTA[prefix]
  return { titlu: tip ? `Persoană ignorată (${tip.eticheta.toLowerCase()})` : 'Alertă ignorată', detaliu }
}

function Comutator({ on, onChange, labelledBy, disabled }: { on: boolean; onChange: (v: boolean) => void; labelledBy: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      className="notif-switch"
      data-on={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="notif-switch-thumb" />
    </button>
  )
}

function DeLaCine({ categorie, uid, sursa, responsabili, membri, onChange }: {
  categorie: CategorieSursa; uid: string; sursa: SursaDosare; responsabili: string[]; membri: Membri
  onChange: (sursa: SursaDosare, responsabili: string[]) => void
}) {
  const id = useId()
  // Colegii care pot fi responsabili (fără vizualizatori), cu tine primul; plus cei deja aleși, ca să poată fi scoși.
  const persoane = useMemo(() => {
    const lista = Object.entries(membri).filter(([u, m]) => u !== uid && m.role !== 'viewer').map(([u]) => u)
    for (const u of responsabili) if (u !== uid && !lista.includes(u)) lista.push(u)
    lista.sort((a, b) => numeMembru(membri, a).localeCompare(numeMembru(membri, b), 'ro'))
    return [uid, ...lista]
  }, [membri, uid, responsabili])
  const optiuni: { id: SursaDosare; label: string }[] = [
    { id: 'toate', label: ETICHETA_TOATE[categorie] },
    { id: 'ale_mele', label: 'doar ale mele' },
    { id: 'responsabili', label: 'doar ale anumitor colegi' },
  ]
  return (
    <div className="notif-delacine">
      <div className="notif-delacine-row">
        {/* O frază pe un singur rând: „Vreau alerte de la [toate dosarele ▾]”. */}
        <label className="notif-delacine-label" htmlFor={`${id}-s`} data-tooltip={TOOLTIP_DE_LA}>Vreau alerte de la</label>
        <select id={`${id}-s`} className="field-input notif-delacine-select" value={sursa}
          onChange={e => onChange(e.target.value as SursaDosare, responsabili)}>
          {optiuni.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {sursa === 'responsabili' && (
        <div className="notif-persoane" role="group" aria-label="Colegi urmăriți">
          {persoane.map(u => {
            const ales = responsabili.includes(u)
            return (
              <button key={u} type="button" aria-pressed={ales}
                className={`notif-persoana${ales ? ' notif-persoana--on' : ''}`}
                disabled={!ales && responsabili.length >= MAX_RESPONSABILI}
                onClick={() => onChange(sursa, ales ? responsabili.filter(x => x !== u) : [...responsabili, u])}>
                {ales ? '✓ ' : ''}{numeMembru(membri, u)}{u === uid ? ' (eu)' : ''}
              </button>
            )
          })}
          {responsabili.length === 0 && <div className="notif-row-desc notif-warn">{FARA_PERSOANE[categorie]}</div>}
        </div>
      )}
    </div>
  )
}

function PraguriEditor({ tip, praguri, disabled, onChange }: {
  tip: TipAlerta; praguri: number[]; disabled: boolean; onChange: (p: number[]) => void
}) {
  const [edit, setEdit] = useState<number | 'nou' | null>(null)
  const [val, setVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (edit !== null) inputRef.current?.select() }, [edit])

  const min = tip.fel === 'vechime' ? 1 : 0
  const eticheta = (n: number) => tip.fel === 'termen' && n === 0 ? 'azi' : String(n)
  const porneste = (idx: number | 'nou') => { setEdit(idx); setVal(idx === 'nou' ? '' : String(praguri[idx])) }
  const confirma = () => {
    const n = Number(val)
    if (val.trim() !== '' && Number.isFinite(n)) {
      const lista = edit === 'nou' ? [...praguri, n] : praguri.map((p, i) => i === edit ? n : p)
      const nou = normalizeazaPraguri(tip.fel, lista)
      if (JSON.stringify(nou) !== JSON.stringify(praguri)) onChange(nou)
    }
    setEdit(null)
  }
  const input = (
    <input
      ref={inputRef}
      type="number"
      className="notif-prag-input"
      min={min}
      max={MAX_ZILE_PRAG}
      step={1}
      value={val}
      aria-label={tip.fel === 'termen' ? 'Zile înainte de termen (0 = în ziua termenului)' : 'După câte zile'}
      onChange={e => setVal(e.target.value)}
      onBlur={confirma}
      onWheel={blurNumberInputOnWheel}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); confirma() }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEdit(null) }
      }}
    />
  )

  return (
    <div className="notif-cand">
      <div className="notif-chips">
        {praguri.map((p, i) => edit === i ? <span key={i} className="notif-chip notif-chip--edit">{input}</span> : (
          <span key={i} className="notif-chip">
            <button type="button" className="notif-chip-val" disabled={disabled} onClick={() => porneste(i)}
              aria-label={`Prag: ${eticheta(p)}${tip.fel === 'termen' && p > 0 ? ' zile înainte' : ''}. Modifică`}>
              {eticheta(p)}
            </button>
            <button type="button" className="notif-chip-x" disabled={disabled || praguri.length <= 1}
              aria-label={`Elimină pragul ${eticheta(p)}`} title={praguri.length <= 1 ? 'Rămâne cel puțin un prag' : undefined}
              onClick={() => onChange(praguri.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
        {edit === 'nou' && <span className="notif-chip notif-chip--edit">{input}</span>}
        {edit !== 'nou' && praguri.length < MAX_PRAGURI && (
          <button type="button" className="notif-chip-add" disabled={disabled} onClick={() => porneste('nou')} aria-label="Adaugă prag">+</button>
        )}
      </div>
      <div className="notif-row-desc">{descrierePraguri(tip, praguri)}</div>
    </div>
  )
}

function RandTip({ tip, prefs, role, onToggle, onPraguri }: {
  tip: TipAlerta; prefs: PreferinteAlerte; role: RolCabinet; onToggle: (on: boolean) => void; onPraguri: (p: number[]) => void
}) {
  const id = useId()
  const ef = preferintaEfectiva(tip, prefs, role)
  return (
    <div className={`notif-rule${ef.activ ? '' : ' notif-rule--off'}`} data-notif-cod={tip.cod}>
      {/* Sus: titlul și descrierea, cu comutatorul (sau lacătul) în dreapta. */}
      <div className="notif-rule-top">
        <div className="notif-rule-name">
          <div className="notif-row-label" id={`${id}-l`}>{tip.eticheta}</div>
          <div className="notif-row-desc">{tip.descriere}</div>
        </div>
        {ef.obligatoriu ? (
          <span className="notif-lock" tabIndex={0} role="img" aria-label={TOOLTIP_LACAT} data-tooltip={TOOLTIP_LACAT}>🔒</span>
        ) : (
          <Comutator on={ef.activ} labelledBy={`${id}-l`} onChange={onToggle} />
        )}
      </div>
      {/* Doar tipurile cu praguri au „Când”; cele imediate și evenimentele rămân pe un rând. */}
      {arePraguri(tip.fel) && (
        <div className="notif-rule-body">
          <span className="notif-rule-cell-label" aria-hidden="true">Când</span>
          <PraguriEditor tip={tip} praguri={ef.praguri} disabled={!ef.activ} onChange={onPraguri} />
        </div>
      )}
    </div>
  )
}

export default function NotificariCard() {
  const { user, activeWorkspace, userRole, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const role: RolCabinet | null = userRole
  const { prefs, actualizeaza } = usePreferinteAlerte(workspaceId, user.uid, role)
  const { notificari } = useNotificari(workspaceId, user.uid)
  const [params] = useSearchParams()
  const tinta = params.get('notificari')
  const cardRef = useRef<HTMLDivElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const membri: Membri = useMemo(() => activeWorkspace?.members ?? {}, [activeWorkspace?.members])

  // Sub-filele: doar categoriile cu cel puțin un tip pe care rolul îl poate primi.
  const tipuri = tipuriPentruRol(role)
  const categorii = CATALOG_ALERTE.categorii.filter(c => tipuri.some(t => t.categorie === c.id))
  const categorieTinta = (cod: string | null): CategorieAlerta | null => {
    const tip = cod ? TIP_ALERTA[cod] : undefined
    return tip && role && tip.roluri.includes(role) ? tip.categorie : null
  }
  const [categorieAleasa, setCategorie] = useState<CategorieAlerta | null>(() => categorieTinta(tinta))
  // Un link din clopoțel (?notificari=<cod>) deschide sub-fila tipului.
  const [tintaPrecedenta, setTintaPrecedenta] = useState(tinta)
  if (tintaPrecedenta !== tinta) {
    setTintaPrecedenta(tinta)
    const c = categorieTinta(tinta)
    if (c) setCategorie(c)
  }
  const categorie = categorii.find(c => c.id === categorieAleasa)?.id ?? categorii[0]?.id ?? null

  // Link din clopoțel (?notificari=<cod> sau =1): derulează la card și evidențiază scurt cardul tipului.
  useEffect(() => {
    if (!tinta) return
    const card = cardRef.current
    if (!card) return
    const rand = TIP_ALERTA[tinta] ? card.querySelector<HTMLElement>(`[data-notif-cod="${tinta}"]`) : null
    ;(rand ?? card).scrollIntoView({ behavior: 'smooth', block: rand ? 'center' : 'start' })
    if (!rand) return
    rand.classList.add('notif-highlight')
    const t = setTimeout(() => rand.classList.remove('notif-highlight'), 2400)
    return () => { clearTimeout(t); rand.classList.remove('notif-highlight') }
  }, [tinta])

  const salveaza = (fn: (p: PreferinteAlerte) => PreferinteAlerte) => {
    actualizeaza(fn).then(() => marcheazaPas('alerte')).catch(() => toast('Nu am putut salva. Încearcă din nou.', 'err'))
  }

  const deLaCine = areFiltruDeLaCine(role, user.uid, membri)
  const modificat = role !== null && areModificari(prefs, role)

  return (
    <div className="card notif-card" ref={cardRef} id="notificari" data-ghid="notif-setari">
      <div className="card-head">
        <span className="card-title">🔔 Notificări</span>
        {modificat && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setConfirmReset(true)}>Revino la implicite</button>
        )}
      </div>
      <div className="card-body">
        <div className="card-sub notif-card-sub">Ce alerte primești tu în clopoțel și când. Fiecare coleg își alege singur.</div>

        {!role || !categorie ? (
          <div className="notif-row-desc">Nu există alerte pentru rolul tău în acest cabinet.</div>
        ) : (
          <>
            <div className="notif-subtabs" role="tablist" aria-label="Categorii de alerte">
              {categorii.map(cat => (
                <button key={cat.id} type="button" role="tab" id={`notif-cat-${cat.id}`} aria-selected={categorie === cat.id}
                  aria-controls="notif-cat-panou" className={`notif-subtab${categorie === cat.id ? ' notif-subtab--active' : ''}`}
                  onClick={() => setCategorie(cat.id)}>
                  {cat.eticheta}
                </button>
              ))}
            </div>

            <div className="notif-rules" id="notif-cat-panou" role="tabpanel" aria-labelledby={`notif-cat-${categorie}`}>
              {esteCategorieSursa(categorie) && deLaCine && (() => {
                const s = sursaEfectiva(categorie, prefs, role)
                return (
                  <DeLaCine
                    key={categorie}
                    categorie={categorie}
                    uid={user.uid}
                    sursa={s.sursa}
                    responsabili={s.responsabili}
                    membri={membri}
                    onChange={(sursa, uids) => salveaza(p => cuSursa(p, categorie, sursa, uids))}
                  />
                )
              })()}
              {tipuri.filter(t => t.categorie === categorie).map(tip => (
                <RandTip
                  key={tip.cod}
                  tip={tip}
                  prefs={prefs}
                  role={role}
                  onToggle={on => salveaza(p => cuTipActiv(p, role, tip.cod, on))}
                  onPraguri={praguri => salveaza(p => cuPraguri(p, tip.cod, praguri))}
                />
              ))}
            </div>
          </>
        )}

        {prefs.ignorate.length > 0 && (
          <div className="notif-group notif-ignorate-grup">
            <div className="notif-group-title">Ignorate ({prefs.ignorate.length})</div>
            <ul className="notif-ignorate">
              {prefs.ignorate.map(intrare => {
                const e = etichetaIgnorata(intrare, notificari)
                return (
                  <li key={intrare} className="notif-row">
                    <div className="notif-row-text">
                      <div className="notif-row-label">{e.titlu}</div>
                      {e.detaliu && <div className="notif-row-desc">{e.detaliu}</div>}
                    </div>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => salveaza(p => faraIgnorat(p, intrare))}>
                      Reactivează
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {confirmReset && (
        <ConfirmModal
          title="Revii la setările implicite?"
          message="Tipurile de alerte, pragurile și „Vreau alerte de la” revin la cele implicite pentru rolul tău. Alertele ignorate rămân ignorate."
          confirmLabel="Revino la implicite"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false)
            actualizeaza(faraModificari)
              .then(() => toast('Notificările au revenit la setările implicite', 'ok'))
              .catch(() => toast('Nu am putut salva. Încearcă din nou.', 'err'))
          }}
        />
      )}
    </div>
  )
}
