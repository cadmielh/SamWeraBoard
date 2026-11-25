import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { Client } from '../../types'
import { useApp } from '../../AppContext'
import { formatDateRo } from '../../lib/dates'
import {
  ACCEPT, DESC_IMPLICIT, ascundeTemporar, incepeStergereAmanata, terminaStergereAmanata, caleFolder, continutRecursiv, creeazaFolder, descarcaFisier, descendenti, extensie,
  editabil, extractibil, formatMarime, tiparibil, initDocumenteClient, mutaFisier, mutaFolder, normalizeazaCautare, numeLipire, previzualizabil,
  reafiseaza, redenumesteFisier, redenumesteFolder, revinoLaOriginal, sorteazaFisiere, sorteazaFoldere, stergeFisier, stergeFolder, subfoldere,
  useAscunse, useDocumenteClient, type EroareFisier, type Fisier, type Folder, type Sortare,
} from '../../lib/fisiere'
import ConfirmModal from '../ConfirmModal'
import BtnLabel from '../BtnLabel'
import MeniuRand, { type OptiuneMeniu } from './MeniuRand'
import FisierPreview from './FisierPreview'
import MutaModal, { type ElementMutat } from './MutaModal'
import CoadaIncarcare from './CoadaIncarcare'
import ExtrageAct from './ExtrageAct'
import SpatiuCabinet from './SpatiuCabinet'
import { useIncarcari } from './useIncarcari'
import { IconCautare, IconDescarca, IconDirectie, IconFisier, IconFolder, IconFolderNou, IconIncarca, IconRestrange } from './icons'
import '../../styles/documente.css'

// Editorul de poze (procesarea pixelilor) se descarcă doar la prima editare.
const EditorPoza = lazy(() => import('./EditorPoza'))
const TiparModal = lazy(() => import('./TiparModal'))
const PaginiPdf = lazy(() => import('./PaginiPdf'))

const SORTARI: { key: Sortare; label: string }[] = [
  { key: 'nume', label: 'Nume' },
  { key: 'tip', label: 'Tip' },
  { key: 'marime', label: 'Mărime' },
  { key: 'data', label: 'Dată' },
]
const CHEIE_SORTARE = 'cabinio:documente-sortare'
const CAUTARE_DE_LA = 8                       // câmpul de căutare apare de la atâtea elemente încolo
const MAX_DESCARCARI_ODATA = 10               // browserele cer confirmare pentru multe descărcări simultane
const MIME_INTERN = 'application/x-cabinio-documente'

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
const cheieEl = (e: Element) => `${e.tip === 'fisier' ? 'f' : 'd'}:${e.f.id}`
const nrText = (n: number, unu: string, multe: string) => `${n} ${n === 1 ? unu : multe}`

// Clienții pentru care s-a cerut deja pregătirea documentelor în sesiunea curentă (serverul e oricum idempotent).
const initCerut = new Set<string>()

/** Ținta clipboard-ului e un câmp de text sau există o fereastră deschisă: lipirea nu e pentru documente. */
function lipireInAltaParte(e: ClipboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (t && (t.closest('input, textarea, [contenteditable="true"]'))) return true
  return !!document.querySelector('.modal-backdrop')
}

interface Props {
  client: Client
  /** `coloana`: în coloana din dreapta a fișei (se poate restrânge); `sectiune`: în fluxul fișei (ecran îngust, telefon). */
  layout?: 'sectiune' | 'coloana'
  restrans?: boolean
  onRestrans?: (restrans: boolean) => void
  /** Salvarea unei modificări a fișei (ex. datele extrase dintr-un act păstrat). Fără ea, „Extrage datele” nu apare. */
  onSaveClient?: (patch: Partial<Client>) => Promise<void>
}

/** Documentele clientului: foldere, încărcare (buton, tragere, lipire), căutare, selecție multiplă, previzualizare,
 * descărcare, redenumire, mutare (și prin tragere), ștergere cu „Anulează”, extragerea datelor dintr-un act. Lista e
 * live; toate modificările trec prin server. Viewer: doar vede și descarcă. La prima deschidere de către un membru,
 * serverul creează folderele implicite ale cabinetului (o singură dată per client). */
export default function ClientDocumente({ client, layout = 'sectiune', restrans = false, onRestrans, onSaveClient }: Props) {
  const { activeWorkspace, userRole, canEdit, toast } = useApp()
  const workspaceId = activeWorkspace?.id ?? null
  const date = useDocumenteClient(workspaceId, client.id)
  const { loading, error } = date
  const ascunse = useAscunse()
  const coada = useIncarcari(workspaceId, client.id)
  // Ștergerea rămâne posibilă și după expirarea abonamentului (datele sunt ale cabinetului); restul cere acces complet.
  const poateSterge = userRole === 'admin' || userRole === 'member'
  const poateSelecta = canEdit || poateSterge

  // Elementele în curs de ștergere (cu „Anulează” încă disponibil) nu se mai arată, cu tot conținutul lor.
  const foldere = useMemo(() => {
    const ascunsePlus = new Set<string>()
    for (const d of date.foldere) if (ascunse.has(d.id)) descendenti(date.foldere, d.id).forEach(id => ascunsePlus.add(id))
    return date.foldere.filter(d => !ascunsePlus.has(d.id))
  }, [date.foldere, ascunse])
  const fisiere = useMemo(() => {
    const vizibile = new Set(foldere.map(d => d.id))
    return date.fisiere.filter(f => !ascunse.has(f.id) && (!f.folderId || vizibile.has(f.folderId)))
  }, [date.fisiere, foldere, ascunse])

  const [folderCerut, setFolderCerut] = useState<string | null>(null)
  const [sortare, setSortareStare] = useState(citesteSortare)
  const setSortare = (next: { dupa: Sortare; desc: boolean }) => {
    setSortareStare(next)
    try { localStorage.setItem(CHEIE_SORTARE, JSON.stringify(next)) } catch { /* doar pentru sesiunea curentă */ }
  }
  const [cautare, setCautare] = useState('')
  const [selectie, setSelectie] = useState<Set<string>>(new Set())
  const [redenumire, setRedenumire] = useState<string | null>(null)       // id-ul rândului editat
  const [folderNou, setFolderNou] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [muta, setMuta] = useState<Element[] | null>(null)
  const [confirmaSterge, setConfirmaSterge] = useState<Element[] | null>(null)
  const [extrage, setExtrage] = useState<Fisier | null>(null)
  const [editor, setEditor] = useState<Fisier | null>(null)
  const [tipar, setTipar] = useState<Fisier[] | null>(null)
  const [pagini, setPagini] = useState<Fisier | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [peste, setPeste] = useState(false)
  const [tintaTragere, setTintaTragere] = useState<string | null>(null)   // folderul (sau „radacina”) de sub cursor
  const [trase, setTrase] = useState<Element[] | null>(null)                // elementele trase din listă
  const [initInCurs, setInitInCurs] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  // Pregătirea automată: client fără niciun folder sau fișier, deschis de cineva care poate scrie.
  useEffect(() => {
    if (loading || error || !canEdit || !workspaceId || date.fisiere.length || date.foldere.length) return
    const k = `${workspaceId}/${client.id}`
    if (initCerut.has(k)) return
    initCerut.add(k)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitInCurs(k)
    initDocumenteClient(client.id).catch(() => { /* fără foldere implicite: utilizatorul le poate crea */ })
      .finally(() => setInitInCurs(cur => cur === k ? null : cur))
  }, [loading, error, canEdit, workspaceId, client.id, date.fisiere.length, date.foldere.length])
  const pregatire = initInCurs === `${workspaceId}/${client.id}`

  // Un folder șters între timp (de un coleg) trimite înapoi la rădăcină.
  const cale = useMemo(() => caleFolder(foldere, folderCerut), [foldere, folderCerut])
  const folderCurent = cale.length ? cale[cale.length - 1].id : null
  const numeFolderCurent = cale.length ? cale[cale.length - 1].nume : 'Documente'

  const q = normalizeazaCautare(cautare)
  const fisiereAici = useMemo(() => sorteazaFisiere(
    q ? fisiere.filter(f => normalizeazaCautare(f.nume).includes(q)) : fisiere.filter(f => f.folderId === folderCurent),
    sortare.dupa, sortare.desc), [fisiere, folderCurent, sortare, q])
  const folderAici = useMemo(() => sorteazaFoldere(
    q ? foldere.filter(d => normalizeazaCautare(d.nume).includes(q)) : subfoldere(foldere, folderCurent),
    foldere, fisiere, sortare.dupa, sortare.desc), [foldere, fisiere, folderCurent, sortare, q])
  const deVazut = useMemo(() => fisiereAici.filter(f => previzualizabil(f.mime)), [fisiereAici])
  const totalOcupat = useMemo(() => fisiere.reduce((s, f) => s + f.marime, 0), [fisiere])
  const elementeAici: Element[] = useMemo(() => [
    ...folderAici.map(f => ({ tip: 'folder', f }) as Element), ...fisiereAici.map(f => ({ tip: 'fisier', f }) as Element),
  ], [folderAici, fisiereAici])
  const selectate = useMemo(() => elementeAici.filter(e => selectie.has(cheieEl(e))), [elementeAici, selectie])

  const numeMembru = (uid: string) => {
    const m = activeWorkspace?.members?.[uid]
    return m ? (m.displayName || m.email.split('@')[0]) : ''
  }
  const caleText = (folderId: string | null) => caleFolder(foldere, folderId).map(d => d.nume).join(' / ') || 'Documente'

  const deschide = (folderId: string | null) => {
    setFolderCerut(folderId); setRedenumire(null); setFolderNou(false); setSelectie(new Set()); setCautare('')
  }

  // Escape golește întâi selecția și se oprește acolo: altfel pagina Clienți l-ar folosi și pentru închiderea fișei
  // (ascultă tot pe document, deci aici ascultăm în faza de captură, înaintea ei). Al doilea Escape închide fișa, ca înainte.
  useEffect(() => {
    if (!selectie.size) return
    const laTasta = (e: KeyboardEvent) => {
      // Un meniu „⋯” deschis își tratează singur Escape (se închide); selecția rămâne până la următorul Escape.
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop, .doc-menu-pop')) return
      if ((e.target as HTMLElement)?.closest('textarea, input:not([type="checkbox"]):not([type="radio"])')) return
      e.stopPropagation()
      setSelectie(new Set())
    }
    document.addEventListener('keydown', laTasta, true)
    return () => document.removeEventListener('keydown', laTasta, true)
  }, [selectie.size])

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

  const alegeFisiere = (list: FileList | File[] | null, folderId: string | null = folderCurent) => {
    const files = Array.from(list ?? [])
    if (files.length) coada.adauga(files, folderId)
  }

  // ── Lipire din clipboard (Ctrl+V / Cmd+V): o captură sau un act copiat intră în folderul deschis ──
  const lipireRef = useRef<(e: ClipboardEvent) => void>(() => {})
  useEffect(() => {
    lipireRef.current = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (!canEdit || !files.length || lipireInAltaParte(e)) return
      e.preventDefault()
      const acum = new Date()
      alegeFisiere(files.map(f => new File([f], numeLipire(f, acum), { type: f.type })), folderCurent)
      if (restrans) onRestrans?.(false)
    }
  })
  useEffect(() => {
    const h = (e: ClipboardEvent) => lipireRef.current(e)
    document.addEventListener('paste', h)
    return () => document.removeEventListener('paste', h)
  }, [])

  // ── Tragere: fișiere din calculator (peste secțiune sau peste un folder) și elemente din listă (peste un folder) ──
  const cuFisiere = (e: React.DragEvent) => canEdit && Array.from(e.dataTransfer.types).includes('Files')
  const intern = (e: React.DragEvent) => canEdit && Array.from(e.dataTransfer.types).includes(MIME_INTERN)
  const dragHandlers = canEdit ? {
    onDragEnter: (e: React.DragEvent) => { if (!cuFisiere(e)) return; e.preventDefault(); dragDepth.current++; setPeste(true) },
    onDragOver: (e: React.DragEvent) => { if (!cuFisiere(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) { setPeste(false); setTintaTragere(null) } },
    onDrop: (e: React.DragEvent) => {
      if (!cuFisiere(e)) return
      e.preventDefault(); dragDepth.current = 0; setPeste(false); setTintaTragere(null)
      alegeFisiere(e.dataTransfer.files)
      if (restrans) onRestrans?.(false)          // fișiere trase pe banda restrânsă: coloana se deschide, cu progresul
    },
  } : {}

  /** Poate primi folderul `dest` elementele trase? (nu în el însuși, nu în propriul subfolder, nu acolo unde sunt deja) */
  const primeste = (dest: string | null): boolean => {
    if (!trase) return true
    return trase.some(el => (el.tip === 'fisier' ? el.f.folderId : el.f.parentId) !== dest)
      && !trase.some(el => el.tip === 'folder' && dest !== null && descendenti(foldere, el.f.id).has(dest))
  }

  /** Handlerele unei ținte de tragere: un folder din listă sau o treaptă din firul de navigare (`null` = rădăcina). */
  const tintaHandlers = (dest: string | null) => canEdit ? {
    onDragOver: (e: React.DragEvent) => {
      if (!(cuFisiere(e) || (intern(e) && primeste(dest)))) return
      e.preventDefault(); e.stopPropagation()
      e.dataTransfer.dropEffect = intern(e) ? 'move' : 'copy'
      setTintaTragere(dest ?? 'radacina')
    },
    onDragLeave: () => setTintaTragere(t => t === (dest ?? 'radacina') ? null : t),
    onDrop: (e: React.DragEvent) => {
      const fisiereTrase = cuFisiere(e)
      if (!fisiereTrase && !intern(e)) return
      e.preventDefault(); e.stopPropagation()
      dragDepth.current = 0; setPeste(false); setTintaTragere(null)
      if (fisiereTrase) alegeFisiere(e.dataTransfer.files, dest)
      else if (trase && primeste(dest)) mutaElemente(trase, dest).catch(() => { /* mesajul l-a afișat mutaElemente */ })
      setTrase(null)
    },
  } : {}

  const rowDrag = (el: Element) => canEdit ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      // Un element selectat trage toată selecția; altfel doar pe el.
      const lot = selectie.has(cheieEl(el)) ? selectate : [el]
      setTrase(lot)
      e.dataTransfer.setData(MIME_INTERN, lot.map(cheieEl).join(','))
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => { setTrase(null); setTintaTragere(null) },
  } : {}

  // ── Mutare, ștergere (cu „Anulează”), descărcare — pentru unul sau mai multe elemente ──
  const mutaElemente = async (lot: Element[], dest: string | null) => {
    const deMutat = lot.filter(el => (el.tip === 'fisier' ? el.f.folderId : el.f.parentId) !== dest)
    const erori: string[] = []
    setBusyId(deMutat.length === 1 ? deMutat[0].f.id : 'lot')
    for (const el of deMutat) {
      try {
        if (el.tip === 'fisier') await mutaFisier(el.f.id, dest)
        else await mutaFolder(el.f.id, dest)
      } catch (e) {
        erori.push(`„${el.f.nume}”: ${(e as Error).message}`)
      }
    }
    setBusyId(null)
    setSelectie(new Set())
    const ok = deMutat.length - erori.length
    const unde = dest ? foldere.find(d => d.id === dest)?.nume ?? 'folder' : 'Documente'
    if (ok) toast(ok === 1 && deMutat.length === 1 ? `Mutat în „${unde}”.` : `${nrText(ok, 'element mutat', 'elemente mutate')} în „${unde}”.`, 'ok')
    if (erori.length) toast(erori.length === 1 ? `Nu s-a putut muta ${erori[0]}` : `${erori.length} elemente nu s-au putut muta. ${erori[0]}`, 'err')
    if (erori.length && !ok) throw new Error('mutare eșuată')
  }

  /** Ștergerea amânată: elementele dispar acum, cererile pleacă la expirarea notificării; „Anulează” le readuce. */
  /** `confirmat`: utilizatorul a confirmat ștergerea folderelor cu conținut (se șterg recursiv). Un folder șters fără
   * confirmare (era gol) se șterge doar dacă e tot gol: dacă între timp cineva a încărcat ceva în el, serverul refuză
   * (`folder_negol`) și folderul rămâne. Cererile pleacă spre cabinetul de acum, nu spre cel activ la expirare. */
  const stergeAmanat = (lot: Element[], confirmat = false) => {
    const ids = lot.map(el => el.f.id)
    const wid = workspaceId ?? undefined
    ascundeTemporar(ids)
    incepeStergereAmanata()
    setSelectie(new Set())
    const mesaj = lot.length === 1
      ? `${lot[0].tip === 'folder' ? 'Folderul' : 'Documentul'} „${lot[0].f.nume}” a fost șters.`
      : `${nrText(lot.length, 'element șters', 'elemente șterse')}.`
    toast(mesaj, 'ok', {
      action: { label: 'Anulează', onClick: () => { reafiseaza(ids); terminaStergereAmanata() } },
      onExpire: async () => {
        const erori: string[] = []
        const pastrate: string[] = []
        try {
          for (const el of lot) {
            try {
              if (el.tip === 'fisier') await stergeFisier(el.f.id, wid)
              else await stergeFolder(el.f.id, confirmat, wid)
            } catch (e) {
              const err = e as EroareFisier
              if (err.code === 'folder_negol') pastrate.push(el.f.nume)
              else if (err.status !== 404) erori.push(el.f.nume)     // 404: șters deja (de un coleg)
            }
          }
        } finally {
          terminaStergereAmanata()
          reafiseaza(ids)                                 // cele șterse dispar oricum din listă; cele rămase reapar
        }
        const lista = (n: string[]) => `${n.slice(0, 3).map(x => `„${x}”`).join(', ')}${n.length > 3 ? '…' : ''}`
        if (pastrate.length) toast(`Nu am șters ${lista(pastrate)}: între timp a primit documente noi. Verifică-l și șterge-l din nou dacă e cazul.`, 'info')
        if (erori.length) toast(`Nu s-au putut șterge: ${lista(erori)}.`, 'err')
      },
    })
  }

  /** Folderele cu conținut cer confirmare (se șterg cu tot ce conțin); documentele și folderele goale, nu: „Anulează” ajunge. */
  const cereStergere = (lot: Element[]) => {
    const cuContinut = lot.some(el => el.tip === 'folder' && (() => {
      const c = continutRecursiv(foldere, fisiere, el.f.id)
      return c.fisiere + c.foldere > 0
    })())
    if (cuContinut) setConfirmaSterge(lot)
    else stergeAmanat(lot)
  }

  const descarcaLot = async (lot: Fisier[]) => {
    for (const f of lot.slice(0, MAX_DESCARCARI_ODATA)) await descarca(f)
    if (lot.length > MAX_DESCARCARI_ODATA) toast(`S-au descărcat primele ${MAX_DESCARCARI_ODATA}. Selectează mai puține pentru restul.`, 'info')
  }

  const mesajStergere = (lot: Element[]) => {
    const folderele = lot.filter(el => el.tip === 'folder')
    const c = folderele.reduce((acc, el) => {
      const x = continutRecursiv(foldere, fisiere, el.f.id)
      return { fisiere: acc.fisiere + x.fisiere, foldere: acc.foldere + x.foldere }
    }, { fisiere: 0, foldere: 0 })
    const parti = [c.fisiere ? nrText(c.fisiere, 'fișier', 'fișiere') : '', c.foldere ? nrText(c.foldere, 'subfolder', 'subfoldere') : ''].filter(Boolean)
    const ce = lot.length === 1 ? <>Folderul „<strong>{lot[0].f.nume}</strong>” conține</> : <>Folderele selectate conțin</>
    return <>{ce} {parti.join(' și ')}. Se șterg împreună. Vei putea anula câteva secunde.</>
  }

  const optiuni = (el: Element): OptiuneMeniu[] => [
    ...(el.tip === 'fisier' ? [{ label: 'Descarcă', onSelect: () => void descarca(el.f) }] : []),
    ...(el.tip === 'fisier' && canEdit && onSaveClient && extractibil(el.f.mime)
      ? [{ label: 'Extrage datele în fișă', onSelect: () => setExtrage(el.f) }] : []),
    ...(canEdit ? [
      ...(el.tip === 'fisier' && editabil(el.f.mime) && !el.f.arhivat
        ? [{ label: 'Editează (decupează, îndreaptă)', onSelect: () => setEditor(el.f) }] : []),
      ...(el.tip === 'fisier' && el.f.mime === 'application/pdf' && !el.f.arhivat
        ? [{ label: 'Pagini (rotește, mută, șterge)', onSelect: () => setPagini(el.f) }] : []),
      ...(el.tip === 'fisier' && tiparibil(el.f.mime) && !el.f.arhivat
        ? [{ label: 'Pregătește pentru tipar', onSelect: () => setTipar([el.f]) }] : []),
      ...(el.tip === 'fisier' && el.f.editat
        ? [{ label: 'Revino la original', onSelect: () => void ruleaza(el.f.id, () => revinoLaOriginal(el.f.id), 'Documentul a revenit la original.') }]
        : []),
      { label: 'Redenumește', onSelect: () => { setFolderNou(false); setRedenumire(el.f.id) } },
      { label: 'Mută în…', onSelect: () => setMuta([el]) },
    ] : []),
    ...(poateSterge ? [{ label: 'Șterge', danger: true, onSelect: () => cereStergere([el]) }] : []),
  ]

  const comuta = (el: Element) => setSelectie(prev => {
    const next = new Set(prev)
    const k = cheieEl(el)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })
  const toateSelectate = elementeAici.length > 0 && selectate.length === elementeAici.length

  const nimic = !loading && !error && !pregatire && fisiere.length === 0 && foldere.length === 0
  const golAici = !loading && !error && !pregatire && !nimic && !q && fisiereAici.length === 0 && folderAici.length === 0 && !folderNou
  const faraRezultate = !!q && fisiereAici.length === 0 && folderAici.length === 0
  const arataCautare = fisiere.length + foldere.length >= CAUTARE_DE_LA || !!cautare

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
          <button type="button" className="doc-icon-btn" onClick={() => inputRef.current?.click()} aria-label="Încarcă documente" title="Încarcă documente"
            data-ghid="doc-incarca">
            <IconIncarca size={16} />
          </button>
        )}
        {fileInput}
      </div>
    )
  }

  const casuta = (el: Element) => poateSelecta && (
    <input type="checkbox" className="doc-check" checked={selectie.has(cheieEl(el))} onChange={() => comuta(el)}
      aria-label={`Selectează ${el.f.nume}`} onClick={e => e.stopPropagation()} />
  )

  const randFolder = (d: Folder) => {
    const el: Element = { tip: 'folder', f: d }
    const n = continutRecursiv(foldere, fisiere, d.id)
    if (redenumire === d.id) {
      return (
        <RandEditare key={d.id} icon={<IconFolder />} initial={d.nume}
          onCancel={() => setRedenumire(null)}
          onSave={async nume => {
            if (nume !== d.nume) await ruleaza(d.id, () => redenumesteFolder(d.id, nume))
            setRedenumire(null)
          }} />
      )
    }
    const detalii = n.fisiere === 0 && n.foldere === 0 ? 'Gol'
      : [n.fisiere ? nrText(n.fisiere, 'fișier', 'fișiere') : '', n.foldere ? nrText(n.foldere, 'subfolder', 'subfoldere') : ''].filter(Boolean).join(' · ')
    return (
      <li key={d.id} {...rowDrag(el)} {...tintaHandlers(d.id)}
        className={`doc-row doc-row--folder${busyId === d.id ? ' is-busy' : ''}${tintaTragere === d.id ? ' is-tinta' : ''}${selectie.has(cheieEl(el)) ? ' is-selected' : ''}`}>
        {casuta(el)}
        <button type="button" className="doc-row-main" onClick={() => deschide(d.id)}>
          <IconFolder />
          <span className="doc-row-text">
            <span className="doc-name">{d.nume}</span>
            <span className="doc-meta">{q ? [caleText(d.parentId), detalii].join(' · ') : detalii}</span>
          </span>
        </button>
        <div className="doc-row-actions">
          <MeniuRand eticheta={`Acțiuni pentru folderul ${d.nume}`} optiuni={optiuni(el)} />
        </div>
      </li>
    )
  }

  const randFisier = (f: Fisier) => {
    const el: Element = { tip: 'fisier', f }
    if (redenumire === f.id) {
      return (
        <RandEditare key={f.id} icon={<IconFisier mime={f.mime} />} initial={f.nume} sufix={extensie(f.nume)}
          onCancel={() => setRedenumire(null)}
          onSave={async nume => {
            if (nume !== f.nume) await ruleaza(f.id, () => redenumesteFisier(f.id, nume))
            setRedenumire(null)
          }} />
      )
    }
    return (
      <li key={f.id} {...rowDrag(el)}
        className={`doc-row${busyId === f.id ? ' is-busy' : ''}${selectie.has(cheieEl(el)) ? ' is-selected' : ''}`}>
        {casuta(el)}
        <button type="button" className="doc-row-main" onClick={() => deschideFisier(f)}
          title={previzualizabil(f.mime) ? `Deschide „${f.nume}”` : `Descarcă „${f.nume}”`}>
          <IconFisier mime={f.mime} />
          <span className="doc-row-text">
            <span className="doc-name">{f.nume}</span>
            <span className="doc-meta">
              {[q ? caleText(f.folderId) : '', f.sursa === 'generat' ? 'generat' : '', f.editat ? 'editat' : '', formatMarime(f.marime),
                f.createdAt ? formatDateRo(f.createdAt) : '', q ? '' : numeMembru(f.createdBy)].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
        <div className="doc-row-actions">
          {busyId === f.id
            ? <span className="spin spin-dark" role="status" aria-label="Se procesează" />
            : <button type="button" className="doc-icon-btn doc-only-hover" onClick={() => void descarca(f)} aria-label={`Descarcă ${f.nume}`} title="Descarcă"><IconDescarca /></button>}
          <MeniuRand eticheta={`Acțiuni pentru ${f.nume}`} optiuni={optiuni(el)} />
        </div>
      </li>
    )
  }

  const fisiereSelectate = selectate.filter((el): el is { tip: 'fisier'; f: Fisier } => el.tip === 'fisier').map(el => el.f)

  return (
    <div className={`cv2-section doc-section doc-section--${layout}${peste ? ' is-drop' : ''}`} data-sectiune="documente" {...dragHandlers}>
      <div className="doc-head">
        <div className="cv2-section-label">
          Documente
          {fisiere.length > 0 && <span className="cv2-count-chip">{fisiere.length}</span>}
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
            <button type="button" className="btn btn-ghost btn-sm doc-btn" onClick={() => { setRedenumire(null); setCautare(''); setFolderNou(true) }} title="Folder nou" aria-label="Folder nou">
              <IconFolderNou /> <span className="doc-btn-text">Folder nou</span>
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn btn-outline-primary btn-sm doc-btn" onClick={() => inputRef.current?.click()}
              title="Încarcă documente (sau trage-le aici, ori lipește cu Ctrl+V)" aria-label="Încarcă documente" data-ghid="doc-incarca">
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

      {arataCautare && (
        <div className="doc-cautare">
          <IconCautare />
          <input type="search" className="field-input" placeholder="Caută în documentele clientului…" value={cautare}
            aria-label="Caută în documentele clientului"
            onChange={e => { setCautare(e.target.value); setSelectie(new Set()) }}
            onKeyDown={e => { if (e.key === 'Escape' && cautare) { e.stopPropagation(); setCautare('') } }} />
        </div>
      )}

      {selectate.length > 0 && (
        <div className="doc-bulk" role="toolbar" aria-label="Acțiuni pentru elementele selectate">
          <label className="doc-bulk-all">
            <input type="checkbox" className="doc-check" checked={toateSelectate}
              onChange={() => setSelectie(toateSelectate ? new Set() : new Set(elementeAici.map(cheieEl)))} aria-label="Selectează tot" />
            <span>{nrText(selectate.length, 'selectat', 'selectate')}</span>
          </label>
          <div className="doc-bulk-actions">
            {fisiereSelectate.length > 0 && (
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => void descarcaLot(fisiereSelectate)}>
                <IconDescarca size={14} /> Descarcă
              </button>
            )}
            {canEdit && fisiereSelectate.length > 0 && fisiereSelectate.length === selectate.length && fisiereSelectate.every(f => tiparibil(f.mime)) && (
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setTipar(fisiereSelectate)}
                title="Într-un PDF A4: buletinul față-verso la mărime reală sau câte un document pe pagină">Pentru tipar</button>
            )}
            {canEdit && !q && <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMuta(selectate)}>Mută în…</button>}
            {poateSterge && <button type="button" className="btn btn-ghost btn-xs doc-bulk-danger" onClick={() => cereStergere(selectate)}>Șterge</button>}
            <button type="button" className="doc-icon-btn" onClick={() => setSelectie(new Set())} aria-label="Renunță la selecție" title="Renunță (Esc)">✕</button>
          </div>
        </div>
      )}

      {cale.length > 0 && !q && (
        <nav className="doc-crumbs" aria-label="Locația în documente">
          <button type="button" className={`doc-crumb${tintaTragere === 'radacina' ? ' is-tinta' : ''}`} onClick={() => deschide(null)}
            {...tintaHandlers(null)}>Documente</button>
          {cale.map((c, i) => (
            <span key={c.id} className="doc-crumb-wrap">
              <span className="doc-crumb-sep" aria-hidden>›</span>
              <button type="button" className={`doc-crumb${tintaTragere === c.id ? ' is-tinta' : ''}`} onClick={() => deschide(c.id)}
                aria-current={i === cale.length - 1 ? 'page' : undefined} {...(i < cale.length - 1 ? tintaHandlers(c.id) : {})}>{c.nume}</button>
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
              ? <>Trage aici actele clientului, lipește-le (Ctrl+V) sau <button type="button" className="doc-link" onClick={() => inputRef.current?.click()}>alege-le de pe calculator</button>. Sunt păstrate criptat.</>
              : 'Documentele încărcate de colegi vor apărea aici.'}
          </div>
          {canEdit && <div className="doc-empty-hint">PDF, imagini, Word, Excel, XML sau text · până la 15 MB pe fișier</div>}
        </div>
      )}

      {!loading && !error && !pregatire && (!nimic || folderNou) && (
        <ul className="doc-list" data-ghid="doc-lista">
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
          {folderAici.map(randFolder)}
          {fisiereAici.map(randFisier)}
          {golAici && (
            <li className="doc-empty doc-empty--folder">
              <div className="doc-empty-text">
                Folderul e gol.{canEdit && <> Trage fișiere aici sau <button type="button" className="doc-link" onClick={() => inputRef.current?.click()}>încarcă</button>.</>}
              </div>
            </li>
          )}
          {faraRezultate && (
            <li className="doc-empty doc-empty--folder">
              <div className="doc-empty-text">Niciun document sau folder nu conține „{cautare.trim()}”.</div>
            </li>
          )}
        </ul>
      )}

      {!loading && !error && <SpatiuCabinet workspaceId={workspaceId} client={totalOcupat} />}

      {peste && !tintaTragere && (
        <div className="doc-drop" aria-hidden>
          <IconIncarca size={22} />
          <span>Eliberează pentru a încărca în „{numeFolderCurent}”</span>
        </div>
      )}

      {preview && deVazut.some(f => f.id === preview) && (
        <FisierPreview fisiere={deVazut} start={deVazut.findIndex(f => f.id === preview)}
          onClose={() => setPreview(null)} onDownload={f => descarca(f)}
          onEdit={canEdit ? f => { setPreview(null); if (f.mime === 'application/pdf') setPagini(f); else setEditor(f) } : undefined} />
      )}

      {muta && (
        <MutaModal
          foldere={foldere}
          elemente={muta.map<ElementMutat>(el => ({ tip: el.tip, id: el.f.id, nume: el.f.nume }))}
          folderCurent={muta[0].tip === 'fisier' ? muta[0].f.folderId : muta[0].f.parentId}
          onClose={() => setMuta(null)}
          onMove={dest => mutaElemente(muta, dest)}
        />
      )}

      {confirmaSterge && (
        <ConfirmModal title={confirmaSterge.length === 1 ? 'Șterge folderul' : 'Șterge elementele selectate'} message={mesajStergere(confirmaSterge)}
          confirmLabel="Șterge" danger onConfirm={() => { const lot = confirmaSterge; setConfirmaSterge(null); stergeAmanat(lot, true) }}
          onCancel={() => setConfirmaSterge(null)} />
      )}

      {pagini && (
        <Suspense fallback={null}><PaginiPdf fisier={pagini} onClose={() => setPagini(null)} /></Suspense>
      )}

      {tipar && (
        <Suspense fallback={null}>
          <TiparModal fisiere={tipar} onClose={() => setTipar(null)} onCreat={f => {
            setSelectie(new Set())
            toast(`„${f.nume}” a fost creat lângă documente.`, 'ok', { action: { label: 'Deschide', onClick: () => setPreview(f.id) } })
          }} />
        </Suspense>
      )}

      {editor && (
        <Suspense fallback={null}><EditorPoza fisier={editor} onClose={() => setEditor(null)} /></Suspense>
      )}

      {extrage && onSaveClient && (
        <ExtrageAct client={client} fisier={extrage} onSaveClient={onSaveClient} onClose={() => setExtrage(null)} onToast={toast} />
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
