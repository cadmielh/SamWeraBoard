import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { IDFields } from '../lib/api'
import type { Client, ScannedPerson } from '../types'
import { inferTipClient } from '../types'
import { useApp } from '../AppLayout'
import { useClienti } from '../lib/clienti'
import { EMPTY_ID_FIELDS } from '../lib/idFields'
import UploadZone from '../components/UploadZone'
import DriveFilePicker from '../components/DriveFilePicker'
import FieldsForm from '../components/FieldsForm'
import TemplateFiller from '../components/TemplateFiller'
import History from '../components/History'
import ScanQueue from '../components/ScanQueue'
import ClientDocSelector from '../components/ClientDocSelector'
import MultiPersonPreview from '../components/MultiPersonPreview'

// Internal source modes — 'buletin' = nou PF, 'societate' = nou PJ, 'client' = din portofoliu
type SourceMode = 'buletin' | 'societate' | 'client'
type Step = 1 | 2 | 3

const CONTENT_STYLE = {
  maxWidth: 860, margin: '0 auto', padding: '2rem 1.5rem',
  display: 'flex', flexDirection: 'column' as const, gap: '1.5rem',
}

export default function GenerareDocumentePage() {
  const { user, accessToken, toast, ocrMode, activeWorkspace } = useApp()
  const workspaceId = activeWorkspace?.id ?? ''
  const { clienti, loading: clientiLoading, add: addClient } = useClienti(workspaceId || null)

  const [hasStarted, setHasStarted] = useState(false)
  const [sourceMode, setSourceMode] = useState<SourceMode>('client')
  const [step, setStep] = useState<Step>(1)

  // Landing: sub-selecție pentru "Entitate nouă"
  const [newEntityHover, setNewEntityHover] = useState(false)

  // Buletin (nou PF) mode state
  const [fields, setFields] = useState<IDFields | null>(null)
  const [sourceFile, setSourceFile] = useState('')
  const [showDrivePicker, setShowDrivePicker] = useState(false)

  // Societate / Client mode state
  const [scannedPersons, setScannedPersons] = useState<ScannedPerson[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [searchParams] = useSearchParams()

  // Deep-link: navigare din ClientView (?clientId=...&mode=client)
  useEffect(() => {
    const clientId = searchParams.get('clientId')
    const mode = searchParams.get('mode') as SourceMode | null
    if (clientId && mode === 'client' && clienti.length > 0) {
      const found = clienti.find(c => c.id === clientId)
      if (found) {
        setSourceMode('client')
        setSelectedClient(found)
        setHasStarted(true)
        // PF cu date complete → direct la TemplateFiller
        const tipClient = inferTipClient(found)
        if (tipClient === 'PF' && isPFComplete(found)) {
          setStep(3)
        } else {
          setStep(2)
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, clienti])

  function isPFComplete(c: Client): boolean {
    const titular = c.titular
    if (!titular) return false
    // Cel puțin: CNP + Nume + Prenume
    return !!(titular.cnp && titular.nume && titular.prenume)
  }

  const startMode = (mode: SourceMode) => {
    setSourceMode(mode)
    setFields(null)
    setSourceFile('')
    setScannedPersons([])
    setSelectedClient(null)
    setShowDrivePicker(false)
    setStep(1)
    setHasStarted(true)
  }

  const goToLanding = () => {
    setHasStarted(false)
    setFields(null)
    setSourceFile('')
    setScannedPersons([])
    setSelectedClient(null)
    setShowDrivePicker(false)
    setStep(1)
  }

  // ── Buletin (nou PF) handlers ─────────────────────────────────────────────────

  const handleExtracted = useCallback(async (result: IDFields, filename: string) => {
    setFields(result)
    setSourceFile(filename)
    setStep(2)
    setShowDrivePicker(false)
    toast('Câmpuri extrase cu succes', 'ok')
    if (user) {
      try {
        await addDoc(collection(db, 'users', user.uid, 'extractions'), {
          createdAt: serverTimestamp(), sourceFile: filename, fields: result,
        })
      } catch { /* Firestore might not be configured yet */ }
    }
  }, [user, toast])

  const handleHistorySelect = (f: IDFields, filename: string) => {
    setSourceMode('buletin')
    setFields(f)
    setSourceFile(filename)
    setStep(2)
    setHasStarted(true)
  }

  // ── Societate (nou PJ) handlers ───────────────────────────────────────────────

  const handleScanQueueContinue = (persons: ScannedPerson[]) => {
    setScannedPersons(persons)
    setStep(3)
  }

  // ── Client din portofoliu handlers ────────────────────────────────────────────

  const handleClientSelect = (c: Client) => {
    setSelectedClient(c)
    const tipClient = inferTipClient(c)
    if (tipClient === 'PF' && isPFComplete(c)) {
      // Date PF complete → salt direct la TemplateFiller
      setStep(3)
    } else {
      setStep(2)
    }
  }

  const handleMultiPersonContinue = (persons: ScannedPerson[], updatedClient: Client) => {
    setScannedPersons(persons)
    setSelectedClient(updatedClient)
    setStep(3)
  }

  // PF cu date lipsă: scanare CI → completare + merging în selectedClient.titular
  const handlePFScanExtracted = useCallback(async (result: IDFields, filename: string) => {
    setFields(result)
    setSourceFile(filename)
    setStep(3)
    toast('Date CI extrase', 'ok')
    if (user) {
      try {
        await addDoc(collection(db, 'users', user.uid, 'extractions'), {
          createdAt: serverTimestamp(), sourceFile: filename, fields: result,
        })
      } catch {}
    }
  }, [user, toast])

  // ── Save client from TemplateFiller ──────────────────────────────────────────

  const handleClientSaved = useCallback(async (clientData: Client) => {
    if (!workspaceId || !user) return
    try {
      await addClient(workspaceId, clientData, user.uid)
      toast('Client salvat în portofoliu', 'ok')
    } catch (err: unknown) {
      toast((err as Error).message ?? 'Eroare la salvare client', 'err')
    }
  }, [workspaceId, user, addClient, toast])

  // ── Step labels ───────────────────────────────────────────────────────────────

  const getModeLabel = () => {
    if (sourceMode === 'client') return '📂 Client din portofoliu'
    if (sourceMode === 'societate') return '👥 Entitate nouă — PJ'
    return '📄 Entitate nouă — PF'
  }

  const getStepLabels = (): string[] => {
    if (sourceMode === 'buletin') return ['Scanează CI', 'Verifică', 'Completează']
    if (sourceMode === 'societate') return ['Configurează', 'Completează']
    if (selectedClient && inferTipClient(selectedClient) === 'PF') {
      return isPFComplete(selectedClient) ? ['Selectează', 'Completează'] : ['Selectează', 'Scanează CI', 'Completează']
    }
    return ['Selectează client', 'Verifică date', 'Completează']
  }

  const displayStep = sourceMode === 'societate' && step === 3 ? 2 : step

  return (
    <>
      {/* ══ TOP BAR ══ */}
      <div style={{
        background: '#fff', borderBottom: '1px solid var(--s200)',
        padding: '.5rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
      }}>
        {hasStarted ? (
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={goToLanding}
              style={{ display: 'flex', alignItems: 'center', gap: '.375rem', flexShrink: 0 }}
            >
              ← Schimbă modul
            </button>
            <div style={{
              fontSize: '.72rem', fontWeight: 700, color: 'var(--p600)',
              background: 'var(--p50)', padding: '.2rem .5rem', borderRadius: 4, whiteSpace: 'nowrap',
            }}>
              {getModeLabel()}
            </div>

            <nav style={{ display: 'flex', alignItems: 'center', gap: '.375rem', flex: 1 }}>
              {getStepLabels().map((label, i) => {
                const s = i + 1
                const active = displayStep === s
                const done = displayStep > s
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '.375rem' }}>
                    {i > 0 && <div style={{ width: 20, height: 1, background: done ? 'var(--p200)' : 'var(--s200)' }} />}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', opacity: done || active ? 1 : 0.4 }}>
                      <span style={{
                        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                        background: done ? 'var(--p500)' : active ? 'var(--p100)' : 'transparent',
                        color: done ? '#fff' : active ? 'var(--p600)' : 'var(--s400)',
                        border: done || active ? 'none' : '1.5px solid var(--s300)',
                        fontSize: '.65rem', fontWeight: 700,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {done ? '✓' : s}
                      </span>
                      <span style={{ fontSize: '.78rem', fontWeight: active ? 600 : 400, color: active ? 'var(--s800)' : 'var(--s400)', whiteSpace: 'nowrap' }}>
                        {label}
                      </span>
                    </div>
                  </div>
                )
              })}
            </nav>
          </>
        ) : (
          <span style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--s800)', flex: 1 }}>
            Generare documente
          </span>
        )}

        <span className={`chip ${ocrMode === 'claude' ? 'chip-primary' : 'chip-muted'}`} style={{ fontSize: '.68rem' }}>
          {ocrMode === 'claude' ? '✦ Claude' : '⚙ OCR Local'}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setHistoryOpen(h => !h)}>
          {historyOpen ? 'Închide' : 'Istoric'}
        </button>
      </div>

      <main style={CONTENT_STYLE}>

        {/* ══════════════ LANDING ══════════════ */}
        {!hasStarted && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ textAlign: 'center', paddingTop: '.5rem' }}>
              <h2 style={{ fontWeight: 700, fontSize: '1.2rem', color: 'var(--s800)', margin: 0 }}>
                Generare documente
              </h2>
              <p style={{ color: 'var(--s400)', fontSize: '.875rem', marginTop: '.375rem' }}>
                Alege sursa de date
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: 640, margin: '0 auto', width: '100%' }}>

              {/* Card 1: Client din portofoliu */}
              <LandingCard
                icon="📂"
                title="Client din portofoliu"
                desc="Selectează un client existent"
                bullets={[
                  'PF sau PJ detectat automat',
                  'Completează date lipsă prin scanare',
                  'Generează și arhivează documentele',
                ]}
                onClick={() => startMode('client')}
              />

              {/* Card 2: Entitate nouă — cu sub-selecție PF/PJ */}
              <div
                style={{
                  background: '#fff', border: `2px solid ${newEntityHover ? 'var(--p400)' : 'var(--s200)'}`,
                  borderRadius: 'var(--r-lg, 12px)', padding: '1.5rem 1.25rem',
                  display: 'flex', flexDirection: 'column', gap: '1rem',
                  boxShadow: newEntityHover ? '0 4px 16px rgba(99,102,241,.12)' : 'none',
                  transition: 'border-color .15s, box-shadow .15s',
                }}
                onMouseEnter={() => setNewEntityHover(true)}
                onMouseLeave={() => setNewEntityHover(false)}
              >
                <div style={{ fontSize: '2rem', lineHeight: 1 }}>➕</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--s800)', marginBottom: '.2rem' }}>
                    Entitate nouă
                  </div>
                  <div style={{ fontSize: '.78rem', color: 'var(--p600)', fontWeight: 600 }}>
                    Fără client salvat
                  </div>
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                  {['Persoană fizică sau juridică', 'Scanează CI sau introdu manual', 'Opțional: salvează ca client nou'].map(b => (
                    <li key={b} style={{ fontSize: '.8rem', color: 'var(--s500)', lineHeight: 1.4 }}>{b}</li>
                  ))}
                </ul>
                <div style={{ display: 'flex', gap: '.5rem', marginTop: 'auto' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => startMode('buletin')}
                    style={{
                      flex: 1, background: 'var(--b50, #eff6ff)', color: 'var(--b700, #1d4ed8)',
                      border: '1.5px solid var(--b200, #bfdbfe)', fontWeight: 700,
                    }}
                  >
                    Persoană Fizică
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => startMode('societate')}
                    style={{
                      flex: 1, background: 'var(--g50, #f0fdf4)', color: 'var(--g700, #15803d)',
                      border: '1.5px solid var(--g200, #bbf7d0)', fontWeight: 700,
                    }}
                  >
                    Persoană Juridică
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ NOU PF (buletin) ══════════════ */}
        {hasStarted && sourceMode === 'buletin' && (
          <>
            {step === 1 && (
              showDrivePicker
                ? <DriveFilePicker
                    accessToken={accessToken}
                    onExtracted={handleExtracted}
                    onToast={toast}
                    onClose={() => setShowDrivePicker(false)}
                  />
                : <UploadZone
                    accessToken={accessToken}
                    onExtracted={handleExtracted}
                    onToast={toast}
                    onShowDrivePicker={() => setShowDrivePicker(true)}
                    onManualEntry={() => { setFields(EMPTY_ID_FIELDS); setSourceFile('manual'); setStep(2) }}
                  />
            )}
            {step === 2 && fields && (
              <FieldsForm
                fields={fields}
                sourceFile={sourceFile}
                initialEditing={sourceFile === 'manual'}
                onFieldsChange={setFields}
                onNext={() => setStep(3)}
                onBack={() => { setStep(1); setFields(null) }}
              />
            )}
            {step === 3 && fields && (
              <TemplateFiller
                workspaceId={workspaceId}
                user={user}
                fields={fields}
                scannedPersons={[{
                  id: 'single', role: 'asociat', cotaParticipare: '',
                  fields, scanStatus: sourceFile === 'manual' ? 'manual' : 'scanned',
                }]}
                client={null}
                accessToken={accessToken}
                onToast={toast}
                onBack={() => setStep(2)}
                onClientSaved={handleClientSaved}
              />
            )}
          </>
        )}

        {/* ══════════════ NOU PJ (societate) ══════════════ */}
        {hasStarted && sourceMode === 'societate' && (
          <>
            {step === 1 && (
              <div className="card">
                <div className="card-head">
                  <span className="card-title">
                    <span className="step-chip">1</span>
                    Configurează echipa societății
                  </span>
                </div>
                <div className="card-body">
                  <ScanQueue
                    accessToken={accessToken}
                    onContinue={handleScanQueueContinue}
                    onToast={toast}
                  />
                </div>
              </div>
            )}
            {step === 3 && (
              <TemplateFiller
                workspaceId={workspaceId}
                user={user}
                fields={null}
                scannedPersons={scannedPersons}
                client={null}
                accessToken={accessToken}
                onToast={toast}
                onBack={() => setStep(1)}
                onClientSaved={handleClientSaved}
              />
            )}
          </>
        )}

        {/* ══════════════ CLIENT DIN PORTOFOLIU ══════════════ */}
        {hasStarted && sourceMode === 'client' && (
          <>
            {step === 1 && (
              <div className="card">
                <div className="card-head">
                  <span className="card-title">
                    <span className="step-chip">1</span>
                    Selectează client din portofoliu
                  </span>
                </div>
                <div className="card-body">
                  <ClientDocSelector
                    clients={clienti}
                    loading={clientiLoading}
                    onSelect={handleClientSelect}
                  />
                  {clienti.length === 0 && !clientiLoading && (
                    <p style={{ fontSize: '.85rem', color: 'var(--s400)', marginTop: '.75rem' }}>
                      Niciun client în portofoliu. Adaugă clienți din pagina Clienți.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: PF cu date lipsă → scanare CI */}
            {step === 2 && selectedClient && inferTipClient(selectedClient) === 'PF' && (
              <div className="card">
                <div className="card-head">
                  <div>
                    <span className="card-title">
                      <span className="step-chip">2</span>
                      Completează date CI
                    </span>
                    <p className="card-sub">{selectedClient.denumire} — date lipsă</p>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setStep(1); setSelectedClient(null) }}>← Înapoi</button>
                </div>
                <div className="card-body">
                  {showDrivePicker
                    ? <DriveFilePicker
                        accessToken={accessToken}
                        onExtracted={handlePFScanExtracted}
                        onToast={toast}
                        onClose={() => setShowDrivePicker(false)}
                      />
                    : <UploadZone
                        accessToken={accessToken}
                        onExtracted={handlePFScanExtracted}
                        onToast={toast}
                        onShowDrivePicker={() => setShowDrivePicker(true)}
                        onManualEntry={() => { setFields(EMPTY_ID_FIELDS); setSourceFile('manual'); setStep(3) }}
                      />
                  }
                </div>
              </div>
            )}

            {/* Step 2: PJ → MultiPersonPreview */}
            {step === 2 && selectedClient && inferTipClient(selectedClient) === 'PJ' && (
              <div className="card">
                <div className="card-head">
                  <div>
                    <span className="card-title">
                      <span className="step-chip">2</span>
                      Verifică datele persoanelor
                    </span>
                    <p className="card-sub">{selectedClient.denumire}</p>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setStep(1); setSelectedClient(null) }}>← Înapoi</button>
                </div>
                <div className="card-body">
                  <MultiPersonPreview
                    client={selectedClient}
                    accessToken={accessToken}
                    onContinue={handleMultiPersonContinue}
                    onToast={toast}
                  />
                </div>
              </div>
            )}

            {/* Step 3: TemplateFiller */}
            {step === 3 && selectedClient && (
              <TemplateFiller
                workspaceId={workspaceId}
                user={user}
                fields={fields}
                scannedPersons={scannedPersons}
                client={selectedClient}
                accessToken={accessToken}
                onToast={toast}
                onBack={() => {
                  const tipClient = inferTipClient(selectedClient)
                  if (tipClient === 'PF' && isPFComplete(selectedClient)) {
                    setStep(1)
                  } else {
                    setStep(2)
                  }
                }}
                onClientSaved={handleClientSaved}
              />
            )}
          </>
        )}
      </main>

      {historyOpen && user && (
        <History
          user={user}
          open={historyOpen}
          onSelect={handleHistorySelect}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </>
  )
}

function LandingCard({ icon, title, desc, bullets, onClick }: {
  icon: string
  title: string
  desc: string
  bullets: string[]
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff', border: `2px solid ${hovered ? 'var(--p400)' : 'var(--s200)'}`,
        borderRadius: 'var(--r-lg, 12px)', padding: '1.5rem 1.25rem',
        cursor: 'pointer', textAlign: 'left', display: 'flex',
        flexDirection: 'column', gap: '1rem',
        boxShadow: hovered ? '0 4px 16px rgba(99,102,241,.12)' : 'none',
        transition: 'border-color .15s, box-shadow .15s',
        fontFamily: 'var(--font)',
      }}
    >
      <div style={{ fontSize: '2rem', lineHeight: 1 }}>{icon}</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--s800)', marginBottom: '.2rem' }}>{title}</div>
        <div style={{ fontSize: '.78rem', color: 'var(--p600)', fontWeight: 600 }}>{desc}</div>
      </div>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
        {bullets.map(b => (
          <li key={b} style={{ fontSize: '.8rem', color: 'var(--s500)', lineHeight: 1.4 }}>{b}</li>
        ))}
      </ul>
      <div style={{
        marginTop: 'auto', fontSize: '.825rem', fontWeight: 700,
        color: 'var(--p600)', display: 'flex', alignItems: 'center', gap: '.3rem',
      }}>
        Pornește <span style={{ fontSize: '1rem' }}>→</span>
      </div>
    </button>
  )
}
