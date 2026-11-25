import { useMemo, useState } from 'react'
import { useApp } from '../../AppContext'
import { formatDateRo } from '../../lib/dates'
import {
  LIMITA_CABINET, MAX_FOLDERE_IMPLICITE, nivelSpatiu, descarcaFisier, formatMarime, previzualizabil, salveazaSetariDocumente, stergeFisier,
  useArhiva, useSetariDocumente, useSpatiuDocumente, type Fisier,
} from '../../lib/fisiere'
import BtnLabel from '../BtnLabel'
import ConfirmModal from '../ConfirmModal'
import FisierPreview from './FisierPreview'
import MeniuRand from './MeniuRand'
import { IconDescarca, IconFisier, IconFolder } from './icons'
import '../../styles/documente.css'

const CAUTARE_DE_LA = 8

/** Setări › Documente: spațiul ocupat de cabinet și Arhiva (documentele clienților șterși, păstrate la cerere). */
export default function DocumenteSetari() {
  const { activeWorkspace, userRole, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const spatiu = useSpatiuDocumente(workspaceId)
  const arhiva = useArhiva(workspaceId)
  const poateSterge = userRole === 'admin' || userRole === 'member'
  const [cautare, setCautare] = useState('')
  const [preview, setPreview] = useState<{ lista: Fisier[]; id: string } | null>(null)
  const [sterge, setSterge] = useState<Fisier | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const grupuri = useMemo(() => {
    const q = cautare.trim().toLocaleLowerCase('ro')
    const potrivite = q
      ? arhiva.fisiere.filter(f => `${f.nume} ${f.clientNume ?? ''} ${f.cale ?? ''}`.toLocaleLowerCase('ro').includes(q))
      : arhiva.fisiere
    const map = new Map<string, Fisier[]>()
    for (const f of potrivite) {
      const k = f.clientNume || 'Client fără nume'
      map.set(k, [...(map.get(k) ?? []), f])
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'ro', { sensitivity: 'base' }))
      .map(([client, lista]) => ({ client, lista: lista.sort((a, b) => a.nume.localeCompare(b.nume, 'ro', { numeric: true })) }))
  }, [arhiva.fisiere, cautare])

  const procent = spatiu ? Math.min(100, (spatiu.octeti / LIMITA_CABINET) * 100) : 0

  const descarca = async (f: Fisier) => {
    setBusyId(f.id)
    try { await descarcaFisier(f) } catch (e) { toast((e as Error).message, 'err') } finally { setBusyId(null) }
  }
  const confirmaStergere = async () => {
    const f = sterge
    setSterge(null)
    if (!f) return
    setBusyId(f.id)
    try {
      await stergeFisier(f.id)
      toast(`„${f.nume}” a fost șters.`, 'ok')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div className="card-head"><span className="card-title">Spațiu folosit</span></div>
        <div className="card-body doc-spatiu">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.875rem' }}>
            <span><strong>{formatMarime(spatiu?.octeti ?? 0)}</strong> din {formatMarime(LIMITA_CABINET)}</span>
            <span className="doc-meta">{spatiu?.numar ?? 0} {spatiu?.numar === 1 ? 'document' : 'documente'}</span>
          </div>
          <div className={`doc-spatiu-bar${nivelSpatiu(procent)}`} role="meter"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(procent)} aria-label="Spațiu folosit pentru documente">
            <span style={{ width: `${Math.max(procent, spatiu?.octeti ? 1 : 0)}%` }} />
          </div>
          <div className="card-sub">
            Inclus în abonament. Documentele sunt păstrate criptat, în Uniunea Europeană; fiecare deschidere apare în jurnalul de acces.
          </div>
        </div>
      </div>

      <FoldereImpliciteCard />
      <FolderGenerateCard />

      <div className="card">
        <div className="card-head">
          <span className="card-title">Arhivă</span>
          {arhiva.fisiere.length > 0 && <span className="cv2-count-chip">{arhiva.fisiere.length}</span>}
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
          <div className="card-sub" style={{ marginTop: 0 }}>
            Documentele clienților șterși, când ați ales să le păstrați. Rămân aici până le ștergeți.
          </div>
          {arhiva.fisiere.length >= CAUTARE_DE_LA && (
            <input className="field-input" type="search" placeholder="Caută după document sau client…" value={cautare}
              onChange={e => setCautare(e.target.value)} aria-label="Caută în Arhivă" />
          )}
          {arhiva.loading && <div className="doc-loading"><span className="spin spin-dark" /> Se încarcă…</div>}
          {arhiva.error && <div className="doc-empty-text">Arhiva nu a putut fi încărcată.</div>}
          {!arhiva.loading && !arhiva.error && arhiva.fisiere.length === 0 && (
            <div className="doc-empty"><div className="doc-empty-text">Arhiva e goală.</div></div>
          )}
          {!arhiva.loading && arhiva.fisiere.length > 0 && grupuri.length === 0 && (
            <div className="doc-empty-text">Niciun document nu se potrivește căutării.</div>
          )}
          {grupuri.map(g => (
            <section key={g.client} className="doc-arhiva-grup" aria-label={g.client}>
              <div className="doc-arhiva-client">{g.client} <span className="doc-meta">{g.lista.length}</span></div>
              <ul className="doc-list">
                {g.lista.map(f => (
                  <li key={f.id} className={`doc-row${busyId === f.id ? ' is-busy' : ''}`}>
                    <button type="button" className="doc-row-main" title={previzualizabil(f.mime) ? `Deschide „${f.nume}”` : `Descarcă „${f.nume}”`}
                      onClick={() => previzualizabil(f.mime)
                        ? setPreview({ lista: g.lista.filter(x => previzualizabil(x.mime)), id: f.id })
                        : void descarca(f)}>
                      <IconFisier mime={f.mime} />
                      <span className="doc-row-text">
                        <span className="doc-name">{f.nume}</span>
                        <span className="doc-meta">
                          {[f.cale, formatMarime(f.marime), f.arhivatLa ? `arhivat la ${formatDateRo(f.arhivatLa)}` : ''].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                    <div className="doc-row-actions">
                      {busyId === f.id
                        ? <span className="spin spin-dark" role="status" aria-label="Se procesează" />
                        : <button type="button" className="doc-icon-btn doc-only-hover" onClick={() => void descarca(f)} aria-label={`Descarcă ${f.nume}`} title="Descarcă"><IconDescarca /></button>}
                      {poateSterge && <MeniuRand eticheta={`Acțiuni pentru ${f.nume}`} optiuni={[{ label: 'Șterge definitiv', danger: true, onSelect: () => setSterge(f) }]} />}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      {preview && (
        <FisierPreview fisiere={preview.lista} start={Math.max(0, preview.lista.findIndex(f => f.id === preview.id))}
          onClose={() => setPreview(null)} onDownload={descarca} />
      )}
      {sterge && (
        <ConfirmModal title="Șterge documentul" danger confirmLabel="Șterge"
          message={<>Ștergi definitiv „<strong>{sterge.nume}</strong>” din Arhivă? Acțiunea nu poate fi anulată.</>}
          onConfirm={confirmaStergere} onCancel={() => setSterge(null)} />
      )}
    </div>
  )
}

/** Folderele create automat la fiecare client. Doar adminul le schimbă; se aplică clienților ale căror documente nu au
 * fost încă deschise (cei pregătiți își păstrează folderele, pe care le pot redenumi sau șterge). */
function FoldereImpliciteCard() {
  const { activeWorkspace, userRole, canEdit, toast } = useApp()
  const salvate = useSetariDocumente(activeWorkspace?.id ?? null)?.foldereImplicite ?? null
  const editabil = userRole === 'admin' && canEdit
  const [lista, setLista] = useState<string[] | null>(null)       // ciorna; null = fără modificări
  const [busy, setBusy] = useState(false)
  const curent = lista ?? salvate ?? []
  const modificat = lista !== null && JSON.stringify(lista.map(n => n.trim())) !== JSON.stringify(salvate)

  const seteaza = (i: number, v: string) => setLista(curent.map((n, j) => (j === i ? v : n)))
  const salveaza = async () => {
    const curate = curent.map(n => n.trim()).filter(Boolean)
    const chei = curate.map(n => n.toLocaleLowerCase('ro'))
    if (new Set(chei).size !== chei.length) { toast('Două foldere au același nume.', 'err'); return }
    setBusy(true)
    try {
      await salveazaSetariDocumente({ foldereImplicite: curate })
      setLista(null)
      toast('Folderele implicite au fost salvate.', 'ok')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head"><span className="card-title">Foldere implicite pentru clienți</span></div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <div className="card-sub" style={{ marginTop: 0 }}>
          Se creează automat la fiecare client, prima dată când îi deschideți documentele. În fișa clientului pot fi apoi
          redenumite, șterse sau completate cu altele. Schimbările de aici nu modifică clienții deja pregătiți.
        </div>
        {salvate === null && <div className="doc-loading"><span className="spin spin-dark" /> Se încarcă…</div>}
        {salvate !== null && curent.length === 0 && <div className="doc-empty-text">Niciun folder implicit: clienții pornesc fără foldere.</div>}
        {salvate !== null && curent.length > 0 && (
          <ul className="doc-list">
            {curent.map((nume, i) => (
              <li key={i} className="doc-row">
                <div className="doc-row-main" style={{ cursor: 'default' }}>
                  <IconFolder />
                  {editabil
                    ? <input className="field-input doc-implicit-input" value={nume} maxLength={80} aria-label={`Folderul ${i + 1}`}
                        onChange={e => seteaza(i, e.target.value)} />
                    : <span className="doc-name">{nume}</span>}
                </div>
                {editabil && (
                  <div className="doc-row-actions">
                    <button type="button" className="doc-icon-btn" aria-label={`Elimină ${nume || 'folderul'}`} title="Elimină"
                      onClick={() => setLista(curent.filter((_, j) => j !== i))}>✕</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {editabil && salvate !== null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={curent.length >= MAX_FOLDERE_IMPLICITE}
              onClick={() => setLista([...curent, ''])}>+ Adaugă folder</button>
            {modificat && (
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLista(null)} disabled={busy}>Renunță</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={salveaza} disabled={busy}>
                  <BtnLabel busy={busy}>Salvează</BtnLabel>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Folderul în care se păstrează copiile documentelor generate (bifa „Păstrează o copie…” de la generare). Dacă nu
 * există la client, serverul îl creează la prima copie. */
function FolderGenerateCard() {
  const { activeWorkspace, userRole, canEdit, toast } = useApp()
  const salvat = useSetariDocumente(activeWorkspace?.id ?? null)?.folderGenerate ?? null
  const editabil = userRole === 'admin' && canEdit
  const [ciorna, setCiorna] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const valoare = ciorna ?? salvat ?? ''
  const modificat = ciorna !== null && ciorna.trim() !== salvat

  const salveaza = async () => {
    if (!valoare.trim()) { toast('Alege un nume pentru folder.', 'err'); return }
    setBusy(true)
    try {
      await salveazaSetariDocumente({ folderGenerate: valoare.trim() })
      setCiorna(null)
      toast('Folderul documentelor generate a fost salvat.', 'ok')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head"><span className="card-title">Documente generate</span></div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <div className="card-sub" style={{ marginTop: 0 }}>
          La generare, poți bifa „Păstrează o copie în documentele clientului”. Copia (.docx) ajunge în folderul de mai jos;
          dacă clientul nu îl are, se creează automat.
        </div>
        {salvat === null
          ? <div className="doc-loading"><span className="spin spin-dark" /> Se încarcă…</div>
          : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.625rem', flexWrap: 'wrap' }}>
              <IconFolder />
              {editabil
                ? <input className="field-input doc-implicit-input" style={{ flex: 1, minWidth: '12rem' }} value={valoare} maxLength={80}
                    aria-label="Folderul documentelor generate" onChange={e => setCiorna(e.target.value)} />
                : <span className="doc-name">{salvat}</span>}
              {modificat && (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCiorna(null)} disabled={busy}>Renunță</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={salveaza} disabled={busy}>
                    <BtnLabel busy={busy}>Salvează</BtnLabel>
                  </button>
                </>
              )}
            </div>
          )}
      </div>
    </div>
  )
}
