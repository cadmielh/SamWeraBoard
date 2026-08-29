import { useState } from 'react'
import type { CSSProperties } from 'react'
import { fillDocx, fillDocxFromBuiltinTemplate, fillDocxFromDriveTemplate, fillGdoc, fillPdfFromBuiltinTemplate } from '../lib/api'
import type { IDFields } from '../lib/api'
import type { BuiltinTemplate, Client, DocTemplate, ScannedPerson, ToastItem } from '../types'
import { inferTipClient } from '../types'
import type { User } from 'firebase/auth'
import { buildReplacements, buildRepeatGroups, checkReadiness, groupMissingFields } from '../lib/placeholders'
import { useTemplates, logDocGeneration } from '../lib/templates'
import { asociatiCountMismatch, useBuiltinTemplates } from '../lib/builtinTemplates'
import { EMPTY_CLIENT, useClienti, type ClientInput } from '../lib/clienti'
import DriveFolderPicker from './DriveFolderPicker'
import TemplateLibrary from './TemplateLibrary'
import ClientModal from './ClientModal'
import ClauseSelector from './ClauseSelector'
import type { ClauseSelectorValue } from './ClauseSelector'
import PdfFormFiller from './PdfFormFiller'
import type { PdfFormValue } from './PdfFormFiller'
import type { ClientPatchProposal } from '../lib/clauseFieldSpecs'
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

type Tab = 'docx' | 'gdoc'

// Placeholdere completate intern (ex. {{SUBTITLU_ACTUALIZARE}}, injectat abia
// la generare, în funcție de toggle-ul Înființare/Actualizare) — niciodată
// tastate de user, deci nu trebuie verificate ca "necompletate".
const INTERNAL_BUILTIN_FIELDS = new Set(['SUBTITLU_ACTUALIZARE'])
const builtinCheckablePlaceholders = (b: BuiltinTemplate): string[] =>
  b.placeholders.filter(ph => !INTERNAL_BUILTIN_FIELDS.has(ph.replace(/^\{\{|\}\}$/g, '')))

const builtinKey = (b: BuiltinTemplate) => `builtin:${b.key}`

export default function TemplateFiller({
  workspaceId, user, fields, client, scannedPersons,
  accessToken, onToast, onBack, onClientSaved, stepNumber = 3,
}: Props) {
  const { templates, loading: tplLoading, add: addTemplate, remove: removeTemplate } = useTemplates(workspaceId)
  const { builtins } = useBuiltinTemplates(accessToken)
  const { update: updateClient } = useClienti(workspaceId)

  const docxTemplates = templates.filter(t => t.type === 'docx')
  const gdocTemplates = templates.filter(t => t.type === 'gdoc')

  const [tab, setTab] = useState<Tab>('docx')
  const [clauseState, setClauseState] = useState<Record<string, ClauseSelectorValue>>({})
  const [pdfFormState, setPdfFormState] = useState<Record<string, PdfFormValue>>({})
  const [pendingClientPatches, setPendingClientPatches] = useState<{ key: string; label: string; patch: Partial<ClientInput> }[] | null>(null)
  const [checkedPatchKeys, setCheckedPatchKeys] = useState<Set<string>>(new Set())
  // Șablonul afișat momentan în panoul din dreapta — 'builtin:<key>' pentru
  // șabloanele de bază, sau tpl.id pentru cele din bibliotecă.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [uploadToDrive, setUploadToDrive] = useState(false)
  const [driveFolder, setDriveFolder] = useState<{ id: string; name: string } | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
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

  const currentTabTemplates = tab === 'docx' ? docxTemplates : gdocTemplates
  const selectedInTab = currentTabTemplates.filter(t => selectedIds.has(t.id))

  const switchTab = (t: Tab) => { setTab(t); setActiveKey(null) }

  const replacements = buildReplacements({ idFields: fields, client, scannedPersons })
  const repeatGroups = buildRepeatGroups({ idFields: fields, client, scannedPersons })
  const hasScannedPersonsNoClient = (scannedPersons ?? []).length > 0 && !client?.id
  // Asociați existenți (client.asociati) sau doar scanați, nesalvați încă —
  // aceeași listă folosită deja la umplerea {{#ASOCIATI}}.
  const asociatiCount = repeatGroups.ASOCIATI?.length ?? 0

  // Diferențiere PF/PJ — un client PJ nu ar trebui să poată genera un șablon
  // gândit strict pentru PF (și invers). "universal"/lipsă = se aplică oricui.
  const clientTip = client ? inferTipClient(client as Client) : null
  const tipMismatchMsg = (tipTemplate: string | undefined, tplLabel: string): string | null => {
    if (!tipTemplate || tipTemplate === 'universal' || !clientTip) return null
    if (tipTemplate === clientTip) return null
    return `${tplLabel} e valabil doar pentru ${tipTemplate}, dar clientul selectat este ${clientTip}`
  }

  // Implicit — primul șablon compatibil cu tipul clientului (dacă există),
  // altfel primul disponibil — ca panoul din dreapta să nu rămână gol la
  // intrarea în pas; derivat la randare (nu stocat separat), ca selecția
  // explicită a userului să rămână prioritară.
  const defaultActiveKey = (() => {
    if (tab === 'docx' && builtins.length > 0) {
      const compatible = builtins.find(b => !tipMismatchMsg(b.tipTemplate, b.name))
      return builtinKey(compatible ?? builtins[0])
    }
    const compatible = currentTabTemplates.find(t => !tipMismatchMsg(t.tipTemplate, t.name))
    return (compatible ?? currentTabTemplates[0])?.id ?? null
  })()
  const effectiveActiveKey = activeKey ?? defaultActiveKey

  // Doar șabloanele fără clauze au checkbox (vezi renderTemplateRow) — cele cu
  // tip incompatibil clientului sunt oricum disabled, excluse din select-all.
  const selectableInTab = currentTabTemplates.filter(t => !t.clauses?.length && !tipMismatchMsg(t.tipTemplate, t.name))
  const allSelectableSelected = selectableInTab.length > 0 && selectableInTab.every(t => selectedIds.has(t.id))
  const selectAllInTab = () => setSelectedIds(prev => {
    const next = new Set(prev); selectableInTab.forEach(t => next.add(t.id)); return next
  })
  const deselectAllInTab = () => setSelectedIds(prev => {
    const next = new Set(prev); selectableInTab.forEach(t => next.delete(t.id)); return next
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
    setLoading(tpl.id, true)
    try {
      const outputName = resolveOutputName(tpl)
      const cs = clauseState[tpl.id]
      const mergedReplacements = cs ? { ...replacements, ...cs.extraReplacements } : replacements
      const mergedGroups = cs && Object.keys(cs.extraGroups).length ? { ...repeatGroups, ...cs.extraGroups } : repeatGroups
      let result: { blob?: Blob; name?: string; link?: string }

      if (tpl.driveFileId) {
        result = await fillDocxFromDriveTemplate(tpl.driveFileId, mergedReplacements, accessToken, uploadToDrive, driveFolder?.id, outputName, mergedGroups, cs?.selectedClauses)
      } else {
        const file = await resolveTemplateFile(tpl)
        if (!file) { onToast(`Fișierul pentru "${tpl.name}" nu este disponibil`, 'err'); return }
        result = await fillDocx(file, mergedReplacements, accessToken, uploadToDrive, driveFolder?.id, outputName, mergedGroups, cs?.selectedClauses)
      }

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
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Generare eșuată', 'err')
    } finally {
      setLoading(tpl.id, false)
    }
  }

  // Șabloane de bază — generare directă, fără duplicare prealabilă în Firestore.
  const handleGenerateBuiltinDocx = async (b: BuiltinTemplate) => {
    const key = builtinKey(b)
    setLoading(key, true)
    try {
      let outputName = b.outputNameTemplate || b.name
      for (const [ph, val] of Object.entries(replacements)) outputName = outputName.replaceAll(ph, val)
      if (!outputName.endsWith('.docx')) outputName += '.docx'

      const cs = clauseState[key]
      // Copie proprie, mereu — "replacements" e obiectul partajat de toate
      // șabloanele randate în același pas, nu trebuie mutat direct.
      const mergedReplacements = { ...replacements, ...(cs?.extraReplacements ?? {}) }
      const mergedGroups = cs && Object.keys(cs.extraGroups).length ? { ...repeatGroups, ...cs.extraGroups } : repeatGroups

      if (b.key === 'act_constitutiv') {
        // Placeholder gol ar fi eliminat de backend (nu se trimit câmpuri
        // goale) și ar rămâne vizibil literal în document — un singur spațiu
        // se substituie normal și randează ca linie goală.
        mergedReplacements['{{SUBTITLU_ACTUALIZARE}}'] = actConstitutivMode === 'actualizare'
          ? `- actualizat la ${replacements['{{DATA_AZI}}']} -`
          : ' '
      }

      const result = await fillDocxFromBuiltinTemplate(b.key, mergedReplacements, accessToken, uploadToDrive, driveFolder?.id, outputName, mergedGroups, cs?.selectedClauses)

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

  // Șablon de bază PDF (AcroForm) — fără clauze/grupuri, valorile vin deja
  // asamblate din PdfFormFiller (inclusiv orice corectare făcută de user peste
  // parsarea automată de adresă/județ).
  const handleGeneratePdf = async (b: BuiltinTemplate) => {
    const key = builtinKey(b)
    const form = pdfFormState[key]
    if (!form?.isComplete) return
    setLoading(key, true)
    try {
      let outputName = b.outputNameTemplate || b.name
      for (const [ph, val] of Object.entries(replacements)) outputName = outputName.replaceAll(ph, val)
      if (!outputName.endsWith('.pdf')) outputName += '.pdf'

      const blob = await fillPdfFromBuiltinTemplate(b.key, form.fieldValues, accessToken, outputName)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = outputName; a.click()
      URL.revokeObjectURL(url)
      onToast(`Descărcat: ${outputName}`, 'ok')
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

  // Variantă pentru PdfFormFiller, care nu are clauze — colectează direct o
  // listă de propuneri (ex. sedii secundare noi), nu un Record pe tag de clauză.
  const offerClientPatchList = (proposals: ClientPatchProposal[]) => {
    if (!client?.id || proposals.length === 0) return
    const withKeys = proposals.map((p, i) => ({ key: `pdf-${i}`, ...p }))
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
      const result = await fillGdoc(tpl.docId, replacements, accessToken, outputName)
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
    const targets = templates.filter(t => selectedIds.has(t.id))
    for (const tpl of targets) {
      if (tpl.type === 'docx') await handleGenerateDocx(tpl)
      else await handleGenerateGdoc(tpl)
    }
  }

  // Confirmation wrappers — check for missing fields before generating
  const tryGenerateSingle = (tpl: DocTemplate) => {
    // Șabloanele cu clauze au propria verificare de completitudine în
    // ClauseSelector (butonul Generează e dezactivat până e completă) —
    // nu mai trece prin dialogul de confirmare pentru câmpuri lipsă.
    if (tpl.clauses?.length) { handleGenerateDocx(tpl); return }

    const { missing } = checkReadiness(tpl.placeholders ?? [], replacements, repeatGroups)
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
    const { missing } = checkReadiness(builtinCheckablePlaceholders(b), replacements, repeatGroups)
    if (missing.length > 0) {
      setPendingGenerate({ tpl: b, missing, isBuiltin: true })
    } else {
      handleGenerateBuiltinDocx(b)
    }
  }

  const tryBatchGenerate = () => {
    const targets = templates.filter(t => selectedIds.has(t.id))
    const allMissing = targets.flatMap(t => checkReadiness(t.placeholders ?? [], replacements, repeatGroups).missing)
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
  const readinessPct = (placeholders?: string[]): number | null => {
    if (!placeholders || placeholders.length === 0) return null
    const { filled } = checkReadiness(placeholders, replacements, repeatGroups)
    return Math.round((filled.length / placeholders.length) * 100)
  }

  // Generic — folosit atât pentru DocTemplate (șabloane proprii), cât și
  // pentru BuiltinTemplate (șabloane de bază fără clauze, ex. Act Constitutiv).
  const renderReadiness = (tpl: { id: string; placeholders?: string[] }) => {
    if (!tpl.placeholders || tpl.placeholders.length === 0) return null
    const { filled, missing } = checkReadiness(tpl.placeholders, replacements, repeatGroups)
    const total = tpl.placeholders.length
    const pct = Math.round((filled.length / total) * 100)
    const isExpanded = expandedReadiness.has(tpl.id)
    const grouped = missing.length > 0 ? groupMissingFields(missing) : {}

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
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
    const mismatch = b.type === 'pdf' ? undefined : asociatiCountMismatch(b.key, asociatiCount)
    const tipMsg = tipMismatchMsg(b.tipTemplate, b.name)
    const pct = b.type === 'pdf' ? null : readinessPct(builtinCheckablePlaceholders(b))
    return (
      <div key={key} className={`tf-row${isActive ? ' tf-row--active' : ''}`}>
        <button
          type="button" className="tf-row-main" onClick={() => setActiveKey(key)}
          disabled={!!tipMsg} title={tipMsg ?? undefined}
        >
          <span className="tf-row-badge">BAZĂ</span>
          {b.tipTemplate !== 'universal' && (
            <span className={`tf-row-tip tf-row-tip--${b.tipTemplate.toLowerCase()}`}>{b.tipTemplate}</span>
          )}
          <span className="tf-row-name">{b.name}</span>
          {link && <span className="tf-row-check" title="Generat">✓</span>}
          {(mismatch || tipMsg) && <span className="tf-row-warn" title={tipMsg ?? mismatch ?? undefined}>⚠️</span>}
          {pct !== null && !link && (
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
    const pct = readinessPct(tpl.placeholders)
    return (
      <div key={tpl.id} className={`tf-row${isActive ? ' tf-row--active' : ''}`}>
        {!hasClauses && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(tpl.id)}
            disabled={!!tipMsg}
            title={tipMsg ?? 'Include în generarea în lot'}
          />
        )}
        <button
          type="button" className="tf-row-main" onClick={() => setActiveKey(tpl.id)}
          disabled={!!tipMsg} title={tipMsg ?? undefined}
        >
          {tpl.tipTemplate && tpl.tipTemplate !== 'universal' && (
            <span className={`tf-row-tip tf-row-tip--${tpl.tipTemplate.toLowerCase()}`}>{tpl.tipTemplate}</span>
          )}
          <span className="tf-row-name">{tpl.name}</span>
          {link && <span className="tf-row-check" title="Generat">✓</span>}
          {(asociatiMismatch || tipMsg) && <span className="tf-row-warn" title={tipMsg ?? asociatiMismatch ?? undefined}>⚠️</span>}
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
            {uploadToDrive && tpl.type === 'docx' ? 'Upload' : 'Generează'}
          </button>
        </div>

        {tpl.description && <p className="card-sub" style={{ margin: 0 }}>{tpl.description}</p>}

        {asociatiMismatch && (
          <div style={WARN_BOX}>⚠️ {tpl.name} {asociatiMismatch}</div>
        )}

        {!asociatiMismatch && (hasClauses ? (
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
    const isPdf = b.type === 'pdf'
    const isLoading = loadingIds.has(key)
    const link = generatedLinks[key]
    // Șablonul PDF (fără clauze/#ASOCIATI) nu are legătură cu numărul de
    // asociați din document — restricția nu se aplică.
    const mismatch = isPdf ? undefined : asociatiCountMismatch(b.key, asociatiCount)
    const tipMsg = tipMismatchMsg(b.tipTemplate, b.name)

    return (
      <div className="tf-detail-panel">
        <div className="tf-detail-head">
          <span className="tf-row-badge">DE BAZĂ</span>
          <span className="tf-detail-title" title={b.name}>{b.name}</span>
          <button
            className="btn btn-sm btn-outline-primary"
            onClick={() => isPdf ? handleGeneratePdf(b) : tryGenerateBuiltinSingle(b)}
            disabled={isLoading || !!mismatch || !!tipMsg || (isPdf ? !pdfFormState[key]?.isComplete : (b.clauses.length > 0 && !clauseState[key]?.isComplete))}
          >
            {isLoading ? <><span className="spin" />&nbsp;</> : '↓ '}
            {!isPdf && uploadToDrive ? 'Upload' : 'Generează'}
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

        {!mismatch && (isPdf ? (
          <PdfFormFiller
            key={client?.id ?? 'none'}
            client={client}
            onChange={v => setPdfFormState(prev => ({ ...prev, [key]: v }))}
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
    const tpl = currentTabTemplates.find(t => t.id === effectiveActiveKey)
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
          <div className="tf-layout">

            {/* ── Coloana din stânga — listă ── */}
            <div className="tf-list">
              {/* Tab switcher */}
              <div style={{ display: 'flex', gap: '.25rem', background: 'var(--s100)', borderRadius: 'var(--r-sm)', padding: '.25rem' }}>
                {(['docx', 'gdoc'] as Tab[]).map(t => (
                  <button key={t} onClick={() => switchTab(t)} style={{
                    flex: 1, padding: '.4rem .75rem', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: tab === t ? 'var(--surface)' : 'transparent',
                    boxShadow: tab === t ? 'var(--sh-sm)' : 'none',
                    color: tab === t ? 'var(--s800)' : 'var(--s400)',
                    fontWeight: tab === t ? 600 : 400, fontSize: '.85rem',
                    fontFamily: 'var(--font)', transition: 'all var(--t)',
                  }}>
                    {t === 'docx' ? '📄 Word Document' : '🔷 Google Doc'}
                  </button>
                ))}
              </div>

              {tplLoading && (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--s400)' }}>
                  <span className="spin" style={{ display: 'inline-block' }} />
                </div>
              )}

              {tab === 'docx' && builtins.length > 0 && (
                <>
                  <div className="tf-list-label">Șabloane de bază</div>
                  <div className="tf-rows">{builtins.map(renderBuiltinRow)}</div>
                </>
              )}

              {!tplLoading && currentTabTemplates.length === 0 && (
                <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--s400)', fontSize: '.875rem' }}>
                  Niciun șablon {tab === 'docx' ? 'Word' : 'Google Doc'} adăugat.{' '}
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowLibrary(true)} style={{ marginTop: '.5rem', display: 'block', margin: '.375rem auto 0' }}>
                    + Adaugă din biblioteca de șabloane
                  </button>
                </div>
              )}

              {!tplLoading && currentTabTemplates.length > 0 && (
                <>
                  <div className="tf-list-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Șabloanele mele</span>
                    {selectableInTab.length > 1 && (
                      <button
                        type="button" className="btn btn-ghost btn-xs"
                        style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 600 }}
                        onClick={allSelectableSelected ? deselectAllInTab : selectAllInTab}
                      >
                        {allSelectableSelected ? 'Deselectează tot' : 'Selectează tot'}
                      </button>
                    )}
                  </div>
                  <div className="tf-rows">{currentTabTemplates.map(renderTemplateRow)}</div>
                </>
              )}

              {/* Drive upload option (docx only) */}
              {tab === 'docx' && !tplLoading && currentTabTemplates.length > 0 && (
                <div style={{ marginTop: '.5rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.875rem', color: 'var(--s700)' }}>
                    <input type="checkbox" checked={uploadToDrive} onChange={e => setUploadToDrive(e.target.checked)} />
                    Salvează documentele generate pe Google Drive
                  </label>
                  {uploadToDrive && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
                      <label style={LABEL}>Folder destinație</label>
                      {showFolderPicker ? (
                        <DriveFolderPicker
                          accessToken={accessToken}
                          onToast={onToast}
                          onSelect={folder => { setDriveFolder(folder); setShowFolderPicker(false) }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                          <span style={{ flex: 1, fontSize: '.875rem', color: driveFolder ? 'var(--s800)' : 'var(--s400)' }}>
                            {driveFolder ? `📁 ${driveFolder.name}` : 'Rădăcina Drive'}
                          </span>
                          <button className="btn btn-ghost btn-sm" onClick={() => setShowFolderPicker(true)}>
                            {driveFolder ? 'Schimbă' : 'Alege folder'}
                          </button>
                          {driveFolder && (
                            <button onClick={() => setDriveFolder(null)} style={BTN_X} title="Elimină">×</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Batch generate */}
              {selectedInTab.length > 1 && (
                <button className="btn btn-primary" onClick={tryBatchGenerate} disabled={loadingIds.size > 0}>
                  {loadingIds.size > 0
                    ? <><span className="spin" />&nbsp;Generare în curs…</>
                    : `⚡ Generează toate (${selectedInTab.length})`
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
