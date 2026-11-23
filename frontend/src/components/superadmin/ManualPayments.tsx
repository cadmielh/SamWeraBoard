import { useEffect, useRef, useState } from 'react'
import { formatDate, toDate } from '../../lib/billing'
import {
  adminCancelManualPayment, adminManualPayments, adminRecordManualPayment,
  type ManualMethod, type ManualPayment,
} from '../../lib/superAdmin'
import type { WorkspaceBilling } from '../../types'
import BtnLabel from '../BtnLabel'

const METHOD_LABEL: Record<ManualMethod, string> = { transfer: 'Transfer bancar', numerar: 'Numerar', card: 'Card (POS)', altele: 'Altă metodă' }

const ERRORS: Record<string, string> = {
  stripe_subscription_active: 'Cabinetul are un abonament Stripe care se reînnoiește în această perioadă și ar plăti de două ori. '
    + 'Anulează-l întâi din Stripe sau alege o perioadă acoperită deja de el.',
  invalid_period: 'Perioada nu e validă: sfârșitul trebuie să fie după început, cel mult 3 ani.',
  invalid_paid_at: 'Data plății nu poate fi în viitor.',
  invalid_amount: 'Suma trebuie să fie între 0 și 1.000.000 RON.',
  invalid_credits: 'Numărul de credite trebuie să fie între 1 și 1000.',
  invalid_number: 'Seria și numărul facturii: cel mult 60 de caractere.',
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
/** Ultima zi a perioadei: o lună (sau un an) de la început, minus o zi (ex. 1 dec – 31 dec). */
function periodEnd(start: string, interval: 'month' | 'year'): string {
  const d = parseYmd(start)
  const end = interval === 'year' ? new Date(d.getFullYear() + 1, d.getMonth(), d.getDate() - 1)
    : new Date(d.getFullYear(), d.getMonth() + 1, d.getDate() - 1)
  return ymd(end)
}
const ron = (bani: number) => `${(bani / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`
const fmt = (iso: string | null) => formatDate(toDate(iso))
const short = (iso: string | null) => toDate(iso)?.toLocaleDateString('ro-RO') ?? '—'

/** Încasările plătite în afara Stripe (transfer, numerar): abonament pe o perioadă sau pachet de credite. */
export default function ManualPayments({ workspaceId, billing, onChange, startOpen = false }: {
  workspaceId: string
  billing: WorkspaceBilling | undefined
  onChange: (b: WorkspaceBilling) => void
  startOpen?: boolean
}) {
  const [payments, setPayments] = useState<ManualPayment[] | null>(null)
  const [open, setOpen] = useState(startOpen)
  const formRef = useRef<HTMLDivElement>(null)

  // Deschis din Încasări: formularul e mai jos în panou, îl aducem în vedere.
  useEffect(() => {
    if (startOpen) formRef.current?.scrollIntoView?.({ block: 'center' })
  }, [startOpen])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    adminManualPayments(workspaceId)
      .then(r => { if (alive) setPayments(r.payments) })
      .catch(e => { if (alive) { setPayments([]); setError((e as Error).message) } })
    return () => { alive = false }
  }, [workspaceId])

  const saved = (p: ManualPayment, b: WorkspaceBilling, message: string) => {
    setPayments(prev => [p, ...(prev ?? []).filter(x => x.id !== p.id)]
      .sort((a, c) => (c.paidAt ?? '').localeCompare(a.paidAt ?? '')))
    onChange(b)
    setDone(message)
    setError(null)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', color: 'var(--s600)' }}>
        <button className="btn btn-sm" onClick={() => { setOpen(o => !o); setDone(null); setError(null) }} aria-expanded={open}>
          {open ? 'Închide formularul' : 'Înregistrează o încasare'}
        </button>
        <span>abonament sau credite plătite prin transfer, numerar etc.</span>
      </div>
      {open && (
        <div ref={formRef}><ManualForm workspaceId={workspaceId} billing={billing}
          onSaved={(p, b) => {
            setOpen(false)
            saved(p, b, p.kind === 'subscription'
              ? `Abonament înregistrat: acces până pe ${fmt(p.periodEnd)}.`
              : `${p.credits} credite adăugate.`)
          }}
          onError={setError} /></div>
      )}
      {payments && payments.length > 0 && (
        <ManualList workspaceId={workspaceId} payments={payments}
          onCanceled={(p, b) => saved(p, b, p.kind === 'subscription'
            ? 'Încasarea a fost anulată; accesul s-a recalculat din celelalte.'
            : 'Încasarea a fost anulată; creditele rămase din pachet au fost scoase.')}
          onError={setError} />
      )}
      {done && <div role="status" style={{ color: 'var(--g700)', fontSize: '.8125rem' }}>{done}</div>}
      {error && <div style={{ color: 'var(--r600)', fontSize: '.8125rem' }}>{error}</div>}
    </>
  )
}

function ManualForm({ workspaceId, billing, onSaved, onError }: {
  workspaceId: string
  billing: WorkspaceBilling | undefined
  onSaved: (p: ManualPayment, b: WorkspaceBilling) => void
  onError: (m: string | null) => void
}) {
  // Perioada nouă continuă abonamentul manual în curs, dacă există; altfel începe azi. Calculate o dată, la deschidere.
  const [{ today, nextStart }] = useState(() => {
    const now = new Date()
    const current = toDate(billing?.manualUntil ?? null)
    return {
      today: ymd(now),
      nextStart: current && current > now ? ymd(new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1)) : ymd(now),
    }
  })
  const [kind, setKind] = useState<'subscription' | 'credits'>('subscription')
  const [interval, setInterval] = useState<'month' | 'year' | null>('month')
  const [start, setStart] = useState(nextStart)
  const [end, setEnd] = useState(periodEnd(nextStart, 'month'))
  const [credits, setCredits] = useState('30')
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(today)
  const [method, setMethod] = useState<ManualMethod>('transfer')
  const [invoice, setInvoice] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const pickInterval = (iv: 'month' | 'year' | null) => {
    setInterval(iv)
    if (iv) setEnd(periodEnd(start, iv))
  }
  const changeStart = (v: string) => {
    setStart(v)
    if (v && interval) setEnd(periodEnd(v, interval))
  }
  const nAmount = Number(amount.replace(',', '.'))
  const nCredits = Number(credits)
  const valid = amount.trim() !== '' && Number.isFinite(nAmount) && nAmount >= 0 && !!paidAt
    && (kind === 'credits' ? Number.isInteger(nCredits) && nCredits >= 1 && nCredits <= 1000 : !!start && !!end && end >= start)

  const submit = async () => {
    setBusy(true)
    onError(null)
    try {
      const r = await adminRecordManualPayment(workspaceId, {
        kind, amount: Math.round(nAmount * 100) / 100, method, paidAt,
        note: note.trim() || undefined, invoiceNumber: invoice.trim() || undefined,
        ...(kind === 'subscription' ? { periodStart: start, periodEnd: end, interval } : { credits: nCredits }),
      })
      onSaved(r.payment, r.billing)
    } catch (e) {
      const err = e as Error & { code?: string }
      onError(ERRORS[err.code ?? ''] ?? err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="manual-form" onSubmit={e => { e.preventDefault(); if (valid) void submit() }}>
      <div className="manual-form-row">
        <span className="manual-form-label">Ce s-a plătit</span>
        <div className="manual-form-fields">
          <div className="seg" role="group" aria-label="Tipul încasării">
            <button type="button" aria-pressed={kind === 'subscription'} onClick={() => setKind('subscription')}>Abonament</button>
            <button type="button" aria-pressed={kind === 'credits'} onClick={() => setKind('credits')}>Credite</button>
          </div>
        </div>
      </div>
      {kind === 'subscription' ? (
        <div className="manual-form-row">
          <span className="manual-form-label">Perioada</span>
          <div className="manual-form-fields">
            <div className="seg" role="group" aria-label="Durata">
              <button type="button" aria-pressed={interval === 'month'} onClick={() => pickInterval('month')}>O lună</button>
              <button type="button" aria-pressed={interval === 'year'} onClick={() => pickInterval('year')}>Un an</button>
              <button type="button" aria-pressed={interval === null} onClick={() => pickInterval(null)}>Altă perioadă</button>
            </div>
            <span className="manual-form-pair">
              <input className="field-input" type="date" value={start} onChange={e => changeStart(e.target.value)} aria-label="De la" />
              <span>–</span>
              <input className="field-input" type="date" value={end} min={start}
                onChange={e => { setEnd(e.target.value); setInterval(null) }} aria-label="Până la (inclusiv)" />
            </span>
          </div>
        </div>
      ) : (
        <div className="manual-form-row">
          <span className="manual-form-label">Credite</span>
          <div className="manual-form-fields">
            <input className="field-input" type="number" min={1} max={1000} value={credits} onChange={e => setCredits(e.target.value)}
              style={{ width: '5rem' }} aria-label="Număr de credite" />
            <span>valabile 12 luni</span>
          </div>
        </div>
      )}
      <div className="manual-form-row">
        <span className="manual-form-label">Încasat</span>
        <div className="manual-form-fields">
          <span className="manual-form-pair">
            <input className="field-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00"
              style={{ width: '6.5rem' }} aria-label="Suma încasată, în RON" />
            <span>RON, pe</span>
            <input className="field-input" type="date" value={paidAt} max={today} onChange={e => setPaidAt(e.target.value)} aria-label="Data plății" />
          </span>
          <select className="field-input" value={method} onChange={e => setMethod(e.target.value as ManualMethod)} aria-label="Metoda de plată">
            {(Object.keys(METHOD_LABEL) as ManualMethod[]).map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </div>
      </div>
      <div className="manual-form-row">
        <span className="manual-form-label">Opțional</span>
        <div className="manual-form-fields">
          <input className="field-input" value={invoice} onChange={e => setInvoice(e.target.value)} maxLength={60}
            placeholder="Seria și nr. facturii" style={{ width: '9.5rem' }} aria-label="Seria și numărul facturii" />
          <input className="field-input" value={note} onChange={e => setNote(e.target.value)} maxLength={200}
            placeholder="Notă (ex. nr. ordin de plată)" style={{ flex: '1 1 10rem' }} aria-label="Notă" />
        </div>
      </div>
      <div className="manual-form-row">
        <span className="manual-form-label" />
        <div className="manual-form-fields">
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !valid}>
            <BtnLabel busy={busy}>Înregistrează încasarea</BtnLabel>
          </button>
          <span className="manual-form-hint">
            {kind === 'subscription'
              ? 'Clientul vede „Abonament activ” până la sfârșitul perioadei. Nu se reînnoiește singur: primești o notificare cu 7 zile înainte.'
              : 'Creditele intră imediat în soldul cabinetului.'}
          </span>
        </div>
      </div>
    </form>
  )
}

function ManualList({ workspaceId, payments, onCanceled, onError }: {
  workspaceId: string
  payments: ManualPayment[]
  onCanceled: (p: ManualPayment, b: WorkspaceBilling) => void
  onError: (m: string | null) => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const cancel = async (p: ManualPayment) => {
    setBusy(true)
    onError(null)
    try {
      const r = await adminCancelManualPayment(workspaceId, p.id, reason.trim())
      setConfirming(null)
      setReason('')
      onCanceled(r.payment, r.billing)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="manual-list" role="table" aria-label="Încasări manuale">
      {payments.map(p => (
        <div key={p.id} role="row" className={`manual-row${p.canceledAt ? ' manual-row--canceled' : ''}`}>
          <span role="cell" className="manual-row-date">{short(p.paidAt)}</span>
          <span role="cell" className="manual-row-what">
            {p.kind === 'subscription' ? `Abonament ${short(p.periodStart)} – ${short(p.periodEnd)}` : `${p.credits} credite`}
            <small>{[METHOD_LABEL[p.method], p.invoice.number ? `factura ${p.invoice.number}` : p.amount > 0 ? 'fără factură încă' : null, p.note]
              .filter(Boolean).join(' · ')}</small>
          </span>
          <span role="cell" className="manual-row-amount">{ron(p.amount)}</span>
          <span role="cell" className="manual-row-action">
            {p.canceledAt ? <span className="chip chip-muted" title={p.cancelReason ?? undefined}>Anulată {short(p.canceledAt)}</span>
              : confirming === p.id ? (
                <span style={{ display: 'inline-flex', gap: '.375rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="field-input" autoFocus value={reason} onChange={e => setReason(e.target.value)} maxLength={120}
                    placeholder="Motiv (opțional)" style={{ width: '9rem' }} aria-label="Motivul anulării" />
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void cancel(p)}>
                    <BtnLabel busy={busy}>Anulează</BtnLabel>
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirming(null)}>×</button>
                </span>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => { setConfirming(p.id); setReason('') }}
                  title={p.kind === 'subscription' ? 'Accesul se recalculează din celelalte încasări' : 'Creditele rămase din pachet se scot'}>
                  Anulează
                </button>
              )}
          </span>
        </div>
      ))}
    </div>
  )
}
