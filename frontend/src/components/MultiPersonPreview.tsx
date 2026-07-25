import { useState } from 'react'
import type { Client, Persoana, ScannedPerson, ToastItem } from '../types'
import { persoanaToIDFields, idFieldsToPersoana } from '../lib/idFields'
import PersonScanModal from './PersonScanModal'

interface Props {
  client: Client
  accessToken: string
  onContinue: (persons: ScannedPerson[], updatedClient: Client) => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

function completenessScore(p: Persoana): number {
  const keys: (keyof Persoana)[] = ['cnp', 'nume', 'prenume', 'serie_numar', 'data_nasterii', 'locul_nasterii', 'cetatenia', 'adresa']
  return keys.filter(k => p[k]).length / keys.length
}

function PersonCard({
  persoana, role, index, accessToken,
  onUpdate, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onToast,
}: {
  persoana: Persoana
  role: 'asociat' | 'administrator'
  index: number
  accessToken: string
  onUpdate: (p: Persoana) => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onToast: (msg: string, type: ToastItem['type']) => void
}) {
  const [scanMode, setScanMode] = useState<'scan' | 'manual' | null>(null)
  const score = completenessScore(persoana)
  const fullName = [persoana.prenume, persoana.nume].filter(Boolean).join(' ')
  const isComplete = score >= 0.875
  const isPartial = score > 0 && !isComplete
  const isEmpty = score === 0

  const roleLabel = role === 'asociat' ? 'Asociat' : 'Administrator'

  return (
    <>
      <div style={{
        background: 'var(--s50)', borderRadius: 'var(--r-sm)',
        border: `1.5px solid ${isEmpty ? 'var(--s200)' : isPartial ? 'var(--y400, #fbbf24)' : 'var(--g300, #86efac)'}`,
        padding: '.75rem .875rem', display: 'flex', flexDirection: 'column', gap: '.5rem',
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{
            fontSize: '.7rem', fontWeight: 700, padding: '.15rem .45rem', borderRadius: 4, whiteSpace: 'nowrap',
            color: role === 'asociat' ? 'var(--p600)' : 'var(--s600)',
            background: role === 'asociat' ? 'var(--p50)' : 'var(--s100)',
          }}>
            {roleLabel} {index + 1}
          </span>
          <span style={{ flex: 1, fontWeight: 600, fontSize: '.875rem', color: 'var(--s800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fullName || <span style={{ color: 'var(--s400)', fontWeight: 400 }}>Fără date</span>}
          </span>
          {isComplete && <span title="Date complete" style={{ color: 'var(--g600)' }}>✅</span>}
          {isPartial && <span title="Date parțiale" style={{ color: 'var(--y600, #ca8a04)' }}>⚠️</span>}
          {isEmpty && <span title="Fără date" style={{ color: 'var(--s400)' }}>⏳</span>}
          {persoana.cotaParticipare && (
            <span style={{ fontSize: '.72rem', color: 'var(--s500)', background: 'var(--s100)', padding: '.1rem .35rem', borderRadius: 3 }}>
              {persoana.cotaParticipare}
            </span>
          )}
          <div style={{ display: 'flex', gap: '.125rem' }}>
            <button onClick={onMoveUp} disabled={!canMoveUp} style={BTN_ICON} title="Sus">↑</button>
            <button onClick={onMoveDown} disabled={!canMoveDown} style={BTN_ICON} title="Jos">↓</button>
          </div>
        </div>

        {/* Summary of filled data */}
        {!isEmpty && (
          <div style={{ fontSize: '.775rem', color: 'var(--s500)', display: 'flex', gap: '.75rem', flexWrap: 'wrap', paddingLeft: '.25rem' }}>
            {persoana.cnp && <span>CNP: <strong style={{ color: 'var(--s700)' }}>{persoana.cnp}</strong></span>}
            {persoana.adresa && <span>Adresă: <strong style={{ color: 'var(--s700)' }}>{persoana.adresa}{persoana.judet ? `, ${persoana.judet}` : ''}</strong></span>}
            {persoana.valabila_pana_la && (
              <span>CI val.: <strong style={{ color: 'var(--s700)' }}>{persoana.valabila_pana_la}</strong></span>
            )}
          </div>
        )}

        {/* Missing fields warning */}
        {isPartial && (
          <div style={{ fontSize: '.75rem', color: 'var(--y700, #a16207)', background: 'var(--y50, #fefce8)', padding: '.3rem .5rem', borderRadius: 4 }}>
            Câmpuri lipsă:{' '}
            {(['cnp', 'serie_numar', 'adresa', 'data_nasterii', 'locul_nasterii', 'cetatenia'] as (keyof Persoana)[])
              .filter(k => !persoana[k])
              .map(k => k.replace(/_/g, ' '))
              .join(', ')}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-outline-primary btn-sm" onClick={() => setScanMode('scan')}>
            📷 Scanează CI
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setScanMode('manual')}>
            ✏️ Editează manual
          </button>
        </div>
      </div>

      {scanMode && (
        <PersonScanModal
          personLabel={`${roleLabel} ${index + 1}${fullName ? ` — ${fullName}` : ''}`}
          accessToken={accessToken}
          initialFields={scanMode === 'manual' ? persoanaToIDFields(persoana) : undefined}
          mode={scanMode}
          onConfirm={f => { onUpdate(idFieldsToPersoana(f, persoana)); setScanMode(null); onToast('Date actualizate', 'ok') }}
          onClose={() => setScanMode(null)}
          onToast={onToast}
        />
      )}
    </>
  )
}

export default function MultiPersonPreview({ client, accessToken, onContinue, onToast }: Props) {
  const [asociati, setAsociati] = useState<Persoana[]>([...client.asociati])
  const [admini, setAdmini] = useState<Persoana[]>([...client.administratori])

  const moveInArray = <T,>(arr: T[], from: number, to: number): T[] => {
    const next = [...arr]
    ;[next[from], next[to]] = [next[to], next[from]]
    return next
  }

  const handleContinue = () => {
    const persons: ScannedPerson[] = [
      ...asociati.map(p => ({
        id: crypto.randomUUID(),
        role: 'asociat' as const,
        cotaParticipare: p.cotaParticipare,
        fields: persoanaToIDFields(p),
        scanStatus: (p.cnp ? 'scanned' : 'empty') as ScannedPerson['scanStatus'],
      })),
      ...admini.map(p => ({
        id: crypto.randomUUID(),
        role: 'administrator' as const,
        cotaParticipare: '',
        fields: persoanaToIDFields(p),
        scanStatus: (p.cnp ? 'scanned' : 'empty') as ScannedPerson['scanStatus'],
      })),
    ]
    const updatedClient: Client = { ...client, asociati, administratori: admini }
    onContinue(persons, updatedClient)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Asociați */}
      {asociati.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
          <div style={SECTION_TITLE}>
            Asociați <span style={COUNT_CHIP}>{asociati.length}</span>
          </div>
          {asociati.map((p, i) => (
            <PersonCard
              key={i}
              persoana={p}
              role="asociat"
              index={i}
              accessToken={accessToken}
              onUpdate={updated => setAsociati(prev => prev.map((x, idx) => idx === i ? updated : x))}
              onMoveUp={() => setAsociati(prev => moveInArray(prev, i, i - 1))}
              onMoveDown={() => setAsociati(prev => moveInArray(prev, i, i + 1))}
              canMoveUp={i > 0}
              canMoveDown={i < asociati.length - 1}
              onToast={onToast}
            />
          ))}
        </section>
      )}

      {/* Administratori */}
      {admini.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
          <div style={SECTION_TITLE}>
            Administratori <span style={COUNT_CHIP}>{admini.length}</span>
          </div>
          {admini.map((p, i) => (
            <PersonCard
              key={i}
              persoana={p}
              role="administrator"
              index={i}
              accessToken={accessToken}
              onUpdate={updated => setAdmini(prev => prev.map((x, idx) => idx === i ? updated : x))}
              onMoveUp={() => setAdmini(prev => moveInArray(prev, i, i - 1))}
              onMoveDown={() => setAdmini(prev => moveInArray(prev, i, i + 1))}
              canMoveUp={i > 0}
              canMoveDown={i < admini.length - 1}
              onToast={onToast}
            />
          ))}
        </section>
      )}

      {asociati.length === 0 && admini.length === 0 && (
        <div style={{ color: 'var(--s400)', fontSize: '.875rem', textAlign: 'center', padding: '1.5rem 0' }}>
          Clientul nu are asociați sau administratori adăugați.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '.25rem' }}>
        <button className="btn btn-primary" onClick={handleContinue}>
          Continuă la template →
        </button>
      </div>
    </div>
  )
}

const BTN_ICON: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--s400)', fontSize: '.95rem', lineHeight: 1,
  padding: '.125rem .3rem', borderRadius: 4,
}
const SECTION_TITLE: React.CSSProperties = {
  fontSize: '.75rem', fontWeight: 700, color: 'var(--s500)',
  letterSpacing: '.06em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '.375rem',
}
const COUNT_CHIP: React.CSSProperties = {
  background: 'var(--s200)', color: 'var(--s600)', borderRadius: 99,
  padding: '.05rem .45rem', fontSize: '.7rem', fontWeight: 700,
}
