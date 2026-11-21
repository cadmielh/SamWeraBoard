import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { fillDocx, fillDocxFromBuiltinTemplate, fillDocxFromDriveTemplate, fillGdoc } from '../lib/api'
import { ensureDriveToken, getDriveToken } from '../lib/driveAuth'
import type { IDFields, DriveTarget } from '../lib/api'
import type { BuiltinTemplate, ClauseMeta, Client, DocTemplate, Persoana, ScannedPerson, ToastItem } from '../types'
import { inferTipClient } from '../types'
import type { User } from 'firebase/auth'
import {
  buildReplacements, buildRepeatGroups, checkReadiness, groupMissingFields, isManualPlaceholder, manualLabel,
  detectCustomPersonRoles, customPersonReplacements, detectCustomPersonGroups, persoanaToSingularMap,
  customRolePool, joinNames, isDateLabel, pairManualDateFields,
  visibleManualPlaceholders, MOD_EXERCITARE_MANDATE, MOD_EXERCITARE_OPTIUNI,
  ACTUALIZARE_GROUP, actualizareGroups, withoutActualizareFields, defaultActMode, type ActMode, activeClauses, withDenumireActualizata,
} from '../lib/placeholders'
import { personSex } from '../lib/sex'
import CustomPersonField from './CustomPersonField'
import CustomPersonGroupField from './CustomPersonGroupField'
import DateFieldInput from './DateFieldInput'
import { useTemplates, logDocGeneration, listRecentGenerations } from '../lib/templates'
import { felLista, listaActe, denumireAct, OPERATIUNI, textLista } from '../lib/listeBife'
import type { FelLista } from '../lib/listeBife'
import ListaBifePanel from './ListaBifePanel'
import { assertWritable } from '../lib/billing'
import { asociatiCountMismatch, useBuiltinTemplates } from '../lib/builtinTemplates'
import { applyTemplateOrder, builtinOrderKey, dedicatedFormKey, isDedicatedKey, matchesTemplateSearch, ownOrderKey, visibleBuiltins } from '../lib/templateChanges'
import { groupByFolder } from '../lib/templateFolders'
import TemplateFolderHeader from './TemplateFolderHeader'
import { useApp } from '../AppContext'
import { EMPTY_CLIENT, denumireExists, missingRegistrationFields, useClienti, type ClientInput } from '../lib/clienti'
import DriveFolderPicker from './DriveFolderPicker'
import TemplateLibrary from './TemplateLibrary'
import ClientModal from './ClientModal'
import CreditNotice from './CreditNotice'
import ClauseSelector from './ClauseSelector'
import CesiunePanel from './CesiunePanel'
import { calculCesiune, hasCesiune, notaAplicata, propunereCesiune } from '../lib/cesiune'
import type { ClauseSelectorValue } from './ClauseSelector'
import DeclaratieActivitateFiller from './DeclaratieActivitateFiller'
import Anexa1Filler from './Anexa1Filler'
import BeneficiariRealiFiller from './BeneficiariRealiFiller'
import Anexa2aFiller from './Anexa2aFiller'
import Anexa2bFiller from './Anexa2bFiller'
import type { Anexa2aFormState } from '../lib/anexa2aFiller'
import type { Anexa2bFormState } from '../lib/anexa2bFiller'
import type { ClientPatchProposal } from '../lib/clauseFieldSpecs'
import { buildVariantContext, variantWarningMessage } from '../lib/variants'
import { withEmptyFieldMarks, withOptionalFieldMarks, DECLARATIE_ACTIVITATE_KEY } from '../lib/declaratieActivitateFiller'
import { ANEXA1_KEY } from '../lib/anexa1Filler'
import { BRX_KEY } from '../lib/beneficiariRealiFiller'
import { ANEXA2A_KEY } from '../lib/anexa2aFiller'
import { ANEXA2B_KEY } from '../lib/anexa2bFiller'
import Modal from './Modal'
import TemplateSearchInput from './TemplateSearchInput'
import { IconBack } from './NavIcons'
import { useIsMobile } from '../lib/useIsMobile'
import { useMobileBack } from '../lib/useMobileBack'
import { campuriCalculate, valoriCalculate } from '../lib/campuriCalculate'
import { campuriAutoturism, completariAutoturism } from '../lib/autoturism'
import type { CampAuto } from '../lib/autoturism'

/** Rezultatul unui formular dedicat (declarație, Anexa 1, BRX, Anexa 2a/2b), ținut pe șablon. Câmpurile opționale
 * există doar la unele formulare: tabelele declarației, propunerile ei de actualizare a fișei, grupurile BRX și starea
 * completă a formularelor lungi (Anexa 2a/2b), redată la revenirea pe șablon. */
interface DedicatedFormValue {
  replacements: Record<string, string>
  isComplete: boolean
  completion: { done: number; total: number; missing: string[] }
  rowGroups?: Record<string, Record<string, string>[]>
  groups?: Record<string, Record<string, string>[]>
  clientPatches?: ClientPatchProposal[]
  state?: unknown
}

interface Props {
  workspaceId: string
  user: User | null
  fields?: IDFields | null
  client?: Partial<Client> | null
  scannedPersons?: ScannedPerson[]
  onToast: (msg: string, type: ToastItem['type']) => void
  onBack: () => void
  onClientSaved?: (client: Client) => void
  // Numărul afișat în badge — nu e mereu "3": fluxul "client din portofoliu"
  // comasează selecția+verificarea pe un singur ecran, deci acesta e pasul 2.
  stepNumber?: number
}


const builtinCheckablePlaceholders = (b: BuiltinTemplate): string[] => b.placeholders

const builtinKey = (b: BuiltinTemplate) => `builtin:${b.key}`

// Singurul șablon de bază cu formular dedicat (declarant/CAEN/sedii, cu
// parsare de adresă) în loc de placeholdere generice — analog cazului special
// al act_constitutivMode, dar identificat după cheie, nu după `type`, ca un
// eventual alt șablon docx viitor să nu fie tras din greșeală pe acest formular.

export default function TemplateFiller({
  workspaceId, user, fields, client, scannedPersons,
  onToast, onBack, onClientSaved, stepNumber = 3,
}: Props) {
  const { templates, loading: tplLoading, add: addTemplate, remove: removeTemplate } = useTemplates(workspaceId)
  const { activeWorkspace } = useApp()
  const { builtins: allBuiltins } = useBuiltinTemplates()
  // La generare apar doar șabloanele de bază pe care adminul cabinetului nu le-a ascuns (biblioteca le arată pe toate).
  const hiddenBuiltins = activeWorkspace?.hiddenBuiltins
  // Ordinea stabilită de admin în biblioteca de șabloane (Workspace.templateOrder).
  const templateOrder = activeWorkspace?.templateOrder
  const builtins = useMemo(
    () => applyTemplateOrder(visibleBuiltins(allBuiltins, hiddenBuiltins), b => builtinOrderKey(b.key), templateOrder),
    [allBuiltins, hiddenBuiltins, templateOrder])
  const { update: updateClient } = useClienti(workspaceId)

  const [clauseState, setClauseState] = useState<Record<string, ClauseSelectorValue>>({})
  // Formularele dedicate: rezultatul fiecăruia, pe șablon (cheie = id-ul din listă), și handle-ul celui randat acum.
  const [dedicatedForms, setDedicatedForms] = useState<Record<string, DedicatedFormValue & { forClient?: string }>>({})
  const dedicatedRefs = useRef<Record<string, { scrollToFirstMissing: () => string[] } | null>>({})
  const [pendingClientPatches, setPendingClientPatches] = useState<(ClientPatchProposal & { key: string })[] | null>(null)
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
  const driveTarget = (): DriveTarget | null => destRef.current.drive ? { token: getDriveToken(), folderId: destRef.current.folderId } : null
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
  const closeDestDialog = async (ok: boolean) => {
    if (ok && destChoice === 'drive') {
      // Conectarea la Drive se face acum, din click, nu după ce documentul a fost deja generat.
      try {
        await ensureDriveToken()
      } catch (err) {
        onToast((err as Error).message, 'err')
        return
      }
    }
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
  // Cabinet pe credite fără credite pentru firma aleasă (sau fără client salvat): butoanele de generare sunt oprite.
  const [creditBlock, setCreditBlock] = useState<string | null>(null)
  const [expandedReadiness, setExpandedReadiness] = useState<Set<string>>(new Set())
  const [pendingGenerate, setPendingGenerate] = useState<{
    tpl: DocTemplate | BuiltinTemplate
    missing: string[]
    isBatch?: boolean
    batchTargets?: DocTemplate[]
    isBuiltin?: boolean
  } | null>(null)
  // Înființare/Actualizare — pentru orice șablon cu bloc {{#ACTUALIZARE}} (vezi actualizareGroups), o singură
  // alegere per client, implicit după CUI (vezi defaultActMode).
  const actModeImplicit = defaultActMode(client)
  const [actMode, setActMode] = useState<ActMode>(actModeImplicit)
  // La schimbarea clientului (sau a bifei lui), modul revine la cel implicit — ajustat în render, nu într-un efect.
  const actModeKey = `${client?.id ?? ''}:${actModeImplicit}`
  const [actModeFor, setActModeFor] = useState(actModeKey)
  if (actModeFor !== actModeKey) {
    setActModeFor(actModeKey)
    setActMode(actModeImplicit)
  }

  // Firmă în înființare: CUI-ul / J-ul lipsă ies în document ca loc de completat de mână — spunem asta explicit.
  const lipsaInregistrare = client ? missingRegistrationFields(client) : []
  const renderInfiintareNote = (placeholders?: string[]) =>
    lipsaInregistrare.length > 0 && (placeholders ?? []).some(p => p === '{{SOCIETATE_CIF}}' || p === '{{SOCIETATE_NR_REG}}')
      ? <div style={WARN_BOX}>ℹ️ Firma e în curs de înființare: {lipsaInregistrare.join(' și ')} vor rămâne în document ca loc de completat de mână.</div>
      : null

  const listTemplates = useMemo(() => applyTemplateOrder(templates, t => ownOrderKey(t.id), templateOrder), [templates, templateOrder])
  // Diferențiere PF/PJ — un client PJ nu ar trebui să poată genera un șablon
  // gândit strict pentru PF (și invers). "universal"/lipsă = se aplică oricui.
  const clientTip = client ? inferTipClient(client as Client) : null
  const tipMismatchMsg = (tipTemplate: string | undefined, tplLabel: string): string | null => {
    if (!tipTemplate || tipTemplate === 'universal' || !clientTip) return null
    if (tipTemplate === clientTip) return null
    return `${tplLabel} e valabil doar pentru ${tipTemplate}, dar clientul selectat este ${clientTip}`
  }
  // Șabloanele celuilalt tip (PF/PJ) nu apar deloc în listă; fără client (tip necunoscut) apar toate.
  const tipOk = (t: { tipTemplate?: string; name: string }) => !tipMismatchMsg(t.tipTemplate, t.name)
  const ascunseTip = builtins.filter(b => !tipOk(b)).length + listTemplates.filter(t => !tipOk(t)).length

  // Căutarea filtrează doar ce se afișează în listă: selecția și generarea în lot rămân neschimbate.
  const [tplSearch, setTplSearch] = useState('')
  const shownBuiltins = builtins.filter(b => tipOk(b) && matchesTemplateSearch(b.name, tplSearch))
  const shownTemplates = listTemplates.filter(t => tipOk(t) && matchesTemplateSearch(t.name, tplSearch))

  const replacements = buildReplacements({ idFields: fields, client, scannedPersons })
  const repeatGroups = buildRepeatGroups({ idFields: fields, client, scannedPersons })
  const hasScannedPersonsNoClient = (scannedPersons ?? []).length > 0 && !client?.id
  // Asociați existenți (client.asociati) sau doar scanați, nesalvați încă —
  // aceeași listă folosită deja la umplerea {{#ASOCIATI}}.
  const asociatiCount = repeatGroups.ASOCIATI?.length ?? 0
  // Câmpuri completate manual la generare ({{CAMP_…}}): valori per șablon, peste cele calculate din client.
  const [manualValues, setManualValues] = useState<Record<string, Record<string, string>>>({})
  // Persoane pentru roluri „noi", în afara Asociat/Administrator (comodant, reprezentant legal…) — alese
  // dintre asociații/administratorii firmei curente sau introduse manual (vezi CustomPersonField); per
  // șablon, apoi per „ROL_N" (poziția). Nu se salvează la fișa clientului — doar pentru acest document.
  const [customPersonPicks, setCustomPersonPicks] = useState<Record<string, Record<string, Persoana>>>({})
  const existingPersonsForCustomRoles = [...(client?.asociati ?? []), ...(client?.administratori ?? [])]
  // Un rol „REPREZENTANT_X” (vezi isReprezentantRole) e cine reprezintă o entitate — legal, administratorul
  // firmei — lista de ales se restrânge la administratori, nu toată lista de persoane cunoscute (cerință
  // utilizator: „ar trebui să fie picker între administrator”, nu orice persoană/asociat al firmei).
  // Un rol „…_ASOCIAT” se alege doar dintre asociați, „…_ADMINISTRATOR” doar dintre administratori (vezi customRolePool).
  const existingForCustomRole = (role: string): Persoana[] => {
    const pool = customRolePool(role)
    return pool === 'administratori' ? (client?.administratori ?? [])
      : pool === 'asociati' ? (client?.asociati ?? []) : existingPersonsForCustomRoles
  }
  const customPersonReplacementsFor = (id: string): Record<string, string> => {
    const picks = customPersonPicks[id]
    if (!picks) return {}
    const out: Record<string, string> = {}
    for (const [key, p] of Object.entries(picks)) {
      const m = key.match(/^(.+)_(\d+)$/)
      if (m) Object.assign(out, customPersonReplacements(m[1], Number(m[2]), p))
    }
    return out
  }
  // Persoane pentru roluri „noi" scrise fie ca bloc REPETITIV în șablon ({{#COMODANTI}}…), fie ca simplu câmp
  // „…LISTA" (nume îmbinate pe-o linie) — câte vrea utilizatorul, nu o singură poziție fixă ca mai sus (vezi
  // CustomPersonGroupField/detectCustomPersonGroups). Per șablon, apoi per ROL (nu per tag — același rol poate
  // avea un tag repetitiv ȘI unul „…LISTA”, dar o SINGURĂ listă de persoane aleasă, pentru amândouă). Nu se
  // salvează la fișa clientului — doar pentru acest document.
  const [customGroupPicks, setCustomGroupPicks] = useState<Record<string, Record<string, Persoana[]>>>({})
  // Cesiunea de părți sociale (CEDENT_1 → CESIONAR_1), per șablon: doar numărul de părți se introduce, restul se calculează
  // (vezi lib/cesiune.ts); `dinFisa` — calculul din fișa actuală, deși ea a fost deja actualizată după această cesiune.
  const [cesiuneState, setCesiuneState] = useState<Record<string, { parti: string; dinFisa: boolean }>>({})
  // Câmpurile de tip listă alese din bife („operațiunea”, „lista actelor” — vezi lib/listeBife), per șablon și fel
  const [listeState, setListeState] = useState<Record<string, Partial<Record<FelLista, string[]>>>>({})
  // Persoanele alese țin de firma curentă (ex. administratorul care semnează anexa) — la alt client se aleg din nou
  const [picksForClient, setPicksForClient] = useState(client?.id)
  if (picksForClient !== client?.id) {
    setPicksForClient(client?.id)
    setCustomPersonPicks({})
    setCustomGroupPicks({})
    setCesiuneState({})
    setListeState({})
  }
  // Actele generate pentru client în ultimele 30 de zile: bifate implicit în „lista actelor”
  const [acteRecente, setActeRecente] = useState<{ clientId: string; nume: string[] } | null>(null)
  useEffect(() => {
    if (!workspaceId || !client?.id) return
    let cancelled = false
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    listRecentGenerations(workspaceId, client.id, since)
      .then(gens => { if (!cancelled) setActeRecente({ clientId: client.id!, nume: gens.map(g => g.templateName) }) })
      .catch(() => { /* fără bife implicite */ })
    return () => { cancelled = true }
  }, [workspaceId, client?.id])
  const asociatUnic = (client?.asociati?.length ?? 0) === 1
  const optiuniActe = (id: string) => listaActe([
    ...builtins.filter(b => builtinKey(b) !== id).map(b => b.name),
    ...templates.filter(t => t.id !== id).map(t => t.name),
  ], asociatUnic, activeWorkspace?.name)
  const listaFor = (id: string, fel: FelLista) => {
    const optiuni = fel === 'operatiune' ? OPERATIUNI : optiuniActe(id)
    const recente = acteRecente?.clientId === client?.id ? (acteRecente?.nume ?? []) : []
    const implicite = fel === 'acte'
      ? optiuni.filter(o => recente.some(n => denumireAct(n, asociatUnic, activeWorkspace?.name) === o))
      : []
    const alese = listeState[id]?.[fel] ?? implicite
    return { optiuni, alese, text: textLista(optiuni, alese) }
  }
  const listeValuesFor = (id: string): Record<string, string> => {
    const op = listaFor(id, 'operatiune').text, acte = listaFor(id, 'acte').text
    return { '{{CAMP_OPERATIUNE}}': op, '{{CAMP_OPERATIUNI}}': op, '{{CAMP_LISTA_ACTELOR}}': acte, '{{CAMP_LISTA_ACTE}}': acte }
  }
  type TplWithRoles = { id: string; repeatGroups?: string[]; repeatGroupFields?: Record<string, string[]>; placeholders?: string[] }
  // Un BuiltinTemplate n-are `id` (identificat prin `key`, vezi builtinKey) — formă minimă pentru
  // customGroupsFor/customListReplacementsFor/readinessPct, reconstruită altfel la fiecare apel.
  const builtinTplRef = (b: BuiltinTemplate): TplWithRoles =>
    ({ id: builtinKey(b), repeatGroups: b.repeatGroups, repeatGroupFields: b.repeatGroupFields, placeholders: b.placeholders })
  // SEX/SEX_REF — la fel ca ASOCIATI/ADMINISTRATORI (buildRepeatGroups), pentru variantele „numit/ă" etc. din
  // clauza fiecărei persoane (vezi variants.py) — SEX_REF diferă per element, ca fiecare persoană din listă
  // să-și primească propriul sex, nu pe-al primeia din listă.
  const customGroupsFor = (tpl: TplWithRoles): Record<string, Record<string, string>[]> => {
    const out: Record<string, Record<string, string>[]> = actualizareGroups(tpl.repeatGroups, actMode)
    const picks = customGroupPicks[tpl.id]
    if (!picks) return out
    for (const { role, repeatTag } of detectCustomPersonGroups(tpl.repeatGroups ?? [], tpl.placeholders ?? [], tpl.repeatGroupFields)) {
      const persons = picks[role]
      if (!repeatTag || !persons) continue
      out[repeatTag] = persons.map((p, i) => ({ ...persoanaToSingularMap(p), SEX: personSex(p) ?? '', SEX_REF: `${role}_${i + 1}` }))
    }
    return out
  }
  // Partea „…LISTA" — un placeholder SIMPLU (nu bloc repetitiv), completat direct cu numele îmbinate
  // (joinNames), la fel ca ASOCIATI_LISTA/ADMINISTRATORI_LISTA deja completate automat din client.
  const customListReplacementsFor = (tpl: TplWithRoles): Record<string, string> => {
    const picks = customGroupPicks[tpl.id]
    if (!picks) return {}
    const out: Record<string, string> = {}
    for (const { role, listTag } of detectCustomPersonGroups(tpl.repeatGroups ?? [], tpl.placeholders ?? [], tpl.repeatGroupFields)) {
      const persons = picks[role]
      if (!listTag || !persons) continue
      out[`{{${listTag}}}`] = joinNames(persons)
    }
    return out
  }
  const cesiuneFor = (id: string) => {
    const cedent = customPersonPicks[id]?.CEDENT_1 ?? null
    const cesionar = customPersonPicks[id]?.CESIONAR_1 ?? null
    const st = cesiuneState[id] ?? { parti: '', dinFisa: false }
    const parti = Number(st.parti) || 0
    const nota = notaAplicata(client, cedent, parti)
    const calc = calculCesiune(client, cedent, cesionar, parti, nota && !st.dinFisa ? nota.inainte : undefined)
    return { cedent, cesionar, st, parti, nota, calc }
  }
  const repl = (id: string) => ({ ...replacements, ...(manualValues[id] ?? {}), ...listeValuesFor(id), ...customPersonReplacementsFor(id), ...cesiuneFor(id).calc.values })
  const renderCesiunePanel = (id: string) => {
    const { cedent, cesionar, st, nota, calc } = cesiuneFor(id)
    const set = (patch: Partial<{ parti: string; dinFisa: boolean }>) => setCesiuneState(prev => ({ ...prev, [id]: { ...st, ...patch } }))
    return <CesiunePanel cedent={cedent} cesionar={cesionar} parti={st.parti} onParti={v => set({ parti: v })} calc={calc}
      nota={nota} dinFisa={st.dinFisa} onDinFisa={v => set({ dinFisa: v })} />
  }
  // Actualizarea fișei după cesiune — doar dacă nu a fost deja aplicată (nota din fișă), ca să nu se aplice de două ori.
  const cesiuneProposalFor = (tpl: DocTemplate, selectedClauses?: string[]): ClientPatchProposal[] => {
    if (!hasCesiune(tpl.placeholders)) return []
    if (tpl.clauses?.length && !tpl.clauses.some(c => selectedClauses?.includes(c.tag) && hasCesiune(c.placeholders))) return []
    const { cedent, cesionar, parti, nota, calc } = cesiuneFor(tpl.id)
    if (!cedent || !cesionar || nota || calc.error || !(parti > 0)) return []
    return [propunereCesiune(cedent, cesionar, parti, calc.totalParti)]
  }
  // Etichetele cerute pentru alegerile curente — ex. modul de exercitare a mandatelor doar de la 2 reprezentanți legali
  // și câmpurile din blocul {{#ACTUALIZARE}} (numărul/data hotărârii) doar la actualizare
  const groupFieldsOf = (id: string) => (listTemplates.find(t => t.id === id) ?? builtins.find(b => builtinKey(b) === id))?.repeatGroupFields
  const shownPh = (id: string, phs: string[] = []) =>
    withoutActualizareFields(visibleManualPlaceholders(phs, customGroupPicks[id]), groupFieldsOf(id), actMode)
  // La înființare, un șablon cu toate clauzele în blocul {{#ACTUALIZARE}} se tratează ca unul fără clauze (vezi activeClauses).
  const hasActiveClauses = (tpl: DocTemplate) => activeClauses(tpl.clauses, tpl.repeatGroupFields, actMode).length > 0
  const renderActModeToggle = (repeatGroups?: string[]) => repeatGroups?.includes(ACTUALIZARE_GROUP) && (
    <div style={{ display: 'flex', gap: '.375rem' }}>
      <button
        type="button"
        className={`btn btn-sm ${actMode === 'infiintare' ? 'btn-primary' : 'btn-outline-primary'}`}
        onClick={() => setActMode('infiintare')}
      >
        🆕 Înființare
      </button>
      <button
        type="button"
        className={`btn btn-sm ${actMode === 'actualizare' ? 'btn-primary' : 'btn-outline-primary'}`}
        onClick={() => setActMode('actualizare')}
      >
        🔄 Actualizare
      </button>
    </div>
  )

  // Variantele „a/b” din document (sex, număr, categorie) le alege serverul; aici pregătim contextul din valorile finale.
  // `customGroups` (persoanele alese pentru un rol custom, ex. COMODANT) e opțional — doar șabloanele cu
  // asemenea roluri au nevoie de el (vezi VariantContext/buildVariantContext).
  const variantsFor = (finalReplacements: Record<string, string>, customGroups?: Record<string, Persoana[]>) =>
    buildVariantContext({ client, scannedPersons, idFields: fields, replacements: finalReplacements, customGroups })
  // Avertismentul rămâne pe ecran până e închis (nu dispare ca o notificare): documentul conține variante nealese.
  const [variantNotices, setVariantNotices] = useState<string[]>([])
  const notifyVariants = (warnings: string[] | undefined, labels: Record<string, string>) => {
    const msg = variantWarningMessage(warnings, labels)
    if (msg) setVariantNotices(prev => prev.includes(msg) ? prev : [...prev, msg])
  }

  // În lot intră doar ce se aplică clientului curent (o bifă rămasă de la alt client nu mai contează).
  const selectedTemplates = listTemplates.filter(t => selectedIds.has(t.id) && tipOk(t) && !asociatiCountMismatch(t.sourceKey, asociatiCount))

  // Șablon cu număr de asociați nepotrivit: nu se poate deschide; un click explică de ce.
  const notApplicable = (name: string, reason: string) =>
    onToast(`„${name}” nu se aplică clientului selectat: ${reason}.`, 'info')

  // Implicit — primul șablon compatibil cu tipul clientului (dacă există),
  // altfel primul disponibil — ca panoul din dreapta să nu rămână gol la
  // intrarea în pas; derivat la randare (nu stocat separat), ca selecția
  // explicită a userului să rămână prioritară.
  const defaultActiveKey = (() => {
    const b = builtins.find(x => tipOk(x) && (x.key === DECLARATIE_ACTIVITATE_KEY || !asociatiCountMismatch(x.key, asociatiCount)))
      ?? builtins.find(tipOk)
    if (b) return builtinKey(b)
    const compatible = listTemplates.find(t => tipOk(t) && !asociatiCountMismatch(t.sourceKey, asociatiCount))
      ?? listTemplates.find(tipOk)
    return compatible?.id ?? null
  })()
  // Un șablon de bază ascuns între timp de admin, sau unul pentru celălalt tip de client (ales înainte de schimbarea
  // clientului), nu mai rămâne activ: se trece la cel implicit.
  const activeKeyVisible = activeKey && (activeKey.startsWith('builtin:')
    ? builtins.some(b => builtinKey(b) === activeKey && tipOk(b))
    : !listTemplates.some(t => t.id === activeKey && !tipOk(t))) ? activeKey : null
  const effectiveActiveKey = activeKeyVisible ?? defaultActiveKey

  // Pe telefon lista și formularul nu încap unul lângă altul: întâi lista, iar șablonul atins se deschide
  // pe toată lățimea, cu „Înapoi” (și gestul telefonului) spre listă.
  const isMobile = useIsMobile()
  const mobileDetail = isMobile && !!activeKeyVisible
  const mobileBack = useMobileBack(!!activeKeyVisible, () => setActiveKey(null))
  useEffect(() => {
    if (mobileDetail) layoutRef.current?.scrollIntoView({ block: 'start' })
  }, [mobileDetail, activeKeyVisible])

  // Revizia fișierului văzută când s-a deschis formularul: dacă cineva înlocuiește fișierul între timp, documentul
  // s-ar genera din fișierul nou cu un formular început pe cel vechi — utilizatorul e avertizat.
  const [seenRevisions, setSeenRevisions] = useState<Record<string, number>>({})
  const activeTemplate = templates.find(t => t.id === effectiveActiveKey)
  useEffect(() => {
    if (!activeTemplate || seenRevisions[activeTemplate.id] !== undefined) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeenRevisions(prev => ({ ...prev, [activeTemplate.id]: activeTemplate.revision ?? 0 }))
  }, [activeTemplate, seenRevisions])

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

  // Folderele stabilite de admin în biblioteca de șabloane (Workspace.templateFolders); la căutare, doar cele cu rezultate.
  const ownGroups = groupByFolder(shownTemplates, t => ownOrderKey(t.id), activeWorkspace?.templateFolders, activeWorkspace?.templateFolderOf)
    .filter(g => g.items.length > 0)
  // Folderele închise se țin minte pe acest calculator, per cabinet (o comoditate — fără ele, toate sunt deschise).
  const closedKey = `tf-closed-folders:${workspaceId}`
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(closedKey) ?? '[]') as string[]) } catch { return new Set() }
  })
  const toggleFolder = (id: string) => setClosedFolders(prev => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    try { localStorage.setItem(closedKey, JSON.stringify([...next])) } catch { /* stocare indisponibilă: rămâne doar în pagină */ }
    return next
  })
  const selectableIds = new Set(selectableTemplates.map(t => t.id))
  const setFolderSelected = (ids: string[], on: boolean) => setSelectedIds(prev => {
    const next = new Set(prev); ids.forEach(id => on ? next.add(id) : next.delete(id)); return next
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

  // Formularul dedicat al unui șablon: cheia lui (vezi dedicatedFormKey) sau null. Șabloanele de bază după cheie,
  // copiile din bibliotecă după `sourceKey` (sau declarația, după etichete).
  const dedicatedKindOf = (tpl: DocTemplate): string | null => tpl.type === 'docx' ? dedicatedFormKey(tpl) : null
  const builtinDedicatedKind = (b: BuiltinTemplate): string | null => isDedicatedKey(b.key) ? b.key : null
  const dedicatedFor = (id: string) => {
    const st = dedicatedForms[id]
    return st && st.forClient === client?.id ? st : undefined
  }

  const handleGenerateDocx = async (tpl: DocTemplate) => {
    // Formular dedicat (copie din bibliotecă, sau declarația recunoscută după etichete): el completează documentul.
    const dedicatedKey = dedicatedKindOf(tpl)
    const form = dedicatedKey ? dedicatedFor(tpl.id) : undefined
    if (dedicatedKey) {
      const missing = dedicatedRefs.current[tpl.id]?.scrollToFirstMissing() ?? []
      if (missing.length > 0) { onToast(`Completează: ${missing.join(', ')}.`, 'err'); return }
      if (!form) return
    }
    if (!(await askDestination())) return
    setLoading(tpl.id, true)
    try {
      const outputName = resolveOutputName(tpl)
      const cs = hasActiveClauses(tpl) ? clauseState[tpl.id] : undefined
      let mergedReplacements = withDenumireActualizata({ ...repl(tpl.id), ...customListReplacementsFor(tpl), ...(cs?.extraReplacements ?? {}) })
      const mergedGroups = { ...repeatGroups, ...customGroupsFor(tpl), ...(cs?.extraGroups ?? {}), ...(form?.groups ?? {}) }
      let rowGroups: Record<string, Record<string, string>[]> | undefined
      if (form?.rowGroups) {
        // Declarația: câmpurile necompletate apar ca „-”, iar tabelele au lungime variabilă.
        rowGroups = form.rowGroups
        mergedReplacements = withEmptyFieldMarks(tpl.placeholders ?? [], { ...replacements, ...form.replacements }, form.rowGroups)
      } else if (form) {
        mergedReplacements = { ...replacements, ...form.replacements }
      } else {
        mergedReplacements = withOptionalFieldMarks(tpl.placeholders ?? [], mergedReplacements, mergedGroups)
      }
      let result: { blob?: Blob; name?: string; link?: string; warnings?: string[] }
      const { ctx: variantCtx, labels: variantLabels } = variantsFor(mergedReplacements, customGroupPicks[tpl.id])

      if (tpl.driveFileId) {
        result = await fillDocxFromDriveTemplate(tpl.driveFileId, mergedReplacements, await ensureDriveToken(), driveTarget(), outputName, mergedGroups, cs?.selectedClauses, rowGroups, variantCtx)
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
        onToast(`Se descarcă: ${outputName}`, 'ok')
        await _logGeneration(tpl, outputName)
        maybePromptSaveClient()
      }
      offerClientPatches(cs, cesiuneProposalFor(tpl, cs?.selectedClauses))
      if (form?.clientPatches) offerClientPatchList(form.clientPatches)
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
      const mergedReplacements = withDenumireActualizata({ ...repl(key), ...customListReplacementsFor(builtinTplRef(b)), ...(cs?.extraReplacements ?? {}) })
      const mergedGroups = { ...repeatGroups, ...customGroupsFor(builtinTplRef(b)), ...(cs?.extraGroups ?? {}) }

      const marked = withOptionalFieldMarks(b.placeholders ?? [], mergedReplacements, mergedGroups)
      const { ctx: variantCtx, labels: variantLabels } = variantsFor(marked, customGroupPicks[key])
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
        onToast(`Se descarcă: ${outputName}`, 'ok')
        maybePromptSaveClient()
      }
      offerClientPatches(cs)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Generare eșuată', 'err')
    } finally {
      setLoading(key, false)
    }
  }

  // Șabloanele de bază cu formular dedicat (declarație, Anexa 1, BRX, Anexa 2a/2b): formularul asamblează direct
  // etichetele proprii; {{SOCIETATE_*}}/{{DATA_AZI}} etc. vin din `replacements`, comune tuturor șabloanelor.
  const handleGenerateDedicated = async (b: BuiltinTemplate) => {
    const key = builtinKey(b)
    const form = dedicatedFor(key)
    // Butonul rămâne mereu activ — la click sărim la primul câmp lipsă în loc să-l ținem disabled.
    const missing = dedicatedRefs.current[key]?.scrollToFirstMissing() ?? []
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

      // Declarația (singura cu tabele de lungime variabilă, `rowGroups`): câmpurile necompletate (bloc, scară,
      // telefon...) apar ca „-”, nu ca etichetă brută. Celelalte formulare completează deja fiecare etichetă.
      const mergedReplacements = form.rowGroups
        ? withEmptyFieldMarks(b.placeholders ?? [], { ...replacements, ...form.replacements }, form.rowGroups)
        : { ...replacements, ...form.replacements }
      const variants = form.rowGroups ? variantsFor(mergedReplacements) : undefined
      const result = await fillDocxFromBuiltinTemplate(b.key, mergedReplacements, driveTarget(), outputName, form.groups, undefined, form.rowGroups, variants?.ctx)
      if (variants) notifyVariants(result.warnings, variants.labels)
      if (result.link) {
        setGeneratedLinks(prev => ({ ...prev, [key]: result.link! }))
        onToast(`Salvat pe Drive: ${result.name}`, 'ok')
      } else if (result.blob) {
        const url = URL.createObjectURL(result.blob)
        const a = document.createElement('a'); a.href = url; a.download = outputName; a.click()
        URL.revokeObjectURL(url)
        onToast(`Se descarcă: ${outputName}`, 'ok')
      }
      maybePromptSaveClient()
      if (form.clientPatches) offerClientPatchList(form.clientPatches)
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Generare eșuată', 'err')
    } finally {
      setLoading(key, false)
    }
  }

  // După o generare reușită, propune (nu aplică direct) actualizarea
  // profilului clientului cu tot ce a colectat ClauseSelector din clauzele
  // bifate — userul alege ce anume se scrie în Firestore.
  const offerClientPatches = (cs: ClauseSelectorValue | undefined, extra: ClientPatchProposal[] = []) => {
    if (!client?.id || (!cs && extra.length === 0)) return
    const proposals = [...Object.entries(cs?.clientPatches ?? {}).map(([key, p]) => ({ key, ...p })),
      ...extra.map((p, i) => ({ key: `extra-${i}`, ...p }))]
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
      if (checkedPatchKeys.has(p.key)) Object.assign(merged, p.update ? p.update({ ...client, ...merged }) : p.patch)
    }
    try {
      // Denumirea e unică în cabinet (ca la formularul clientului): o denumire nouă deja folosită nu se aplică
      if (merged.denumire && await denumireExists(workspaceId, merged.denumire, client.id)) {
        onToast(`Există deja un client cu denumirea „${merged.denumire}” — denumirea nu s-a schimbat.`, 'err')
        delete merged.denumire
      }
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
    // Google Docs se completează direct din browser (nu trece prin API): cabinetul în citire e oprit aici.
    try { assertWritable() } catch { return }
    setLoading(tpl.id, true)
    try {
      const outputName = tpl.outputNameTemplate || tpl.name
      const result = await fillGdoc(tpl.docId, withOptionalFieldMarks(tpl.placeholders ?? [], replacements), await ensureDriveToken(), outputName)
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
    if (hasActiveClauses(tpl) || dedicatedKindOf(tpl)) { handleGenerateDocx(tpl); return }

    const { missing } = checkReadiness(shownPh(tpl.id, tpl.placeholders), { ...repl(tpl.id), ...customListReplacementsFor(tpl) }, { ...repeatGroups, ...customGroupsFor(tpl) }, tpl.repeatGroupFields)
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
    const key = builtinKey(b)
    const { missing } = checkReadiness(shownPh(key, builtinCheckablePlaceholders(b)), { ...repl(key), ...customListReplacementsFor(builtinTplRef(b)) }, { ...repeatGroups, ...customGroupsFor(builtinTplRef(b)) }, b.repeatGroupFields)
    if (missing.length > 0) {
      setPendingGenerate({ tpl: b, missing, isBuiltin: true })
    } else {
      handleGenerateBuiltinDocx(b)
    }
  }

  const tryBatchGenerate = () => {
    const targets = selectedTemplates
    const allMissing = targets.flatMap(t => checkReadiness(shownPh(t.id, t.placeholders), { ...repl(t.id), ...customListReplacementsFor(t) }, { ...repeatGroups, ...customGroupsFor(t) }, t.repeatGroupFields).missing)
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
    const base = { id: '', createdAt: null, createdBy: user?.uid ?? '', denumireLower: (client?.denumire ?? '').toLowerCase() }
    // Fișa completată deja la pasul anterior (entitate nouă PF/PJ) se salvează exact cum e: refăcută din scanări,
    // și-ar pierde corecturile la persoane, iar titularul unui PF ar ajunge și printre asociați.
    if (client) return { ...base, ...EMPTY_CLIENT, ...client, id: '' } as Client
    const asociati =(scannedPersons ?? []).filter(p => p.role === 'asociat').map(p => ({
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
    return { ...base, ...EMPTY_CLIENT, asociati, administratori: admini } as Client
  }

  const toggleReadiness = (id: string) =>
    setExpandedReadiness(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  // Procentul de completare pentru afișarea pe rândul compact din listă —
  // aceeași sursă de adevăr ca renderReadiness, doar rezumată la un număr. `tpl` (opțional) aduce
  // repeatGroups/placeholders proprii, pentru rolurile „noi" alese ca listă (vezi customGroupsFor/
  // customListReplacementsFor) — fără el, procentul rămâne sub 100% chiar și cu totul completat (bug real,
  // raportat de utilizator: un rol „listă" complet ales tot apărea ca „necompletat").
  const readinessPct = (placeholders?: string[], id?: string, tpl?: TplWithRoles): number | null => {
    if (!placeholders || placeholders.length === 0) return null
    const extraRepl = tpl ? customListReplacementsFor(tpl) : {}
    const extraGroups = tpl ? customGroupsFor(tpl) : {}
    const phs = id ? shownPh(id, placeholders) : placeholders
    const { filled } = checkReadiness(phs, { ...(id ? repl(id) : replacements), ...extraRepl }, { ...repeatGroups, ...extraGroups }, tpl?.repeatGroupFields)
    return Math.round((filled.length / phs.length) * 100)
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

  // Formularele dedicate: procentul vine din formular (câmpurile obligatorii), nu din etichetele șablonului — toate
  // completate automat de formular, deci n-ar reflecta nimic real. Apare după prima deschidere a șablonului pentru
  // clientul curent; starea unui client anterior nu se afișează.
  const dedicatedPct = (id: string): number | null => {
    const c = dedicatedFor(id)?.completion
    return c && c.total > 0 ? Math.round((c.done / c.total) * 100) : null
  }
  const renderDedicatedProgress = (id: string) => {
    const c = dedicatedFor(id)?.completion
    return c ? renderProgressBar(id, c, 'De completat înainte de generare') : null
  }
  /** Formularul dedicat al șablonului `id` (cheia formularului = `kind`); `mountKey` îl reface la schimbarea clientului. */
  const renderDedicatedForm = (kind: string, id: string, mountKey: string) => {
    const ref = (h: { scrollToFirstMissing: () => string[] } | null) => { dedicatedRefs.current[id] = h }
    const onChange = (v: DedicatedFormValue) => setDedicatedForms(prev => ({ ...prev, [id]: { ...v, forClient: client?.id } }))
    const initial = dedicatedFor(id)?.state
    switch (kind) {
      case DECLARATIE_ACTIVITATE_KEY: return <DeclaratieActivitateFiller key={mountKey} ref={ref} client={client} onChange={onChange} />
      case ANEXA1_KEY: return <Anexa1Filler key={mountKey} ref={ref} client={client} onChange={onChange} />
      case BRX_KEY: return <BeneficiariRealiFiller key={mountKey} ref={ref} client={client} onChange={onChange} />
      case ANEXA2A_KEY: return <Anexa2aFiller key={mountKey} ref={ref} client={client} onChange={onChange} initial={initial as Anexa2aFormState | undefined} />
      case ANEXA2B_KEY: return <Anexa2bFiller key={mountKey} ref={ref} client={client} onChange={onChange} initial={initial as Anexa2bFormState | undefined} />
      default: return null
    }
  }

  // Șabloane cu clauze (Decizia Asociatului Unic, Hotărâre AGA și copiile lor): completarea = datele din afara clauzelor
  // (din client) + „cel puțin o clauză bifată” + câmpurile clauzelor bifate. Fără nicio clauză bifată încă, procentul
  // arată doar ce e deja completat din client.
  const clauseCompletion = (id: string, placeholders: string[] | undefined, clauses: ClauseMeta[], groupFields?: Record<string, string[]>) => {
    const clausePh = new Set(clauses.flatMap(c => c.placeholders))
    const base = shownPh(id, (placeholders ?? []).filter(ph => !clausePh.has(ph) && ph !== '{{ART_NR}}'))
    // repl(id): cu persoanele alese pentru rolurile „noi" (ex. administratorul care semnează anexa)
    const { filled, missing } = checkReadiness(base, repl(id), repeatGroups, groupFields)
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
  const clausePct = (id: string, placeholders: string[] | undefined, clauses: ClauseMeta[], groupFields?: Record<string, string[]>): number | null => {
    const c = clauseCompletion(id, placeholders, clauses, groupFields)
    return c.total > 0 ? Math.round((c.done / c.total) * 100) : null
  }

  // Alegerea persoanelor pentru rolurile „noi" cu poziții fixe ({{ROL_N_CÂMP}}) — în renderReadiness și, la
  // șabloanele cu clauze (care n-au renderReadiness), deasupra listei de clauze: ex. administratorul care semnează
  // anexa unei hotărâri ({{REPREZENTANT_SOCIETATE_1_…}}).
  const renderCustomPersonFields = (tplId: string, customRoles: { role: string; positions: number[] }[]) => customRoles.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem', border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', marginBottom: '.375rem' }}>
      <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Persoane</div>
      {renderCustomPersonInputs(tplId, customRoles)}
    </div>
  )
  // Doar listele de alegere — și în interiorul unei clauze, pentru persoanele folosite numai acolo (alegerea e una
  // singură per șablon: aceeași persoană în două clauze bifate se schimbă în amândouă).
  const renderCustomPersonInputs = (tplId: string, customRoles: { role: string; positions: number[] }[]) => (
    <>
      {customRoles.flatMap(({ role, positions }) => positions.map(position => (
        <CustomPersonField
          key={`${role}_${position}`}
          role={role} position={position} showPosition={positions.length > 1}
          existing={existingForCustomRole(role)}
          value={customPersonPicks[tplId]?.[`${role}_${position}`] ?? null}
          onChange={p => setCustomPersonPicks(prev => ({
            ...prev, [tplId]: { ...prev[tplId], [`${role}_${position}`]: p },
          }))}
        />
      )))}
    </>
  )

  // Câmpurile completate manual ({{CAMP_…}}) și persoanele cu rol propriu (poziții fixe sau listă) — la șabloanele fără
  // clauze (renderReadiness) și deasupra clauzelor, la cele cu clauze.
  const renderTemplateInputs = (
    tpl: { id: string },
    manualFields: string[],
    customRoles: { role: string; positions: number[] }[],
    customGroups: { role: string }[],
  ) => {
    const manualValue = (ph: string) => manualValues[tpl.id]?.[ph] ?? ''
    // Câmpurile calculate din altele (litere, data de sfârșit — vezi lib/campuriCalculate) se recalculează la fiecare schimbare
    const calculate = campuriCalculate(manualFields)
    const setManualValue = (ph: string, v: string) => setManualValues(prev => {
      const cur = { ...prev[tpl.id], [ph]: v, ...completariAutoturism(manualFields, ph, v) }
      return { ...prev, [tpl.id]: { ...cur, ...valoriCalculate(manualFields, cur) } }
    })
    const auto = campuriAutoturism(manualFields)
    const renderManualField = (ph: string, style?: CSSProperties, spec?: CampAuto) => {
      const label = spec?.label ?? manualLabel(ph)
      const inputId = `manual-${tpl.id}-${ph}`
      if (isDateLabel(label)) {
        return <DateFieldInput key={ph} id={inputId} label={label} value={manualValue(ph)} onChange={v => setManualValue(ph, v)} style={style} />
      }
      const avertisment = spec?.verifica?.(manualValue(ph))
      return (
        <div className="field" key={ph} style={style}>
          <label className="field-label" htmlFor={inputId}>{label}</label>
          <input id={inputId} className="field-input" value={manualValue(ph)} list={spec?.sugestii ? `${inputId}-sugestii` : undefined}
            inputMode={spec?.numeric ? 'decimal' : undefined}
            onChange={e => setManualValue(ph, spec?.majuscule ? e.target.value.toUpperCase() : e.target.value)} />
          {spec?.sugestii && <datalist id={`${inputId}-sugestii`}>{spec.sugestii.map(o => <option key={o} value={o} />)}</datalist>}
          {avertisment && <div style={{ fontSize: '.75rem', color: 'var(--warn, #b45309)' }}>{avertisment}</div>}
        </div>
      )
    }
    // Modul de exercitare a mandatelor stă sub lista reprezentanților legali: decizia vine abia după ce se vede că
    // sunt cel puțin doi (shownPh îl scoate din `manualFields` sub 2 — vezi visibleManualPlaceholders).
    const showModExercitare = manualFields.includes(MOD_EXERCITARE_MANDATE)
    // Operațiunea înaintea listei actelor, ca în frază
    const liste = manualFields.filter(ph => felLista(ph)).sort((a, b) => (felLista(a) === 'operatiune' ? 0 : 1) - (felLista(b) === 'operatiune' ? 0 : 1))
    const otherManualFields = manualFields.filter(ph => ph !== MOD_EXERCITARE_MANDATE && !auto.has(ph) && !felLista(ph))
    const { pairs, rest } = pairManualDateFields(otherManualFields.filter(ph => !calculate.has(ph)))
    const boxStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '.375rem', border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', marginBottom: '.375rem' }
    const titleStyle: CSSProperties = { fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }
    // Un câmp calculat se arată doar ca rezultat, sub câmpurile din care vine
    const renderCalculat = (ph: string) => (
      <div key={ph} style={{ fontSize: '.85rem', color: 'var(--s500)' }}>
        {manualLabel(ph)}: {manualValue(ph) ? <strong>{manualValue(ph)}</strong> : `se calculează din ${calculate.get(ph)!.map(manualLabel).join(' / ').toLowerCase()}`}
        {' '}(calculat)
      </div>
    )
    const renderField = (ph: string) => renderManualField(ph, undefined, auto.get(ph))
    const renderLista = (ph: string) => {
      const fel = felLista(ph)!
      const { optiuni, alese, text } = listaFor(tpl.id, fel)
      return (
        <ListaBifePanel key={ph} id={`lista-${tpl.id}-${fel}`} titlu={fel === 'operatiune' ? 'Operațiunea' : 'Lista actelor'}
          optiuni={optiuni} alese={alese} text={text}
          nota={fel === 'acte' ? 'Propuse: actele generate pentru client în ultimele 30 de zile' : undefined}
          onChange={v => setListeState(prev => ({ ...prev, [tpl.id]: { ...prev[tpl.id], [fel]: v } }))} />
      )
    }
    return (
      <>
        {liste.map(renderLista)}
        {auto.size > 0 && (
          <div style={boxStyle}>
            <div style={titleStyle}>Autoturism</div>
            {[...auto.keys()].map(ph => calculate.has(ph) ? renderCalculat(ph) : renderField(ph))}
          </div>
        )}
        {otherManualFields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem', border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', marginBottom: '.375rem' }}>
            <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>De completat manual</div>
            {pairs.map(([nr, data]) => (
              <div key={nr} className="tf-manual-pair">
                {renderManualField(nr)}
                {renderManualField(data)}
              </div>
            ))}
            {rest.map(renderField)}
            {otherManualFields.filter(ph => calculate.has(ph)).map(renderCalculat)}
          </div>
        )}
        {renderCustomPersonFields(tpl.id, customRoles)}
        {customGroups.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', marginBottom: '.375rem' }}>
            <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Persoane (listă)</div>
            {customGroups.map(({ role }) => (
              <Fragment key={role}>
                <CustomPersonGroupField
                  tag={role} role={role}
                  existing={existingForCustomRole(role)}
                  value={customGroupPicks[tpl.id]?.[role] ?? []}
                  onChange={persons => setCustomGroupPicks(prev => ({
                    ...prev, [tpl.id]: { ...prev[tpl.id], [role]: persons },
                  }))}
                />
                {role === 'REPREZENTANT_LEGAL' && showModExercitare && (
                  <div className="field">
                    <label className="field-label" htmlFor={`manual-${tpl.id}-mod-exercitare`}>Reprezentanții legali își exercită mandatele</label>
                    <select id={`manual-${tpl.id}-mod-exercitare`} className="field-input"
                      value={manualValue(MOD_EXERCITARE_MANDATE)} onChange={e => setManualValue(MOD_EXERCITARE_MANDATE, e.target.value)}>
                      <option value="">— alege —</option>
                      {MOD_EXERCITARE_OPTIUNI.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </>
    )
  }

  // Generic — folosit atât pentru DocTemplate (șabloane proprii), cât și
  // pentru BuiltinTemplate (șabloane de bază fără clauze, ex. Act Constitutiv).
  const renderReadiness = (tpl: { id: string; placeholders?: string[]; repeatGroups?: string[]; repeatGroupFields?: Record<string, string[]> }) => {
    if (!tpl.placeholders || tpl.placeholders.length === 0) return null
    const mergedGroupsForReadiness = { ...repeatGroups, ...customGroupsFor(tpl) }
    const mergedReplForReadiness = { ...repl(tpl.id), ...customListReplacementsFor(tpl) }
    const placeholders = shownPh(tpl.id, tpl.placeholders)
    const { filled, missing } = checkReadiness(placeholders, mergedReplForReadiness, mergedGroupsForReadiness, tpl.repeatGroupFields)
    const total = placeholders.length
    const pct = Math.round((filled.length / total) * 100)
    const isExpanded = expandedReadiness.has(tpl.id)
    const grouped = missing.length > 0 ? groupMissingFields(missing) : {}
    // {{CAMP_NUMAR_HOTARARE}} etc.: câmpuri care nu vin din client, ci se scriu aici la generare
    const manualFields = placeholders.filter(isManualPlaceholder)
    // Roluri de persoană „noi" (comodant, reprezentant legal…) — nu se completează automat din client ca
    // Asociat/Administrator, dar utilizatorul poate alege una dintre persoanele deja cunoscute la firmă sau
    // adăuga una nouă (vezi CustomPersonField) — poziții FIXE ({{ROL_N_CÂMP}}).
    // Din `placeholders` (cele cerute în modul ales): la înființare, persoanele din blocul {{#ACTUALIZARE}} nu se cer.
    const customRoles = detectCustomPersonRoles(placeholders)
    // Aceleași roluri noi, dar scrise fie ca bloc REPETITIV ({{#COMODANTI}}…), fie ca simplu câmp „…LISTA" —
    // câte persoane e nevoie, nu o singură poziție (vezi CustomPersonGroupField/detectCustomPersonGroups).
    const customGroups = detectCustomPersonGroups(tpl.repeatGroups ?? [], placeholders, tpl.repeatGroupFields)

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
        {renderTemplateInputs(tpl, manualFields, customRoles, customGroups)}
        {hasCesiune(placeholders) && renderCesiunePanel(tpl.id)}
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
    const dedicated = builtinDedicatedKind(b)
    const mismatch = dedicated ? undefined : asociatiCountMismatch(b.key, asociatiCount)
    const tipMsg = tipMismatchMsg(b.tipTemplate, b.name)
    const pct = dedicated ? dedicatedPct(key) : b.clauses.length > 0 ? clausePct(key, b.placeholders, b.clauses, b.repeatGroupFields) : readinessPct(builtinCheckablePlaceholders(b), key, builtinTplRef(b))
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
    const hasClauses = hasActiveClauses(tpl)
    const isSelected = selectedIds.has(tpl.id)
    const link = generatedLinks[tpl.id]
    const asociatiMismatch = asociatiCountMismatch(tpl.sourceKey, asociatiCount)
    const tipMsg = tipMismatchMsg(tpl.tipTemplate, tpl.name)
    const dedicated = dedicatedKindOf(tpl)
    const pct = dedicated ? dedicatedPct(tpl.id) : hasClauses ? clausePct(tpl.id, tpl.placeholders, tpl.clauses!, tpl.repeatGroupFields) : readinessPct(tpl.placeholders, tpl.id, tpl)
    return (
      <div key={tpl.id} className={`tf-row${isActive ? ' tf-row--active' : ''}${asociatiMismatch ? ' tf-row--na' : ''}`}>
        {!hasClauses && !dedicated && (
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
    const hasClauses = hasActiveClauses(tpl)
    const asociatiMismatch = asociatiCountMismatch(tpl.sourceKey, asociatiCount)
    const isSelected = selectedIds.has(tpl.id)
    const tipMsg = tipMismatchMsg(tpl.tipTemplate, tpl.name)
    const dedicated = dedicatedKindOf(tpl)
    const seenRevision = seenRevisions[tpl.id]
    const fileChanged = seenRevision !== undefined && (tpl.revision ?? 0) !== seenRevision

    return (
      <div className="tf-detail-panel">
        {fileChanged && (
          <div role="alert" style={WARN_BOX}>
            ⚠️ Fișierul acestui șablon a fost înlocuit cât timp îl completai. Verifică formularul: unele câmpuri pot fi noi sau eliminate.{' '}
            <button type="button" className="btn btn-ghost btn-xs"
              onClick={() => setSeenRevisions(prev => ({ ...prev, [tpl.id]: tpl.revision ?? 0 }))}>Am înțeles</button>
          </div>
        )}
        <div className="tf-detail-head">
          <span className="tf-detail-title" title={tpl.name}>{tpl.name}</span>
          <span title={creditBlock ?? undefined} style={{ display: 'inline-flex' }}>
          <button
            className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => tryGenerateSingle(tpl)}
            disabled={isLoading || !!creditBlock || !!asociatiMismatch || !!tipMsg || (hasClauses && !clauseState[tpl.id]?.isComplete)}
          >
            {isLoading ? <><span className="spin" />&nbsp;</> : (tpl.type === 'gdoc' ? '🔷 ' : '↓ ')}
            Generează
          </button>
          </span>
        </div>

        {tpl.description && <p className="card-sub" style={{ margin: 0 }}>{tpl.description}</p>}

        {asociatiMismatch && (
          <div style={WARN_BOX}>⚠️ {tpl.name} {asociatiMismatch}</div>
        )}
        {renderInfiintareNote(tpl.placeholders)}
        {!asociatiMismatch && renderActModeToggle(tpl.repeatGroups)}

        {!asociatiMismatch && dedicated && renderDedicatedProgress(tpl.id)}
        {!asociatiMismatch && !dedicated && hasClauses && renderProgressBar(tpl.id, clauseCompletion(tpl.id, tpl.placeholders, tpl.clauses!, tpl.repeatGroupFields), 'De completat înainte de generare')}
        {!asociatiMismatch && (dedicated ? (
          renderDedicatedForm(dedicated, tpl.id, `${tpl.id}:${client?.id ?? 'none'}`)
        ) : hasClauses ? (
          <>
            {(() => {
              // Câmpurile manuale din clauze se completează în clauza lor (ClauseSelector) — aici doar cele din afara clauzelor
              const clausePh = new Set(tpl.clauses!.flatMap(c => c.placeholders))
              const all = tpl.placeholders ?? []
              // Persoanele folosite doar în clauze se aleg în clauza lor (renderPersons), nu aici
              return renderTemplateInputs(tpl, shownPh(tpl.id, all.filter(ph => isManualPlaceholder(ph) && !clausePh.has(ph))),
                detectCustomPersonRoles(all.filter(ph => !clausePh.has(ph))), detectCustomPersonGroups(tpl.repeatGroups ?? [], all, tpl.repeatGroupFields))
            })()}
            <ClauseSelector
              renderPersons={phs => {
                const roles = detectCustomPersonRoles(phs)
                // Panoul de cesiune stă în clauza în care se cedează părțile (nu și în retragere/cooptare, care doar le preia)
                return (
                  <>
                    {roles.length > 0 && renderCustomPersonInputs(tpl.id, roles)}
                    {phs.includes('{{NR_PARTI_CEDATE}}') && renderCesiunePanel(tpl.id)}
                  </>
                )
              }}
              key={`${tpl.id}:${client?.id ?? 'none'}`}
              clauses={tpl.clauses!}
              client={client}
              // Cu persoanele alese în lista de deasupra (roluri proprii) — o clauză care le folosește e completă după alegere
              baseReplacements={repl(tpl.id)}
              onChange={v => setClauseState(prev => ({ ...prev, [tpl.id]: v }))}
            />
          </>
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
    const dedicated = builtinDedicatedKind(b)
    const isLoading = loadingIds.has(key)
    const link = generatedLinks[key]
    // Declarația, Anexa 1, Anexa 2a și Beneficiari Reali (formulare dedicate, fără clauze/#ASOCIATI) nu au
    // legătură cu numărul de asociați din document — restricția nu se aplică.
    const mismatch = dedicated ? undefined : asociatiCountMismatch(b.key, asociatiCount)
    const tipMsg = tipMismatchMsg(b.tipTemplate, b.name)

    return (
      <div className="tf-detail-panel">
        <div className="tf-detail-head">
          <span className="tf-row-badge">DE BAZĂ</span>
          <span className="tf-detail-title" title={b.name}>{b.name}</span>
          <span title={creditBlock ?? undefined} style={{ display: 'inline-flex' }}>
          <button
            className="btn btn-sm btn-outline-primary"
            onClick={() => dedicated ? handleGenerateDedicated(b) : tryGenerateBuiltinSingle(b)}
            disabled={isLoading || !!creditBlock || !!mismatch || !!tipMsg || (!dedicated && b.clauses.length > 0 && !clauseState[key]?.isComplete)}
          >
            {isLoading ? <><span className="spin" />&nbsp;</> : '↓ '}
            Generează
          </button>
          </span>
        </div>

        {mismatch && <div style={WARN_BOX}>⚠️ {b.name} {mismatch}</div>}
        {!mismatch && tipMsg && <div style={WARN_BOX}>⚠️ {tipMsg}</div>}
        {renderInfiintareNote(b.placeholders)}

        {!mismatch && renderActModeToggle(b.repeatGroups)}

        {!mismatch && dedicated && renderDedicatedProgress(key)}
        {!mismatch && !dedicated && b.clauses.length > 0 && renderProgressBar(key, clauseCompletion(key, b.placeholders, b.clauses, b.repeatGroupFields), 'De completat înainte de generare')}
        {!mismatch && (dedicated ? (
          renderDedicatedForm(dedicated, key, client?.id ?? 'none')
        ) : b.clauses.length > 0 ? (
          <ClauseSelector
            key={`${key}:${client?.id ?? 'none'}`}
            clauses={b.clauses}
            client={client}
            baseReplacements={replacements}
            onChange={v => setClauseState(prev => ({ ...prev, [key]: v }))}
          />
        ) : (
          // Aceeași referință ca procentul din listă (readinessPct): cu blocurile repetitive ale șablonului, ca persoanele
          // alese ca listă (ex. comodanții) să conteze la completare — fără ele, numele lor apăreau „lipsă” deși erau alese.
          renderReadiness(builtinTplRef(b))
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
                💾 Salvare client
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setShowLibrary(true)}>📁 Șabloane</button>
          </div>
        </div>

        <div className="card-body">
          <CreditNotice clientId={client?.id || null} clientName={client?.denumire} onToast={onToast} onBlockedChange={setCreditBlock} />
          <div className={`tf-layout${isMobile ? (mobileDetail ? ' tf-layout--m-detail' : ' tf-layout--m-list') : ''}`} ref={layoutRef} style={{ ['--tf-list-w' as string]: `${listW}px` }}>

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

              {(builtins.length > 0 || listTemplates.length > 0) && (
                <TemplateSearchInput value={tplSearch} onChange={setTplSearch} />
              )}
              {ascunseTip > 0 && clientTip && (
                <div style={{ fontSize: '.75rem', color: 'var(--s500)' }}>
                  {ascunseTip === 1 ? 'Un șablon doar pentru' : `${ascunseTip} șabloane doar pentru`} {clientTip === 'PF' ? 'PJ' : 'PF'} {ascunseTip === 1 ? 'nu apare' : 'nu apar'}: clientul e {clientTip}.
                </div>
              )}
              {tplSearch.trim() && !tplLoading && shownBuiltins.length === 0 && shownTemplates.length === 0 && (
                <div style={{ textAlign: 'center', padding: '1rem 0', color: 'var(--s400)', fontSize: '.85rem' }}>
                  Niciun șablon nu se potrivește căutării.
                </div>
              )}

              {shownBuiltins.length > 0 && (
                <>
                  <div className="tf-list-label">Șabloane de bază</div>
                  <div className="tf-rows">{shownBuiltins.map(renderBuiltinRow)}</div>
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

              {!tplLoading && shownTemplates.length > 0 && (
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
                  {ownGroups.map(g => {
                    if (!g.folder) return <div key="fara-folder" className="tf-rows">{g.items.map(renderTemplateRow)}</div>
                    const f = g.folder
                    const open = !!tplSearch.trim() || !closedFolders.has(f.id)
                    const selectable = g.items.filter(t => selectableIds.has(t.id)).map(t => t.id)
                    const allOn = selectable.length > 0 && selectable.every(id => selectedIds.has(id))
                    return (
                      <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
                        <TemplateFolderHeader name={f.name} count={g.items.length} open={open} onToggle={() => toggleFolder(f.id)}
                          actions={selectable.length > 1 && (
                            <input type="checkbox" checked={allOn} onChange={() => setFolderSelected(selectable, !allOn)}
                              title={allOn ? 'Deselectează tot din folder' : 'Include tot folderul în generarea în lot'}
                              aria-label={`Selectează tot din folderul „${f.name}”`} />
                          )} />
                        {open && <div className="tf-rows tfolder-items">{g.items.map(renderTemplateRow)}</div>}
                      </div>
                    )
                  })}
                </>
              )}

              {/* Batch generate */}
              {selectedTemplates.length > 1 && (
                <span title={creditBlock ?? undefined} style={{ display: 'inline-flex' }}><button className="btn btn-primary" onClick={tryBatchGenerate} disabled={loadingIds.size > 0 || !!creditBlock}>
                  {loadingIds.size > 0
                    ? <><span className="spin" />&nbsp;Generare în curs…</>
                    : `⚡ Generează toate (${selectedTemplates.length})`
                  }
                </button></span>
              )}
            </div>

            {/* ── Coloana din dreapta — detaliu șablon activ ── */}
            <div className="tf-detail">
              {mobileDetail && (
                <button type="button" className="mobile-back tf-m-back" onClick={mobileBack}><IconBack /> Șabloane</button>
              )}
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
              💾 Salvezi această entitate în lista de clienți?
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
