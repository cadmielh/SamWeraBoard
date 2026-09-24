import { useEffect, useMemo, useState } from 'react'
import { analyzeBlanks, applyBlanks, suggestBlanksAI, type BlankAnalysis, type BlankGroup, type BlankSuggestion } from '../lib/api'
import { choiceFromSuggestion, choicesToTags, summarize, tagForChoice, type BlankChoice } from '../lib/blanks'
import { blurNumberInputOnWheel } from '../lib/inputEvents'
import type { ToastItem } from '../types'
import Modal from './Modal'

interface Props {
  file: File
  /** Șablonul cu etichete, gata de salvat în bibliotecă. */
  onDone: (template: File) => void
  onClose: () => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

const KIND_LABEL: Record<BlankChoice['kind'], string> = {
  company: 'Societate', person: 'Persoană', manual: 'Câmp manual', keep: 'Las neschimbat',
}

// Calități uzuale, ca autocompletare — dar câmpul e liber (orice text), fiindcă motorul din blanks.py
// recunoaște orice calitate scrisă clar în șablon, nu doar din listă (vezi blanks.py: _ROLE_KEYWORDS).
const ROLE_OPTIONS = [
  'ASOCIAT', 'ADMINISTRATOR', 'COMODANT', 'COMODATAR', 'REPREZENTANT_LEGAL', 'IMPUTERNICIT', 'MANDATAR',
  'CHIRIAS', 'LOCATOR', 'LOCATAR', 'VANZATOR', 'CUMPARATOR', 'IMPRUMUTATOR', 'IMPRUMUTAT', 'CENZOR',
  'ACTIONAR', 'FONDATOR', 'BENEFICIAR', 'GARANT', 'DEBITOR', 'CREDITOR',
]
const ROLE_DATALIST_ID = 'blank-role-options'

/** „comodant judiciar” → „COMODANT_JUDICIAR” — la fel ca pe server (blanks.py/ai_suggest.py), ca eticheta
 * scrisă manual să producă exact același tag ca una propusă din context sau de AI. */
const normalizeRole = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')

function initialFor(kind: BlankChoice['kind'], analysis: BlankAnalysis, prev: BlankChoice): BlankChoice {
  if (kind === 'keep') return { kind: 'keep' }
  if (kind === 'company') return { kind: 'company', field: Object.keys(analysis.companyFields)[0] }
  if (kind === 'person') return { kind: 'person', role: prev.kind === 'person' ? prev.role : 'ASOCIAT', n: prev.kind === 'person' ? prev.n : 1, field: 'NUME_COMPLET' }
  return { kind: 'manual', label: '' }
}

function Row({ s, analysis, choice, onChange, onAskAi, aiPending, aiAsked }: {
  s: BlankSuggestion; analysis: BlankAnalysis; choice: BlankChoice; onChange: (c: BlankChoice) => void
  onAskAi?: (id: number) => void; aiPending?: boolean; aiAsked?: boolean
}) {
  const tag = tagForChoice(choice)
  const [wide, setWide] = useState(false)
  const hasWider = (s.before_wide && s.before_wide !== s.before) || (s.after_wide && s.after_wide !== s.after)
  const shownBefore = wide && s.before_wide ? s.before_wide : s.before
  const shownAfter = wide && s.after_wide ? s.after_wide : s.after
  return (
    <div style={{ border: '1px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.625rem .75rem', display: 'flex', flexDirection: 'column', gap: '.5rem',
      background: s.confidence === 'low' ? 'var(--y50)' : 'var(--surface)' }}>
      <div style={{ fontSize: '.8125rem', color: 'var(--s500)', overflowWrap: 'anywhere', display: 'flex', alignItems: 'flex-start', gap: '.4rem' }}>
        <span style={{ flex: 1 }}>
          {s.source === 'ai' && (
            <span className="chip chip-muted" style={{ marginRight: '.4rem', fontSize: '.65rem', verticalAlign: 'middle' }} title="Propus de AI — verifică înainte de a accepta">
              ✨ AI
            </span>
          )}
          …{shownBefore.trimStart()}<mark style={{ background: 'var(--p100)', color: 'var(--p700)', padding: '0 .25rem', borderRadius: 3, fontWeight: 700 }}>……</mark>{shownAfter}…
        </span>
        {hasWider && (
          <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0, fontSize: '.7rem', padding: '.15rem .45rem' }}
            onClick={() => setWide(v => !v)} title="Arată mai mult text din jurul locului liber">
            {wide ? '▾ mai puțin' : '▸ mai mult context'}
          </button>
        )}
        {onAskAi && !aiAsked && (
          <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0, fontSize: '.7rem', padding: '.15rem .45rem' }}
            disabled={aiPending} onClick={() => onAskAi(s.id)} title="Cere sugestie AI doar pentru acest loc">
            {aiPending ? <span className="spin" /> : '✨'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' }}>
        <select className="field-input" style={{ width: 'auto' }} value={choice.kind} aria-label="Ce se completează aici"
          onChange={e => onChange(initialFor(e.target.value as BlankChoice['kind'], analysis, choice))}>
          {(Object.keys(KIND_LABEL) as BlankChoice['kind'][]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        {choice.kind === 'company' && (
          <select className="field-input" style={{ width: 'auto', maxWidth: 260 }} value={choice.field} aria-label="Câmpul societății"
            onChange={e => onChange({ kind: 'company', field: e.target.value })}>
            {Object.entries(analysis.companyFields).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        {choice.kind === 'person' && (
          <>
            <input className="field-input" style={{ width: 150 }} list={ROLE_DATALIST_ID} value={choice.role} aria-label="Rolul persoanei"
              placeholder="ASOCIAT" onChange={e => onChange({ ...choice, role: normalizeRole(e.target.value) })} />
            <input className="field-input" type="number" min={1} max={9} style={{ width: 64 }} value={choice.n} aria-label="Numărul persoanei"
              onChange={e => onChange({ ...choice, n: Number(e.target.value) })} onWheel={blurNumberInputOnWheel} />
            <select className="field-input" style={{ width: 'auto', maxWidth: 240 }} value={choice.field} aria-label="Câmpul persoanei"
              onChange={e => onChange({ ...choice, field: e.target.value })}>
              {Object.entries(analysis.personFields).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </>
        )}
        {choice.kind === 'manual' && (
          <input className="field-input" style={{ flex: 1, minWidth: 180 }} placeholder="Numele câmpului (ex. Nr. hotărârii)" value={choice.label}
            aria-label="Numele câmpului manual" onChange={e => onChange({ kind: 'manual', label: e.target.value })} />
        )}
        {tag && <code style={{ fontSize: '.72rem', color: 'var(--s400)' }}>{tag}</code>}
      </div>
    </div>
  )
}

function GroupRow({ g, mode, onChange }: { g: BlankGroup; mode: 'repeat' | 'fixed'; onChange: (m: 'repeat' | 'fixed') => void }) {
  const itemWord = g.role === 'CAEN' ? 'coduri CAEN' : 'persoane'
  // „Poziții fixe” n-are sens pentru o listă de activități CAEN (nu e o persoană anume la o poziție fixă) —
  // codurile găsite nu au un câmp propriu per poziție (spre deosebire de ASOCIAT_1/ASOCIAT_2), deci ar ieși
  // toate cu aceeași etichetă {{CAEN}} dacă am lăsa alegerea asta. Se repetă mereu automat.
  const fixedAllowed = g.role !== 'CAEN'
  return (
    <div style={{ border: '1.5px solid var(--p200)', borderRadius: 'var(--r-sm)', padding: '.75rem .875rem', display: 'flex', flexDirection: 'column', gap: '.5rem', background: 'var(--p50)' }}>
      <div style={{ fontSize: '.875rem', color: 'var(--s800)' }}>
        Am găsit <strong>{g.count}</strong> {g.label} {g.kind === 'inline' ? 'în aceeași frază' : 'în paragrafe separate'}.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8125rem', cursor: 'pointer' }}>
          <input type="radio" name={`group-${g.id}`} checked={mode === 'repeat'} onChange={() => onChange('repeat')} />
          Se repetă automat{fixedAllowed ? ' (recomandat)' : ''} — merge cu orice număr de {itemWord}
        </label>
        {fixedAllowed && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8125rem', cursor: 'pointer' }}>
            <input type="radio" name={`group-${g.id}`} checked={mode === 'fixed'} onChange={() => onChange('fixed')} />
            Poziții fixe — valabil doar dacă numărul de {itemWord} rămâne {g.count}
          </label>
        )}
      </div>
    </div>
  )
}

/** Un document fără etichete, cu locuri libere („……”): aplicația propune câmpul potrivit din context, iar utilizatorul confirmă. */
export default function BlankImportModal({ file, onDone, onClose, onToast }: Props) {
  const [analysis, setAnalysis] = useState<BlankAnalysis | null>(null)
  const [choices, setChoices] = useState<Record<number, BlankChoice>>({})
  const [groupChoices, setGroupChoices] = useState<Record<number, 'repeat' | 'fixed'>>({})
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [creating, setCreating] = useState(false)
  // Locurile pe care utilizatorul le-a modificat manual — o sugestie AI nu le mai suprascrie (vezi
  // applyAiSuggestions mai jos), ca o corectare deja făcută să nu dispară dintr-o cerere de sugestii AI.
  const [touchedIds, setTouchedIds] = useState<Set<number>>(new Set())
  const [aiError, setAiError] = useState<string | null>(null)
  // Cereri AI per câmp, nu doar pentru toate cele needeslușite deodată — mai puțini tokeni trimiși când
  // doar unul-două locuri chiar au nevoie de ajutor (cerere utilizator). `aiPendingIds` — cererea (cererile)
  // în curs chiar acum; `aiAskedIds` — deja cerute cu succes, butonul lor dispare (nu invită la apăsări
  // repetate, fiecare fiind un apel plătit) — la eroare NU intră în `aiAskedIds`, ca să se poată reîncerca.
  const [aiPendingIds, setAiPendingIds] = useState<Set<number>>(new Set())
  const [aiAskedIds, setAiAskedIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    let cancelled = false
    analyzeBlanks(file)
      .then(a => {
        if (cancelled) return
        setAnalysis(a)
        setChoices(Object.fromEntries(a.blanks.map(b => [b.id, choiceFromSuggestion(b)])))
        setGroupChoices(Object.fromEntries(a.groups.map(g => [g.id, 'repeat' as const])))    // implicit: se repetă
      })
      .catch(e => { if (!cancelled) setError((e as Error).message ?? 'Analiza a eșuat') })
    return () => { cancelled = true }
  }, [file])

  // Locurile din grupurile acceptate ca „se repetă” sunt tratate integral de bloc, nu unul câte unul.
  const groupedIds = useMemo(() => {
    const ids = new Set<number>()
    for (const g of analysis?.groups ?? []) if (groupChoices[g.id] === 'repeat') for (const id of g.blank_ids) ids.add(id)
    return ids
  }, [analysis, groupChoices])
  const ungroupedBlanks = useMemo(() => (analysis?.blanks ?? []).filter(b => !groupedIds.has(b.id)), [analysis, groupedIds])

  const summary = useMemo(() => summarize(ungroupedBlanks), [ungroupedBlanks])
  const toCheck = useMemo(() => ungroupedBlanks.filter(b => b.confidence !== 'high'), [ungroupedBlanks])
  const recognized = useMemo(() => ungroupedBlanks.filter(b => b.confidence === 'high'), [ungroupedBlanks])
  // Un câmp manual fără nume nu se poate crea: blochează butonul până e completat sau lăsat neschimbat
  const missingLabel = ungroupedBlanks.some(b => { const c = choices[b.id]; return c?.kind === 'manual' && !c.label.trim() })

  const create = async () => {
    setCreating(true)
    try {
      onDone(await applyBlanks(file, choicesToTags(choices), groupChoices))
    } catch (e) {
      onToast((e as Error).message ?? 'Crearea șablonului a eșuat', 'err')
    } finally {
      setCreating(false)
    }
  }

  // Apelat DOAR la cererea explicită a utilizatorului (butonul „per câmp” din fiecare rând, sau cel de mai
  // jos pentru toate cele needeslușite deodată) — niciodată automat. `ids` lipsă = toate cele needeslușite
  // ȘI încă necerute (nu se reîntreabă ce a fost deja cerut). Sugestiile se combină cu ce e deja afișat,
  // fără să atingă locurile deja corectate manual (vezi touchedIds); nimic nu se scrie în șablon aici — trec
  // prin ACELAȘI ecran de confirmare ca restul, până la „Creează șablonul”.
  const requestAiSuggestions = async (ids?: number[]) => {
    const targetIds = ids ?? toCheck.filter(b => !aiAskedIds.has(b.id)).map(b => b.id)
    if (targetIds.length === 0) return
    setAiPendingIds(prev => new Set([...prev, ...targetIds]))
    setAiError(null)
    try {
      const suggestions = await suggestBlanksAI(file, targetIds)
      const byId = new Map(suggestions.map(s => [s.id, s]))
      setAnalysis(prev => prev && { ...prev, blanks: prev.blanks.map(b => (byId.has(b.id) && !touchedIds.has(b.id)) ? byId.get(b.id)! : b) })
      setChoices(prev => {
        const next = { ...prev }
        for (const s of suggestions) if (!touchedIds.has(s.id)) next[s.id] = choiceFromSuggestion(s)
        return next
      })
      setAiAskedIds(prev => new Set([...prev, ...targetIds]))
      if (suggestions.length === 0) onToast('AI-ul n-a găsit nimic în plus de propus', 'ok')
    } catch (e) {
      setAiError((e as Error).message ?? 'Sugestiile AI au eșuat')
    } finally {
      setAiPendingIds(prev => { const next = new Set(prev); for (const id of targetIds) next.delete(id); return next })
    }
  }

  const renderRow = (s: BlankSuggestion) => analysis && (
    <Row key={s.id} s={s} analysis={analysis} choice={choices[s.id] ?? choiceFromSuggestion(s)}
      onChange={c => {
        setTouchedIds(prev => prev.has(s.id) ? prev : new Set(prev).add(s.id))
        setChoices(prev => ({ ...prev, [s.id]: c }))
      }}
      onAskAi={s.confidence !== 'high' ? (id => requestAiSuggestions([id])) : undefined}
      aiPending={aiPendingIds.has(s.id)} aiAsked={aiAskedIds.has(s.id)} />
  )

  return (
    <Modal onClose={onClose} ariaLabel="Locuri libere din document"
      backdropStyle={{ background: 'var(--backdrop)', zIndex: 420 }}
      boxStyle={{ maxWidth: 760, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
      <datalist id={ROLE_DATALIST_ID}>{ROLE_OPTIONS.map(r => <option key={r} value={r} />)}</datalist>
      <div style={{ padding: '1.125rem 1.25rem', borderBottom: '1px solid var(--s200)' }}>
        <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--s800)' }}>Locuri libere din „{file.name}”</div>
        <div style={{ fontSize: '.8125rem', color: 'var(--s500)', marginTop: '.25rem' }}>
          Documentul nu are etichete. Aplicația a recunoscut din context ce se completează în fiecare loc liber; verifică și corectează ce e nesigur.
        </div>
      </div>

      <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
        {!analysis && !error && <div style={{ color: 'var(--s400)', fontSize: '.875rem' }}><span className="spin spin-dark" /> Se analizează documentul…</div>}
        {error && <div style={{ color: 'var(--r600)', fontSize: '.875rem' }}>{error}</div>}
        {analysis && analysis.blanks.length === 0 && (
          <div style={{ fontSize: '.875rem', color: 'var(--s500)' }}>
            Nu am găsit locuri libere („……”, „.....” sau „_____”). Dacă documentul folosește alt semn, scrie etichetele manual sau spune-mi cum marchezi locurile de completat.
          </div>
        )}
        {analysis && analysis.blanks.length > 0 && (
          <>
            {analysis.groups.length > 0 && (
              <>
                <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  {analysis.groups.length > 1 ? 'Liste de persoane găsite' : 'Listă de persoane găsită'}
                </div>
                {analysis.groups.map(g => (
                  <GroupRow key={g.id} g={g} mode={groupChoices[g.id] ?? 'repeat'}
                    onChange={m => setGroupChoices(prev => ({ ...prev, [g.id]: m }))} />
                ))}
              </>
            )}
            <div style={{ fontSize: '.8125rem', color: 'var(--s600)' }}>
              <strong>{summary.total}</strong> locuri libere de verificat individual · <strong>{summary.recognized}</strong> recunoscute sigur · <strong style={{ color: 'var(--y700)' }}>{summary.toCheck}</strong> de verificat
            </div>
            {toCheck.length > 0 && (() => {
              const unasked = toCheck.filter(b => !aiAskedIds.has(b.id))
              const bulkPending = unasked.some(b => aiPendingIds.has(b.id))
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.625rem', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--s500)', letterSpacing: '.06em', textTransform: 'uppercase' }}>De verificat</div>
                    {unasked.length > 0 && (
                      <button className="btn btn-ghost btn-sm" onClick={() => requestAiSuggestions()} disabled={bulkPending}
                        title="Trimite locurile needeslușite către AI (Gemini) — opțional; alegerile deja făcute manual nu sunt atinse. Poți cere și separat, per câmp, cu ✨ de lângă fiecare rând.">
                        {bulkPending ? <><span className="spin" />&nbsp;Se cer sugestii…</> : `✨ Cere sugestii AI pentru cele ${unasked.length} needeslușite`}
                      </button>
                    )}
                  </div>
                  {aiError && <div style={{ fontSize: '.8125rem', color: 'var(--r600)' }}>{aiError}</div>}
                  {toCheck.map(renderRow)}
                </>
              )
            })()}
            {recognized.length > 0 && (
              <>
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll(v => !v)}>
                  {showAll ? '▾ Ascunde' : '▸ Arată'} cele recunoscute sigur ({recognized.length})
                </button>
                {showAll && recognized.map(renderRow)}
              </>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--s200)', display: 'flex', gap: '.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
        {missingLabel && <span style={{ fontSize: '.75rem', color: 'var(--r600)', marginRight: 'auto' }}>Dă un nume câmpurilor manuale sau alege „Las neschimbat”.</span>}
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Anulează</button>
        <button className="btn btn-primary btn-sm" onClick={create} disabled={!analysis || analysis.blanks.length === 0 || creating || missingLabel}>
          {creating ? <><span className="spin" />&nbsp;Se creează…</> : 'Creează șablonul'}
        </button>
      </div>
    </Modal>
  )
}
