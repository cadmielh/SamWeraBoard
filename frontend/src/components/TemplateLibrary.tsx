import { useState, useRef } from 'react'
import type { DocTemplate, ToastItem } from '../types'
import type { TemplateInput } from '../lib/templates'

type TipTemplate = 'universal' | 'PF' | 'PJ'
const TIP_TEMPLATE_OPTIONS: { value: TipTemplate; label: string }[] = [
  { value: 'universal', label: 'Universal (PF + PJ)' },
  { value: 'PF', label: 'Persoană Fizică' },
  { value: 'PJ', label: 'Persoană Juridică' },
]
import { detectPlaceholders } from '../lib/api'
import Modal from './Modal'

const MAX_BASE64_BYTES = 500 * 1024  // 500 KB

interface Props {
  templates: DocTemplate[]
  accessToken: string
  onAdd: (data: TemplateInput) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onClose: () => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

type AddTab = 'docx' | 'gdoc'
type View = 'list' | 'add' | 'guide'

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
    items: ['{{CNP}}', '{{NUME}}', '{{PRENUME}}', '{{SERIE_NUMAR}}', '{{DATA_NASTERII}}', '{{LOCUL_NASTERII}}', '{{CETATENIA}}', '{{ADRESA}}', '{{JUDET}}', '{{EMISA_DE}}', '{{VALABILA_DE_LA}}', '{{VALABILA_PANA_LA}}'],
  },
  {
    title: 'Entitate / Societate',
    items: [
      '{{SOCIETATE_DENUMIRE}}', '{{SOCIETATE_CIF}}', '{{SOCIETATE_NR_REG}}', '{{SOCIETATE_SEDIU}}', '{{SOCIETATE_FORMA_JURIDICA}}',
      '{{CAPITAL_SOCIAL_TOTAL}}', '{{PARTI_SOCIALE_TOTALE}}',
      '{{CAEN_1}} (principală, format "cod - descriere")', '{{CAEN_2}}, {{CAEN_3}}… (secundare, în ordinea adăugării)',
    ],
  },
  {
    title: 'Asociați — PJ (N = 1, 2, 3 …)',
    items: [
      '{{ASOCIAT_N_NUME}}', '{{ASOCIAT_N_PRENUME}}', '{{ASOCIAT_N_CNP}}', '{{ASOCIAT_N_ADRESA}}', '{{ASOCIAT_N_DATA_NASTERII}}', '{{ASOCIAT_N_LOCUL_NASTERII}}', '{{ASOCIAT_N_CETATENIA}}', '{{ASOCIAT_N_SERIE_NUMAR}}', '{{ASOCIAT_N_EMISA_DE}}', '{{ASOCIAT_N_VALABILA_DE_LA}}', '{{ASOCIAT_N_VALABILA_PANA_LA}}', '{{ASOCIAT_N_COTA_PARTICIPARE}}',
      '{{COTA_ASOCIAT_N}}', '{{CAPITAL_SOCIAL_ASOCIAT_N}}', '{{PARTI_SOCIALE_ASOCIAT_N}}',
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
    title: 'Blocuri repetitive — un paragraf per persoană (doar .docx)',
    items: [
      '{{#ASOCIATI}} ... {{/ASOCIATI}} — paragraful/paragrafele dintre cele două marcaje se repetă o dată pentru fiecare asociat',
      '{{#ADMINISTRATORI}} ... {{/ADMINISTRATORI}} — la fel, pentru administratori',
      'În interiorul blocului: {{NUME}}, {{PRENUME}}, {{CNP}}, {{ADRESA}}, {{JUDET}}, {{DATA_NASTERII}}, {{LOCUL_NASTERII}}, {{CETATENIA}}, {{SERIE_NUMAR}}, {{EMISA_DE}}, {{VALABILA_DE_LA}}, {{VALABILA_PANA_LA}}, {{COTA_PARTICIPARE}}',
      '{{INDEX}} — numărul de ordine (1, 2, 3…) în cadrul blocului',
      '{{CAPITAL_SOCIAL}}, {{PARTI_SOCIALE}} — doar în {{#ASOCIATI}}, calculate din cota asociatului',
    ],
  },
  {
    title: 'Date automate',
    items: ['{{DATA_AZI}}', '{{DATA_CURENTA}}', '{{LUNA_AZI}}', '{{AN_AZI}}'],
  },
]

export default function TemplateLibrary({ templates, accessToken, onAdd, onRemove, onClose, onToast }: Props) {
  const [view, setView] = useState<View>('list')
  const [addTab, setAddTab] = useState<AddTab>('docx')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // docx add form state
  const [docxFile, setDocxFile] = useState<File | null>(null)
  const [docxName, setDocxName] = useState('')
  const [docxDesc, setDocxDesc] = useState('')
  const [docxOutput, setDocxOutput] = useState('')
  const [docxPlaceholders, setDocxPlaceholders] = useState<string[]>([])
  const [docxTip, setDocxTip] = useState<TipTemplate>('universal')
  const [detecting, setDetecting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // gdoc add form state
  const [gdocName, setGdocName] = useState('')
  const [gdocDocId, setGdocDocId] = useState('')
  const [gdocDesc, setGdocDesc] = useState('')
  const [gdocOutput, setGdocOutput] = useState('')
  const [gdocTip, setGdocTip] = useState<TipTemplate>('universal')

  const handleDocxFileSelect = async (f: File) => {
    setDocxFile(f)
    setDocxName(prev => prev || f.name.replace(/\.[^.]+$/, ''))
    setDocxOutput(prev => prev || `${f.name.replace(/\.[^.]+$/, '')}_completat.docx`)
    setDetecting(true)
    try {
      const phs = await detectPlaceholders(f, accessToken)
      setDocxPlaceholders(phs)
    } catch {
      setDocxPlaceholders([])
    } finally {
      setDetecting(false)
    }
  }

  const handleAddDocx = async () => {
    if (!docxFile || !docxName.trim()) { onToast('Selectează un fișier și introdu un nume', 'err'); return }
    if (docxFile.size > MAX_BASE64_BYTES) {
      onToast('Fișierul depășește 500 KB. Încarcă-l pe Google Drive și adaugă-l prin Drive ID.', 'err')
      return
    }
    setSaving(true)
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res((reader.result as string).split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(docxFile)
      })
      await onAdd({
        name: docxName.trim(),
        description: docxDesc.trim(),
        type: 'docx',
        fileBase64: base64,
        fileName: docxFile.name,
        placeholders: docxPlaceholders,
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

  const handleAddGdoc = async () => {
    if (!gdocName.trim() || !gdocDocId.trim()) { onToast('Introdu numele și ID-ul documentului', 'err'); return }
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

  const resetDocxForm = () => { setDocxFile(null); setDocxName(''); setDocxDesc(''); setDocxOutput(''); setDocxPlaceholders([]); setDocxTip('universal') }
  const resetGdocForm = () => { setGdocName(''); setGdocDocId(''); setGdocDesc(''); setGdocOutput(''); setGdocTip('universal') }

  return (
    <Modal
      onClose={onClose}
      ariaLabel="Biblioteca de șabloane"
      backdropStyle={{ background: 'rgba(15,23,42,.4)', alignItems: 'stretch', justifyContent: 'flex-end', padding: 0 }}
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
              {templates.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--s400)', fontSize: '.875rem', padding: '2rem 0' }}>
                  Niciun șablon adăugat.<br />
                  <button className="btn btn-outline-primary btn-sm" style={{ marginTop: '.75rem' }} onClick={() => setView('add')}>+ Adaugă primul șablon</button>
                </div>
              )}
              {templates.map(tpl => (
                <div key={tpl.id} style={{ background: 'var(--s50)', border: '1.5px solid var(--s200)', borderRadius: 'var(--r-sm)', padding: '.75rem .875rem', display: 'flex', flexDirection: 'column', gap: '.375rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '.75rem', fontWeight: 700, padding: '.1rem .4rem', borderRadius: 3, background: tpl.type === 'docx' ? 'var(--b50, #eff6ff)' : 'var(--p50)', color: tpl.type === 'docx' ? 'var(--b700, #1d4ed8)' : 'var(--p700)' }}>
                      {tpl.type === 'docx' ? 'DOCX' : 'GDoc'}
                    </span>
                    {tpl.tipTemplate && tpl.tipTemplate !== 'universal' && (
                      <span style={{
                        fontSize: '.68rem', fontWeight: 700, padding: '.1rem .35rem', borderRadius: 3,
                        background: tpl.tipTemplate === 'PF' ? 'var(--b100, #dbeafe)' : 'var(--g100, #dcfce7)',
                        color: tpl.tipTemplate === 'PF' ? 'var(--b700, #1d4ed8)' : 'var(--g700, #15803d)',
                      }}>
                        {tpl.tipTemplate}
                      </span>
                    )}
                    <span style={{ flex: 1, fontWeight: 600, fontSize: '.9rem', color: 'var(--s800)' }}>{tpl.name}</span>
                    {tpl.type === 'docx' && tpl.fileBase64 && (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDownload(tpl)} title="Descarcă șablon original" style={{ fontSize: '.75rem' }}>⬇</button>
                    )}
                    <button
                      onClick={() => handleRemove(tpl.id)}
                      disabled={removingId === tpl.id}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--r500)', fontSize: '1rem', padding: '.125rem .3rem', borderRadius: 4 }}
                      title="Șterge"
                    >
                      {removingId === tpl.id ? <span className="spin" /> : '🗑'}
                    </button>
                  </div>
                  {tpl.description && <div style={{ fontSize: '.78rem', color: 'var(--s500)' }}>{tpl.description}</div>}
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
                </div>
              ))}
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
                    background: addTab === t ? '#fff' : 'transparent',
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
                  {/* File picker */}
                  <div>
                    <label style={LABEL}>Fișier .docx</label>
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
                      <p style={{ color: 'var(--r500)', fontSize: '.78rem', marginTop: '.375rem' }}>
                        Fișierul depășește 500 KB. Te rugăm să-l încarci pe Google Drive și să-l adaugi prin ID Drive.
                      </p>
                    )}
                  </div>

                  {/* Detected placeholders */}
                  {detecting && <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}><span className="spin" /> Detectare placeholder-e…</div>}
                  {!detecting && docxPlaceholders.length > 0 && (
                    <div>
                      <div style={LABEL}>Placeholder-e detectate ({docxPlaceholders.length})</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginTop: '.25rem' }}>
                        {docxPlaceholders.map(ph => <PlaceholderBadge key={ph} ph={ph} />)}
                      </div>
                    </div>
                  )}
                  {!detecting && docxFile && docxPlaceholders.length === 0 && (
                    <div style={{ fontSize: '.8rem', color: 'var(--s400)' }}>Nu s-au detectat placeholder-e. Asigură-te că folosești formatul <code style={{ background: 'var(--s100)', padding: '.1rem .3rem', borderRadius: 3 }}>{'{{CAMP}}'}</code>.</div>
                  )}

                  <div>
                    <label style={LABEL}>Nume șablon *</label>
                    <input value={docxName} onChange={e => setDocxName(e.target.value)} placeholder="ex: Contract de asociere" style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Descriere (opțional)</label>
                    <input value={docxDesc} onChange={e => setDocxDesc(e.target.value)} placeholder="Scurtă descriere…" style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Tip șablon</label>
                    <select value={docxTip} onChange={e => setDocxTip(e.target.value as TipTemplate)} style={{ ...INPUT, appearance: 'auto' }}>
                      {TIP_TEMPLATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={LABEL}>Numele fișierului generat</label>
                    <input value={docxOutput} onChange={e => setDocxOutput(e.target.value)} placeholder="ex: contract_{{SOCIETATE_DENUMIRE}}_{{DATA_AZI}}.docx" style={INPUT} />
                    <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '.25rem' }}>Poți folosi placeholder-e și în numele fișierului.</p>
                  </div>

                  <button className="btn btn-primary" onClick={handleAddDocx} disabled={saving || !docxFile || !docxName.trim()}>
                    {saving ? <><span className="spin" />&nbsp;Salvează…</> : '💾 Salvează șablon'}
                  </button>
                </div>
              )}

              {addTab === 'gdoc' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
                  <div>
                    <label style={LABEL}>Nume șablon *</label>
                    <input value={gdocName} onChange={e => setGdocName(e.target.value)} placeholder="ex: Contract SRL" style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Google Doc ID *</label>
                    <input value={gdocDocId} onChange={e => setGdocDocId(e.target.value)} placeholder="ID din URL: /document/d/ID/edit" style={INPUT} />
                    <p style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '.25rem' }}>
                      Copiază ID-ul din: docs.google.com/document/d/<strong>ID</strong>/edit
                    </p>
                  </div>
                  <div>
                    <label style={LABEL}>Descriere (opțional)</label>
                    <input value={gdocDesc} onChange={e => setGdocDesc(e.target.value)} placeholder="Scurtă descriere…" style={INPUT} />
                  </div>
                  <div>
                    <label style={LABEL}>Tip șablon</label>
                    <select value={gdocTip} onChange={e => setGdocTip(e.target.value as TipTemplate)} style={{ ...INPUT, appearance: 'auto' }}>
                      {TIP_TEMPLATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={LABEL}>Numele documentului generat</label>
                    <input value={gdocOutput} onChange={e => setGdocOutput(e.target.value)} placeholder="ex: contract_{{SOCIETATE_DENUMIRE}}" style={INPUT} />
                  </div>
                  <button className="btn btn-primary" onClick={handleAddGdoc} disabled={saving || !gdocName.trim() || !gdocDocId.trim()}>
                    {saving ? <><span className="spin" />&nbsp;Salvează…</> : '💾 Salvează șablon'}
                  </button>
                </div>
              )}
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
    </Modal>
  )
}

const LABEL: React.CSSProperties = {
  fontSize: '.695rem', fontWeight: 700, color: 'var(--s500)',
  letterSpacing: '.05em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem',
}
const INPUT: React.CSSProperties = {
  padding: '.375rem .625rem', borderRadius: 'var(--r-sm)',
  border: '1.5px solid var(--s300)', fontSize: '.875rem',
  color: 'var(--s800)', background: '#fff', width: '100%',
  fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box',
}
