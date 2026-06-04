import { useState, useCallback } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { IDFields } from '../lib/api'
import { useApp } from '../AppLayout'
import UploadZone from '../components/UploadZone'
import DriveFilePicker from '../components/DriveFilePicker'
import FieldsForm from '../components/FieldsForm'
import TemplateFiller from '../components/TemplateFiller'
import History from '../components/History'

type Step = 1 | 2 | 3

const CONTENT_STYLE = {
  maxWidth: 820, margin: '0 auto', padding: '2rem 1.5rem',
  display: 'flex', flexDirection: 'column' as const, gap: '1.5rem',
}

const EMPTY_FIELDS: IDFields = {
  cnp: '', nume: '', prenume: '', serie_numar: '',
  data_nasterii: '', locul_nasterii: '', cetatenia: '',
  adresa: '', judet: '', emisa_de: '', valabila_pana_la: '',
}

export default function ExtragerePage() {
  const { user, accessToken, toast, ocrMode } = useApp()

  const [step, setStep] = useState<Step>(1)
  const [fields, setFields] = useState<IDFields | null>(null)
  const [sourceFile, setSourceFile] = useState('')
  const [showDrivePicker, setShowDrivePicker] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const handleExtracted = useCallback(async (result: IDFields, filename: string) => {
    setFields(result)
    setSourceFile(filename)
    setStep(2)
    setShowDrivePicker(false)
    toast('Câmpuri extrase cu succes', 'ok')
    if (user) {
      try {
        await addDoc(collection(db, 'users', user.uid, 'extractions'), {
          createdAt: serverTimestamp(),
          sourceFile: filename,
          fields: result,
        })
      } catch { /* Firestore might not be configured yet */ }
    }
  }, [user, toast])

  const handleHistorySelect = (f: IDFields, filename: string) => {
    setFields(f)
    setSourceFile(filename)
    setStep(2)
  }

  return (
    <>
      {/* Compact top bar for step indicator + history */}
      <div style={{ background: '#fff', borderBottom: '1px solid var(--s200)', padding: '.5rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: '.375rem', flex: 1 }}>
          {(['Încarcă', 'Verifică', 'Completează'] as const).map((label, i) => {
            const s = i + 1
            const active = step === s
            const done = step > s
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '.375rem' }}>
                {i > 0 && <div style={{ width: 24, height: 1, background: done ? 'var(--p200)' : 'var(--s200)' }} />}
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
        <span className={`chip ${ocrMode === 'claude' ? 'chip-primary' : 'chip-muted'}`} style={{ fontSize: '.68rem' }}>
          {ocrMode === 'claude' ? '✦ Claude' : '⚙ OCR Local'}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setHistoryOpen(h => !h)}>
          {historyOpen ? 'Închide' : 'Istoric'}
        </button>
      </div>

      <main style={CONTENT_STYLE}>
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
                onManualEntry={() => { setFields(EMPTY_FIELDS); setSourceFile('manual'); setStep(2) }}
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
            fields={fields}
            accessToken={accessToken}
            onToast={toast}
            onBack={() => setStep(2)}
          />
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
