import { useEffect, useMemo, useRef, useState } from 'react'
import type { Client } from '../../types'
import { useApp } from '../../AppContext'
import { formatDateRo } from '../../lib/dates'
import {
  ACCEPT, caleFolder, continutRecursiv, creeazaFolder, descarcaFisier, extensie, initDocumenteClient,
  formatMarime, mutaFisier, mutaFolder, previzualizabil, redenumesteFisier, redenumesteFolder, sorteazaFisiere, stergeFisier,
  sorteazaFoldere, stergeFolder, subfoldere, useDocumenteClient, DESC_IMPLICIT, type EroareFisier, type Fisier, type Folder, type Sortare,
} from '../../lib/fisiere'
import ConfirmModal from '../ConfirmModal'
import BtnLabel from '../BtnLabel'
import MeniuRand, { type OptiuneMeniu } from './MeniuRand'
import FisierPreview from './FisierPreview'
import MutaModal from './MutaModal'
import CoadaIncarcare from './CoadaIncarcare'
import { useIncarcari } from './useIncarcari'
import { IconDescarca, IconDirectie, IconFisier, IconFolder, IconFolderNou, IconIncarca, IconRestrange } from './icons'
import '../../styles/documente.css'

const SORTARI: { key: Sortare; label: string }[] = [
  { key: 'nume', label: 'Nume' },
  { key: 'tip', label: 'Tip' },
  { key: 'marime', label: 'Mărime' },
  { key: 'data', label: 'Dată' },
]
const CHEIE_SORTARE = 'cabinio:documente-sortare'

// Ordinea aleasă se reține pe dispozitivul utilizatorului, pentru toți clienții.
function citesteSortare(): { dupa: Sortare; desc: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(CHEIE_SORTARE) ?? '{}') as { dupa?: string; desc?: unknown }
    const dupa = SORTARI.some(o => o.key === v.dupa) ? v.dupa as Sortare : 'data'
    return { dupa, desc: typeof v.desc === 'boolean' ? v.desc : DESC_IMPLICIT[dupa] }
  } catch {
    return { dupa: 'data', desc: true }
  }
}

type Element = { tip: 'fisier'; f: Fisier } | { tip: 'folder'; f: Folder }

// Clienții pentru care s-a cerut deja pregătirea documentelor în sesiunea curentă (serverul e oricum idempotent).
const initCerut = new Set<string>()

interface Props {
  client: Client
  /** `coloana`: în coloana din dreapta a fișei (se poate restrânge); `sectiune`: în fluxul fișei (ecran îngust, telefon). */
  layout?: 'sectiune' | 'coloana'
  restrans?: boolean
  onRestrans?: (restrans: boolean) => void
}

/** Documentele clientului: foldere, încărcare (buton sau tragere), previzualizare, descărcare, redenumire, mutare,
 * ștergere. Lista e live; toate modificările trec prin server. Viewer: doar vede și descarcă. La prima deschidere de
 * către un membru, serverul creează folderele implicite ale cabinetului (o singură dată per client). */
export default function ClientDocumente({ client, layout = 'sectiune', restrans = false, onRestrans }: Props) {
  const { activeWorkspace, userRole, canEdit, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const { fisiere, foldere, loading, error } = useDocumenteClient(workspaceId, client.id)
  const coada = useIncarcari(workspaceId, client.id)
  // Ștergerea rămâne posibilă și după expirarea abonamentului (datele sunt ale cabinetului); restul cere acces complet.
  const poateSterge = userRole === 'admin' || userRole === 'member'

  const [folderCerut, setFolderCerut] = useState<string | null>(null)
  const [sortare, setSortareStare] = useState(citesteSortare)
  const setSortare = (next: { dupa: Sortare; desc: boolean }) => {
    setSortareStare(next)
    try { localStorage.setItem(CHEIE_SORTARE, JSON.stringify(next)) } catch { /* doar pentru sesiunea curentă */ }
  }
  const [redenumire, setRedenumire] = useState<string | null>(null)       // id-ul rândului editat
  const [folderNou, setFolderNou] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [muta, setMuta] = useState<Element | null>(null)
  const [sterge, setSterge] = useState<Element | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [peste, setPeste] = useState(false)
  const [initInCurs, setInitInCurs] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  // Pregătirea automată: client fără niciun folder sau fișier, deschis de cineva care poate scrie.
  useEffect(() => {
    if (loading || error || !canEdit || !workspaceId || fisiere.length || foldere.length) return
    const k = `${workspaceId}/${client.id}`
    if (initCerut.has(k)) return
    initCerut.add(k)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitInCurs(k)
    initDocumenteClient(client.id).catch(() => { /* fără foldere implicite: utilizatorul le poate crea */ })
      .finally(() => setInitInCurs(cur => cur === k ? null : cur))
  }, [loading, error, canEdit, workspaceId, client.id, fisiere.length, foldere.length])
  const pregatire = initInCurs === `${workspaceId}/${client.id}`

  // Un folder șters între timp (de un coleg) trimite înapoi la rădăcină.
  const cale = useMemo(() => caleFolder(foldere, folderCerut), [foldere, folderCerut])
  const folderCurent = cale.length ? cale[cale.length - 1].id : null
  const numeFolderCurent = cale.length ? cale[cale.length - 1].nume : 'Documente'

  const fisiereAici = useMemo(() => sorteazaFisiere(fisiere.filter(f => f.folderId === folderCurent), sortare.dupa, sortare.desc),
    [fisiere, folderCurent, sortare])
  const folderAici = useMemo(() => sorteazaFoldere(subfoldere(foldere, folderCurent), foldere, fisiere, sortare.dupa, sortare.desc),
    [foldere, fisiere, folderCurent, sortare])
  const deVazut = useMemo(() => fisiereAici.filter(f => previzualizabil(f.mime)), [fisiereAici])
  const totalOcupat = useMemo(() => fisiere.reduce((s, f) => s + f.marime, 0), [fisiere])

  const numeMembru = (uid: string) => {
    const m = activeWorkspace?.members?.[uid]
    return m ? (m.displayName || m.email.split('@')[0]) : ''
  }

  const deschide = (folderId: string | null) => { setFolderCerut(folderId); setRedenumire(null); setFolderNou(false) }

  const ruleaza = async (id: string, fn: () => Promise<unknown>, succes?: string) => {
    setBusyId(id)
    try {
      await fn()
      if (succes) toast(succes, 'ok')
    } catch (e) {
      toast((e as Error).message || 'Operațiunea nu a reușit.', 'err')
      throw e
    } finally {
      setBusyId(null)
    }
  }

  const descarca = (f: Fisier) => ruleaza(f.id, () => descarcaFisier(f)).catch(() => {})

  const deschideFisier = (f: Fisier) => {
    if (previzualizabil(f.mime)) setPreview(f.id)
    else void descarca(f)
  }

  const alegeFisiere = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length) coada.adauga(files, folderCurent)
  }

  // ── Tragere din exploratorul de fișiere ──
  const cuFisiere = (e: React.DragEvent) => canEdit && Array.from(e.dataTransfer.types).includes('Files')
  const dragHandlers = canEdit ? {
    onDragEnter: (e: React.DragEvent) => { if (!cuFisiere(e)) return; e.preventDefault(); dragDepth.current++; setPeste(true) },
    onDragOver: (e: React.DragEvent) => { if (!cuFisiere(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setPeste(false) },
    onDrop: (e: React.DragEvent) => {
      if (!cuFisiere(e)) return
      e.preventDefault(); dragDepth.current = 0; setPeste(false)
      alegeFisiere(e.dataTransfer.files)
      if (restrans) onRestrans?.(false)          // fișiere trase pe banda restrânsă: coloana se deschide, cu progresul
    },
  } : {}

  const confirmaStergere = async () => {
    const el = sterge
    if (!el) return
    setSterge(null)
    if (el.tip === 'fisier') {
      await ruleaza(el.f.id, () => stergeFisier(el.f.id), `„${el.f.nume}” a fost șters.`).catch(() => {})
    } else {
      // Confirmarea a arătat conținutul văzut atunci. Dacă serverul găsește mai mult (un coleg a încărcat între timp),
      // răspunde `folder_negol` și utilizatorul confirmă din nou, cu numărul actualizat.
      const c = continutRecursiv(foldere, fisiere, el.f.id)
      setBusyId(el.f.id)
      try {
        await stergeFolder(el.f.id, c.fisiere + c.foldere > 0)
        toast(`Folderul „${el.f.nume}” a fost șters.`, 'ok')
      } catch (e) {
        const err = e as EroareFisier
        toast(err.message || 'Folderul nu a putut fi șters.', err.code === 'folder_negol' ? 'info' : 'err')
        if (err.code === 'folder_negol') setSterge(el)
      } finally {
        setBusyId(null)
      }
    }
  }

  const mesajStergere = (el: Element) => {
    if (el.tip === 'fisier') return <>Ștergi definitiv „<strong>{el.f.nume}</strong>”? Acțiunea nu poate fi anulată.</>
    const c = continutRecursiv(foldere, fisiere, el.f.id)
    if (!c.fisiere && !c.foldere) return <>Ștergi folderul gol „<strong>{el.f.nume}</strong>”?</>
    const parti = [c.fisiere ? `${c.fisiere} ${c.fisiere === 1 ? 'fișier' : 'fișiere'}` : '', c.foldere ? `${c.foldere} ${c.foldere === 1 ? 'subfolder' : 'subfoldere'}` : ''].filter(Boolean)
    return <>Folderul „<strong>{el.f.nume}</strong>” conține {parti.join(' și ')}. Se șterg definitiv împreună cu el.</>
  }

  const optiuni = (el: Element): OptiuneMeniu[] => [
    ...(el.tip === 'fisier' ? [{ label: 'Descarcă', onSelect: () => void descarca(el.f) }] : []),
    ...(canEdit ? [
      { label: 'Redenumește', onSelect: () => { setFolderNou(false); setRedenumire(el.f.id) } },
      { label: 'Mută în…', onSelect: () => setMuta(el) },
    ] : []),
    ...(poateSterge ? [{ label: 'Șterge', danger: true, onSelect: () => setSterge(el) }] : []),
  ]

  const nimic = !loading && !error && !pregatire && fisiere.length === 0 && foldere.length === 0
  const golAici = !loading && !error && !pregatire && !nimic && fisiereAici.length === 0 && folderAici.length === 0 && !folderNou

  const fileInput = (
    <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden
      onChange={e => { alegeFisiere(e.target.files); e.target.value = '' }} />
  )

  // Coloana restrânsă: o bandă îngustă cu numărul de documente și încărcarea; fișierele se pot trage și aici.
  if (layout === 'coloana' && restrans) {
    const activ = coada.items.some(i => i.stare === 'asteptare' || i.stare === 'incarcare' || i.stare === 'pauza')
    return (
      <div className={`doc-rail${peste ? ' is-drop' : ''}`} data-sectiune="documente" {...dragHandlers}>
        <button type="button" className="doc-icon-btn" onClick={() => onRestrans?.(false)} aria-label="Extinde documentele" title="Extinde documentele">
          <IconRestrange directie="stanga" />
        </button>
        <button type="button" className="doc-rail-main" onClick={() => onRestrans?.(false)} title="Documente">
          <IconFolder />
          <span className="doc-rail-count">{fisiere.length}</span>
          <span className="doc-rail-label">Documente</span>
        </button>
        {activ && <span className="spin spin-dark" role="status" aria-label="Se încarcă documente" />}
        {canEdit && (
          <button type="button" className="doc-icon-btn" onClick={() => inputRef.current?.click()} aria-label="Încarcă documente" title="Încarcă documente">
            <IconIncarca size={16} />
          </button>
        )}
        {fileInput}
      </div>
    )
  }

  return (
    <div className={`cv2-section doc-section doc-section--${layout}${peste ? ' is-drop' : ''}`} data-sectiune="documente" {...dragHandlers}>
      <div className="doc-head">
        <div className="cv2-section-label">
          Documente
          {fisiere.length > 0 && <span className="cv2-count-chip">{fisiere.length}</span>}
          {totalOcupat > 0 && <span className="doc-meta doc-head-size">{formatMarime(totalOcupat)}</span>}
        </div>
        <div className="doc-head-actions">
          {fisiere.length + foldere.length > 1 && (
            <div className="doc-sort-grup">
              <select className="doc-sort" value={sortare.dupa} aria-label="Ordonează după"
                onChange={e => { const dupa = e.target.value as Sortare; setSortare({ dupa, desc: DESC_IMPLICIT[dupa] }) }}>
                {SORTARI.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button type="button" className="doc-icon-btn doc-sort-dir" onClick={() => setSortare({ ...sortare, desc: !sortare.desc })}
                aria-label={sortare.desc ? 'Ordine descrescătoare; schimbă în crescătoare' : 'Ordine crescătoare; schimbă în descrescătoare'}
                title={sortare.desc ? 'Descrescător' : 'Crescător'}>
                <IconDirectie desc={sortare.desc} />
              </button>
            </div>
          )}
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-sm doc-btn" onClick={() => { setRedenumire(null); setFolderNou(true) }} title="Folder nou" aria-label="Folder nou">
              <IconFolderNou /> <span className="doc-btn-text">Folder nou</span>
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn btn-outline-primary btn-sm doc-btn" onClick={() => inputRef.current?.click()} title="Încarcă documente" aria-label="Încarcă documente">
              <IconIncarca /> <span className="doc-btn-text">Încarcă</span>
            </button>
          )}
          {fileInput}
        </div>
        {layout === 'coloana' && onRestrans && (
          <button type="button" className="doc-icon-btn doc-restrange" onClick={() => onRestrans(true)} aria-label="Restrânge documentele" title="Restrânge documentele">
            <IconRestrange directie="dreapta" />
          </button>
        )}
      </div>

      {cale.length > 0 && (
        <nav className="doc-crumbs" aria-label="Locația în documente">
          <button type="button" className="doc-crumb" onClick={() => deschide(null)}>Documente</button>
          {cale.map((c, i) => (
            <span key={c.id} className="doc-crumb-wrap">
              <span className="doc-crumb-sep" aria-hidden>›</span>
              <button type="button" className="doc-crumb" onClick={() => deschide(c.id)} aria-current={i === cale.length - 1 ? 'page' : undefined}>{c.nume}</button>
            </span>
          ))}
        </nav>
      )}

      {coada.items.length > 0 && <CoadaIncarcare coada={coada} foldere={foldere} />}

      {(loading || pregatire) && <div className="doc-loading"><span className="spin spin-dark" /> Se încarcă documentele…</div>}
      {error && <div className="doc-empty-text">Documentele nu au putut fi încărcate. Reîncarcă pagina.</div>}

      {nimic && !folderNou && (
        <div className="doc-empty">
          <div className="doc-empty-title">Niciun document încă</div>
          <div className="doc-empty-text">
            {canEdit
              ? <>Trage aici actele clientului sau <button type="button" className="doc-link" onClick={() => inputRef.current?.click()}>alege-le de pe calculator</button>. Sunt păstrate criptat.</>
              : 'Documentele încărcate de colegi vor apărea aici.'}
          </div>
          {canEdit && <div className="doc-empty-hint">PDF, imagini, Word, Excel, XML sau text · până la 15 MB pe fișier</div>}
        </div>
      )}

      {!loading && !error && !pregatire && (!nimic || folderNou) && (
        <ul className="doc-list">
          {folderNou && (
            <RandEditare
              icon={<IconFolder />} initial="" placeholder="Numele folderului"
              onCancel={() => setFolderNou(false)}
              onSave={async nume => {
                await ruleaza('nou', () => creeazaFolder(client.id, folderCurent, nume))
                setFolderNou(false)
              }}
            />
          )}
          {folderAici.map(d => {
            const n = continutRecursiv(foldere, fisiere, d.id)
            return redenumire === d.id ? (
              <RandEditare key={d.id} icon={<IconFolder />} initial={d.nume}
                onCancel={() => setRedenumire(null)}
                onSave={async nume => {
                  if (nume !== d.nume) await ruleaza(d.id, () => redenumesteFolder(d.id, nume))
                  setRedenumire(null)
                }} />
            ) : (
              <li key={d.id} className={`doc-row doc-row--folder${busyId === d.id ? ' is-busy' : ''}`}>
                <button type="button" className="doc-row-main" onClick={() => deschide(d.id)}>
                  <IconFolder />
                  <span className="doc-row-text">
                    <span className="doc-name">{d.nume}</span>
                    <span className="doc-meta">{n.fisiere === 0 && n.foldere === 0 ? 'Gol' : [n.fisiere ? `${n.fisiere} ${n.fisiere === 1 ? 'fișier' : 'fișiere'}` : '', n.foldere ? `${n.foldere} ${n.foldere === 1 ? 'subfolder' : 'subfoldere'}` : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
                <div className="doc-row-actions">
                  <MeniuRand eticheta={`Acțiuni pentru folderul ${d.nume}`} optiuni={optiuni({ tip: 'folder', f: d })} />
                </div>
              </li>
            )
          })}
          {fisiereAici.map(f => redenumire === f.id ? (
            <RandEditare key={f.id} icon={<IconFisier mime={f.mime} />} initial={f.nume} sufix={extensie(f.nume)}
              onCancel={() => setRedenumire(null)}
              onSave={async nume => {
                if (nume !== f.nume) await ruleaza(f.id, () => redenumesteFisier(f.id, nume))
                setRedenumire(null)
              }} />
          ) : (
            <li key={f.id} className={`doc-row${busyId === f.id ? ' is-busy' : ''}`}>
              <button type="button" className="doc-row-main" onClick={() => deschideFisier(f)}
                title={previzualizabil(f.mime) ? `Deschide „${f.nume}”` : `Descarcă „${f.nume}”`}>
                <IconFisier mime={f.mime} />
                <span className="doc-row-text">
                  <span className="doc-name">{f.nume}</span>
                  <span className="doc-meta">
                    {[formatMarime(f.marime), f.createdAt ? formatDateRo(f.createdAt) : '', numeMembru(f.createdBy)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
              <div className="doc-row-actions">
                {busyId === f.id
                  ? <span className="spin spin-dark" role="status" aria-label="Se procesează" />
                  : <button type="button" className="doc-icon-btn doc-only-hover" onClick={() => void descarca(f)} aria-label={`Descarcă ${f.nume}`} title="Descarcă"><IconDescarca /></button>}
                <MeniuRand eticheta={`Acțiuni pentru ${f.nume}`} optiuni={optiuni({ tip: 'fisier', f })} />
              </div>
            </li>
          ))}
          {golAici && (
            <li className="doc-empty doc-empty--folder">
              <div className="doc-empty-text">
                Folderul e gol.{canEdit && <> Trage fișiere aici sau <button type="button" className="doc-link" onClick={() => inputRef.current?.click()}>încarcă</button>.</>}
              </div>
            </li>
          )}
        </ul>
      )}

      {peste && (
        <div className="doc-drop" aria-hidden>
          <IconIncarca size={22} />
          <span>Eliberează pentru a încărca în „{numeFolderCurent}”</span>
        </div>
      )}

      {preview && deVazut.some(f => f.id === preview) && (
        <FisierPreview fisiere={deVazut} start={deVazut.findIndex(f => f.id === preview)}
          onClose={() => setPreview(null)} onDownload={f => descarca(f)} />
      )}

      {muta && (
        <MutaModal
          foldere={foldere}
          tinta={{ tip: muta.tip, id: muta.f.id, nume: muta.f.nume, folderCurent: muta.tip === 'fisier' ? muta.f.folderId : muta.f.parentId }}
          onClose={() => setMuta(null)}
          onMove={async dest => {
            const el = muta
            const numeDest = dest ? foldere.find(d => d.id === dest)?.nume ?? 'folder' : 'Documente'
            await ruleaza(el.f.id, () => el.tip === 'fisier' ? mutaFisier(el.f.id, dest) : mutaFolder(el.f.id, dest), `Mutat în „${numeDest}”.`)
          }}
        />
      )}

      {sterge && (
        <ConfirmModal title={sterge.tip === 'fisier' ? 'Șterge documentul' : 'Șterge folderul'} message={mesajStergere(sterge)}
          confirmLabel="Șterge" danger onConfirm={confirmaStergere} onCancel={() => setSterge(null)} />
      )}
    </div>
  )
}

/** Rândul în editare (folder nou sau redenumire): Enter salvează, Escape renunță. La fișiere, extensia rămâne fixă și
 * se arată separat, ca să nu fie ștearsă din greșeală. */
function RandEditare({ icon, initial, sufix, placeholder, onSave, onCancel }: {
  icon: React.ReactNode; initial: string; sufix?: string; placeholder?: string
  onSave: (nume: string) => Promise<void>; onCancel: () => void
}) {
  const baza = sufix && initial.toLowerCase().endsWith(`.${sufix}`) ? initial.slice(0, -(sufix.length + 1)) : initial
  const [val, setVal] = useState(baza)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])

  const salveaza = async () => {
    const curat = val.trim()
    if (!curat) { onCancel(); return }
    setBusy(true)
    try { await onSave(sufix ? `${curat}.${sufix}` : curat) } catch { setBusy(false); ref.current?.focus() }
  }

  return (
    <li className="doc-row doc-row--edit">
      <div className="doc-row-main">
        {icon}
        <div className="doc-edit">
          <input ref={ref} className="field-input" value={val} placeholder={placeholder} maxLength={150} disabled={busy}
            aria-label={placeholder ?? 'Nume nou'}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void salveaza() } else if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }} />
          {sufix && <span className="doc-edit-ext">.{sufix}</span>}
        </div>
      </div>
      <div className="doc-row-actions">
        <button type="button" className="btn btn-ghost btn-xs" onClick={onCancel} disabled={busy} aria-label="Renunță">✕</button>
        <button type="button" className="btn btn-primary btn-xs" onClick={() => void salveaza()} disabled={busy} aria-label="Salvează">
          <BtnLabel busy={busy}>✓</BtnLabel>
        </button>
      </div>
    </li>
  )
}
