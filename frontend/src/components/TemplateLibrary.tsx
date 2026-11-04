import { useState, useRef, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BuiltinTemplate, DocTemplate, ToastItem } from '../types'
import { updateTemplateMeta, type TemplateInput } from '../lib/templates'
import { useBuiltinTemplates } from '../lib/builtinTemplates'
import IconTrash from './IconTrash'

type TipTemplate = 'universal' | 'PF' | 'PJ'
const TIP_TEMPLATE_OPTIONS: { value: TipTemplate; label: string }[] = [
  { value: 'universal', label: 'Universal (PF + PJ)' },
  { value: 'PF', label: 'Persoană Fizică' },
  { value: 'PJ', label: 'Persoană Juridică' },
]
import { createTemplate, detectPlaceholders, duplicateBuiltinTemplate, replaceTemplateFile, type TemplateFileMeta } from '../lib/api'
import { assertWritable } from '../lib/billing'
import { ensureDriveToken } from '../lib/driveAuth'
import { pickGoogleDoc } from '../lib/picker'
import { setBuiltinHidden, setTemplateOrder } from '../lib/workspace'
import { applyTemplateOrder, builtinOrderKey, deliveryLabel, diffTemplate, hasChanges, matchesTemplateSearch, ownOrderKey, type TemplateChanges } from '../lib/templateChanges'
import TemplateSearchInput from './TemplateSearchInput'
import { useApp } from '../AppContext'
import Modal from './Modal'
import BlankImportModal from './BlankImportModal'
import TemplateDeliveryModal from './TemplateDeliveryModal'

// Aceeași limită ca template_safety.MAX_STORED_BYTES (verificată și pe server, și în firestore.rules).
const MAX_BASE64_BYTES = 500 * 1024  // 500 KB
const TOO_LARGE_MSG = 'Fișierul depășește 500 KB. Comprimă imaginile din document (Word: Fișier → Comprimare imagini) și încearcă din nou.'

/** Înlocuirea în curs a fișierului unui șablon: noul fișier, etichetele lui și ce se schimbă în formular. */
interface PendingReplace { tpl: DocTemplate; file: File; next: TemplateFileMeta; changes: TemplateChanges }

function ChangeList({ title, items, tone }: { title: string; items: string[]; tone: 'warn' | 'info' }) {
  if (!items.length) return null
  return (
    <div style={{ fontSize: '.8rem', color: tone === 'warn' ? 'var(--o700)' : 'var(--s600)' }}>
      <strong>{title}</strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem', marginTop: '.25rem' }}>
        {items.map(i => <code key={i} style={{ background: 'var(--s100)', padding: '.1rem .35rem', borderRadius: 4, fontSize: '.75rem' }}>{i}</code>)}
      </div>
    </div>
  )
}

interface Props {
  templates: DocTemplate[]
  onAdd: (data: TemplateInput) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onClose: () => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

type AddTab = 'docx' | 'gdoc'
type View = 'list' | 'add' | 'guide' | 'replace' | 'edit'

/** Câmpurile editabile din aplicație ale unui șablon propriu (aceleași limite ca în firestore.rules). */
interface EditForm { name: string; description: string; outputNameTemplate: string; tipTemplate: TipTemplate }

/** Cardul unui șablon din bibliotecă: închis arată doar antetul (tip, nume, semnale), la click se deschid detaliile
 * și acțiunile. Antetul e un div cu rol de buton, nu un <button>, pentru că poate conține bifa „Vizibil la generare”.
 * Ordinea se schimbă doar din mânerul „⋮⋮” (adminul): un click pe card îl deschide, nu îl mută. */
function LibraryCard({ sortId, name, canDrag, open, onToggle, dim, head, children }: {
  sortId: string
  name: string
  canDrag: boolean
  open: boolean
  onToggle: () => void
  dim?: boolean
  head: ReactNode
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: sortId, disabled: !canDrag })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
      className={`tl-card${open ? ' tl-card--open' : ''}${dim ? ' tl-card--dim' : ''}${isDragging ? ' tl-card--dragging' : ''}`}>
      <div className="tl-card-head" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle}
        onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle() } }}>
        {canDrag && (
          <button type="button" ref={setActivatorNodeRef} className="tl-drag" {...attributes} {...listeners}
            onClick={e => e.stopPropagation()} title="Trage pentru a schimba ordinea" aria-label={`Mută „${name}” (Spațiu, apoi săgeți)`}>
            ⋮⋮
          </button>
        )}
        <span className="tl-chevron" aria-hidden>›</span>
        {head}
      </div>
      {open && <div className="tl-card-body">{children}</div>}
    </div>
  )
}

/** O secțiune reordonabilă a bibliotecii (șabloanele de bază sau cele proprii), cu mouse, atingere sau tastatură. */
function SortableSection({ ids, onReorder, children }: { ids: string[]; onReorder: (ids: string[]) => void; children: ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
    </DndContext>
  )
}

function PlaceholderBadge({ ph }: { ph: string }) {
  return (
    <code style={{ background: 'var(--p50)', color: 'var(--p700)', padding: '.1rem .35rem', borderRadius: 4, fontSize: '.75rem', fontFamily: 'monospace' }}>
      {ph}
    </code>
  )
}

const GUIDE_SECTIONS = [
  {
    title: 'Persoană fizică / titular (PF sau scanare CI)',
    items: ['{{CNP}}', '{{NUME}}', '{{PRENUME}}', '{{SERIE_NUMAR}}', '{{DATA_NASTERII}}', '{{LOCUL_NASTERII}}', '{{CETATENIA}} (după „cetățenia”: română)', '{{CETATENIA_ACORD}} (după „cetățean”: român / română, după sexul persoanei)', '{{ADRESA}}', '{{JUDET}}', '{{EMISA_DE}}', '{{VALABILA_DE_LA}}', '{{VALABILA_PANA_LA}}'],
  },
  {
    title: 'Entitate / Societate',
    items: [
      '{{SOCIETATE_DENUMIRE}}', '{{SOCIETATE_CIF}}', '{{SOCIETATE_NR_REG}}', '{{SOCIETATE_SEDIU}}', '{{SOCIETATE_JUDET}}', '{{SOCIETATE_FORMA_JURIDICA}}',
      '{{ASOCIATI_LISTA}} / {{ADMINISTRATORI_LISTA}} (numele pe o singură linie: „A, B și C”)',
      '{{CAMP_ORICE_NUME}} — câmp completat manual la generare (ex. {{CAMP_NR_HOTARARE}}); numele apare ca titlu al câmpului',
      '{{CAPITAL_SOCIAL_TOTAL}}', '{{PARTI_SOCIALE_TOTALE}}',
      '{{CAEN_1}} (activitate principală, format "cod - descriere")',
      '{{CAEN_DOMENIU}} (domeniul principal de activitate — grupa CAEN, 3 cifre, derivată automat din CAEN_1)',
      '{{CAEN_PRINCIPAL_COD}} (doar codul CAEN principal)', '{{CAEN_SECUNDARE_COD}} (codurile CAEN secundare, separate prin virgulă; „-” dacă nu există)',
    ],
  },
  {
    title: 'Asociați — PJ (N = 1, 2, 3 …)',
    items: [
      '{{ASOCIAT_N_NUME}}', '{{ASOCIAT_N_PRENUME}}', '{{ASOCIAT_N_CNP}}', '{{ASOCIAT_N_ADRESA}}', '{{ASOCIAT_N_DATA_NASTERII}}', '{{ASOCIAT_N_LOCUL_NASTERII}}', '{{ASOCIAT_N_CETATENIA}}', '{{ASOCIAT_N_SERIE_NUMAR}}', '{{ASOCIAT_N_SERIE_ACT}}', '{{ASOCIAT_N_NR_ACT}}', '{{ASOCIAT_N_EMISA_DE}}', '{{ASOCIAT_N_VALABILA_DE_LA}}', '{{ASOCIAT_N_VALABILA_PANA_LA}}', '{{ASOCIAT_N_COTA_PARTICIPARE}}',
      '{{CAPITAL_SOCIAL_ASOCIAT_N}}', '{{PARTI_SOCIALE_ASOCIAT_N}}',
    ],
  },
  {
    title: 'Administratori — PJ (N = 1, 2, 3 …)',
    items: ['{{ADMINISTRATOR_N_NUME}}', '{{ADMINISTRATOR_N_PRENUME}}', '{{ADMINISTRATOR_N_CNP}}', '{{ADMINISTRATOR_N_ADRESA}}', '{{ADMINISTRATOR_N_DATA_NASTERII}}', '{{ADMINISTRATOR_N_LOCUL_NASTERII}}', '{{ADMINISTRATOR_N_CETATENIA}}', '{{ADMINISTRATOR_N_SERIE_NUMAR}}', '{{ADMINISTRATOR_N_EMISA_DE}}', '{{ADMINISTRATOR_N_VALABILA_DE_LA}}', '{{ADMINISTRATOR_N_VALABILA_PANA_LA}}'],
  },
  {
    title: 'Membri familie — IF (N = 1, 2, 3 …)',
    items: ['{{MEMBRU_IF_N_NUME}}', '{{MEMBRU_IF_N_PRENUME}}', '{{MEMBRU_IF_N_CNP}}', '{{MEMBRU_IF_N_ADRESA}}', '{{MEMBRU_IF_N_DATA_NASTERII}}', '{{MEMBRU_IF_N_SERIE_NUMAR}}'],
  },
  {
    title: 'Blocuri repetitive — un paragraf per element (doar .docx)',
    items: [
      '{{#ASOCIATI}} ... {{/ASOCIATI}} — paragraful/paragrafele dintre cele două marcaje se repetă o dată pentru fiecare asociat',
      '{{#ADMINISTRATORI}} ... {{/ADMINISTRATORI}} — la fel, pentru administratori',
      'În interiorul {{#ASOCIATI}}/{{#ADMINISTRATORI}}: {{NUME}}, {{PRENUME}}, {{CNP}}, {{ADRESA}}, {{JUDET}}, {{DATA_NASTERII}}, {{LOCUL_NASTERII}}, {{CETATENIA}}, {{CETATENIA_ACORD}}, {{SERIE_NUMAR}}, {{SERIE_ACT}}, {{NR_ACT}}, {{EMISA_DE}}, {{VALABILA_DE_LA}}, {{VALABILA_PANA_LA}}, {{COTA_PARTICIPARE}}',
      '{{INDEX}} — numărul de ordine (1, 2, 3…) în cadrul blocului',
      '{{CAPITAL_SOCIAL}}, {{PARTI_SOCIALE}} — doar în {{#ASOCIATI}}, calculate din cota asociatului',
      '{{#CAEN_SECUNDARE}} {{CAEN}} {{/CAEN_SECUNDARE}} — un rând per activitate secundară CAEN (nelimitat); dacă nu există niciuna, tot blocul dispare din document',
    ],
  },
  {
    title: 'Poziții numerotate fixe (N = 1, 2, 3 …) — pentru text diferit per persoană sau tabele',
    items: [
      'Folosește {{ASOCIAT_N_...}} / {{ADMINISTRATOR_N_...}} / {{MEMBRU_IF_N_...}} doar când textul chiar diferă în funcție de poziție (ex. semnătura doar a asociatului 1), sau în interiorul unui tabel — blocurile repetitive de mai sus nu funcționează în tabele',
      'Dacă poziția N nu există (ex. {{ASOCIAT_3_NUME}} dar sunt doar 2 asociați), paragraful respectiv e șters automat din document; într-un tabel, doar celula e golită',
    ],
  },
  {
    title: 'Date automate',
    items: ['{{DATA_AZI}}', '{{DATA_CURENTA}}', '{{LUNA_AZI}}', '{{AN_AZI}}'],
  },
]

export default function TemplateLibrary({ templates, onAdd, onRemove, onClose, onToast }: Props) {
  const [view, setView] = useState<View>('list')
  const [addTab, setAddTab] = useState<AddTab>('docx')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const { builtins, loading: builtinsLoading } = useBuiltinTemplates()
  const [duplicatingKey, setDuplicatingKey] = useState<string | null>(null)
  const { activeWorkspace, userRole, canEdit, isSuperAdmin } = useApp()
  const hiddenBuiltins = new Set(activeWorkspace?.hiddenBuiltins ?? [])
  const isWorkspaceAdmin = userRole === 'admin'
  const [togglingKey, setTogglingKey] = useState<string | null>(null)
  const [deliverTpl, setDeliverTpl] = useState<DocTemplate | null>(null)
  const [search, setSearch] = useState('')
  // Cardurile deschise: `b:<cheie>` pentru șabloanele de bază, `t:<id>` pentru cele proprii.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (k: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (!next.delete(k)) next.add(k)
    return next
  })
  // Ordinea stabilită de admin (Workspace.templateOrder), aceeași și la pasul de generare. După o mutare, ordinea nouă
  // se arată imediat; rămâne valabilă până sosește documentul cabinetului actualizat (`base` nu mai e același).
  const savedOrder = activeWorkspace?.templateOrder
  const [localOrder, setLocalOrder] = useState<{ base: string[] | undefined; order: string[] } | null>(null)
  const order = localOrder && localOrder.base === savedOrder ? localOrder.order : savedOrder
  const orderedBuiltins = applyTemplateOrder(builtins, b => builtinOrderKey(b.key), order)
  const orderedTemplates = applyTemplateOrder(templates, t => ownOrderKey(t.id), order)
  const shownBuiltins = orderedBuiltins.filter(b => matchesTemplateSearch(b.name, search))
  const shownTemplates = orderedTemplates.filter(t => matchesTemplateSearch(t.name, search))
  // Pe o listă filtrată, „mută mai sus” nu are un sens clar: reordonarea merge doar fără căutare.
  const canReorder = isWorkspaceAdmin && !search.trim()

  const reorder = async (section: 'builtins' | 'own', ids: string[]) => {
    if (!activeWorkspace) return
    const builtinIds = section === 'builtins' ? ids : orderedBuiltins.map(b => builtinOrderKey(b.key))
    const ownIds = section === 'own' ? ids : orderedTemplates.map(t => ownOrderKey(t.id))
    const next = [...builtinIds, ...ownIds]
    setLocalOrder({ base: savedOrder, order: next })
    try {
      await setTemplateOrder(activeWorkspace.id, next)
    } catch {
      setLocalOrder(null)
      onToast('Ordinea nu s-a putut salva. Doar administratorul cabinetului poate schimba ordinea șabloanelor.', 'err')
    }
  }

  // Editarea numelui, descrierii, tipului și numelui fișierului generat (direct în Firestore, validat de reguli).
  const [editTpl, setEditTpl] = useState<DocTemplate | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Înlocuirea fișierului unui șablon propriu (templates_api.py): alegere → diferențe → confirmare.
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [replaceTarget, setReplaceTarget] = useState<DocTemplate | null>(null)
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(null)
  const [replacingId, setReplacingId] = useState<string | null>(null)
  const [replaceSaving, setReplaceSaving] = useState(false)

  // docx add form state
  const [docxFile, setDocxFile] = useState<File | null>(null)
  const [docxName, setDocxName] = useState('')
  const [docxDesc, setDocxDesc] = useState('')
  const [docxOutput, setDocxOutput] = useState('')
  const [docxPlaceholders, setDocxPlaceholders] = useState<string[]>([])
  const [docxTip, setDocxTip] = useState<TipTemplate>('universal')
  const [detecting, setDetecting] = useState(false)
  // Fișierul refuzat de server (nevalid, macro, conținut extern…): nu se poate salva ca șablon.
  const [docxError, setDocxError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // gdoc add form state
  const [gdocName, setGdocName] = useState('')
  const [gdocDocId, setGdocDocId] = useState('')
  const [gdocPickedName, setGdocPickedName] = useState('')
  const [pickingGdoc, setPickingGdoc] = useState(false)
  const [gdocDesc, setGdocDesc] = useState('')
  const [gdocOutput, setGdocOutput] = useState('')
  const [gdocTip, setGdocTip] = useState<TipTemplate>('universal')

  // Un document fără etichete (dar cu locuri libere „……”): aplicația propune singură câmpurile din context (BlankImportModal).
  const [blankFile, setBlankFile] = useState<File | null>(null)

  const handleDocxFileSelect = async (f: File, offerBlanks = true) => {
    setDocxFile(f)
    setDocxName(prev => prev || f.name.replace(/\.[^.]+$/, ''))
    setDocxOutput(prev => prev || `${f.name.replace(/\.[^.]+$/, '')}_completat.docx`)
    setDetecting(true)
    setDocxError(null)
    try {
      const { placeholders } = await detectPlaceholders(f)
      setDocxPlaceholders(placeholders)
      if (placeholders.length === 0 && offerBlanks) setBlankFile(f)
    } catch (err: unknown) {
      // Înainte, o eroare aici salva tăcut un șablon fără nicio etichetă; acum fișierul nu se mai poate salva.
      setDocxError((err as Error).message || 'Fișierul nu a putut fi citit.')
      setDocxPlaceholders([])
    } finally {
      setDetecting(false)
    }
  }

  const handleAddDocx = async () => {
    if (!docxFile || !docxName.trim()) { onToast('Selectează un fișier și introdu un nume', 'err'); return }
    if (docxError) { onToast(docxError, 'err'); return }
    if (docxFile.size > MAX_BASE64_BYTES) { onToast(TOO_LARGE_MSG, 'err'); return }
    setSaving(true)
    try {
      assertWritable()
      // Etichetele le recalculează serverul, din același fișier: cele afișate mai sus sunt doar previzualizarea.
      await createTemplate(docxFile, {
        name: docxName.trim(),
        description: docxDesc.trim(),
        tipTemplate: docxTip,
        outputNameTemplate: docxOutput.trim() || `${docxName.trim()}_completat.docx`,
      })
      onToast('Șablon adăugat', 'ok')
      resetDocxForm()
      setView('list')
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Eroare la salvare', 'err')
    } finally {
      setSaving(false)
    }
  }

  // Șablon creat din locuri libere: se întoarce în formularul de adăugare, cu un mesaj clar și cursorul pe „Nume șablon”;
  // rămâne doar să completezi numele și secțiunea (tipul), apoi „Salvează șablon”.
  const [justImported, setJustImported] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const showImportedTemplate = async (file: File) => {
    setView('add')
    setAddTab('docx')
    setJustImported(true)
    setDocxName(file.name.replace(/\.[^.]+$/, ''))
    await handleDocxFileSelect(file, false)
    setTimeout(() => {
      nameInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }, 80)
  }

  // Alege șablonul prin Google Picker (drive.file): id-ul nu se mai lipește de mână, iar aplicația primește acces la el.
  const handlePickGdoc = async () => {
    setPickingGdoc(true)
    try {
      const doc = await pickGoogleDoc(await ensureDriveToken())
      if (doc) {
        setGdocDocId(doc.id)
        setGdocPickedName(doc.name)
        if (!gdocName.trim()) setGdocName(doc.name)
      }
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Google Drive indisponibil', 'err')
    } finally {
      setPickingGdoc(false)
    }
  }

  const handleAddGdoc = async () => {
    if (!gdocName.trim() || !gdocDocId.trim()) { onToast('Introdu numele și alege documentul din Drive', 'err'); return }
    setSaving(true)
    try {
      await onAdd({
        name: gdocName.trim(),
        description: gdocDesc.trim(),
        type: 'gdoc',
        docId: gdocDocId.trim(),
        tipTemplate: gdocTip,
        outputNameTemplate: gdocOutput.trim() || `${gdocName.trim()}_completat`,
      })
      onToast('Șablon Google Doc adăugat', 'ok')
      resetGdocForm()
      setView('list')
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Eroare la salvare', 'err')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (id: string) => {
    setRemovingId(id)
    try {
      await onRemove(id)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Eroare la ștergere', 'err')
    } finally {
      setRemovingId(null)
    }
  }

  const handleDownload = (tpl: DocTemplate) => {
    if (!tpl.fileBase64 || !tpl.fileName) return
    const binary = atob(tpl.fileBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = tpl.fileName; a.click()
    URL.revokeObjectURL(url)
  }

  const resetDocxForm = () => { setDocxFile(null); setDocxName(''); setDocxDesc(''); setDocxOutput(''); setDocxPlaceholders([]); setDocxTip('universal'); setJustImported(false); setDocxError(null) }

  // ── Înlocuirea fișierului ──
  const startReplace = (tpl: DocTemplate) => {
    setReplaceTarget(tpl)
    replaceInputRef.current?.click()
  }

  const handleReplaceFileSelect = async (file: File) => {
    const tpl = replaceTarget
    if (!tpl) return
    if (file.size > MAX_BASE64_BYTES) { onToast(TOO_LARGE_MSG, 'err'); return }
    setReplacingId(tpl.id)
    try {
      const next = await detectPlaceholders(file)
      setPendingReplace({ tpl, file, next, changes: diffTemplate(tpl, next, builtins) })
      setView('replace')
    } catch (err: unknown) {
      onToast((err as Error).message || 'Fișierul nu a putut fi citit.', 'err')
    } finally {
      setReplacingId(null)
    }
  }

  const confirmReplace = async () => {
    if (!pendingReplace) return
    const { tpl, file } = pendingReplace
    setReplaceSaving(true)
    try {
      await replaceTemplateFile(tpl.id, file, tpl.revision ?? 0)
      onToast(`Fișierul șablonului „${tpl.name}” a fost înlocuit`, 'ok')
      setPendingReplace(null)
      setView('list')
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Înlocuirea a eșuat', 'err')
      // La conflict, lista se actualizează singură (onSnapshot): utilizatorul vede versiunea colegului.
      if ((err as { code?: string }).code === 'revision_conflict') { setPendingReplace(null); setView('list') }
    } finally {
      setReplaceSaving(false)
    }
  }

  const startEdit = (tpl: DocTemplate) => {
    setEditTpl(tpl)
    setEditForm({
      name: tpl.name,
      description: tpl.description ?? '',
      outputNameTemplate: tpl.outputNameTemplate ?? '',
      tipTemplate: (tpl.tipTemplate as TipTemplate | undefined) ?? 'universal',
    })
    setView('edit')
  }

  const closeEdit = () => { setEditTpl(null); setEditForm(null); setView('list') }

  const saveEdit = async () => {
    if (!editTpl || !editForm || !activeWorkspace) return
    const next = {
      name: editForm.name.trim(),
      description: editForm.description.trim(),
      outputNameTemplate: editForm.outputNameTemplate.trim()
        || `${editForm.name.trim()}_completat${editTpl.type === 'docx' ? '.docx' : ''}`,
      tipTemplate: editForm.tipTemplate,
    }
    // Se trimit doar câmpurile schimbate: regulile validează exact ce se modifică.
    const before = { name: editTpl.name, description: editTpl.description ?? '', outputNameTemplate: editTpl.outputNameTemplate ?? '', tipTemplate: editTpl.tipTemplate ?? 'universal' }
    const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => before[k as keyof typeof before] !== v))
    if (!Object.keys(patch).length) { closeEdit(); return }
    setEditSaving(true)
    try {
      await updateTemplateMeta(activeWorkspace.id, editTpl.id, patch)
      onToast('Șablon actualizat', 'ok')
      closeEdit()
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      onToast(code === 'permission-denied'
        ? 'Modificarea nu a fost acceptată. Verifică lungimea câmpurilor sau dacă ai drept de editare.'
        : (err as Error).message ?? 'Eroare la salvare', 'err')
    } finally {
      setEditSaving(false)
    }
  }

  const toggleBuiltin = async (key: string, visible: boolean) => {
    if (!activeWorkspace) return
    setTogglingKey(key)
    try {
      await setBuiltinHidden(activeWorkspace.id, key, !visible)
    } catch {
      onToast('Nu s-a putut salva alegerea. Doar administratorul cabinetului poate ascunde șabloane de bază.', 'err')
    } finally {
      setTogglingKey(null)
    }
  }
  const resetGdocForm = () => {
    setGdocPickedName(''); setGdocName(''); setGdocDocId(''); setGdocDesc(''); setGdocOutput(''); setGdocTip('universal') }

  const handleDuplicateBuiltin = async (b: BuiltinTemplate) => {
    setDuplicatingKey(b.key)
    try {
      assertWritable()
      await duplicateBuiltinTemplate(b.key)
      onToast(`"${b.name}" duplicat în Șabloanele mele`, 'ok')
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Eroare la duplicare', 'err')
    } finally {
      setDuplicatingKey(null)
    }
  }

  return (
    <Modal
      onClose={onClose}
      ariaLabel="Biblioteca de șabloane"
      backdropStyle={{ background: 'var(--backdrop)', alignItems: 'stretch', justifyContent: 'flex-end', padding: 0 }}
      boxStyle={{
        width: '100%', maxWidth: 520, borderRadius: 0, boxShadow: '-4px 0 24px rgba(0,0,0,.12)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'none',
      }}
    >
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--s200)', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <span style={{ flex: 1, fontWeight: 700, fontSize: '1rem', color: 'var(--s800)' }}>📁 Biblioteca de șabloane</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setView('guide')}>Ghid placeholders</button>
          <button className="btn btn-outline-primary btn-sm" onClick={() => setView('add')}>+ Adaugă</button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1.3rem', padding: '.2rem', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto' }}>

          {/* ── LIST ── */}
          {view === 'list' && (
            <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <TemplateSearchInput value={search} onChange={setSearch} />
              {/* ── Șabloane de bază — servite din backend, disponibile din prima în orice workspace ── */}
              <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                Șabloane de bază
              </div>
              {builtinsLoading && (
                <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}><span className="spin" /> Se încarcă…</div>
              )}
              {!builtinsLoading && builtins.length > 0 && (
                <div style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '-.375rem' }}>
                  {isWorkspaceAdmin
                    ? `Debifează „Vizibil la generare” pentru șabloanele pe care cabinetul nu le folosește. ${search.trim()
                      ? 'Golește căutarea ca să poți schimba ordinea.'
                      : 'Trage de ⋮⋮ ca să schimbi ordinea.'} Ambele se aplică la generare, pentru toți colegii.`
                    : 'Administratorul cabinetului alege ce șabloane de bază apar la generare și în ce ordine.'}
                </div>
              )}
              {!builtinsLoading && builtins.length > 0 && shownBuiltins.length === 0 && (
                <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}>Niciun șablon de bază nu se potrivește căutării.</div>
              )}
              {!builtinsLoading && (
              <SortableSection ids={shownBuiltins.map(b => builtinOrderKey(b.key))} onReorder={ids => void reorder('builtins', ids)}>
              {shownBuiltins.map(b => {
                const hidden = hiddenBuiltins.has(b.key)
                return (
                  <LibraryCard
                    key={b.key} sortId={builtinOrderKey(b.key)} name={b.name} canDrag={canReorder} open={expanded.has(`b:${b.key}`)} onToggle={() => toggleExpanded(`b:${b.key}`)} dim={hidden}
                    head={<>
                      <span style={{ fontSize: '.75rem', fontWeight: 700, padding: '.1rem .4rem', borderRadius: 3, background: 'var(--p50)', color: 'var(--p700)' }}>
                        DE BAZĂ
                      </span>
                      <span className="tl-card-name">{b.name}</span>
                      {isWorkspaceAdmin ? (
                        // Bifa rămâne pe cardul închis: se folosește des și nu deschide cardul.
                        <label onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.75rem', color: 'var(--s600)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!hidden} disabled={togglingKey === b.key}
                            onChange={e => void toggleBuiltin(b.key, e.target.checked)} />
                          Vizibil la generare
                        </label>
                      ) : hidden && (
                        <span style={{ fontSize: '.72rem', color: 'var(--s500)' }}>Ascuns la generare</span>
                      )}
                    </>}
                  >
                    {b.description && <div style={{ fontSize: '.78rem', color: 'var(--s500)' }}>{b.description}</div>}
                    {b.clauses.length > 0 && (
                      <div style={{ fontSize: '.72rem', color: 'var(--s400)' }}>{b.clauses.length} articole opționale, la alegere</div>
                    )}
                    <div style={{ display: 'flex', gap: '.375rem', flexWrap: 'wrap' }}>
                      <button className="btn btn-outline-primary btn-sm" onClick={() => handleDuplicateBuiltin(b)} disabled={duplicatingKey === b.key}
                        title="Creează o copie în „Șabloanele mele”, pe care o poți modifica">
                        {duplicatingKey === b.key ? <span className="spin" /> : '📋 Duplică'}
                      </button>
                    </div>
                  </LibraryCard>
                )
              })}
              </SortableSection>
              )}

              <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase', marginTop: '.375rem' }}>
                Șabloanele mele
              </div>
              {templates.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--s400)', fontSize: '.875rem', padding: '2rem 0' }}>
                  Niciun șablon adăugat.<br />
                  <button className="btn btn-outline-primary btn-sm" style={{ marginTop: '.75rem' }} onClick={() => setView('add')}>+ Adaugă primul șablon</button>
                </div>
              )}
              {templates.length > 0 && shownTemplates.length === 0 && (
                <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}>Niciun șablon propriu nu se potrivește căutării.</div>
              )}
              <SortableSection ids={shownTemplates.map(t => ownOrderKey(t.id))} onReorder={ids => void reorder('own', ids)}>
              {shownTemplates.map(tpl => {
                const label = deliveryLabel(tpl, activeWorkspace?.members)
                const newerSource = tpl.sourceKey && tpl.sourceVersion != null
                  ? builtins.find(b => b.key === tpl.sourceKey && b.version > tpl.sourceVersion!)
                  : undefined
                const hasFile = tpl.type === 'docx' && !!tpl.fileBase64
                return (
                  <LibraryCard
                    key={tpl.id} sortId={ownOrderKey(tpl.id)} name={tpl.name} canDrag={canReorder} open={expanded.has(`t:${tpl.id}`)} onToggle={() => toggleExpanded(`t:${tpl.id}`)}
                    head={<>
                      <span style={{ fontSize: '.75rem', fontWeight: 700, padding: '.1rem .4rem', borderRadius: 3, background: tpl.type === 'docx' ? 'var(--b50)' : 'var(--p50)', color: tpl.type === 'docx' ? 'var(--b700)' : 'var(--p700)' }}>
                        {tpl.type === 'docx' ? 'DOCX' : 'GDoc'}
                      </span>
                      {tpl.tipTemplate && tpl.tipTemplate !== 'universal' && (
                        <span style={{
                          fontSize: '.68rem', fontWeight: 700, padding: '.1rem .35rem', borderRadius: 3,
                          background: tpl.tipTemplate === 'PF' ? 'var(--b100)' : 'var(--g100)',
                          color: tpl.tipTemplate === 'PF' ? 'var(--b700)' : 'var(--g700)',
                        }}>
                          {tpl.tipTemplate}
                        </span>
                      )}
                      <span className="tl-card-name">{tpl.name}</span>
                      {/* Semnalele care cer atenție rămân vizibile și pe cardul închis; detaliile lor, la deschidere. */}
                      {label && <span title={label} aria-label={label} style={{ fontSize: '.8rem', color: 'var(--p700)' }}>✦</span>}
                      {newerSource && <span title={`Există o versiune mai nouă a „${newerSource.name}”`} style={{ fontSize: '.8rem' }}>⚠️</span>}
                    </>}
                  >
                    {tpl.description && <div style={{ fontSize: '.78rem', color: 'var(--s500)' }}>{tpl.description}</div>}
                    {label && <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--p700)' }}>✦ {label}</div>}
                    {newerSource && (
                      <div style={{ fontSize: '.72rem', color: 'var(--o700)' }}>
                        ⚠️ bazat pe "{newerSource.name}" v{tpl.sourceVersion} — există o versiune mai nouă (v{newerSource.version})
                      </div>
                    )}
                    {tpl.placeholders && tpl.placeholders.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem', marginTop: '.125rem' }}>
                        {tpl.placeholders.slice(0, 8).map(ph => <PlaceholderBadge key={ph} ph={ph} />)}
                        {tpl.placeholders.length > 8 && (
                          <span style={{ fontSize: '.75rem', color: 'var(--s400)' }}>+{tpl.placeholders.length - 8} mai multe</span>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: '.72rem', color: 'var(--s400)' }}>
                      Output: <code style={{ background: 'var(--s100)', padding: '.1rem .3rem', borderRadius: 3 }}>{tpl.outputNameTemplate}</code>
                    </div>
                    <div style={{ display: 'flex', gap: '.375rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.25rem' }}>
                      {canEdit && (
                        <button className="btn btn-ghost btn-sm" onClick={() => startEdit(tpl)}
                          title="Schimbă numele, descrierea, tipul sau numele fișierului generat" style={{ fontSize: '.75rem' }}>
                          ✎ Editează
                        </button>
                      )}
                      {hasFile && (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleDownload(tpl)} title="Descarcă fișierul șablonului (pentru modificare în Word)" style={{ fontSize: '.75rem' }}>⬇ Descarcă</button>
                      )}
                      {canEdit && hasFile && (
                        <button className="btn btn-ghost btn-sm" onClick={() => startReplace(tpl)} disabled={replacingId === tpl.id}
                          title="Înlocuiește fișierul cu varianta modificată în Word (păstrează formularul)" style={{ fontSize: '.75rem' }}>
                          {replacingId === tpl.id ? <span className="spin" /> : '⟳ Înlocuiește'}
                        </button>
                      )}
                      {isSuperAdmin && hasFile && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setDeliverTpl(tpl)} title="Trimite o copie în cabinetul unui client" style={{ fontSize: '.75rem' }}>
                          ✉ Trimite
                        </button>
                      )}
                      <span style={{ flex: 1 }} />
                      <button
                        onClick={() => handleRemove(tpl.id)}
                        disabled={removingId === tpl.id}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--r500)', padding: '.125rem .3rem', borderRadius: 4, display: 'inline-flex', alignItems: 'center' }}
                        title="Șterge" aria-label={`Șterge „${tpl.name}”`}
                      >
                        {removingId === tpl.id ? <span className="spin" /> : <IconTrash />}
                      </button>
                    </div>
                  </LibraryCard>
                )
              })}
              </SortableSection>
            </div>
          )}

          {/* ── ADD ── */}
          {view === 'add' && (
            <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setView('list')} style={{ alignSelf: 'flex-start' }}>← Înapoi</button>

              {/* Tab docx / gdoc */}
              <div style={{ display: 'flex', gap: '.25rem', background: 'var(--s100)', borderRadius: 'var(--r-sm)', padding: '.25rem' }}>
                {(['docx', 'gdoc'] as AddTab[]).map(t => (
                  <button key={t} onClick={() => setAddTab(t)} style={{
                    flex: 1, padding: '.35rem .75rem', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: addTab === t ? 'var(--surface)' : 'transparent',
                    boxShadow: addTab === t ? 'var(--sh-sm)' : 'none',
                    color: addTab === t ? 'var(--s800)' : 'var(--s400)',
                    fontWeight: addTab === t ? 600 : 400, fontSize: '.85rem', fontFamily: 'var(--font)',
                  }}>
                    {t === 'docx' ? '📄 Word (.docx)' : '🔷 Google Doc'}
                  </button>
                ))}
              </div>

              {addTab === 'docx' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
                  {justImported && docxFile && (
                    <div role="status" style={{ background: 'var(--g50)', border: '1.5px solid var(--g300)', borderRadius: 'var(--r-sm)', padding: '.75rem .875rem', fontSize: '.85rem', color: 'var(--s700)', lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--g700)' }}>✓ Șablonul cu etichete a fost creat din „{docxFile.name}”.</strong>
                      <br />
                      Mai ai de făcut doar doi pași: completează mai jos <strong>Nume șablon</strong> și <strong>Tip șablon</strong> (secțiunea:
                      Universal, Persoană fizică sau Persoană juridică), apoi apasă <strong>„💾 Salvează șablon”</strong>. Abia după aceea apare în „Șabloanele mele”.
                    </div>
                  )}
                  {/* File picker */}
                  <div className="field">
                    <label className="field-label">Fișier .docx</label>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      style={{ border: '2px dashed var(--s300)', borderRadius: 'var(--r-sm)', padding: '1.25rem', textAlign: 'center', cursor: 'pointer', background: 'var(--s50)' }}
                    >
                      {docxFile
                        ? <span style={{ fontWeight: 600, color: 'var(--s700)', fontSize: '.875rem' }}>📄 {docxFile.name} ({(docxFile.size / 1024).toFixed(0)} KB)</span>
                        : <span style={{ color: 'var(--s400)', fontSize: '.875rem' }}>Apasă pentru a alege fișierul .docx</span>
                      }
                    </div>
                    <input ref={fileInputRef} type="file" accept=".docx" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleDocxFileSelect(f); e.target.value = '' }} />
                    {docxFile && docxFile.size > MAX_BASE64_BYTES && (
                      <p style={{ color: 'var(--r500)', fontSize: '.78rem', marginTop: '.375rem' }}>{TOO_LARGE_MSG}</p>
                    )}
                    {docxError && (
                      <p role="alert" style={{ color: 'var(--r500)', fontSize: '.78rem', marginTop: '.375rem' }}>{docxError}</p>
                    )}
                  </div>

                  {/* Detected placeholders */}
                  {detecting && <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}><span className="spin" /> Detectare placeholder-e…</div>}
                  {!detecting && docxPlaceholders.length > 0 && (
                    <div>
                      <div className="field-label">Placeholder-e detectate ({docxPlaceholders.length})</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginTop: '.25rem' }}>
                        {docxPlaceholders.map(ph => <PlaceholderBadge key={ph} ph={ph} />)}
                      </div>
                    </div>
                  )}
                  {!detecting && docxFile && !docxError && docxPlaceholders.length === 0 && (
                    <div style={{ fontSize: '.8rem', color: 'var(--s400)', display: 'flex', flexDirection: 'column', gap: '.375rem', alignItems: 'flex-start' }}>
                      <span>Documentul nu are etichete <code style={{ background: 'var(--s100)', padding: '.1rem .3rem', borderRadius: 3 }}>{'{{CAMP}}'}</code>. Dacă are locuri libere („……”, „.....”), aplicația le poate recunoaște din context.</span>
                      <button className="btn btn-outline-primary btn-sm" onClick={() => setBlankFile(docxFile)}>Recunoaște locurile libere</button>
                    </div>
                  )}

                  <div className="field">
                    <label className="field-label">Nume șablon *</label>
                    <input ref={nameInputRef} className="field-input" value={docxName} onChange={e => setDocxName(e.target.value)} placeholder="ex: Contract de asociere"
                      style={justImported ? { borderColor: 'var(--p500)', boxShadow: '0 0 0 3px var(--p100)' } : undefined} />
                  </div>
                  <div className="field">
                    <label className="field-label">Descriere (opțional)</label>
                    <input className="field-input" value={docxDesc} onChange={e => setDocxDesc(e.target.value)} placeholder="Scurtă descriere…" />
                  </div>
                  <div className="field">
                    <label className="field-label">Tip șablon</label>
                    <select className="field-input" value={docxTip} onChange={e => setDocxTip(e.target.value as TipTemplate)} style={{ appearance: 'auto' }}>
                      {TIP_TEMPLATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">Numele fișierului generat</label>
                    <input className="field-input" value={docxOutput} onChange={e => setDocxOutput(e.target.value)} placeholder="ex: contract_{{SOCIETATE_DENUMIRE}}_{{DATA_AZI}}.docx" />
                    <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '.25rem' }}>Poți folosi placeholder-e și în numele fișierului.</p>
                  </div>

                  <button className="btn btn-primary" onClick={handleAddDocx} disabled={saving || detecting || !!docxError || !docxFile || !docxName.trim()}>
                    {saving ? <><span className="spin" />&nbsp;Salvează…</> : '💾 Salvează șablon'}
                  </button>
                </div>
              )}

              {addTab === 'gdoc' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
                  <div className="field">
                    <label className="field-label">Nume șablon *</label>
                    <input className="field-input" value={gdocName} onChange={e => setGdocName(e.target.value)} placeholder="ex: Contract SRL" />
                  </div>
                  <div className="field">
                    <label className="field-label">Document Google Docs *</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <span style={{ flex: 1, fontSize: '.875rem', color: gdocDocId ? 'var(--s800)' : 'var(--s400)' }}>
                        {gdocDocId ? `📄 ${gdocPickedName || 'Document ales'}` : 'Niciun document ales'}
                      </span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={handlePickGdoc} disabled={pickingGdoc}>
                        {pickingGdoc ? <span className="spin" /> : (gdocDocId ? 'Schimbă' : 'Alege din Drive')}
                      </button>
                    </div>
                    <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '.25rem' }}>
                      Se alege prin fereastra Google: aplicația primește acces doar la documentul ales. Colegii tăi vor confirma accesul o singură dată, la prima folosire.
                    </p>
                  </div>
                  <div className="field">
                    <label className="field-label">Descriere (opțional)</label>
                    <input className="field-input" value={gdocDesc} onChange={e => setGdocDesc(e.target.value)} placeholder="Scurtă descriere…" />
                  </div>
                  <div className="field">
                    <label className="field-label">Tip șablon</label>
                    <select className="field-input" value={gdocTip} onChange={e => setGdocTip(e.target.value as TipTemplate)} style={{ appearance: 'auto' }}>
                      {TIP_TEMPLATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">Numele documentului generat</label>
                    <input className="field-input" value={gdocOutput} onChange={e => setGdocOutput(e.target.value)} placeholder="ex: contract_{{SOCIETATE_DENUMIRE}}" />
                  </div>
                  <button className="btn btn-primary" onClick={handleAddGdoc} disabled={saving || !gdocName.trim() || !gdocDocId.trim()}>
                    {saving ? <><span className="spin" />&nbsp;Salvează…</> : '💾 Salvează șablon'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── REPLACE: diferențele față de fișierul curent, înainte de confirmare ── */}
          {view === 'replace' && pendingReplace && (() => {
            const { tpl, file, next, changes } = pendingReplace
            const back = () => { setPendingReplace(null); setView('list') }
            return (
              <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
                <button className="btn btn-ghost btn-sm" onClick={back} style={{ alignSelf: 'flex-start' }}>← Înapoi</button>
                <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)' }}>Înlocuiești fișierul șablonului „{tpl.name}”</div>
                <p style={{ fontSize: '.8rem', color: 'var(--s500)', margin: 0 }}>
                  Fișier nou: <strong>{file.name}</strong> · {next.placeholders.length} câmpuri. Numele, formularul și setările șablonului rămân aceleași.
                  Aplicația nu păstrează versiunile anterioare: descarcă fișierul curent dacă vrei o copie.
                </p>
                {!hasChanges(changes) && (
                  <div style={{ fontSize: '.8rem', color: 'var(--g700)' }}>✓ Aceleași câmpuri ca până acum: s-a schimbat doar textul documentului.</div>
                )}
                {changes.dedicatedLost && (
                  <div role="alert" style={{ fontSize: '.8rem', color: 'var(--o700)' }}>
                    ⚠️ Șablonul nu mai are etichetele formularului dedicat de declarație: după înlocuire, se completează cu câmpuri simple.
                  </div>
                )}
                <ChangeList title="⚠️ Câmpuri care dispar (verifică dacă le-ai șters intenționat):" items={changes.removed} tone="warn" />
                <ChangeList title="⚠️ Articole opționale care dispar:" items={changes.removedClauses} tone="warn" />
                <ChangeList title="⚠️ Câmpuri noi pe care formularul dedicat nu le cere (vor rămâne necompletate):" items={changes.dedicatedUnasked} tone="warn" />
                <ChangeList title="Câmpuri noi:" items={changes.added.filter(a => !changes.dedicatedUnasked.includes(a))} tone="info" />
                <ChangeList title="Articole opționale noi:" items={changes.addedClauses} tone="info" />
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDownload(tpl)}>⬇ Descarcă versiunea curentă</button>
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-ghost btn-sm" onClick={back}>Renunță</button>
                  <button className="btn btn-primary btn-sm" onClick={() => void confirmReplace()} disabled={replaceSaving}>
                    {replaceSaving ? <><span className="spin" />&nbsp;Se înlocuiește…</> : 'Înlocuiește fișierul'}
                  </button>
                </div>
              </div>
            )
          })()}

          {/* ── EDIT: numele, descrierea, tipul și numele fișierului generat ── */}
          {view === 'edit' && editTpl && editForm && (
            <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={closeEdit} style={{ alignSelf: 'flex-start' }}>← Înapoi</button>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)' }}>Editezi „{editTpl.name}”</div>
              <p style={{ fontSize: '.8rem', color: 'var(--s500)', margin: 0 }}>
                Textul documentului se schimbă în Word, apoi cu „⟳ Înlocuiește”.
              </p>
              <div className="field">
                <label className="field-label" htmlFor="tpl-edit-name">Nume șablon *</label>
                <input id="tpl-edit-name" className="field-input" value={editForm.name} maxLength={200}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="tpl-edit-desc">Descriere (opțional)</label>
                <input id="tpl-edit-desc" className="field-input" value={editForm.description} maxLength={1000}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })} placeholder="Scurtă descriere…" />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="tpl-edit-tip">Tip șablon</label>
                <select id="tpl-edit-tip" className="field-input" value={editForm.tipTemplate} style={{ appearance: 'auto' }}
                  onChange={e => setEditForm({ ...editForm, tipTemplate: e.target.value as TipTemplate })}>
                  {TIP_TEMPLATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="tpl-edit-output">{editTpl.type === 'docx' ? 'Numele fișierului generat' : 'Numele documentului generat'}</label>
                <input id="tpl-edit-output" className="field-input" value={editForm.outputNameTemplate} maxLength={300}
                  onChange={e => setEditForm({ ...editForm, outputNameTemplate: e.target.value })}
                  placeholder={editTpl.type === 'docx' ? 'ex: contract_{{SOCIETATE_DENUMIRE}}_{{DATA_AZI}}.docx' : 'ex: contract_{{SOCIETATE_DENUMIRE}}'} />
                <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '.25rem' }}>Poți folosi placeholder-e și în numele fișierului.</p>
              </div>
              <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={closeEdit}>Renunță</button>
                <button className="btn btn-primary btn-sm" onClick={() => void saveEdit()} disabled={editSaving || !editForm.name.trim()}>
                  {editSaving ? <><span className="spin" />&nbsp;Se salvează…</> : 'Salvează'}
                </button>
              </div>
            </div>
          )}

          {/* ── GUIDE ── */}
          {view === 'guide' && (
            <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setView('list')} style={{ alignSelf: 'flex-start' }}>← Înapoi</button>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)' }}>Ghid placeholder-e disponibile</div>
              <p style={{ fontSize: '.8rem', color: 'var(--s500)', marginTop: '-.75rem' }}>
                Folosește sintaxa <code style={{ background: 'var(--s100)', padding: '.1rem .3rem', borderRadius: 3 }}>{'{{CAMP}}'}</code> în documentul Word sau Google Doc. N se înlocuiește cu numărul de ordine (1, 2, 3…) al persoanei.
              </p>
              {GUIDE_SECTIONS.map(sec => (
                <div key={sec.title}>
                  <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '.5rem' }}>
                    {sec.title}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                    {sec.items.map(ph => <PlaceholderBadge key={ph} ph={ph} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <input ref={replaceInputRef} type="file" accept=".docx" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void handleReplaceFileSelect(f); e.target.value = '' }} />

        {deliverTpl && activeWorkspace && (
          <TemplateDeliveryModal
            template={deliverTpl}
            sourceWorkspaceId={activeWorkspace.id}
            builtins={builtins}
            onClose={() => setDeliverTpl(null)}
            onToast={onToast}
          />
        )}

        {blankFile && (
          <BlankImportModal
            file={blankFile}
            onClose={() => setBlankFile(null)}
            onToast={onToast}
            onDone={tpl => {
              setBlankFile(null)
              void showImportedTemplate(tpl)                 // formularul de salvare: nume + secțiune, apoi „Salvează șablon”
            }}
          />
        )}
    </Modal>
  )
}
