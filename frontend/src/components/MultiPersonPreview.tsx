import { useState } from 'react'
import type { Client, Persoana, ScannedPerson, ToastItem } from '../types'
import { persoanaToIDFields, idFieldsToPersoana } from '../lib/idFields'
import { EMPTY_PERSOANA } from '../lib/clienti'
import { equalShare, sumCota, isCotaTotalValid } from '../lib/cota'
import PersonScanModal from './PersonScanModal'
import CompanyInfoForm, { type CompanyData } from './CompanyInfoForm'

interface Props {
  client: Client
  accessToken: string
  onContinue: (persons: ScannedPerson[], updatedClient: Client) => void
  onToast: (msg: string, type: ToastItem['type']) => void
}

function companyDataFromClient(client: Client): CompanyData {
  return {
    denumire: client.denumire,
    formaJuridica: client.formaJuridica,
    codFiscal: client.codFiscal,
    nrRegistrul: client.nrRegistrul,
    sediuSocial: client.sediuSocial,
    caenCod: client.caenCod,
    caenDescriere: client.caenDescriere,
    caenSecundare: client.caenSecundare ?? [],
    capitalSocial: client.capitalSocial,
  }
}

function completenessScore(p: Persoana): number {
  const keys: (keyof Persoana)[] = ['cnp', 'nume', 'prenume', 'serie_numar', 'data_nasterii', 'locul_nasterii', 'cetatenia', 'adresa']
  return keys.filter(k => p[k]).length / keys.length
}

function PersonCard({
  persoana, role, index, accessToken,
  onUpdate, onCotaChange, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onRemove, atMin, onToast,
}: {
  persoana: Persoana
  role: 'asociat' | 'administrator'
  index: number
  accessToken: string
  onUpdate: (p: Persoana) => void
  onCotaChange?: (val: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onRemove: () => void
  atMin: boolean
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
          {role === 'asociat' && onCotaChange && (
            <input
              value={persoana.cotaParticipare}
              onChange={e => onCotaChange(e.target.value)}
              placeholder="cotă"
              title="Cotă participare"
              style={{
                width: 56, fontSize: '.72rem', textAlign: 'center', padding: '.15rem .3rem',
                borderRadius: 3, border: '1.5px solid var(--s300)', color: 'var(--s700)',
                background: '#fff', fontFamily: 'var(--font)', outline: 'none',
              }}
            />
          )}
          <div style={{ display: 'flex', gap: '.125rem' }}>
            <button onClick={onMoveUp} disabled={!canMoveUp} style={BTN_ICON} title="Sus">↑</button>
            <button onClick={onMoveDown} disabled={!canMoveDown} style={BTN_ICON} title="Jos">↓</button>
            <button
              onClick={onRemove}
              disabled={atMin}
              style={{ ...BTN_ICON, color: atMin ? 'var(--s300)' : 'var(--r500)' }}
              title={atMin ? `Trebuie să existe cel puțin un ${role === 'asociat' ? 'asociat' : 'administrator'}` : 'Elimină'}
            >
              🗑️
            </button>
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
  // Cotă neintrodusă explicit → default egal proporțional între asociați
  const [asociati, setAsociati] = useState<Persoana[]>(() => {
    const share = equalShare(client.asociati.length)
    return client.asociati.map(a => a.cotaParticipare.trim() ? { ...a } : { ...a, cotaParticipare: share })
  })
  const [admini, setAdmini] = useState<Persoana[]>([...client.administratori])
  const [companyData, setCompanyData] = useState<CompanyData>(() => companyDataFromClient(client))

  const moveInArray = <T,>(arr: T[], from: number, to: number): T[] => {
    const next = [...arr]
    ;[next[from], next[to]] = [next[to], next[from]]
    return next
  }

  const addAsociat = () => setAsociati(prev => {
    const prevEqual = equalShare(prev.length)
    const newEqual = equalShare(prev.length + 1)
    const rebalanced = prev.map(a =>
      (!a.cotaParticipare.trim() || a.cotaParticipare === prevEqual) ? { ...a, cotaParticipare: newEqual } : a
    )
    return [...rebalanced, { ...EMPTY_PERSOANA, calitate: 'Asociat', cotaParticipare: newEqual }]
  })

  const removeAsociat = (i: number) => setAsociati(prev => {
    const prevEqual = equalShare(prev.length)
    const next = [...prev]; next.splice(i, 1)
    const newEqual = equalShare(next.length)
    return next.map(a => a.cotaParticipare === prevEqual ? { ...a, cotaParticipare: newEqual } : a)
  })

  const addAdministrator = () => setAdmini(prev => [...prev, { ...EMPTY_PERSOANA, calitate: 'Administrator' }])
  const removeAdministrator = (i: number) => setAdmini(prev => { const next = [...prev]; next.splice(i, 1); return next })

  // O societate trebuie să aibă minim un asociat și un administrator, iar
  // cotele asociaților trebuie să însumeze mereu 100%
  const asociatAtMin = asociati.length <= 1
  const adminAtMin = admini.length <= 1
  const cotaTotal = sumCota(asociati.map(a => a.cotaParticipare))
  const cotaValid = isCotaTotalValid(asociati.map(a => a.cotaParticipare))
  const hasMinPeople = asociati.length > 0 && admini.length > 0

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
    const updatedClient: Client = { ...client, ...companyData, asociati, administratori: admini }
    onContinue(persons, updatedClient)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Date societate */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
        <div style={SECTION_TITLE}>Date societate</div>
        <CompanyInfoForm
          value={companyData}
          onChange={patch => setCompanyData(prev => ({ ...prev, ...patch }))}
          asociati={asociati}
          accessToken={accessToken}
          onToast={onToast}
        />
      </section>

      {/* Asociați */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={SECTION_TITLE}>Asociați <span style={COUNT_CHIP}>{asociati.length}</span></div>
          <button type="button" className="btn btn-success btn-sm" onClick={addAsociat}>+ Adaugă asociat</button>
        </div>
        {asociati.length === 0 && (
          <p style={{ fontSize: '.8125rem', color: 'var(--s400)', margin: 0 }}>Niciun asociat adăugat.</p>
        )}
        {asociati.map((p, i) => (
          <PersonCard
            key={i}
            persoana={p}
            role="asociat"
            index={i}
            accessToken={accessToken}
            onUpdate={updated => setAsociati(prev => prev.map((x, idx) => idx === i ? updated : x))}
            onCotaChange={val => setAsociati(prev => prev.map((x, idx) => idx === i ? { ...x, cotaParticipare: val } : x))}
            onMoveUp={() => setAsociati(prev => moveInArray(prev, i, i - 1))}
            onMoveDown={() => setAsociati(prev => moveInArray(prev, i, i + 1))}
            canMoveUp={i > 0}
            canMoveDown={i < asociati.length - 1}
            onRemove={() => removeAsociat(i)}
            atMin={asociatAtMin}
            onToast={onToast}
          />
        ))}
        {asociati.length > 0 && (
          <div style={{
            fontSize: '.8125rem', fontWeight: 600,
            color: cotaValid ? 'var(--g700, #15803d)' : 'var(--r600, #dc2626)',
          }}>
            Cotă totală: {cotaTotal}% {cotaValid ? '✓' : '— ar trebui să fie 100%'}
          </div>
        )}
      </section>

      {/* Administratori */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={SECTION_TITLE}>Administratori <span style={COUNT_CHIP}>{admini.length}</span></div>
          <button type="button" className="btn btn-success btn-sm" onClick={addAdministrator}>+ Adaugă administrator</button>
        </div>
        {admini.length === 0 && (
          <p style={{ fontSize: '.8125rem', color: 'var(--s400)', margin: 0 }}>Niciun administrator adăugat.</p>
        )}
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
            onRemove={() => removeAdministrator(i)}
            atMin={adminAtMin}
            onToast={onToast}
          />
        ))}
      </section>

      {!hasMinPeople && (
        <p className="field-error" style={{ margin: 0 }}>
          Este necesar cel puțin un asociat și un administrator.
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '.25rem' }}>
        <button className="btn btn-primary" onClick={handleContinue} disabled={!hasMinPeople || !cotaValid}>
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
