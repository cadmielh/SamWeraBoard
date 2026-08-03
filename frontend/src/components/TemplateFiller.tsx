import { useState } from 'react'
import type { CSSProperties } from 'react'
import { fillDocx, fillDocxFromDriveTemplate, fillGdoc } from '../lib/api'
import type { IDFields } from '../lib/api'
import type { Client, DocTemplate, ScannedPerson, ToastItem } from '../types'
import { inferTipClient } from '../types'
import type { User } from 'firebase/auth'
import { buildReplacements, buildRepeatGroups, checkReadiness, groupMissingFields } from '../lib/placeholders'
import { useTemplates, logDocGeneration } from '../lib/templates'
import { EMPTY_CLIENT, type ClientInput } from '../lib/clienti'
import DriveFolderPicker from './DriveFolderPicker'
import TemplateLibrary from './TemplateLibrary'
import ClientModal from './ClientModal'
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
}

type Tab = 'docx' | 'gdoc'

export default function TemplateFiller({
  workspaceId, user, fields, client, scannedPersons,
  accessToken, onToast, onBack, onClientSaved,
}: Props) {
  const { templates, loading: tplLoading, add: addTemplate, remove: removeTemplate } = useTemplates(workspaceId)

  const docxTemplates = templates.filter(t => t.type === 'docx')
  const gdocTemplates = templates.filter(t => t.type === 'gdoc')

  const [tab, setTab] = useState<Tab>('docx')
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
    tpl: DocTemplate
    missing: string[]
    isBatch?: boolean
    batchTargets?: DocTemplate[]
  } | null>(null)

  const replacements = buildReplacements({ idFields: fields, client, scannedPersons })
  const repeatGroups = buildRepeatGroups({ idFields: fields, client, scannedPersons })
  const hasScannedPersonsNoClient = (scannedPersons ?? []).length > 0 && !client?.id

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const setLoading = (id: string, on: boolean) =>
    setLoadingIds(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n })

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
      let result: { blob?: Blob; name?: string; link?: string }

      if (tpl.driveFileId) {
        result = await fillDocxFromDriveTemplate(tpl.driveFileId, replacements, accessToken, uploadToDrive, driveFolder?.id, outputName, repeatGroups)
      } else {
        const file = await resolveTemplateFile(tpl)
        if (!file) { onToast(`Fișierul pentru "${tpl.name}" nu este disponibil`, 'err'); return }
        result = await fillDocx(file, replacements, accessToken, uploadToDrive, driveFolder?.id, outputName, repeatGroups)
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
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Generare eșuată', 'err')
    } finally {
      setLoading(tpl.id, false)
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
    const { missing } = checkReadiness(tpl.placeholders ?? [], replacements, repeatGroups)
    if (missing.length > 0) {
      setPendingGenerate({ tpl, missing })
    } else {
      if (tpl.type === 'docx') handleGenerateDocx(tpl)
      else handleGenerateGdoc(tpl)
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
    } else {
      const { tpl } = pendingGenerate
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
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const renderReadiness = (tpl: DocTemplate) => {
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
              background: pct === 100 ? 'var(--g500, #22c55e)' : pct > 60 ? 'var(--y500, #eab308)' : 'var(--r400, #f87171)',
            }} />
          </div>
          <span style={{
            fontSize: '.73rem', whiteSpace: 'nowrap', fontWeight: 600,
            color: pct === 100 ? 'var(--g600)' : pct > 60 ? 'var(--y700, #a16207)' : 'var(--r500)',
          }}>
            {pct === 100 ? '✓ Complet' : `${filled.length}/${total} câmpuri`}
          </span>
          {missing.length > 0 && (
            <button
              onClick={() => toggleReadiness(tpl.id)}
              style={{
                border: 'none', cursor: 'pointer', padding: '.1rem .35rem',
                fontSize: '.72rem', borderRadius: 4, fontFamily: 'var(--font)',
                color: 'var(--y700, #a16207)', background: 'var(--y50, #fefce8)',
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
            background: 'var(--y50, #fefce8)', border: '1px solid var(--y200, #fef08a)',
            borderRadius: 'var(--r-sm)', padding: '.5rem .625rem',
            display: 'flex', flexDirection: 'column', gap: '.3rem',
          }}>
            <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--y800, #713f12)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              Câmpuri ce vor rămâne necompletate
            </div>
            {Object.entries(grouped).map(([group, fields]) => (
              <div key={group} style={{ display: 'flex', gap: '.375rem', alignItems: 'flex-start', fontSize: '.78rem' }}>
                <span style={{ color: 'var(--y700, #a16207)', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 90 }}>
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

  const renderTemplate = (tpl: DocTemplate) => {
    const isSelected = selectedIds.has(tpl.id)
    const isLoading = loadingIds.has(tpl.id)
    const link = generatedLinks[tpl.id]

    return (
      <div
        key={tpl.id}
        style={{
          padding: '.625rem .875rem', background: 'var(--s50)', borderRadius: 'var(--r-sm)',
          border: `1.5px solid ${isSelected ? 'var(--p400)' : 'var(--s200)'}`,
          display: 'flex', flexDirection: 'column', gap: '.375rem',
          transition: 'border-color var(--t)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <input type="checkbox" style={{ cursor: 'pointer', flexShrink: 0 }}
            checked={isSelected} onChange={() => toggleSelect(tpl.id)} />
          <span style={{ flex: 1, fontWeight: 600, fontSize: '.875rem', color: 'var(--s800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tpl.name}
          </span>
          {tpl.description && (
            <span style={{ fontSize: '.75rem', color: 'var(--s400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
              {tpl.description}
            </span>
          )}
          <button
            className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => tryGenerateSingle(tpl)}
            disabled={isLoading}
            style={{ flexShrink: 0 }}
          >
            {isLoading ? <><span className="spin" />&nbsp;</> : (tpl.type === 'gdoc' ? '🔷 ' : '↓ ')}
            {uploadToDrive && tpl.type === 'docx' ? 'Upload' : 'Generează'}
          </button>
        </div>

        {renderReadiness(tpl)}

        {/* Avertizare compatibilitate PF/PJ */}
        {tpl.tipTemplate && tpl.tipTemplate !== 'universal' && client && (() => {
          const clientTip = inferTipClient(client as Client)
          const mismatch = (tpl.tipTemplate === 'PF' && clientTip !== 'PF') || (tpl.tipTemplate === 'PJ' && clientTip !== 'PJ')
          if (!mismatch) return null
          return (
            <div style={{
              fontSize: '.75rem', color: 'var(--o700, #c2410c)', background: 'var(--o50, #fff7ed)',
              border: '1px solid var(--o200, #fed7aa)', borderRadius: 4, padding: '.25rem .5rem',
            }}>
              ⚠️ Șablon pentru {tpl.tipTemplate}, dar clientul selectat este {clientTip} — unele câmpuri pot fi goale
            </div>
          )
        })()}

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

  const currentTabTemplates = tab === 'docx' ? docxTemplates : gdocTemplates
  const selectedInTab = currentTabTemplates.filter(t => selectedIds.has(t.id))

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">
            <span className="step-chip">3</span>
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
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: '.25rem', marginBottom: '1.25rem', background: 'var(--s100)', borderRadius: 'var(--r-sm)', padding: '.25rem' }}>
            {(['docx', 'gdoc'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, padding: '.4rem .75rem', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: tab === t ? '#fff' : 'transparent',
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

          {!tplLoading && currentTabTemplates.length === 0 && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--s400)', fontSize: '.875rem' }}>
              Niciun șablon {tab === 'docx' ? 'Word' : 'Google Doc'} adăugat.{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => setShowLibrary(true)} style={{ marginTop: '.5rem', display: 'block', margin: '.375rem auto 0' }}>
                + Adaugă din biblioteca de șabloane
              </button>
            </div>
          )}

          {!tplLoading && currentTabTemplates.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
              {currentTabTemplates.map(renderTemplate)}
            </div>
          )}

          {/* Drive upload option (docx only) */}
          {tab === 'docx' && !tplLoading && currentTabTemplates.length > 0 && (
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
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
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={tryBatchGenerate} disabled={loadingIds.size > 0}>
                {loadingIds.size > 0
                  ? <><span className="spin" />&nbsp;Generare în curs…</>
                  : `⚡ Generează toate (${selectedInTab.length})`
                }
              </button>
            </div>
          )}
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
            backdropStyle={{ background: 'rgba(15,23,42,.45)', zIndex: 400 }}
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
                    background: 'var(--y50, #fefce8)', border: '1px solid var(--y200, #fef08a)',
                    borderRadius: 'var(--r-sm)', padding: '.4rem .625rem',
                    display: 'flex', gap: '.5rem', alignItems: 'flex-start', fontSize: '.825rem',
                  }}>
                    <span style={{ color: 'var(--y700, #a16207)', fontWeight: 700, whiteSpace: 'nowrap', minWidth: 100 }}>
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
          backdropStyle={{ background: 'rgba(15,23,42,.45)', zIndex: 400 }}
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
