import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { fillDocx, fillDocxFromBuiltinTemplate, fillDocxFromDriveTemplate, fillGdoc } from '../lib/api'
import type { IDFields, DriveTarget } from '../lib/api'
import type { BuiltinTemplate, ClauseMeta, Client, DocTemplate, ScannedPerson, ToastItem } from '../types'
import { inferTipClient } from '../types'
import type { User } from 'firebase/auth'
import { buildReplacements, buildRepeatGroups, checkReadiness, groupMissingFields, isManualPlaceholder, manualLabel } from '../lib/placeholders'
import { useTemplates, logDocGeneration } from '../lib/templates'
import { asociatiCountMismatch, useBuiltinTemplates } from '../lib/builtinTemplates'
import { EMPTY_CLIENT, useClienti, type ClientInput } from '../lib/clienti'
import DriveFolderPicker from './DriveFolderPicker'
import TemplateLibrary from './TemplateLibrary'
import ClientModal from './ClientModal'
import ClauseSelector from './ClauseSelector'
import type { ClauseSelectorValue } from './ClauseSelector'
import DeclaratieActivitateFiller from './DeclaratieActivitateFiller'
import type { DeclaratieActivitateFillerHandle, DeclaratieFormValue } from './DeclaratieActivitateFiller'
import type { ClientPatchProposal } from '../lib/clauseFieldSpecs'
import { buildVariantContext, variantWarningMessage } from '../lib/variants'
import { withEmptyFieldMarks, withOptionalFieldMarks, isDeclaratieTemplate, DECLARATIE_ACTIVITATE_KEY } from '../lib/declaratieActivitateFiller'
import Modal from './Modal'

interface Props {
  workspaceId: string
  user: User | null
  fields?: IDFields | null
  client?: Partial<Client> | null
  scannedPersons?: ScannedPerson[]
  accessToken: string
  onToast: (msg: string, type: ToastItem['type']) => void
  onBack: () => void
  onClientSaved?: (client: Client) => void
  // Numărul afișat în badge — nu e mereu "3": fluxul "client din portofoliu"
  // comasează selecția+verificarea pe un singur ecran, deci acesta e pasul 2.
  stepNumber?: number
}


// Placeholdere completate intern (ex. {{SUBTITLU_ACTUALIZARE}}, injectat abia
// la generare, în funcție de toggle-ul Înființare/Actualizare) — niciodată
// tastate de user, deci nu trebuie verificate ca "necompletate".
const INTERNAL_BUILTIN_FIELDS = new Set(['SUBTITLU_ACTUALIZARE'])
const builtinCheckablePlaceholders = (b: BuiltinTemplate): string[] =>
  b.placeholders.filter(ph => !INTERNAL_BUILTIN_FIELDS.has(ph.replace(/^\{\{|\}\}$/g, '')))

const builtinKey = (b: BuiltinTemplate) => `builtin:${b.key}`

// Singurul șablon de bază cu formular dedicat (declarant/CAEN/sedii, cu
// parsare de adresă) în loc de placeholdere generice — analog cazului special
// al act_constitutivMode, dar identificat după cheie, nu după `type`, ca un
// eventual alt șablon docx viitor să nu fie tras din greșeală pe acest formular.

export default function TemplateFiller({
  workspaceId, user, fields, client, scannedPersons,
  accessToken, onToast, onBack, onClientSaved, stepNumber = 3,
}: Props) {
  const { templates, loading: tplLoading, add: addTemplate, remove: removeTemplate } = useTemplates(workspaceId)
  const { builtins } = useBuiltinTemplates()
  const { update: updateClient } = useClienti(workspaceId)

  const [clauseState, setClauseState] = useState<Record<string, ClauseSelectorValue>>({})
  const [declaratieFormState, setDeclaratieFormState] = useState<Record<string, DeclaratieFormValue & { forClient?: string }>>({})
  // Un singur formular de declarație e randat la un moment dat (panoul de
  // detaliu arată doar șablonul activ) — un singur ref, la fel ca
  // companyFormRef din MultiPersonPreview.
  const declaratieFormRef = useRef<DeclaratieActivitateFillerHandle>(null)
  const [pendingClientPatches, setPendingClientPatches] = useState<{ key: string; label: string; patch: Partial<ClientInput> }[] | null>(null)
  const [checkedPatchKeys, setCheckedPatchKeys] = useState<Set<string>>(new Set())
  // Șablonul afișat momentan în panoul din dreapta — 'builtin:<key>' pentru
  // șabloanele de bază, sau tpl.id pentru cele din bibliotecă.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [driveFolder, setDriveFolder] = useState<{ id: string; name: string } | null>(null)
  // Destinația documentului se alege la generare (fereastra „Unde salvezi documentul?”), nu dintr-o bifă permanentă.
  // Alegerea se ține într-un ref, ca handlerele async să o vadă imediat după închiderea ferestrei. Încărcarea în Drive
  // se face din browser, cu tokenul utilizatorului (nu trece prin serverul nostru).
  const destRef = useRef<{ drive: boolean; folderId: string | null }>({ drive: false, folderId: null })
  const driveTarget = (): DriveTarget | null => destRef.current.drive ? { token: accessToken, folderId: destRef.current.folderId } : null
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  // Lățimea coloanei cu șabloane, reglabilă prin tragerea mânerului (preferință locală, ținută în browser).
  const LIST_W_MIN = 240, LIST_W_MAX = 720, LIST_W_DEFAULT = 340
  const layoutRef = useRef<HTMLDivElement>(null)
  const [listW, setListW] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('cabinio-tf-list-w'))
      return v >= LIST_W_MIN && v <= LIST_W_MAX ? v : LIST_W_DEFAULT
    } catch { return LIST_W_DEFAULT }
  })
  const applyListW = (w: number, persist = false) => {
    const max = Math.min(LIST_W_MAX, Math.max(LIST_W_MIN, (layoutRef.current?.clientWidth ?? LIST_W_MAX) - 320))
    const next = Math.round(Math.min(max, Math.max(LIST_W_MIN, w)))
    setListW(next)
    if (persist) { try { localStorage.setItem('cabinio-tf-list-w', String(next)) } catch { /* fără stocare locală: rămâne doar pe sesiune */ } }
    return next
  }
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const left = layoutRef.current?.getBoundingClientRect().left ?? 0
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    let last = listW
    const move = (ev: PointerEvent) => { last = applyListW(ev.clientX - left) }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      applyListW(last, true)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const resizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); applyListW(listW - 24, true) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); applyListW(listW + 24, true) }
    else if (e.key === 'Home') { e.preventDefault(); applyListW(LIST_W_DEFAULT, true) }
  }
  const [destDialogOpen, setDestDialogOpen] = useState(false)
  const [destChoice, setDestChoice] = useState<'local' | 'drive'>('local')
  const destResolver = useRef<((ok: boolean) => void) | null>(null)
  const batchDestChosen = useRef(false)
  const askDestination = (): Promise<boolean> => {
    if (batchDestChosen.current) return Promise.resolve(true)
    return new Promise<boolean>(resolve => { destResolver.current = resolve; setDestDialogOpen(true) })
  }
  const closeDestDialog = (ok: boolean) => {
    if (ok) destRef.current = { drive: destChoice === 'drive', folderId: destChoice === 'drive' ? (driveFolder?.id ?? null) : null }
    setDestDialogOpen(false)
    setShowFolderPicker(false)
    destResolver.current?.(ok)
    destResolver.current = null
  }
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({})
  const [showLibrary, setShowLibrary] = useState(false)
  const [showSaveClient, setShowSaveClient] = useState(false)
  const [showSavePrompt, setShowSavePrompt] = useState(false)
  const [askedSaveClient, setAskedSaveClient] = useState(false)
  const [clientSaved, setClientSaved] = useState(false)
  const [expandedReadiness, setExpandedReadiness] = useState<Set<string>>(new Set())
  const [pendingGenerate, setPendingGenerate] = useState<{
    tpl: DocTemplate | BuiltinTemplate
    missing: string[]
    isBatch?: boolean
    batchTargets?: DocTemplate[]
    isBuiltin?: boolean
  } | null>(null)
  // Singurul șablon de bază fără clauze care are nevoie de acest toggle azi —
  // implicit "actualizare", cazul de utilizare mai frecvent.
  const [actConstitutivMode, setActConstitutivMode] = useState<'infiintare' | 'actualizare'>('actualizare')

  const listTemplates = templates

  const replacements = buildReplacements({ idFields: fields, client, scannedPersons })
  const repeatGroups = buildRepeatGroups({ idFields: fields, client, scannedPersons })
  const hasScannedPersonsNoClient = (scannedPersons ?? []).length > 0 && !client?.id
  // Asociați existenți (client.asociati) sau doar scanați, nesalvați încă —
  // aceeași listă folosită deja la umplerea {{#ASOCIATI}}.
  const asociatiCount = repeatGroups.ASOCIATI?.length ?? 0
  // Câmpuri completate manual la generare ({{CAMP_…}}): valori per șablon, peste cele calculate din client.
  const [manualValues, setManualValues] = useState<Record<string, Record<string, string>>>({})
  const repl = (id: string) => ({ ...replacements, ...(manualValues[id] ?? {}) })

  // Variantele „a/b” din document (sex, număr, categorie) le alege serverul; aici pregătim contextul din valorile finale.
  const variantsFor = (finalReplacements: Record<string, string>) =>
    buildVariantContext({ client, scannedPersons, idFields: fields, replacements: finalReplacements })
  // Avertismentul rămâne pe ecran până e închis (nu dispare ca o notificare): documentul conține variante nealese.
  const [variantNotices, setVariantNotices] = useState<string[]>([])
  const notifyVariants = (warnings: string[] | undefined, labels: Record<string, string>) => {
    const msg = variantWarningMessage(warnings, labels)
    if (msg) setVariantNotices(prev => prev.includes(msg) ? prev : [...prev, msg])
  }

  // În lot intră doar ce se aplică clientului curent (o bifă rămasă de la alt client nu mai contează).
  const selectedTemplates = listTemplates.filter(t => selectedIds.has(t.id) && !asociatiCountMismatch(t.sourceKey, asociatiCount))

  // Diferențiere PF/PJ — un client PJ nu ar trebui să poată genera un șablon
  // gândit strict pentru PF (și invers). "universal"/lipsă = se aplică oricui.
  const clientTip = client ? inferTipClient(client as Client) : null
  const tipMismatchMsg = (tipTemplate: string | undefined, tplLabel: string): string | null => {
    if (!tipTemplate || tipTemplate === 'universal' || !clientTip) return null
    if (tipTemplate === clientTip) return null
    return `${tplLabel} e valabil doar pentru ${tipTemplate}, dar clientul selectat este ${clientTip}`
  }

  // Șablon cu număr de asociați nepotrivit: nu se poate deschide; un click explică de ce.
  const notApplicable = (name: string, reason: string) =>
    onToast(`„${name}” nu se aplică clientului selectat: ${reason}.`, 'info')

  // Implicit — primul șablon compatibil cu tipul clientului (dacă există),
  // altfel primul disponibil — ca panoul din dreapta să nu rămână gol la
  // intrarea în pas; derivat la randare (nu stocat separat), ca selecția
  // explicită a userului să rămână prioritară.
  const defaultActiveKey = (() => {
    if (builtins.length > 0) {
      const compatible = builtins.find(b => !tipMismatchMsg(b.tipTemplate, b.name) && (b.key === DECLARATIE_ACTIVITATE_KEY || !asociatiCountMismatch(b.key, asociatiCount)))
        ?? builtins.find(b => !tipMismatchMsg(b.tipTemplate, b.name))
      return builtinKey(compatible ?? builtins[0])
    }
    const compatible = listTemplates.find(t => !tipMismatchMsg(t.tipTemplate, t.name) && !asociatiCountMismatch(t.sourceKey, asociatiCount))
      ?? listTemplates.find(t => !tipMismatchMsg(t.tipTemplate, t.name))
    return (compatible ?? listTemplates[0])?.id ?? null
  })()
  const effectiveActiveKey = activeKey ?? defaultActiveKey

  // Doar șabloanele fără clauze au checkbox (vezi renderTemplateRow) — cele cu
  // tip incompatibil clientului sunt oricum disabled, excluse din select-all.
  const selectableTemplates = listTemplates.filter(t => !t.clauses?.length && !tipMismatchMsg(t.tipTemplate, t.name) && !asociatiCountMismatch(t.sourceKey, asociatiCount))
  const allSelectableSelected = selectableTemplates.length > 0 && selectableTemplates.every(t => selectedIds.has(t.id))
  const selectAllTemplates = () => setSelectedIds(prev => {
    const next = new Set(prev); selectableTemplates.forEach(t => next.add(t.id)); return next
  })
  const deselectAllTemplates = () => setSelectedIds(prev => {
    const next = new Set(prev); selectableTemplates.forEach(t => next.delete(t.id)); return next
  })

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const setLoading = (id: string, on: boolean) =>
    setLoadingIds(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n })

  const resolveTemplateFile = async (tpl: DocTemplate): Promise<File | null> => {
    if (tpl.fileBase64 && tpl.fileName) {
      const binary = atob(tpl.fileBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      return new File([blob], tpl.fileName, { type: blob.type })
    }
    return null
  }

  const resolveOutputName = (tpl: DocTemplate): string => {
    let name = tpl.outputNameTemplate || tpl.name
    for (const [ph, val] of Object.entries(replacements)) {
      name = name.replaceAll(ph, val)
    }
    return name.endsWith('.docx') ? name : `${name}.docx`
  }

  // Întreabă explicit, o singură dată pe sesiune, dacă entitatea nou generată
  // (fără client existent) ar trebui salvată în portofoliu — nu doar un buton
  // care poate trece neobservat.
  const maybePromptSaveClient = () => {
    if (hasScannedPersonsNoClient && !askedSaveClient && !clientSaved) {
      setAskedSaveClient(true)
      setShowSavePrompt(true)
    }
  }

  const handleGenerateDocx = async (tpl: DocTemplate) => {
    // Declarație de activitate (copie din bibliotecă sau document propriu cu aceleași etichete): formularul dedicat.
    const decl = tpl.type === 'docx' && isDeclaratieTemplate(tpl) ? declaratieFormState[tpl.id] : undefined
    if (tpl.type === 'docx' && isDeclaratieTemplate(tpl)) {
      const missing = declaratieFormRef.current?.scrollToFirstMissing() ?? []
      if (missing.length > 0) { onToast(`Completează: ${missing.join(', ')}.`, 'err'); return }
      if (!decl) return
    }
    if (!(await askDestination())) return
    setLoading(tpl.id, true)
    try {
      const outputName = resolveOutputName(tpl)
      const cs = clauseState[tpl.id]
      let mergedReplacements = { ...repl(tpl.id), ...(cs?.extraReplacements ?? {}) }
      const mergedGroups = cs && Object.keys(cs.extraGroups).length ? { ...repeatGroups, ...cs.extraGroups } : repeatGroups
      let rowGroups: Record<string, Record<string, string>[]> | undefined
      if (decl) {
        rowGroups = decl.rowGroups
        mergedReplacements = withEmptyFieldMarks(tpl.placeholders ?? [], { ...replacements, ...decl.replacements }, decl.rowGroups)
      } else {
        mergedReplacements = withOptionalFieldMarks(tpl.placeholders ?? [], mergedReplacements, mergedGroups)
      }
      let result: { blob?: Blob; name?: string; link?: string; warnings?: string[] }
      const { ctx: variantCtx, labels: variantLabels } = variantsFor(mergedReplacements)

      if (tpl.driveFileId) {
        result = await fillDocxFromDriveTemplate(tpl.driveFileId, mergedReplacements, accessToken, driveTarget(), outputName, mergedGroups, cs?.selectedClauses, rowGroups, variantCtx)
      } else {
        const file = await resolveTemplateFile(tpl)
        if (!file) { onToast(`Fișierul pentru "${tpl.name}" nu este disponibil`, 'err'); return }
        result = await fillDocx(file, mergedReplacements, driveTarget(), outputName, mergedGroups, cs?.selectedClauses, rowGroups, variantCtx)
      }
      notifyVariants(result.warnings, variantLabels)

      if (result.link) {
        setGeneratedLinks(prev => ({ ...prev, [tpl.id]: result.link! }))
        onToast(`Salvat pe Drive: ${result.name}`, 'ok')
        await _logGeneration(tpl, outputName, result.link)
        maybePromptSaveClient()
      } else if (result.blob) {
        const url = URL.createObjectURL(result.blob)
        const a = document.createElement('a'); a.href = url; a.download = outputName; a.click()
        URL.revokeObjectURL(url)
        onToast(`Descărcat: ${outputName}`, 'ok')
        await _logGeneration(tpl, outputName)
        maybePromptSaveClient()
      }
      offerClientPatches(cs)
      if (decl) offerClientPatchList(decl.clientPatches)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Generare eșuată', 'err')
    } finally {
      setLoading(tpl.id, false)
    }
  }

  // Șabloane de bază — generare directă, fără duplicare prealabilă în Firestore.
  const handleGenerateBuiltinDocx = async (b: BuiltinTemplate) => {
    const key = builtinKey(b)
    if (!(await askDestination())) return
    setLoading(key, true)
    try {
      let outputName = b.outputNameTemplate || b.name
      for (const [ph, val] of Object.entries(replacements)) outputName = outputName.replaceAll(ph, val)
      if (!outputName.endsWith('.docx')) outputName += '.docx'

      const cs = clauseState[key]
      // Copie proprie, mereu — "replacements" e obiectul partajat de toate
      // șabloanele randate în același pas, nu trebuie mutat direct.
      const mergedReplacements = { ...repl(key), ...(cs?.extraReplacements ?? {}) }
      const mergedGroups = cs && Object.keys(cs.extraGroups).length ? { ...repeatGroups, ...cs.extraGroups } : repeatGroups

      if (b.key === 'act_constitutiv') {
        // Placeholder gol ar fi eliminat de backend (nu se trimit câmpuri
        // goale) și ar rămâne vizibil literal în document — un singur spațiu
        // se substituie normal și randează ca linie goală.
        mergedReplacements['{{SUBTITLU_ACTUALIZARE}}'] = actConstitutivMode === 'actualizare'
          ? `- actualizat la ${replacements['{{DATA_AZI}}']} -`
          : ' '
      }

      const marked = withOptionalFieldMarks(b.placeholders ?? [], mergedReplacements, mergedGroups)
      const { ctx: variantCtx, labels: variantLabels } = variantsFor(marked)
      const result = await fillDocxFromBuiltinTemplate(b.key, marked, driveTarget(), outputName, mergedGroups, cs?.selectedClauses, undefined, variantCtx)
      notifyVariants(result.warnings, variantLabels)

      if (result.link) {
        setGeneratedLinks(prev => ({ ...prev, [key]: result.link! }))
        onToast(`Salvat pe Drive: ${result.name}`, 'ok')
        maybePromptSaveClient()
      } else if (result.blob) {
        const url = URL.createObjectURL(result.blob)
        const a = document.createElement('a'); a.href = url; a.download = outputName; a.click()
        URL.revokeObjectURL(url)
        onToast(`Descărcat: ${outputName}`, 'ok')
        maybePromptSaveClient()
      }
      offerClientPatches(cs)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Generare eșuată', 'err')
    } finally {
      setLoading(key, false)
    }
  }

  // Șablon de bază "Declarație activitate" — nu are placeholdere/clauze
  // generice, ci un formular dedicat (DeclaratieActivitateFiller) care
  // asamblează direct replacements + rowGroups (tabelele CAEN/sedii
  // secundare, cu lungime variabilă — vezi doc_filler._expand_repeat_table_rows).
  const handleGenerateDeclaratie = async (b: BuiltinTemplate) => {
    const key = builtinKey(b)
    const form = declaratieFormState[key]
    // Butonul rămâne mereu activ — la click sărim la primul câmp lipsă în loc
    // să-l ținem disabled (același tipar ca CompanyInfoForm.scrollToFirstMissing).
    const missing = declaratieFormRef.current?.scrollToFirstMissing() ?? []
    if (missing.length > 0) {
      onToast(`Completează: ${missing.join(', ')}.`, 'err')
      return
    }
    if (!form) return
    if (!(await askDestination())) return
    setLoading(key, true)
    try {
      let outputName = b.outputNameTemplate || b.name
      for (const [ph, val] of Object.entries(replacements)) outputName = outputName.replaceAll(ph, val)
      // .replace, nu doar un `endsWith` check — un outputNameTemplate moștenit
      // dintr-o versiune veche (.pdf) ar produce altfel "...pdf.docx".
      outputName = outputName.replace(/\.(pdf|docx)$/i, '') + '.docx'

      // {{SOCIETATE_*}}/{{DATA_AZI}} etc. vin din `replacements` (calculate o
      // singură dată, comun tuturor șabloanelor) — form.replacements le
      // suprascrie doar pe cele proprii formularului (declarant/sediu).
      // Câmpurile necompletate ale declarației (bloc, scară, etaj, telefon...) apar ca „-”, nu ca etichetă brută.
      const mergedReplacements = withEmptyFieldMarks(b.placeholders ?? [], { ...replacements, ...form.replacements }, form.rowGroups)
      const { ctx: variantCtx, labels: variantLabels } = variantsFor(mergedReplacements)
      const result = await fillDocxFromBuiltinTemplate(b.key, mergedReplacements, driveTarget(), outputName, undefined, undefined, form.rowGroups, variantCtx)
      notifyVariants(result.warnings, variantLabels)
      if (result.link) {
        setGeneratedLinks(prev => ({ ...prev, [key]: result.link! }))
        onToast(`Salvat pe Drive: ${result.name}`, 'ok')
      } else if (result.blob) {
        const url = URL.createObjectURL(result.blob)
        const a = document.createElement('a'); a.href = url; a.download = outputName; a.click()
        URL.revokeObjectURL(url)
        onToast(`Descărcat: ${outputName}`, 'ok')
      }
      maybePromptSaveClient()
      offerClientPatchList(form.clientPatches)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Generare eșuată', 'err')
    } finally {
      setLoading(key, false)
    }
  }

  // După o generare reușită, propune (nu aplică direct) actualizarea
  // profilului clientului cu tot ce a colectat ClauseSelector din clauzele
  // bifate — userul alege ce anume se scrie în Firestore.
  const offerClientPatches = (cs: ClauseSelectorValue | undefined) => {
    if (!client?.id || !cs) return
    const proposals = Object.entries(cs.clientPatches).map(([key, p]) => ({ key, ...p }))
    if (proposals.length === 0) return
    setPendingClientPatches(proposals)
    setCheckedPatchKeys(new Set(proposals.map(p => p.key)))
  }

  // Variantă pentru DeclaratieActivitateFiller, care nu are clauze — colectează
  // direct o listă de propuneri (ex. sedii secundare noi), nu un Record pe tag de clauză.
  const offerClientPatchList = (proposals: ClientPatchProposal[]) => {
    if (!client?.id || proposals.length === 0) return
    const withKeys = proposals.map((p, i) => ({ key: `declaratie-${i}`, ...p }))
    setPendingClientPatches(withKeys)
    setCheckedPatchKeys(new Set(withKeys.map(p => p.key)))
  }

  const handleApplyClientPatches = async () => {
    if (!pendingClientPatches || !client?.id || !workspaceId) { setPendingClientPatches(null); return }
    const merged: Partial<ClientInput> = {}
    for (const p of pendingClientPatches) {
      if (checkedPatchKeys.has(p.key)) Object.assign(merged, p.patch)
    }
    try {
      if (Object.keys(merged).length > 0) {
        await updateClient(workspaceId, client.id, merged)
        onToast('Profilul clientului a fost actualizat', 'ok')
      }
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Eroare la salvare', 'err')
    } finally {
      setPendingClientPatches(null)
    }
  }

  const handleGenerateGdoc = async (tpl: DocTemplate) => {
    if (!tpl.docId) return
    setLoading(tpl.id, true)
    try {
      const outputName = tpl.outputNameTemplate || tpl.name
      const result = await fillGdoc(tpl.docId, withOptionalFieldMarks(tpl.placeholders ?? [], replacements), accessToken, outputName)
      setGeneratedLinks(prev => ({ ...prev, [tpl.id]: result.link }))
      onToast('Document Google creat', 'ok')
      await _logGeneration(tpl, outputName, result.link)
      maybePromptSaveClient()
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Generare eșuată', 'err')
    } finally {
      setLoading(tpl.id, false)
    }
  }

  const handleBatchGenerate = async () => {
    const targets = selectedTemplates
    // Se întreabă o singură dată pentru tot lotul; șabloanele Google Doc se creează oricum în Drive.
    if (targets.some(t => t.type === 'docx') && !(await askDestination())) return
    batchDestChosen.current = true
    try {
      for (const tpl of targets) {
        if (tpl.type === 'docx') await handleGenerateDocx(tpl)
        else await handleGenerateGdoc(tpl)
      }
    } finally {
      batchDestChosen.current = false
    }
  }

  // Confirmation wrappers — check for missing fields before generating
  const tryGenerateSingle = (tpl: DocTemplate) => {
    // Șabloanele cu clauze au propria verificare de completitudine în
    // ClauseSelector (butonul Generează e dezactivat până e completă) —
    // nu mai trece prin dialogul de confirmare pentru câmpuri lipsă.
    if (tpl.clauses?.length || (tpl.type === 'docx' && isDeclaratieTemplate(tpl))) { handleGenerateDocx(tpl); return }

    const { missing } = checkReadiness(tpl.placeholders ?? [], repl(tpl.id), repeatGroups)
    if (missing.length > 0) {
      setPendingGenerate({ tpl, missing })
    } else {
      if (tpl.type === 'docx') handleGenerateDocx(tpl)
      else handleGenerateGdoc(tpl)
    }
  }

  // Șabloane de bază fără clauze (ex. Act Constitutiv) — același tipar ca
  // tryGenerateSingle; cele cu clauze rămân gestionate direct de butonul din
  // panoul de detaliu (blocat dur de ClauseSelector.isComplete).
  const tryGenerateBuiltinSingle = (b: BuiltinTemplate) => {
    if (b.clauses.length > 0) { handleGenerateBuiltinDocx(b); return }
    const { missing } = checkReadiness(builtinCheckablePlaceholders(b), repl(builtinKey(b)), repeatGroups)
    if (missing.length > 0) {
      setPendingGenerate({ tpl: b, missing, isBuiltin: true })
    } else {
      handleGenerateBuiltinDocx(b)
    }
  }

  const tryBatchGenerate = () => {
    const targets = selectedTemplates
    const allMissing = targets.flatMap(t => checkReadiness(t.placeholders ?? [], repl(t.id), repeatGroups).missing)
    const uniqueMissing = [...new Set(allMissing)]
    if (uniqueMissing.length > 0) {
      // Show confirmation using the first template as representative (batch flag)
      setPendingGenerate({ tpl: targets[0], missing: uniqueMissing, isBatch: true, batchTargets: targets })
    } else {
      handleBatchGenerate()
    }
  }

  const confirmGenerate = () => {
    if (!pendingGenerate) return
    if (pendingGenerate.isBatch && pendingGenerate.batchTargets) {
      handleBatchGenerate()
    } else if (pendingGenerate.isBuiltin) {
      handleGenerateBuiltinDocx(pendingGenerate.tpl as BuiltinTemplate)
    } else {
      const tpl = pendingGenerate.tpl as DocTemplate
      if (tpl.type === 'docx') handleGenerateDocx(tpl)
      else handleGenerateGdoc(tpl)
    }
    setPendingGenerate(null)
  }

  const _logGeneration = async (tpl: DocTemplate, outputName: string, driveLink?: string) => {
    if (!client?.id || !workspaceId || !user) return
    try {
      await logDocGeneration(workspaceId, client.id, {
        templateId: tpl.id,
        templateName: tpl.name,
        generatedBy: user.uid,
        outputName,
        driveLink,
      })
    } catch { /* non-critical */ }
  }

  const buildClientInitial = (): Client => {
    const asociati = (scannedPersons ?? []).filter(p => p.role === 'asociat').map(p => ({
      calitate: 'Asociat', cotaParticipare: p.cotaParticipare,
      cnp: p.fields.cnp, nume: p.fields.nume, prenume: p.fields.prenume,
      serie_numar: p.fields.serie_numar, data_nasterii: p.fields.data_nasterii,
      locul_nasterii: p.fields.locul_nasterii, cetatenia: p.fields.cetatenia,
      adresa: p.fields.adresa, judet: p.fields.judet,
      emisa_de: p.fields.emisa_de, valabila_de_la: p.fields.valabila_de_la,
      valabila_pana_la: p.fields.valabila_pana_la,
    }))
    const admini = (scannedPersons ?? []).filter(p => p.role === 'administrator').map(p => ({
      calitate: 'Administrator', cotaParticipare: '',
      cnp: p.fields.cnp, nume: p.fields.nume, prenume: p.fields.prenume,
      serie_numar: p.fields.serie_numar, data_nasterii: p.fields.data_nasterii,
      locul_nasterii: p.fields.locul_nasterii, cetatenia: p.fields.cetatenia,
      adresa: p.fields.adresa, judet: p.fields.judet,
      emisa_de: p.fields.emisa_de, valabila_de_la: p.fields.valabila_de_la,
      valabila_pana_la: p.fields.valabila_pana_la,
    }))
    return {
      id: '', createdAt: null, createdBy: user?.uid ?? '',
      denumireLower: (client?.denumire ?? '').toLowerCase(),
      ...EMPTY_CLIENT,
      ...(client ?? {}),
      asociati,
      administratori: admini,
    } as Client
  }

  const toggleReadiness = (id: string) =>
    setExpandedReadiness(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  // Procentul de completare pentru afișarea pe rândul compact din listă —
  // aceeași sursă de adevăr ca renderReadiness, doar rezumată la un număr.
  const readinessPct = (placeholders?: string[], id?: string): number | null => {
    if (!placeholders || placeholders.length === 0) return null
    const { filled } = checkReadiness(placeholders, id ? repl(id) : replacements, repeatGroups)
    return Math.round((filled.length / placeholders.length) * 100)
  }

  // Declarația: procentul vine din formularul dedicat (câmpurile obligatorii), nu din etichetele șablonului. Apare după
  // prima deschidere a șablonului pentru clientul curent; starea unui client anterior nu se afișează.
  const declCompletion = (id: string) => {
    const st = declaratieFormState[id]
    return st && st.forClient === client?.id ? st.completion : undefined
  }
  const declPct = (id: string): number | null => {
    const c = declCompletion(id)
    return c && c.total > 0 ? Math.round((c.done / c.total) * 100) : null
  }

  // Bara de completare: „X/Y câmpuri” + lista a ceea ce lipsește (deschisă la cerere).
  const renderProgressBar = (id: string, c: { done: number; total: number; missing: string[] }, listTitle: string) => {
    if (c.total === 0) return null
    const pct = Math.round((c.done / c.total) * 100)
    const isExpanded = expandedReadiness.has(id)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <div style={{ flex: 1, height: 4, background: 'var(--s200)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`, borderRadius: 99, transition: 'width .3s',
              background: pct === 100 ? 'var(--g500)' : pct > 60 ? 'var(--y500)' : 'var(--r400)',
            }} />
          </div>
          <span style={{ fontSize: '.73rem', whiteSpace: 'nowrap', fontWeight: 600, color: pct === 100 ? 'var(--g600)' : pct > 60 ? 'var(--y700)' : 'var(--r500)' }}>
            {pct === 100 ? '✓ Complet' : `${c.done}/${c.total} câmpuri`}
          </span>
          {c.missing.length > 0 && (
            <button
              onClick={() => toggleReadiness(id)}
              style={{
                border: 'none', cursor: 'pointer', padding: '.1rem .35rem', fontSize: '.72rem', borderRadius: 4, fontFamily: 'var(--font)',
                color: 'var(--y700)', background: 'var(--y50)', display: 'flex', alignItems: 'center', gap: '.2rem', flexShrink: 0,
              }}
            >
              ⚠️ {c.missing.length} lipsă {isExpanded ? '▴' : '▾'}
            </button>
          )}
        </div>
        {isExpanded && c.missing.length > 0 && (
          <div style={{ background: 'var(--y50)', border: '1px solid var(--y200)', borderRadius: 'var(--r-sm)', padding: '.5rem .625rem', fontSize: '.78rem', color: 'var(--y800)' }}>
            <div style={{ fontSize: '.7rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: '.25rem' }}>
              {listTitle}
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {c.missing.map(m => <li key={m}>{m}</li>)}
            </ul>
          </div>
        )}
      </div>
    )
  }

  const renderDeclaratieProgress = (id: string) => {
    const c = declCompletion(id)
    return c ? renderProgressBar(id, c, 'De completat înainte de generare') : null
  }

  // Șabloane cu clauze (Decizia Asociatului Unic, Hotărâre AGA și copiile lor): completarea = datele din afara clauzelor
  // (din client) + „cel puțin o clauză bifată” + câmpurile clauzelor bifate. Fără nicio clauză bifată încă, procentul
  // arată doar ce e deja completat din client.
  const clauseCompletion = (id: string, placeholders: string[] | undefined, clauses: ClauseMeta[]) => {
    const clausePh = new Set(clauses.flatMap(c => c.placeholders))
    const base = (placeholders ?? []).filter(ph => !clausePh.has(ph) && !INTERNAL_BUILTIN_FIELDS.has(ph.replace(/^\{\{|\}\}$/g, '')) && ph !== '{{ART_NR}}')
    const { filled, missing } = checkReadiness(base, replacements, repeatGroups)
    const cs = clauseState[id]
    const anySelected = !!cs && cs.selectedClauses.length > 0
    const cc = cs?.completion ?? { done: 0, total: 0, missing: [] as string[] }
    const grouped = missing.length > 0 ? groupMissingFields(missing) : {}
    return {
      done: filled.length + (anySelected ? 1 : 0) + cc.done,
      total: base.length + 1 + cc.total,
      missing: [
        ...(anySelected ? [] : ['Bifează cel puțin o clauză']),
        ...Object.entries(grouped).map(([group, fields]) => `${group}: ${fields.join(', ')}`),
        ...cc.missing,
      ],
    }
  }
  const clausePct = (id: string, placeholders: string[] | undefined, clauses: ClauseMeta[]): number | null => {
    const c = clauseCompletion(id, placeholders, clauses)
    return c.total > 0 ? Math.round((c.done / c.total) * 100) : null
  }

  // Generic — folosit atât pentru DocTemplate (șabloane proprii), cât și
  // pentru BuiltinTemplate (șabloane de bază fără clauze, ex. Act Constitutiv).
  const renderReadiness = (tpl: { id: string; placeholders?: string[] }) => {
    if (!tpl.placeholders || tpl.placeholders.length === 0) return null
    const { filled, missing } = checkReadiness(tpl.placeholders, repl(tpl.id), repeatGroups)
    const total = tpl.placeholders.length
    const pct = Math.round((filled.length / total) * 100)
    const isExpanded = expandedReadiness.has(tpl.id)
    const grouped = missing.length > 0 ? groupMissingFields(missing) : {}
    // {{CAMP_NR_HOTARARE}} etc.: câmpuri care nu vin din client, ci se scriu aici la generare
    const manualFields = tpl.placeholders.filter(isManualPlaceholder)

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
        {manualFields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem', border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', marginBottom: '.375rem' }}>
            <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>De completat manual</div>
            {manualFields.map(ph => (
              <div className="field" key={ph}>
                <label className="field-label" htmlFor={`manual-${tpl.id}-${ph}`}>{manualLabel(ph)}</label>
                <input
                  id={`manual-${tpl.id}-${ph}`} className="field-input" value={manualValues[tpl.id]?.[ph] ?? ''}
                  onChange={e => setManualValues(prev => ({ ...prev, [tpl.id]: { ...prev[tpl.id], [ph]: e.target.value } }))}
                />
              </div>
            ))}
          </div>
        )}
        {/* Progress bar row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <div style={{ flex: 1, height: 4, background: 'var(--s200)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`, borderRadius: 99, transition: 'width .3s',
              background: pct === 100 ? 'var(--g500)' : pct > 60 ? 'var(--y500)' : 'var(--r400)',
            }} />
          </div>
          <span style={{
            fontSize: '.73rem', whiteSpace: 'nowrap', fontWeight: 600,
            color: pct === 100 ? 'var(--g600)' : pct > 60 ? 'var(--y700)' : 'var(--r500)',
          }}>
            {pct === 100 ? '✓ Complet' : `${filled.length}/${total} câmpuri`}
          </span>
          {missing.length > 0 && (
            <button
              onClick={() => toggleReadiness(tpl.id)}
              style={{
                border: 'none', cursor: 'pointer', padding: '.1rem .35rem',
                fontSize: '.72rem', borderRadius: 4, fontFamily: 'var(--font)',
                color: 'var(--y700)', background: 'var(--y50)',
                display: 'flex', alignItems: 'center', gap: '.2rem', flexShrink: 0,
              }}
            >
              ⚠️ {missing.length} lipsă {isExpanded ? '▴' : '▾'}
            </button>
          )}
        </div>

        {/* Expandable missing fields */}
        {isExpanded && missing.length > 0 && (
          <div style={{
            background: 'var(--y50)', border: '1px solid var(--y200)',
            borderRadius: 'var(--r-sm)', padding: '.5rem .625rem',
            display: 'flex', flexDirection: 'column', gap: '.3rem',
          }}>
            <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--y800)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              Câmpuri ce vor rămâne necompletate
            </div>
            {Object.entries(grouped).map(([group, fields]) => (
              <div key={group} style={{ display: 'flex', gap: '.375rem', alignItems: 'flex-start', fontSize: '.78rem' }}>
                <span style={{ color: 'var(--y700)', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 90 }}>
                  {group}
                </span>
                <span style={{ color: 'var(--s600)' }}>
                  {fields.join(', ')}
                </span>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onBack}
              style={{ alignSelf: 'flex-start', marginTop: '.125rem' }}
            >
              ← Completează acum
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Listă (stânga) — rânduri compacte, click = arată în panoul din dreapta ──

  const renderBuiltinRow = (b: BuiltinTemplate) => {
    const key = builtinKey(b)
    const isActive = effectiveActiveKey === key
    const link = generatedLinks[key]
    const isDeclaratie = b.key === DECLARATIE_ACTIVITATE_KEY
    const mismatch = isDeclaratie ? undefined : asociatiCountMismatch(b.key, asociatiCount)
    const tipMsg = tipMismatchMsg(b.tipTemplate, b.name)
    const pct = isDeclaratie ? declPct(key) : b.clauses.length > 0 ? clausePct(key, b.placeholders, b.clauses) : readinessPct(builtinCheckablePlaceholders(b), key)
    return (
      <div key={key} className={`tf-row${isActive ? ' tf-row--active' : ''}${mismatch ? ' tf-row--na' : ''}`}>
        <button
          type="button" className="tf-row-main"
          // Neaplicabil clientului (număr de asociați nepotrivit): rămâne clicabil doar ca să explice de ce nu se poate folosi.
          onClick={() => mismatch ? notApplicable(b.name, mismatch) : setActiveKey(key)}
          aria-disabled={mismatch ? true : undefined}
          disabled={!!tipMsg}
          title={tipMsg ? `${b.name} — ${tipMsg}` : mismatch ? undefined : b.name}
          data-tooltip={!tipMsg && mismatch ? `⚠️ ${b.name} nu se aplică acestui client: ${mismatch}.` : undefined}
        >
          <span className="tf-row-badge">BAZĂ</span>
          {b.tipTemplate !== 'universal' && (
            <span className={`tf-row-tip tf-row-tip--${b.tipTemplate.toLowerCase()}`}>{b.tipTemplate}</span>
          )}
          <span className="tf-row-name" title={b.name}>{b.name}</span>
          {link && <span className="tf-row-check" title="Generat">✓</span>}
          {(mismatch || tipMsg) && <span className="tf-row-warn" title={tipMsg ?? undefined}>⚠️</span>}
          {pct !== null && !link && !mismatch && (
            <span className={`tf-row-pct${pct === 100 ? ' tf-row-pct--done' : ''}`}>{pct}%</span>
          )}
        </button>
      </div>
    )
  }

  const renderTemplateRow = (tpl: DocTemplate) => {
    const isActive = effectiveActiveKey === tpl.id
    const hasClauses = !!tpl.clauses?.length
    const isSelected = selectedIds.has(tpl.id)
    const link = generatedLinks[tpl.id]
    const asociatiMismatch = asociatiCountMismatch(tpl.sourceKey, asociatiCount)
    const tipMsg = tipMismatchMsg(tpl.tipTemplate, tpl.name)
    const isDecl = tpl.type === 'docx' && isDeclaratieTemplate(tpl)
    const pct = isDecl ? declPct(tpl.id) : hasClauses ? clausePct(tpl.id, tpl.placeholders, tpl.clauses!) : readinessPct(tpl.placeholders, tpl.id)
    return (
      <div key={tpl.id} className={`tf-row${isActive ? ' tf-row--active' : ''}${asociatiMismatch ? ' tf-row--na' : ''}`}>
        {!hasClauses && !isDecl && (
          <input
            type="checkbox"
            checked={isSelected && !asociatiMismatch}
            onChange={() => toggleSelect(tpl.id)}
            disabled={!!tipMsg || !!asociatiMismatch}
            title={tipMsg ?? (asociatiMismatch ? `Nu se aplică: ${asociatiMismatch}` : 'Include în generarea în lot')}
          />
        )}
        <button
          type="button" className="tf-row-main"
          onClick={() => asociatiMismatch ? notApplicable(tpl.name, asociatiMismatch) : setActiveKey(tpl.id)}
          aria-disabled={asociatiMismatch ? true : undefined}
          disabled={!!tipMsg}
          title={tipMsg ? `${tpl.name} — ${tipMsg}` : asociatiMismatch ? undefined : tpl.name}
          data-tooltip={!tipMsg && asociatiMismatch ? `⚠️ ${tpl.name} nu se aplică acestui client: ${asociatiMismatch}.` : undefined}
        >
          {tpl.tipTemplate && tpl.tipTemplate !== 'universal' && (
            <span className={`tf-row-tip tf-row-tip--${tpl.tipTemplate.toLowerCase()}`}>{tpl.tipTemplate}</span>
          )}
          <span className="tf-row-name" title={tpl.name}>{tpl.name}</span>
          <span className="tf-row-tip tf-row-tip--type" title={tpl.type === 'gdoc' ? 'Document Google Docs' : 'Document Word'}>{tpl.type === 'gdoc' ? 'GDoc' : 'Word'}</span>
          {link && <span className="tf-row-check" title="Generat">✓</span>}
          {(asociatiMismatch || tipMsg) && <span className="tf-row-warn" title={tipMsg ?? undefined}>⚠️</span>}
          {pct !== null && !link && (
            <span className={`tf-row-pct${pct === 100 ? ' tf-row-pct--done' : ''}`}>{pct}%</span>
          )}
        </button>
      </div>
    )
  }

  // ── Panou de detaliu (dreapta) — formularul complet al șablonului activ ──

  const renderTemplateDetail = (tpl: DocTemplate) => {
    const isLoading = loadingIds.has(tpl.id)
    const link = generatedLinks[tpl.id]
    const hasClauses = !!tpl.clauses?.length
    const asociatiMismatch = asociatiCountMismatch(tpl.sourceKey, asociatiCount)
    const isSelected = selectedIds.has(tpl.id)
    const tipMsg = tipMismatchMsg(tpl.tipTemplate, tpl.name)
    const isDecl = tpl.type === 'docx' && isDeclaratieTemplate(tpl)

    return (
      <div className="tf-detail-panel">
        <div className="tf-detail-head">
          <span className="tf-detail-title" title={tpl.name}>{tpl.name}</span>
          <button
            className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => tryGenerateSingle(tpl)}
            disabled={isLoading || !!asociatiMismatch || !!tipMsg || (hasClauses && !clauseState[tpl.id]?.isComplete)}
          >
            {isLoading ? <><span className="spin" />&nbsp;</> : (tpl.type === 'gdoc' ? '🔷 ' : '↓ ')}
            Generează
          </button>
        </div>

        {tpl.description && <p className="card-sub" style={{ margin: 0 }}>{tpl.description}</p>}

        {asociatiMismatch && (
          <div style={WARN_BOX}>⚠️ {tpl.name} {asociatiMismatch}</div>
        )}

        {!asociatiMismatch && isDecl && renderDeclaratieProgress(tpl.id)}
        {!asociatiMismatch && !isDecl && hasClauses && renderProgressBar(tpl.id, clauseCompletion(tpl.id, tpl.placeholders, tpl.clauses!), 'De completat înainte de generare')}
        {!asociatiMismatch && (isDecl ? (
          <DeclaratieActivitateFiller
            key={`${tpl.id}:${client?.id ?? 'none'}`}
            ref={declaratieFormRef}
            client={client}
            onChange={v => setDeclaratieFormState(prev => ({ ...prev, [tpl.id]: { ...v, forClient: client?.id } }))}
          />
        ) : hasClauses ? (
          <ClauseSelector
            clauses={tpl.clauses!}
            client={client}
            baseReplacements={replacements}
            onChange={v => setClauseState(prev => ({ ...prev, [tpl.id]: v }))}
          />
        ) : (
          renderReadiness(tpl)
        ))}

        {tipMsg && <div style={WARN_BOX}>⚠️ {tipMsg}</div>}

        {link && (
          <div style={{ fontSize: '.78rem' }}>
            ✓{' '}
            {tpl.type === 'gdoc'
              ? <a href={link} target="_blank" rel="noreferrer" style={{ color: 'var(--p600)', fontWeight: 600 }}>Deschide în Google Docs ↗</a>
              : <a href={link} target="_blank" rel="noreferrer" style={{ color: 'var(--g600)', fontWeight: 600 }}>Vizualizează pe Drive ↗</a>
            }
          </div>
        )}
      </div>
    )
  }

  const renderBuiltinDetail = (b: BuiltinTemplate) => {
    const key = builtinKey(b)
    const isDeclaratie = b.key === DECLARATIE_ACTIVITATE_KEY
    const isLoading = loadingIds.has(key)
    const link = generatedLinks[key]
    // Declarația (formular dedicat, fără clauze/#ASOCIATI) nu are legătură cu
    // numărul de asociați din document — restricția nu se aplică.
    const mismatch = isDeclaratie ? undefined : asociatiCountMismatch(b.key, asociatiCount)
    const tipMsg = tipMismatchMsg(b.tipTemplate, b.name)

    return (
      <div className="tf-detail-panel">
        <div className="tf-detail-head">
          <span className="tf-row-badge">DE BAZĂ</span>
          <span className="tf-detail-title" title={b.name}>{b.name}</span>
          <button
            className="btn btn-sm btn-outline-primary"
            onClick={() => isDeclaratie ? handleGenerateDeclaratie(b) : tryGenerateBuiltinSingle(b)}
            disabled={isLoading || !!mismatch || !!tipMsg || (!isDeclaratie && b.clauses.length > 0 && !clauseState[key]?.isComplete)}
          >
            {isLoading ? <><span className="spin" />&nbsp;</> : '↓ '}
            Generează
          </button>
        </div>

        {mismatch && <div style={WARN_BOX}>⚠️ {b.name} {mismatch}</div>}
        {!mismatch && tipMsg && <div style={WARN_BOX}>⚠️ {tipMsg}</div>}

        {!mismatch && b.key === 'act_constitutiv' && (
          <div style={{ display: 'flex', gap: '.375rem' }}>
            <button
              type="button"
              className={`btn btn-sm ${actConstitutivMode === 'infiintare' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setActConstitutivMode('infiintare')}
            >
              🆕 Înființare
            </button>
            <button
              type="button"
              className={`btn btn-sm ${actConstitutivMode === 'actualizare' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setActConstitutivMode('actualizare')}
            >
              🔄 Actualizare
            </button>
          </div>
        )}

        {!mismatch && isDeclaratie && renderDeclaratieProgress(key)}
        {!mismatch && !isDeclaratie && b.clauses.length > 0 && renderProgressBar(key, clauseCompletion(key, b.placeholders, b.clauses), 'De completat înainte de generare')}
        {!mismatch && (isDeclaratie ? (
          <DeclaratieActivitateFiller
            key={client?.id ?? 'none'}
            ref={declaratieFormRef}
            client={client}
            onChange={v => setDeclaratieFormState(prev => ({ ...prev, [key]: { ...v, forClient: client?.id } }))}
          />
        ) : b.clauses.length > 0 ? (
          <ClauseSelector
            clauses={b.clauses}
            client={client}
            baseReplacements={replacements}
            onChange={v => setClauseState(prev => ({ ...prev, [key]: v }))}
          />
        ) : (
          renderReadiness({ id: key, placeholders: builtinCheckablePlaceholders(b) })
        ))}

        {link && (
          <div style={{ fontSize: '.78rem' }}>
            ✓ <a href={link} target="_blank" rel="noreferrer" style={{ color: 'var(--g600)', fontWeight: 600 }}>Vizualizează pe Drive ↗</a>
          </div>
        )}
      </div>
    )
  }

  const renderDetail = () => {
    if (!effectiveActiveKey) {
      return <div className="tf-empty">Selectează un șablon din listă pentru a-l completa.</div>
    }
    if (effectiveActiveKey.startsWith('builtin:')) {
      const b = builtins.find(x => builtinKey(x) === effectiveActiveKey)
      return b ? renderBuiltinDetail(b) : <div className="tf-empty">Șablonul nu mai este disponibil.</div>
    }
    const tpl = listTemplates.find(t => t.id === effectiveActiveKey)
    return tpl ? renderTemplateDetail(tpl) : <div className="tf-empty">Selectează un șablon din listă pentru a-l completa.</div>
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">
            <span className="step-chip">{stepNumber}</span>
            Completare template
          </span>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={onBack}>← Înapoi</button>
            {hasScannedPersonsNoClient && !clientSaved && (
              <button className="btn btn-success btn-sm" onClick={() => setShowSaveClient(true)}>
                💾 Salvează ca client
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setShowLibrary(true)}>📁 Șabloane</button>
          </div>
        </div>

        <div className="card-body">
          <div className="tf-layout" ref={layoutRef} style={{ ['--tf-list-w' as string]: `${listW}px` }}>

            {/* ── Coloana din stânga — listă ── */}
            <div className="tf-list">
              <div
                className="tf-resizer" role="separator" aria-orientation="vertical" tabIndex={0}
                aria-label="Lățimea listei de șabloane" aria-valuemin={LIST_W_MIN} aria-valuemax={LIST_W_MAX} aria-valuenow={listW}
                title="Trage pentru a lărgi lista (dublu-click: lățimea implicită)"
                onPointerDown={startResize} onKeyDown={resizeKey} onDoubleClick={() => applyListW(LIST_W_DEFAULT, true)}
              />
              {tplLoading && (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--s400)' }}>
                  <span className="spin" style={{ display: 'inline-block' }} />
                </div>
              )}

              {builtins.length > 0 && (
                <>
                  <div className="tf-list-label">Șabloane de bază</div>
                  <div className="tf-rows">{builtins.map(renderBuiltinRow)}</div>
                </>
              )}

              {!tplLoading && listTemplates.length === 0 && (
                <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--s400)', fontSize: '.875rem' }}>
                  Niciun șablon propriu adăugat.{' '}
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowLibrary(true)} style={{ marginTop: '.5rem', display: 'block', margin: '.375rem auto 0' }}>
                    + Adaugă din biblioteca de șabloane
                  </button>
                </div>
              )}

              {!tplLoading && listTemplates.length > 0 && (
                <>
                  <div className="tf-list-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Șabloanele mele</span>
                    {selectableTemplates.length > 1 && (
                      <button
                        type="button" className="btn btn-ghost btn-xs"
                        style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 600 }}
                        onClick={allSelectableSelected ? deselectAllTemplates : selectAllTemplates}
                      >
                        {allSelectableSelected ? 'Deselectează tot' : 'Selectează tot'}
                      </button>
                    )}
                  </div>
                  <div className="tf-rows">{listTemplates.map(renderTemplateRow)}</div>
                </>
              )}

              {/* Batch generate */}
              {selectedTemplates.length > 1 && (
                <button className="btn btn-primary" onClick={tryBatchGenerate} disabled={loadingIds.size > 0}>
                  {loadingIds.size > 0
                    ? <><span className="spin" />&nbsp;Generare în curs…</>
                    : `⚡ Generează toate (${selectedTemplates.length})`
                  }
                </button>
              )}
            </div>

            {/* ── Coloana din dreapta — detaliu șablon activ ── */}
            <div className="tf-detail">
              <div key={effectiveActiveKey ?? 'empty'} className="tf-detail-fade">
                {renderDetail()}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Sex necunoscut pentru unele persoane: în document au rămas ambele variante („numit/ă”) */}
      {variantNotices.length > 0 && (
        <Modal
          onClose={() => setVariantNotices([])}
          ariaLabel="Sex necunoscut"
          backdropStyle={{ background: 'var(--backdrop)', zIndex: 410 }}
          boxStyle={{ maxWidth: 480, display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: '1.125rem 1.25rem', borderBottom: '1px solid var(--s200)' }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)' }}>⚠️ Verifică documentul generat</div>
          </div>
          <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '.625rem', fontSize: '.875rem', color: 'var(--s700)' }}>
            {variantNotices.map(m => <div key={m}>{m}</div>)}
          </div>
          <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--s200)', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setVariantNotices([])}>Am înțeles</button>
          </div>
        </Modal>
      )}

      {/* Unde se salvează documentul generat — întrebat la generare, o dată pe acțiune (sau pe lot) */}
      {destDialogOpen && (
        <Modal
          onClose={() => closeDestDialog(false)}
          ariaLabel="Unde salvezi documentul"
          backdropStyle={{ background: 'var(--backdrop)', zIndex: 400 }}
          boxStyle={{ maxWidth: 460, display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: '1.125rem 1.25rem', borderBottom: '1px solid var(--s200)' }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)' }}>Unde salvezi documentul?</div>
          </div>
          <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
            {([
              ['local', '💻 Pe calculator', 'Se descarcă fișierul Word.'],
              ['drive', '☁️ În Google Drive', 'Se salvează în Drive-ul tău, în folderul ales.'],
            ] as const).map(([val, title, sub]) => (
              <label key={val} style={{
                display: 'flex', gap: '.625rem', alignItems: 'flex-start', cursor: 'pointer', padding: '.625rem .75rem',
                border: `1.5px solid ${destChoice === val ? 'var(--p500)' : 'var(--s200)'}`, borderRadius: 'var(--r-sm)',
                background: destChoice === val ? 'var(--p50)' : 'transparent',
              }}>
                <input type="radio" name="dest" checked={destChoice === val} onChange={() => setDestChoice(val)} style={{ marginTop: '.2rem' }} />
                <span>
                  <div style={{ fontWeight: 600, fontSize: '.9rem', color: 'var(--s800)' }}>{title}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--s500)' }}>{sub}</div>
                </span>
              </label>
            ))}

            {destChoice === 'drive' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
                <label style={LABEL}>Folder destinație</label>
                {showFolderPicker ? (
                  <DriveFolderPicker
                    accessToken={accessToken}
                    onToast={onToast}
                    onSelect={folder => { setDriveFolder(folder); setShowFolderPicker(false) }}
                    onCancel={() => setShowFolderPicker(false)}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <span style={{ flex: 1, fontSize: '.875rem', color: driveFolder ? 'var(--s800)' : 'var(--s400)' }}>
                      {driveFolder ? `📁 ${driveFolder.name}` : 'Rădăcina Drive'}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowFolderPicker(true)}>
                      {driveFolder ? 'Schimbă' : 'Alege folder'}
                    </button>
                    {driveFolder && <button onClick={() => setDriveFolder(null)} style={BTN_X} title="Elimină">×</button>}
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: '.72rem', color: 'var(--s400)' }}>
              Șabloanele Google Doc se creează întotdeauna direct în Drive, indiferent de alegere.
            </div>
          </div>
          <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--s200)', display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => closeDestDialog(false)}>Anulează</button>
            <button className="btn btn-primary btn-sm" onClick={() => closeDestDialog(true)} disabled={showFolderPicker}>Generează</button>
          </div>
        </Modal>
      )}

      {/* Template Library slide-over */}
      {showLibrary && (
        <TemplateLibrary
          templates={templates}
          accessToken={accessToken}
          onAdd={data => addTemplate(workspaceId, data, user?.uid ?? '')}
          onRemove={id => removeTemplate(workspaceId, id)}
          onClose={() => setShowLibrary(false)}
          onToast={onToast}
        />
      )}

      {/* ── Confirmation dialog for missing fields ── */}
      {pendingGenerate && (() => {
        const grouped = groupMissingFields(pendingGenerate.missing)
        const isBatch = pendingGenerate.isBatch
        return (
          <Modal
            onClose={() => setPendingGenerate(null)}
            ariaLabel="Câmpuri necompletate"
            backdropStyle={{ background: 'var(--backdrop)', zIndex: 400 }}
            boxStyle={{ maxWidth: 460, display: 'flex', flexDirection: 'column' }}
          >
              <div style={{ padding: '1.125rem 1.25rem', borderBottom: '1px solid var(--s200)' }}>
                <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)', marginBottom: '.25rem' }}>
                  ⚠️ Câmpuri necompletate
                </div>
                <div style={{ fontSize: '.825rem', color: 'var(--s500)' }}>
                  {isBatch
                    ? `Documentele selectate vor fi generate cu unele câmpuri lipsă.`
                    : `"${pendingGenerate.tpl.name}" va fi generat cu unele câmpuri lipsă.`
                  }
                </div>
              </div>

              <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: '.125rem' }}>
                  Câmpuri ce vor rămâne goale în document
                </div>
                {Object.entries(grouped).map(([group, fields]) => (
                  <div key={group} style={{
                    background: 'var(--y50)', border: '1px solid var(--y200)',
                    borderRadius: 'var(--r-sm)', padding: '.4rem .625rem',
                    display: 'flex', gap: '.5rem', alignItems: 'flex-start', fontSize: '.825rem',
                  }}>
                    <span style={{ color: 'var(--y700)', fontWeight: 700, whiteSpace: 'nowrap', minWidth: 100 }}>
                      {group}
                    </span>
                    <span style={{ color: 'var(--s700)' }}>{fields.join(', ')}</span>
                  </div>
                ))}
              </div>

              <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--s200)', display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => { setPendingGenerate(null); onBack() }}>
                  ← Întoarce-te și completează
                </button>
                <button className="btn btn-primary btn-sm" onClick={confirmGenerate}>
                  Generează oricum
                </button>
              </div>
          </Modal>
        )
      })()}

      {/* Prompt explicit — întrebăm o singură dată dacă salvăm entitatea generată ca client */}
      {showSavePrompt && (
        <Modal
          onClose={() => setShowSavePrompt(false)}
          ariaLabel="Salvează client"
          backdropStyle={{ background: 'var(--backdrop)', zIndex: 400 }}
          boxStyle={{ maxWidth: 440, display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: '1.125rem 1.25rem', borderBottom: '1px solid var(--s200)' }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)' }}>
              💾 Salvezi această entitate ca client?
            </div>
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            <p style={{ fontSize: '.875rem', color: 'var(--s600)', margin: 0 }}>
              Ai generat documente pentru o entitate care nu există încă în portofoliu.
              Salveaz-o ca să regăsești datele completate (inclusiv corecturile de mai sus) data viitoare, fără să le reintroduci.
            </p>
          </div>
          <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--s200)', display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSavePrompt(false)}>Nu, mulțumesc</button>
            <button className="btn btn-primary btn-sm" onClick={() => { setShowSavePrompt(false); setShowSaveClient(true) }}>
              Da, salvează
            </button>
          </div>
        </Modal>
      )}

      {/* Modificări descrise în clauzele bifate — ofertă de sincronizare cu profilul clientului */}
      {pendingClientPatches && client?.id && (
        <Modal
          onClose={() => setPendingClientPatches(null)}
          ariaLabel="Actualizează profilul clientului"
          backdropStyle={{ background: 'var(--backdrop)', zIndex: 400 }}
          boxStyle={{ maxWidth: 460, display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: '1.125rem 1.25rem', borderBottom: '1px solid var(--s200)' }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)' }}>
              💾 Actualizezi și profilul clientului?
            </div>
            <div style={{ fontSize: '.825rem', color: 'var(--s500)', marginTop: '.25rem' }}>
              Documentul descrie schimbări reale — alege ce se scrie și în portofoliu.
            </div>
          </div>
          <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {pendingClientPatches.map(p => (
              <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', cursor: 'pointer', fontSize: '.875rem', color: 'var(--s700)' }}>
                <input
                  type="checkbox"
                  checked={checkedPatchKeys.has(p.key)}
                  onChange={() => setCheckedPatchKeys(prev => {
                    const next = new Set(prev)
                    if (next.has(p.key)) next.delete(p.key); else next.add(p.key)
                    return next
                  })}
                  style={{ marginTop: '.2rem' }}
                />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
          <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--s200)', display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setPendingClientPatches(null)}>Nu, mulțumesc</button>
            <button className="btn btn-primary btn-sm" onClick={handleApplyClientPatches}>Aplică selectate</button>
          </div>
        </Modal>
      )}

      {/* Save as client modal */}
      {showSaveClient && (
        <ClientModal
          initial={buildClientInitial()}
          onSave={async (data: ClientInput) => {
            // Parent must provide save handler; we bubble via onClientSaved
            onToast('Client salvat', 'ok')
            setShowSaveClient(false)
            setClientSaved(true)
            if (onClientSaved) {
              onClientSaved({ id: '', createdAt: null, createdBy: user?.uid ?? '', denumireLower: data.denumire.toLowerCase(), ...data } as Client)
            }
          }}
          onClose={() => setShowSaveClient(false)}
        />
      )}
    </>
  )
}

const LABEL: CSSProperties = {
  fontSize: '.695rem', fontWeight: 700, color: 'var(--s500)',
  letterSpacing: '.05em', textTransform: 'uppercase', display: 'block', marginBottom: '.375rem',
}
const BTN_X: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--s400)', fontSize: '1.1rem', lineHeight: 1, padding: '.125rem .25rem',
}
const WARN_BOX: CSSProperties = {
  fontSize: '.75rem', color: 'var(--o700)', background: 'var(--o50)',
  border: '1px solid var(--o200)', borderRadius: 4, padding: '.25rem .5rem',
}
