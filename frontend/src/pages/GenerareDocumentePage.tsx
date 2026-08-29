import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { IDFields } from '../lib/api'
import type { Client, ScannedPerson } from '../types'
import { inferTipClient } from '../types'
import { useApp } from '../AppContext'
import { useClienti, EMPTY_CLIENT, EMPTY_PERSOANA, type ClientInput } from '../lib/clienti'
import { EMPTY_ID_FIELDS, idFieldsToPersoana, persoanaToIDFields } from '../lib/idFields'
import UploadZone from '../components/UploadZone'
import DriveFilePicker from '../components/DriveFilePicker'
import FieldsForm from '../components/FieldsForm'
import TemplateFiller from '../components/TemplateFiller'
import History from '../components/History'
import ScanQueue from '../components/ScanQueue'
import ClientDocSelector from '../components/ClientDocSelector'
import MultiPersonPreview, { type MultiPersonPreviewHandle } from '../components/MultiPersonPreview'
import ClientModal from '../components/ClientModal'
import PersonScanModal from '../components/PersonScanModal'
import ConfirmModal from '../components/ConfirmModal'

// Internal source modes — 'buletin' = nou PF, 'societate' = nou PJ, 'client' = din portofoliu
type SourceMode = 'buletin' | 'societate' | 'client'
type Step = 1 | 2 | 3

// Echipa scanată la Pasul 1 devine profilul inițial pentru ClientModal la
// Pasul 2 — același formular complet (date fiscale, verificare unicitate
// denumire) folosit peste tot, nu un formular trunchiat separat, ca să nu mai
// existe două surse divergente de date pentru o entitate nouă.
function scannedPersonsToClientInitial(persons: ScannedPerson[]): Client {
  const toPersoana = (p: ScannedPerson, calitate: string) =>
    idFieldsToPersoana(p.fields, { ...EMPTY_PERSOANA, calitate, cotaParticipare: p.cotaParticipare })
  return {
    id: '', createdAt: null, createdBy: '', denumireLower: '',
    ...EMPTY_CLIENT,
    tipClient: 'PJ',
    asociati: persons.filter(p => p.role === 'asociat').map(p => toPersoana(p, 'Asociat')),
    administratori: persons.filter(p => p.role === 'administrator').map(p => toPersoana(p, 'Administrator')),
  } as Client
}

// Containerul <main> are mereu aceeași lățime, indiferent de pas sau de
// conținutul intern — altfel orice element care refuză să se comprimă undeva
// în interior (ex. un formular cu mai multe câmpuri pe rând) putea forța tot
// cadrul, inclusiv poziția lui, să se schimbe de la un ecran la altul.
// Ecranele care nu au nevoie de atâta lățime (landing, pașii 1-2) își
// centrează propriul conținut în COMPACT_STYLE; Pasul 3 (TemplateFiller)
// folosește tot spațiul, fără alt wrapper.
const CONTENT_STYLE = {
  // <main> e el însuși un element flex, copil al .main-area (tot flex,
  // coloană) — margin:'0 auto' pune margini orizontale "auto", care în
  // flexbox DEZACTIVEAZĂ explicit stretch-ul implicit pe axa respectivă.
  // Fără width explicit, <main> cădea pe dimensionare "shrink-to-fit" după
  // propriul conținut, exact sursa reală a instabilității de la Pasul 3 —
  // nu ceva din interiorul cardului, ci <main> însuși.
  width: '100%', maxWidth: 1400, margin: '0 auto', padding: '2rem 1.5rem',
  display: 'flex', flexDirection: 'column' as const, gap: '1.5rem',
}
const COMPACT_STYLE = { maxWidth: 860, margin: '0 auto', width: '100%' }

export default function GenerareDocumentePage() {
  const { user, accessToken, toast, activeWorkspace } = useApp()
  const workspaceId = activeWorkspace?.id ?? ''
  const { clienti, loading: clientiLoading, add: addClient, update: updateClient } = useClienti(workspaceId || null)

  const [hasStarted, setHasStarted] = useState(false)
  const [sourceMode, setSourceMode] = useState<SourceMode>('client')
  const [step, setStep] = useState<Step>(1)

  // Buletin (nou PF) mode state
  const [fields, setFields] = useState<IDFields | null>(null)
  const [sourceFile, setSourceFile] = useState('')
  const [showDrivePicker, setShowDrivePicker] = useState(false)

  // Societate / Client mode state
  const [scannedPersons, setScannedPersons] = useState<ScannedPerson[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  // Datele complete de client colectate prin ClientModal la Pasul 2 — nu se
  // salvează încă în Firestore (asta rămâne opțional, la Pasul 3, ca înainte),
  // doar alimentează TemplateFiller.
  const [societateClientInput, setSocietateClientInput] = useState<ClientInput | null>(null)
  // ClientModal apelează mereu onClose imediat după un onSave reușit (se
  // comportă ca un modal obișnuit) — fără acest flag, acel onClose ar anula
  // imediat avansarea la Pasul 3 declanșată chiar de acel onSave.
  const societateJustSavedRef = useRef(false)
  const [pfScanMode, setPfScanMode] = useState<'scan' | 'manual' | null>(null)
  // Buton "Continuă" duplicat sus, lângă "Înapoi" — mereu activ; la click,
  // MultiPersonPreview validează singur și sare la primul câmp lipsă dacă e cazul.
  const multiPersonRef = useRef<MultiPersonPreviewHandle>(null)
  // Modificările din MultiPersonPreview se aplică local imediat (pentru
  // completarea template-ului); salvarea în Firestore e opțională, cerută
  // explicit printr-un modal de confirmare — nu se scrie automat în DB.
  const [pendingClientSave, setPendingClientSave] = useState<{ id: string; fields: Partial<ClientInput> } | null>(null)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [searchParams] = useSearchParams()

  // Deep-link din ClientView (?clientId=...&mode=client) — calculat sincron,
  // din primul render, ca să nu se vadă o clipă pagina de start înainte ca
  // lista de clienți să se încarce și efectul de mai jos să aplice link-ul.
  const [deepLinkPending, setDeepLinkPending] = useState(
    () => searchParams.get('mode') === 'client' && !!searchParams.get('clientId')
  )

  // Deep-link: navigare din ClientView (?clientId=...&mode=client) — se aplică
  // o singură dată, la intrarea în pagină. Fără gardă pe `hasStarted`, orice
  // schimbare ulterioară a listei `clienti` (ex. salvarea datelor editate în
  // verificare) re-declanșează efectul și anulează progresul din "Continuă".
  // Rămâne pe pasul 1 — selecția + verificarea sunt comasate acolo.
  useEffect(() => {
    if (hasStarted || !deepLinkPending) return
    const clientId = searchParams.get('clientId')
    const mode = searchParams.get('mode') as SourceMode | null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!clientId || mode !== 'client') { setDeepLinkPending(false); return }
    if (clientiLoading) return // așteaptă încărcarea listei, fără să renunțe încă
    const found = clienti.find(c => c.id === clientId)
    if (found) {
      setSourceMode('client')
      setSelectedClient(found)
      setHasStarted(true)
    }
    setDeepLinkPending(false)
  }, [searchParams, clienti, clientiLoading, hasStarted, deepLinkPending])

  const startMode = (mode: SourceMode) => {
    setSourceMode(mode)
    setFields(null)
    setSourceFile('')
    setScannedPersons([])
    setSelectedClient(null)
    setSocietateClientInput(null)
    setShowDrivePicker(false)
    setStep(1)
    setHasStarted(true)
  }

  const goToLanding = () => {
    setDeepLinkPending(false)
    setHasStarted(false)
    setFields(null)
    setSourceFile('')
    setScannedPersons([])
    setSelectedClient(null)
    setSocietateClientInput(null)
    setShowDrivePicker(false)
    setStep(1)
  }

  // Navigare "un pas înapoi" — aceeași logică e folosită atât de butonul
  // mereu vizibil din bara de sus, cât și de butoanele locale din fiecare card,
  // ca să nu existe două căi de întoarcere cu comportamente diferite.
  const handleStepBack = () => {
    if (step === 3) {
      // "client" comasează selectarea + verificarea pe pasul 1 — nu există
      // pas 2 vizual la care să se întoarcă, sare direct la 1 (selecția
      // rămâne, ca userul să nu reintroducă nimic).
      setStep(sourceMode === 'client' ? 1 : 2)
      return
    }
    if (step !== 2) return
    if (sourceMode === 'buletin') { setStep(1); setFields(null); return }
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
    setStep(2)
  }

  // ── Client din portofoliu handlers ────────────────────────────────────────────

  // Selectarea nu mai schimbă pasul — verificarea apare inline, sub selector,
  // pe același ecran (Pasul 1).
  const handleClientSelect = (c: Client) => {
    setSelectedClient(c)
  }

  const handleMultiPersonContinue = (persons: ScannedPerson[], updatedClient: Client) => {
    const syncedFields: Partial<ClientInput> = {
      denumire: updatedClient.denumire,
      formaJuridica: updatedClient.formaJuridica,
      codFiscal: updatedClient.codFiscal,
      nrRegistrul: updatedClient.nrRegistrul,
      sediuSocial: updatedClient.sediuSocial,
      caenCod: updatedClient.caenCod,
      caenDescriere: updatedClient.caenDescriere,
      caenSecundare: updatedClient.caenSecundare,
      capitalSocial: updatedClient.capitalSocial,
      asociati: updatedClient.asociati,
      administratori: updatedClient.administratori,
    }
    const originalFields = selectedClient && {
      denumire: selectedClient.denumire,
      formaJuridica: selectedClient.formaJuridica,
      codFiscal: selectedClient.codFiscal,
      nrRegistrul: selectedClient.nrRegistrul,
      sediuSocial: selectedClient.sediuSocial,
      caenCod: selectedClient.caenCod,
      caenDescriere: selectedClient.caenDescriere,
      caenSecundare: selectedClient.caenSecundare,
      capitalSocial: selectedClient.capitalSocial,
      asociati: selectedClient.asociati,
      administratori: selectedClient.administratori,
    }
    const hasChanges = JSON.stringify(originalFields) !== JSON.stringify(syncedFields)

    setScannedPersons(persons)
    setSelectedClient(updatedClient)
    setStep(3)

    if (hasChanges && workspaceId && updatedClient.id) {
      setPendingClientSave({ id: updatedClient.id, fields: syncedFields })
    }
  }

  const confirmPendingClientSave = async () => {
    if (!pendingClientSave || !workspaceId) return
    const { id, fields } = pendingClientSave
    setPendingClientSave(null)
    try {
      await updateClient(workspaceId, id, fields)
      toast('Datele clientului au fost actualizate', 'ok')
    } catch (err: unknown) {
      toast((err as Error).message ?? 'Eroare la actualizarea clientului', 'err')
    }
  }

  // PF client din portofoliu: scanare/editare CI → merge local în
  // selectedClient.titular, rămâne pe pasul de verificare. Nu se mai
  // salvează automat aici — la fel ca la PJ, salvarea în Firestore se cere
  // explicit (modal de confirmare) o singură dată, la "Continuă la template".
  const handlePFPersonUpdate = useCallback(async (result: IDFields) => {
    if (!selectedClient) return
    const updatedTitular = idFieldsToPersoana(result, selectedClient.titular ?? { ...EMPTY_PERSOANA, calitate: 'Titular' })
    setSelectedClient({ ...selectedClient, titular: updatedTitular })
    setPfScanMode(null)
    toast('Date actualizate', 'ok')

    if (user) {
      try {
        await addDoc(collection(db, 'users', user.uid, 'extractions'), {
          createdAt: serverTimestamp(), sourceFile: pfScanMode === 'manual' ? 'manual' : 'scan', fields: result,
        })
      } catch { /* log non-critic — nu blocăm fluxul dacă eșuează */ }
    }
  }, [user, toast, selectedClient, pfScanMode])

  const handlePFContinue = () => {
    if (!selectedClient) return
    const original = clienti.find(c => c.id === selectedClient.id)
    const hasChanges = JSON.stringify(original?.titular ?? null) !== JSON.stringify(selectedClient.titular ?? null)

    setStep(3)
    if (hasChanges && workspaceId && selectedClient.id) {
      setPendingClientSave({ id: selectedClient.id, fields: { titular: selectedClient.titular } })
    }
  }

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
    if (sourceMode === 'societate') return '🏢 Entitate nouă — PJ'
    return '🪪 Entitate nouă — PF'
  }

  // `num` e valoarea reală a pasului (comparată cu `step`), nu poziția din
  // listă — pentru "client din portofoliu", selectarea și verificarea sunt
  // comasate pe un singur ecran (pasul 1), deci pasul 2 nu mai există vizual
  // și se sare direct la 3.
  const getStepLabels = (): { num: Step; label: string }[] => {
    if (sourceMode === 'buletin') return [
      { num: 1, label: 'Scanează CI' }, { num: 2, label: 'Verifică' }, { num: 3, label: 'Completează' },
    ]
    if (sourceMode === 'societate') return [
      { num: 1, label: 'Configurează echipa' }, { num: 2, label: 'Date client' }, { num: 3, label: 'Completează' },
    ]
    return [{ num: 1, label: 'Selectează și verifică' }, { num: 3, label: 'Completează' }]
  }

  return (
    <>
      {/* ══ TOP BAR — sticky, ca navigarea înapoi să rămână mereu vizibilă, indiferent de scroll ══ */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--s200)',
        padding: '.5rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        {hasStarted ? (
          <>
            {step > 1 && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleStepBack}
                style={{ display: 'flex', alignItems: 'center', gap: '.375rem', flexShrink: 0 }}
              >
                ← Pasul anterior
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={goToLanding}
              style={{ display: 'flex', alignItems: 'center', gap: '.375rem', flexShrink: 0 }}
            >
              ← Generare documente
            </button>
            <div style={{
              fontSize: '.72rem', fontWeight: 700, color: 'var(--p600)',
              background: 'var(--p50)', padding: '.2rem .5rem', borderRadius: 4, whiteSpace: 'nowrap',
            }}>
              {getModeLabel()}
            </div>

            <nav style={{ display: 'flex', alignItems: 'center', gap: '.375rem', flex: 1 }}>
              {getStepLabels().map(({ num: s, label }, i) => {
                const active = step === s
                const done = step > s
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
                        {done ? '✓' : i + 1}
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

        <button className="btn btn-ghost btn-sm" onClick={() => setHistoryOpen(h => !h)}>
          {historyOpen ? 'Închide' : 'Istoric'}
        </button>
      </div>

      <main style={CONTENT_STYLE}>
        {/* key nou la fiecare schimbare de ecran → React remontează, deci
            animația de fade rulează din nou; orientează vizual userul că s-a
            schimbat conținutul, fără o tranziție bruscă. */}
        <div key={`${hasStarted ? sourceMode : 'landing'}-${step}`} className="step-transition">

        {/* Deep-link în curs de rezolvare — evită să se vadă o clipă pagina
            de start înainte ca lista de clienți să se încarce. */}
        {!hasStarted && deepLinkPending && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <span className="spin spin-dark" style={{ width: 22, height: 22, borderWidth: 3 }} />
          </div>
        )}

        {/* ══════════════ LANDING ══════════════ */}
        {!hasStarted && !deepLinkPending && (
          <div style={{ ...COMPACT_STYLE, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ textAlign: 'center', paddingTop: '.5rem' }}>
              <h2 style={{ fontWeight: 700, fontSize: '1.2rem', color: 'var(--s800)', margin: 0 }}>
                Generare documente
              </h2>
              <p style={{ color: 'var(--s400)', fontSize: '.875rem', marginTop: '.375rem' }}>
                Alege sursa de date
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', width: '100%' }}>

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

              {/* Card 2: Entitate nouă — PJ */}
              <LandingCard
                icon="🏢"
                title="Entitate nouă — PJ"
                desc="Fără client salvat"
                examples="SRL, SA, SCS, etc."
                accent="g"
                bullets={[
                  'Scanează echipa (asociați, administratori)',
                  'Completezi datele complete ale firmei',
                  'Opțional: salvează ca client nou',
                ]}
                onClick={() => startMode('societate')}
              />

              {/* Card 3: Entitate nouă — PF */}
              <LandingCard
                icon="🪪"
                title="Entitate nouă — PF"
                desc="Fără client salvat"
                examples="PFA, II, IF, etc."
                accent="b"
                bullets={[
                  'Scanează buletinul (CI)',
                  'Verifici și completezi datele',
                  'Opțional: salvează ca client nou',
                ]}
                onClick={() => startMode('buletin')}
              />
            </div>
          </div>
        )}

        {/* ══════════════ NOU PF (buletin) ══════════════ */}
        {hasStarted && sourceMode === 'buletin' && (
          <>
            {step === 1 && (
              <div style={COMPACT_STYLE}>
                {showDrivePicker
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
                }
              </div>
            )}
            {step === 2 && fields && (
              <div style={COMPACT_STYLE}>
                <FieldsForm
                  fields={fields}
                  sourceFile={sourceFile}
                  onFieldsChange={setFields}
                  onNext={() => setStep(3)}
                  onBack={handleStepBack}
                />
              </div>
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
                onBack={handleStepBack}
                onClientSaved={handleClientSaved}
              />
            )}
          </>
        )}

        {/* ══════════════ NOU PJ (societate) ══════════════ */}
        {hasStarted && sourceMode === 'societate' && (
          <>
            {step === 1 && (
              <div style={COMPACT_STYLE} className="card">
                <div className="card-head">
                  <span className="card-title">
                    <span className="step-chip">1</span>
                    Configurează echipa societății
                  </span>
                </div>
                <div className="card-body">
                  <ScanQueue
                    accessToken={accessToken}
                    initialPersons={scannedPersons}
                    onContinue={handleScanQueueContinue}
                    onToast={toast}
                  />
                </div>
              </div>
            )}
            {step === 2 && (
              <>
                <div style={COMPACT_STYLE} className="card">
                  <div className="card-head">
                    <span className="card-title">
                      <span className="step-chip">2</span>
                      Date client
                    </span>
                  </div>
                  <div className="card-body">
                    <p className="card-sub" style={{ margin: 0 }}>
                      Completează profilul complet al societății — aceleași câmpuri ca la un client din portofoliu.
                    </p>
                  </div>
                </div>
                <ClientModal
                  initial={scannedPersonsToClientInitial(scannedPersons)}
                  onSave={async data => {
                    societateJustSavedRef.current = true
                    setSocietateClientInput(data)
                    setStep(3)
                  }}
                  onClose={() => {
                    if (societateJustSavedRef.current) { societateJustSavedRef.current = false; return }
                    handleStepBack()
                  }}
                />
              </>
            )}
            {step === 3 && (
              <TemplateFiller
                workspaceId={workspaceId}
                user={user}
                fields={null}
                scannedPersons={scannedPersons}
                client={societateClientInput}
                accessToken={accessToken}
                onToast={toast}
                onBack={handleStepBack}
                onClientSaved={handleClientSaved}
              />
            )}
          </>
        )}

        {/* ══════════════ CLIENT DIN PORTOFOLIU ══════════════ */}
        {hasStarted && sourceMode === 'client' && (
          <>
            {step === 1 && (
              <>
                <div style={COMPACT_STYLE} className="card">
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
                      value={selectedClient?.denumire}
                    />
                    {clienti.length === 0 && !clientiLoading && (
                      <p style={{ fontSize: '.85rem', color: 'var(--s400)', marginTop: '.75rem' }}>
                        Niciun client în portofoliu. Adaugă clienți din pagina Clienți.
                      </p>
                    )}
                  </div>
                </div>

                {/* Verificare inline — apare imediat sub selector, fără schimbare de pas */}
                {selectedClient && inferTipClient(selectedClient) === 'PF' && (
                  <div style={COMPACT_STYLE} className="card">
                    <div className="card-head">
                      <span className="card-title">Verifică datele persoanei</span>
                      <button className="btn btn-primary btn-sm" onClick={handlePFContinue}>Continuă la template →</button>
                    </div>
                    <div className="card-body">
                      <div className="persoana-card" style={{ marginBottom: '1rem' }}>
                        <div>
                          <div className="persoana-card-name">
                            {selectedClient.titular?.nume || selectedClient.titular?.prenume
                              ? `${selectedClient.titular.prenume} ${selectedClient.titular.nume}`
                              : 'Fără date completate'}
                          </div>
                          <div className="persoana-card-sub">
                            {selectedClient.titular?.cnp ? `CNP: ${selectedClient.titular.cnp}` : ''}
                            {selectedClient.titular?.adresa ? ` · ${selectedClient.titular.adresa}${selectedClient.titular.judet ? `, ${selectedClient.titular.judet}` : ''}` : ''}
                            {selectedClient.titular?.data_nasterii ? ` · Născut: ${selectedClient.titular.data_nasterii}` : ''}
                            {selectedClient.titular?.serie_numar ? ` · CI: ${selectedClient.titular.serie_numar}` : ''}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                        <button className="btn btn-outline-primary btn-sm" onClick={() => setPfScanMode('scan')}>📷 Scanează CI</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setPfScanMode('manual')}>✏️ Editează manual</button>
                      </div>
                    </div>
                  </div>
                )}

                {pfScanMode && selectedClient && (
                  <PersonScanModal
                    personLabel={selectedClient.denumire}
                    accessToken={accessToken}
                    initialFields={pfScanMode === 'manual' ? persoanaToIDFields(selectedClient.titular ?? { ...EMPTY_PERSOANA, calitate: 'Titular' }) : undefined}
                    mode={pfScanMode}
                    onConfirm={handlePFPersonUpdate}
                    onClose={() => setPfScanMode(null)}
                    onToast={toast}
                  />
                )}

                {selectedClient && inferTipClient(selectedClient) === 'PJ' && (
                  <div style={COMPACT_STYLE} className="card">
                    <div className="card-head">
                      <span className="card-title">Verifică datele persoanelor</span>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => multiPersonRef.current?.continue()}
                      >
                        Continuă la template →
                      </button>
                    </div>
                    <div className="card-body">
                      <MultiPersonPreview
                        key={selectedClient.id}
                        ref={multiPersonRef}
                        client={selectedClient}
                        accessToken={accessToken}
                        onContinue={handleMultiPersonContinue}
                        onToast={toast}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Step 3 intern, dar afișat ca pasul 2 — "client" comasează
                selecția+verificarea pe un singur ecran. */}
            {step === 3 && selectedClient && (
              <TemplateFiller
                workspaceId={workspaceId}
                user={user}
                fields={fields}
                scannedPersons={scannedPersons}
                client={selectedClient}
                accessToken={accessToken}
                onToast={toast}
                onBack={handleStepBack}
                onClientSaved={handleClientSaved}
                stepNumber={2}
              />
            )}
          </>
        )}
        </div>
      </main>

      {historyOpen && user && (
        <History
          user={user}
          open={historyOpen}
          onSelect={handleHistorySelect}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {pendingClientSave && (
        <ConfirmModal
          title="Salvează modificările?"
          message="Ai modificat datele clientului (societate, asociați sau administratori). Salvezi aceste modificări în profilul clientului din baza de date?"
          confirmLabel="Salvează"
          cancelLabel="Nu salva"
          onConfirm={confirmPendingClientSave}
          onCancel={() => setPendingClientSave(null)}
        />
      )}
    </>
  )
}

// accent — familia de culoare (indigo implicit, albastru pentru PF, verde
// pentru PJ), aceeași convenție ca în restul aplicației, ca alegerea să se
// simtă imediat, dintr-o privire, nu doar din text.
function LandingCard({ icon, title, desc, examples, bullets, onClick, accent = 'p' }: {
  icon: string
  title: string
  desc: string
  examples?: string
  bullets: string[]
  onClick: () => void
  accent?: 'p' | 'b' | 'g'
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--surface)', border: `2px solid ${hovered ? `var(--${accent}400)` : 'var(--s200)'}`,
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
        <div style={{ fontSize: '.78rem', color: `var(--${accent}600)`, fontWeight: 600 }}>{desc}</div>
        {examples && <div style={{ fontSize: '.72rem', color: 'var(--s400)', marginTop: '.15rem' }}>{examples}</div>}
      </div>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
        {bullets.map(b => (
          <li key={b} style={{ fontSize: '.8rem', color: 'var(--s500)', lineHeight: 1.4 }}>{b}</li>
        ))}
      </ul>
      <div style={{
        marginTop: 'auto', fontSize: '.825rem', fontWeight: 700,
        color: `var(--${accent}600)`, display: 'flex', alignItems: 'center', gap: '.3rem',
      }}>
        Pornește <span style={{ fontSize: '1rem' }}>→</span>
      </div>
    </button>
  )
}
