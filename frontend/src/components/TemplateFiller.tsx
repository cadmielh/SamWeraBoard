import { useState, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { fillDocx, fillGdoc } from '../lib/api'
import type { IDFields } from '../lib/api'
import type { ToastItem } from '../types'
import DriveFolderPicker from './DriveFolderPicker'

interface Props {
  fields: IDFields
  accessToken: string
  onToast: (msg: string, type: ToastItem['type']) => void
  onBack: () => void
}

type Tab = 'docx' | 'gdoc'

interface DocxTemplate {
  id: string
  file: File
  outputName: string
}

interface GdocTemplate {
  id: string
  name: string
  docId: string
  outputName: string
}

const GDOC_KEY = 'samwera_gdoc_templates'

function loadGdocTemplates(): GdocTemplate[] {
  try { return JSON.parse(localStorage.getItem(GDOC_KEY) ?? '[]') }
  catch { return [] }
}

function saveGdocTemplates(ts: GdocTemplate[]) {
  localStorage.setItem(GDOC_KEY, JSON.stringify(ts))
}

function docxOutputName(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '')
  return `${base}_completat.docx`
}

function gdocOutputName(name: string): string {
  return `${name}_completat`
}

const LABEL: CSSProperties = {
  fontSize: '.695rem', fontWeight: 700, color: 'var(--s500)',
  letterSpacing: '.05em', textTransform: 'uppercase', display: 'block', marginBottom: '.375rem',
}

const INPUT: CSSProperties = {
  padding: '.375rem .625rem', borderRadius: 'var(--r-sm)',
  border: '1.5px solid var(--s300)', fontSize: '.875rem',
  color: 'var(--s800)', background: '#fff', width: '100%',
  fontFamily: 'var(--font)', outline: 'none',
}

const ROW_BTN: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--s400)', fontSize: '1.1rem', lineHeight: 1,
  padding: '.125rem .375rem', borderRadius: 4,
}

export default function TemplateFiller({ fields, accessToken, onToast, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('docx')

  // DOCX — in-session (File objects can't be serialised)
  const [docxTemplates, setDocxTemplates] = useState<DocxTemplate[]>([])
  const [selectedDocx, setSelectedDocx] = useState<string | null>(null)
  const [uploadToDrive, setUploadToDrive] = useState(false)
  const [driveFolder, setDriveFolder] = useState<{ id: string; name: string } | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [loadingDocx, setLoadingDocx] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // GDoc — persisted to localStorage
  const [gdocTemplates, setGdocTemplates] = useState<GdocTemplate[]>(loadGdocTemplates)
  const [selectedGdoc, setSelectedGdoc] = useState<string | null>(() => loadGdocTemplates()[0]?.id ?? null)
  const [newName, setNewName] = useState('')
  const [newDocId, setNewDocId] = useState('')
  const [loadingGdoc, setLoadingGdoc] = useState(false)
  const [gdocLink, setGdocLink] = useState('')

  const fieldMap = Object.fromEntries(Object.entries(fields))

  useEffect(() => {
    if (docxTemplates.length > 0 && !selectedDocx) {
      setSelectedDocx(docxTemplates[0].id)
    }
  }, [docxTemplates, selectedDocx])

  // ── DOCX helpers ──────────────────────────────────────────────────────────────

  const addDocxTemplate = (file: File) => {
    const t: DocxTemplate = { id: crypto.randomUUID(), file, outputName: docxOutputName(file) }
    setDocxTemplates(prev => [...prev, t])
    setSelectedDocx(t.id)
  }

  const removeDocxTemplate = (id: string) => {
    setDocxTemplates(prev => {
      const next = prev.filter(t => t.id !== id)
      if (selectedDocx === id) setSelectedDocx(next[0]?.id ?? null)
      return next
    })
  }

  const updateDocxOutput = (id: string, outputName: string) =>
    setDocxTemplates(prev => prev.map(t => t.id === id ? { ...t, outputName } : t))

  // ── GDoc helpers ──────────────────────────────────────────────────────────────

  const addGdocTemplate = () => {
    if (!newName.trim() || !newDocId.trim()) { onToast('Enter both name and Doc ID', 'err'); return }
    const t: GdocTemplate = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      docId: newDocId.trim(),
      outputName: gdocOutputName(newName.trim()),
    }
    const next = [...gdocTemplates, t]
    setGdocTemplates(next)
    saveGdocTemplates(next)
    setSelectedGdoc(t.id)
    setNewName('')
    setNewDocId('')
  }

  const removeGdocTemplate = (id: string) => {
    const next = gdocTemplates.filter(t => t.id !== id)
    setGdocTemplates(next)
    saveGdocTemplates(next)
    if (selectedGdoc === id) setSelectedGdoc(next[0]?.id ?? null)
  }

  const updateGdocOutput = (id: string, outputName: string) => {
    const next = gdocTemplates.map(t => t.id === id ? { ...t, outputName } : t)
    setGdocTemplates(next)
    saveGdocTemplates(next)
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleFillDocx = async () => {
    const tpl = docxTemplates.find(t => t.id === selectedDocx)
    if (!tpl) { onToast('Select a template first', 'err'); return }
    setLoadingDocx(true)
    try {
      const result = await fillDocx(tpl.file, fieldMap, accessToken, uploadToDrive, driveFolder?.id, tpl.outputName)
      if (result.link) {
        onToast(`Saved to Drive: ${result.name}`, 'ok')
      } else if (result.blob) {
        const url = URL.createObjectURL(result.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = tpl.outputName
        a.click()
        URL.revokeObjectURL(url)
        onToast('Document downloaded', 'ok')
      }
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Fill failed', 'err')
    } finally {
      setLoadingDocx(false)
    }
  }

  const handleFillGdoc = async () => {
    const tpl = gdocTemplates.find(t => t.id === selectedGdoc)
    if (!tpl) { onToast('Select a template first', 'err'); return }
    setLoadingGdoc(true)
    setGdocLink('')
    try {
      const result = await fillGdoc(tpl.docId, fieldMap, accessToken, tpl.outputName)
      setGdocLink(result.link)
      onToast('Google Doc created', 'ok')
    } catch (err: unknown) {
      onToast((err as Error).message ?? 'Fill failed', 'err')
    } finally {
      setLoadingGdoc(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          <span className="step-chip">3</span>
          Fill Template
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
      </div>
      <div className="card-body">
        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: '.25rem', marginBottom: '1.25rem', background: 'var(--s100)', borderRadius: 'var(--r-sm)', padding: '.25rem' }}>
          {(['docx', 'gdoc'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '.4rem .75rem', borderRadius: '6px', border: 'none',
                cursor: 'pointer', background: tab === t ? '#fff' : 'transparent',
                boxShadow: tab === t ? 'var(--sh-sm)' : 'none',
                color: tab === t ? 'var(--s800)' : 'var(--s400)',
                fontWeight: tab === t ? 600 : 400, fontSize: '.85rem',
                fontFamily: 'var(--font)', transition: 'all var(--t)',
              }}
            >
              {t === 'docx' ? '📄 Word Document' : '🔷 Google Doc'}
            </button>
          ))}
        </div>

        {/* ── DOCX tab ── */}
        {tab === 'docx' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {docxTemplates.length === 0 ? (
              <div style={{ color: 'var(--s400)', fontSize: '.875rem', textAlign: 'center', padding: '1.25rem 0' }}>
                No templates added yet — click below to add one.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {docxTemplates.map(tpl => (
                  <div
                    key={tpl.id}
                    style={{
                      padding: '.625rem .75rem', background: 'var(--s50)', borderRadius: 'var(--r-sm)',
                      border: `1.5px solid ${selectedDocx === tpl.id ? 'var(--p400)' : 'var(--s200)'}`,
                      display: 'flex', flexDirection: 'column', gap: '.375rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <input
                        type="radio" name="docx-tpl" style={{ cursor: 'pointer', flexShrink: 0 }}
                        checked={selectedDocx === tpl.id}
                        onChange={() => setSelectedDocx(tpl.id)}
                      />
                      <span style={{ fontSize: '.875rem', fontWeight: 600, color: 'var(--s800)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tpl.file.name}
                      </span>
                      <button onClick={() => removeDocxTemplate(tpl.id)} style={ROW_BTN} title="Remove">×</button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', paddingLeft: '1.5rem' }}>
                      <label style={{ ...LABEL, marginBottom: 0, whiteSpace: 'nowrap', minWidth: 'max-content' }}>Output name</label>
                      <input
                        value={tpl.outputName}
                        onChange={e => updateDocxOutput(tpl.id, e.target.value)}
                        style={{ ...INPUT }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <button className="btn btn-outline-primary btn-sm" onClick={() => fileInputRef.current?.click()}>
                + Add Template (.docx)
              </button>
              <input
                ref={fileInputRef} type="file" accept=".docx" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) addDocxTemplate(f); e.target.value = '' }}
              />
              <p style={{ fontSize: '.75rem', color: 'var(--s400)', marginTop: '.375rem' }}>
                Use <code style={{ background: 'var(--s100)', padding: '.1rem .3rem', borderRadius: 4 }}>{'{{FIELD}}'}</code> placeholders, e.g. <code style={{ background: 'var(--s100)', padding: '.1rem .3rem', borderRadius: 4 }}>{'{{CNP}}'}</code>, <code style={{ background: 'var(--s100)', padding: '.1rem .3rem', borderRadius: 4 }}>{'{{NUME}}'}</code>
              </p>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.875rem', color: 'var(--s700)' }}>
              <input type="checkbox" checked={uploadToDrive} onChange={e => setUploadToDrive(e.target.checked)} />
              Save filled document to Google Drive
            </label>

            {uploadToDrive && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
                <label style={LABEL}>Save to folder</label>
                {showFolderPicker ? (
                  <DriveFolderPicker
                    accessToken={accessToken}
                    onToast={onToast}
                    onSelect={folder => {
                      setDriveFolder(folder)
                      setShowFolderPicker(false)
                    }}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <span style={{ flex: 1, fontSize: '.875rem', color: driveFolder ? 'var(--s800)' : 'var(--s400)' }}>
                      {driveFolder ? `📁 ${driveFolder.name}` : 'Drive root'}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowFolderPicker(true)}>
                      {driveFolder ? 'Change' : 'Pick folder'}
                    </button>
                    {driveFolder && (
                      <button
                        onClick={() => setDriveFolder(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s400)', fontSize: '1rem', lineHeight: 1, padding: '.125rem .25rem' }}
                        title="Clear"
                      >×</button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleFillDocx} disabled={loadingDocx || !selectedDocx}>
                {loadingDocx
                  ? <><span className="spin" />&nbsp;Filling…</>
                  : uploadToDrive ? '↑ Fill & Upload' : '↓ Fill & Download'}
              </button>
            </div>
          </div>
        )}

        {/* ── GDoc tab ── */}
        {tab === 'gdoc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {gdocTemplates.length === 0 ? (
              <div style={{ color: 'var(--s400)', fontSize: '.875rem', textAlign: 'center', padding: '1.25rem 0' }}>
                No templates saved yet — add one below.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {gdocTemplates.map(tpl => (
                  <div
                    key={tpl.id}
                    style={{
                      padding: '.625rem .75rem', background: 'var(--s50)', borderRadius: 'var(--r-sm)',
                      border: `1.5px solid ${selectedGdoc === tpl.id ? 'var(--p400)' : 'var(--s200)'}`,
                      display: 'flex', flexDirection: 'column', gap: '.375rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <input
                        type="radio" name="gdoc-tpl" style={{ cursor: 'pointer', flexShrink: 0 }}
                        checked={selectedGdoc === tpl.id}
                        onChange={() => setSelectedGdoc(tpl.id)}
                      />
                      <span style={{ fontSize: '.875rem', fontWeight: 600, color: 'var(--s800)', flex: 1 }}>
                        {tpl.name}
                      </span>
                      <button onClick={() => removeGdocTemplate(tpl.id)} style={ROW_BTN} title="Remove">×</button>
                    </div>
                    <div style={{ paddingLeft: '1.5rem', fontSize: '.78rem', color: 'var(--s400)', wordBreak: 'break-all' }}>
                      ID: {tpl.docId}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', paddingLeft: '1.5rem' }}>
                      <label style={{ ...LABEL, marginBottom: 0, whiteSpace: 'nowrap', minWidth: 'max-content' }}>Output name</label>
                      <input
                        value={tpl.outputName}
                        onChange={e => updateGdocOutput(tpl.id, e.target.value)}
                        style={{ ...INPUT }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add template form */}
            <div style={{ background: 'var(--s50)', borderRadius: 'var(--r-sm)', padding: '.75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              <span style={LABEL}>Add Template</span>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addGdocTemplate() }}
                  placeholder="Template name"
                  style={{ ...INPUT, flex: '1 1 140px' }}
                />
                <input
                  value={newDocId}
                  onChange={e => setNewDocId(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addGdocTemplate() }}
                  placeholder="Google Doc ID"
                  style={{ ...INPUT, flex: '2 1 200px' }}
                />
                <button className="btn btn-outline-primary btn-sm" onClick={addGdocTemplate} style={{ whiteSpace: 'nowrap' }}>
                  Add
                </button>
              </div>
              <p style={{ fontSize: '.75rem', color: 'var(--s400)', margin: 0 }}>
                Doc ID from: docs.google.com/document/d/<strong>ID</strong>/edit
              </p>
            </div>

            {gdocLink && (
              <div className="inline-status show ok">
                <span>✓</span>
                Document created —{' '}
                <a href={gdocLink} target="_blank" rel="noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>
                  Open in Google Docs ↗
                </a>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleFillGdoc} disabled={loadingGdoc || !selectedGdoc}>
                {loadingGdoc ? <><span className="spin" />&nbsp;Creating…</> : '🔷 Create Google Doc'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
