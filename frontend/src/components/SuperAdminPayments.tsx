import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import { billingAccess, formatDate } from '../lib/billing'
import { adminBillingPayments, adminMarkInvoiced, adminStripeFees, type AccountFee, type PaymentRow } from '../lib/superAdmin'
import type { Workspace } from '../types'
import BtnLabel from './BtnLabel'
import IconExport from './IconExport'
import IconPlus from './IconPlus'
import IconRefresh from './IconRefresh'
import Modal from './Modal'

type Period = 'luna' | 'luna-trecuta' | 'an' | 'tot' | 'interval'
type KindFilter = 'toate' | PaymentRow['kind']
type InvoiceFilter = 'toate' | 'de-facturat' | 'facturat'
type SortKey = 'at' | 'cabinet' | 'facturare' | 'ce' | 'amount' | 'fee' | 'net' | 'invoice'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }

const COLUMNS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: 'at', label: 'Data' }, { key: 'cabinet', label: 'Cabinet' }, { key: 'facturare', label: 'Facturare' },
  { key: 'ce', label: 'Ce' }, { key: 'amount', label: 'Brut', right: true }, { key: 'fee', label: 'Comision', right: true },
  { key: 'net', label: 'Net', right: true }, { key: 'invoice', label: 'Factură SmartBill' },
]
// Textele încep crescător (A→Z), datele și sumele descrescător (cele mai noi / mai mari întâi).
const TEXT_KEYS: SortKey[] = ['cabinet', 'facturare', 'ce', 'invoice']

const KIND_LABEL: Record<PaymentRow['kind'], string> = {
  subscription: 'Abonament', credits: 'Credite', refund: 'Rambursare', dispute: 'Dispută',
}

// `+ 0` transformă -0 în 0 (altfel apare „-0,00”).
const ron = (bani: number) => `${(bani / 100 + 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toLocaleString('ro-RO', { maximumFractionDigits: 2 })}%` : '—')
const FEE_TYPE: Record<string, string> = {
  stripe_fee: 'Comision de procesare Stripe', application_fee: 'Comision de aplicație', tax: 'Taxă',
}

/** Tooltip-ul comisionului unei plăți: defalcarea de la Stripe, procentul efectiv și calculul netului. */
function feeTooltip(r: PaymentRow): string | undefined {
  if (r.source === 'manual') return 'Încasare înregistrată manual, în afara Stripe: fără comision.'
  if (r.fee === undefined || r.net === undefined) return undefined
  const gross = r.gross ?? r.amount
  const lines = (r.feeDetails ?? []).map(d => `${FEE_TYPE[d.type ?? ''] ?? d.description ?? d.type}: ${ron(d.amount)}`)
  return [
    ...(lines.length ? lines : [`Comision Stripe: ${ron(r.fee)}`]),
    `= ${pct(r.fee, gross)} din brut`,
    `Net = ${ron(gross)} − ${ron(r.fee)} = ${ron(r.net)}`,
    'Valori citite din tranzacția Stripe a plății (nu calculate de aplicație).',
  ].join('\n')
}

// TVA cu taxare inversă pe serviciile Stripe (Irlanda): datorat de furnizorul român, nu plătit către Stripe.
// Cota standard din România (din august 2025); valoarea afișată e o estimare pentru contabil, nu o declarație.
const VAT_RATE = 0.21
const ACCOUNT_FEE_LABEL: Record<AccountFee['category'], string> = {
  billing: 'Stripe Billing', dispute: 'Taxă dispută', stripe: 'Alt comision Stripe',
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const MANUAL_METHOD: Record<string, string> = { transfer: 'transfer bancar', numerar: 'numerar', card: 'card (POS)', altele: 'altă metodă' }

const isIncome = (r: PaymentRow) => r.kind === 'subscription' || r.kind === 'credits'
/** Încasare care cere factură emisă manual și nu o are încă (plățile de 0 RON nu se facturează). */
const needsInvoice = (r: PaymentRow) => isIncome(r) && r.amount > 0 && r.invoice?.status !== 'manual'

function describe(r: PaymentRow): string {
  if (r.source === 'manual') {
    const what = r.kind === 'credits' ? `Pachet ${r.credits} credite`
      : `Abonament${r.periodStart && r.periodEnd ? ` ${formatDate(new Date(r.periodStart))} – ${formatDate(new Date(r.periodEnd))}` : ''}`
    return [what, MANUAL_METHOD[r.method ?? ''] ?? 'manual', r.note].filter(Boolean).join(' · ')
  }
  if (r.kind === 'subscription') {
    const iv = r.interval === 'year' ? 'anual' : r.interval === 'month' ? 'lunar' : null
    const period = r.periodStart && r.periodEnd ? `${formatDate(new Date(r.periodStart))} – ${formatDate(new Date(r.periodEnd))}` : null
    return ['Abonament', [iv, period].filter(Boolean).join(' · ')].filter(Boolean).join(' ')
  }
  if (r.kind === 'credits') return `Pachet ${r.credits ?? r.pack} credite`
  if (r.kind === 'dispute') return `Dispută${r.reason ? ` (${r.reason})` : ''}${r.status ? ` · ${r.status}` : ''}`
  return 'Rambursare'
}

/** Ordinea tabelului (și a exportului). Egalitățile se departajează după dată, cele mai noi întâi. */
function sortRows(rows: PaymentRow[], { key, dir }: Sort): PaymentRow[] {
  const invoiceRank = (r: PaymentRow) => (needsInvoice(r) ? 0 : r.invoice?.status === 'manual' ? 1 : 2)   // de facturat, facturat, nu e cazul
  const value = (r: PaymentRow): string | number => {
    switch (key) {
      case 'at': return r.at ?? ''
      case 'cabinet': return r.workspaceName
      case 'facturare': return r.billingName
      case 'ce': return `${KIND_LABEL[r.kind]} ${describe(r)}`
      case 'amount': return r.amount
      case 'fee': return r.fee ?? 0
      case 'net': return r.net ?? r.amount
      case 'invoice': return invoiceRank(r)
    }
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = value(a), vb = value(b)
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ro', { sensitivity: 'base' })
    return c !== 0 ? c * sign : (b.at ?? '').localeCompare(a.at ?? '')
  })
}

/** Intervalul [de la, până la) pentru filtrul de perioadă, în ora locală. */
function periodRange(p: Period, from: string, to: string, now: Date): [Date | null, Date | null] {
  const y = now.getFullYear(), m = now.getMonth()
  if (p === 'luna') return [new Date(y, m, 1), new Date(y, m + 1, 1)]
  if (p === 'luna-trecuta') return [new Date(y, m - 1, 1), new Date(y, m, 1)]
  if (p === 'an') return [new Date(y, 0, 1), new Date(y + 1, 0, 1)]
  if (p === 'interval') {
    const end = to ? new Date(`${to}T00:00:00`) : null
    if (end) end.setDate(end.getDate() + 1)
    return [from ? new Date(`${from}T00:00:00`) : null, end]
  }
  return [null, null]
}

const money = (bani: number) => (bani / 100).toFixed(2).replace('.', ',')

function csv(rows: PaymentRow[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const head = ['Data', 'Cabinet', 'Denumire facturare', 'CUI', 'Tip', 'Detalii', 'Brut RON', 'Comision Stripe RON', 'Net RON', 'Factura']
  const lines = rows.map(r => [
    r.at ? new Date(r.at).toLocaleDateString('ro-RO') : '', r.workspaceName, r.billingName, r.cui, KIND_LABEL[r.kind], describe(r),
    money(r.amount), r.fee !== undefined ? money(r.fee) : '', r.net !== undefined ? money(r.net) : '', r.invoice?.status === 'manual' ? r.invoice.number ?? '' : needsInvoice(r) ? 'de facturat' : '',
  ].map(v => esc(String(v))).join(';'))
  return '﻿' + [head.map(esc).join(';'), ...lines].join('\r\n')     // BOM + „;”: Excel în română îl deschide corect
}

/** Tabloul de încasări din super admin: abonamente, pachete de credite, rambursări și dispute, cu filtre, totaluri,
 *  evidența facturilor emise manual în SmartBill și export CSV pentru contabil. Sursa: evenimentele Stripe primite. */
export default function SuperAdminPayments({ workspaces, version = 0 }: { workspaces: Workspace[]; version?: number }) {
  const { toast } = useApp()
  const [, setParams] = useSearchParams()
  const [picking, setPicking] = useState(false)
  const [rows, setRows] = useState<PaymentRow[] | null>(null)
  const [feesUnavailable, setFeesUnavailable] = useState(false)
  const [accountFees, setAccountFees] = useState<{ items: AccountFee[]; unavailable: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [period, setPeriod] = useState<Period>('tot')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState<KindFilter>('toate')
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>('toate')
  const [wsFilter, setWsFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'at', dir: 'desc' })
  const [now] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    adminBillingPayments()
      .then(r => { if (!cancelled) { setRows(r.rows); setFeesUnavailable(r.feesUnavailable) } })
      .catch(e => { if (!cancelled) toast((e as Error).message, 'err') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey, version, toast])
  const load = () => { setLoading(true); setReloadKey(k => k + 1) }

  // Comisioanele contului (Billing, dispute) pentru perioada aleasă; nu țin de un cabinet anume.
  const [feeFrom, feeTo] = useMemo(() => {
    const [start, end] = periodRange(period, from, to, now)
    return [start ? ymd(start) : undefined, end ? ymd(end) : undefined]
  }, [period, from, to, now])
  useEffect(() => {
    let cancelled = false
    adminStripeFees(feeFrom, feeTo)
      .then(r => { if (!cancelled) setAccountFees(r) })
      .catch(() => { if (!cancelled) setAccountFees({ items: [], unavailable: true }) })
    return () => { cancelled = true }
  }, [feeFrom, feeTo, reloadKey])

  // Toate filtrele în afară de cel de factură: baza pentru „De facturat x/y” (y = plățile de facturat din perioadă).
  const scoped = useMemo(() => {
    const [start, end] = periodRange(period, from, to, now)
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(r => {
      const at = r.at ? new Date(r.at) : null
      if (start && (!at || at < start)) return false
      if (end && (!at || at >= end)) return false
      if (kind !== 'toate' && r.kind !== kind) return false
      if (wsFilter && r.workspaceId !== wsFilter) return false
      if (q && ![r.workspaceName, r.billingName, r.cui, r.invoice?.number ?? ''].some(v => v.toLowerCase().includes(q))) return false
      return true
    })
  }, [rows, period, from, to, kind, wsFilter, search, now])
  const filtered = useMemo(() => scoped.filter(r =>
    invoiceFilter === 'de-facturat' ? needsInvoice(r) : invoiceFilter === 'facturat' ? r.invoice?.status === 'manual' : true,
  ), [scoped, invoiceFilter])
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort])
  const toggleSort = (key: SortKey) => setSort(prev => prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: TEXT_KEYS.includes(key) ? 'asc' : 'desc' })

  const totals = useMemo(() => {
    const sum = (f: (r: PaymentRow) => boolean) => filtered.filter(f).reduce((n, r) => n + r.amount, 0)
    const income = sum(isIncome)
    const refunds = sum(r => r.kind === 'refund')
    const fees = filtered.filter(isIncome).reduce((n, r) => n + (r.fee ?? 0), 0)
    const feesMissing = filtered.some(r => isIncome(r) && r.amount > 0 && r.fee === undefined)
    // Comisioanele contului nu se pot atribui unui cabinet sau unui tip: intră doar în vederea de ansamblu.
    const accountApplies = !wsFilter && kind === 'toate' && invoiceFilter === 'toate' && !search.trim()
    const accountItems = accountApplies ? accountFees?.items ?? [] : []
    const otherFees = accountItems.reduce((n, f) => n + f.amount, 0)
    const vat = Math.round((fees + otherFees) * VAT_RATE)
    return {
      income, refunds, fees, feesMissing, otherFees, accountItems, accountApplies, vat,
      stripeNet: income + refunds - fees - otherFees, net: income + refunds - fees - otherFees - vat,
      subscriptions: sum(r => r.kind === 'subscription'), credits: sum(r => r.kind === 'credits'),
      payments: filtered.filter(r => isIncome(r) && r.amount > 0).length,
      toInvoice: scoped.filter(needsInvoice).length,
      invoiceable: scoped.filter(r => isIncome(r) && r.amount > 0).length,
      toInvoiceAll: (rows ?? []).filter(needsInvoice).length,
      disputes: filtered.filter(r => r.kind === 'dispute').length,
    }
  }, [filtered, scoped, rows, accountFees, wsFilter, kind, invoiceFilter, search])

  // Starea cabinetelor (din documentele workspace, deja încărcate de pagină).
  const states = useMemo(() => {
    const out = { monthly: 0, yearly: 0, manual: 0, credits: 0, trial: 0, comp: 0, readOnly: 0 }
    for (const w of workspaces) {
      const a = billingAccess(w.billing, now)
      if (!a.full) out.readOnly++
      else if (a.reason === 'subscription' || a.reason === 'past_due') {
        if (a.interval === 'year') out.yearly++
        else out.monthly++
      }
      else if (a.reason === 'manual') out.manual++
      else if (a.reason === 'credits') out.credits++
      else if (a.reason === 'trial') out.trial++
      else if (a.reason === 'comp') out.comp++
    }
    return out
  }, [workspaces, now])

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([csv(sorted)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `incasari-cabinio-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Formularul stă în fișa cabinetului (Abonament): o deschidem peste Încasări, cu formularul deja deschis.
  const openManual = (wid: string) => {
    setPicking(false)
    setParams(prev => { const n = new URLSearchParams(prev); n.set('cabinet', wid); n.set('incasare', '1'); return n })
  }

  const updateRow = (r: PaymentRow, invoice: PaymentRow['invoice']) =>
    setRows(prev => (prev ?? []).map(x => (x.id === r.id && x.kind === r.kind ? { ...x, invoice } : x)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {picking && <PickWorkspace workspaces={workspaces} onPick={openManual} onClose={() => setPicking(false)} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '.75rem' }}>
        <Tile label="Încasat brut" value={ron(totals.income)}
          sub={<>
            <div>abonamente: {ron(totals.subscriptions)}</div>
            <div>credite: {ron(totals.credits)}</div>
            <div>{totals.payments} plăți · perioada filtrată</div>
          </>}
          title="Suma plătită de clienți în perioada filtrată (abonamente + credite), înainte de orice comision." />
        <Tile label="Net" value={ron(totals.stripeNet)} strong
          sub={<>
            <div>ⓘ brut − comisioane{totals.refunds ? ' − rambursări' : ''}</div>
            <div>după TVA (estimat): <strong style={{ color: 'var(--s700)' }}>{ron(totals.net)}</strong></div>
          </>}
          title={[
            `Brut: ${ron(totals.income)}`,
            `− comisioane pe plăți: ${ron(totals.fees)}`,
            ...(totals.accountApplies ? [`− alte comisioane Stripe: ${ron(totals.otherFees)}`] : []),
            ...(totals.refunds ? [`− rambursări: ${ron(-totals.refunds)}`] : []),
            `= net Stripe: ${ron(totals.stripeNet)}`,
            `− TVA taxare inversă: ${ron(totals.vat)}`,
            `= net real (estimat): ${ron(totals.net)}`,
          ].join('\n')} />
        <Tile label="Comisioane Stripe" value={ron(totals.fees + (totals.accountApplies ? totals.otherFees : 0))}
          tone={totals.feesMissing || accountFees?.unavailable ? 'warn' : undefined}
          sub={<>
            <div>ⓘ pe plăți: {ron(totals.fees)} ({totals.feesMissing ? 'incomplet' : `${pct(totals.fees, totals.income)} din brut`})</div>
            <div>alte comisioane: {accountFees?.unavailable ? 'nu se pot citi' : totals.accountApplies
              ? `${ron(totals.otherFees)} (${totals.accountItems.length} tranzacții)` : '— (doar fără filtre)'}</div>
          </>}
          title={[
            'Pe plăți: comisioanele de procesare reținute de Stripe din fiecare plată din perioada filtrată,',
            `adică ${pct(totals.fees, totals.income)} din brutul de ${ron(totals.income)} (detaliu: la mouse pe coloana „Comision”).`,
            '',
            'Alte comisioane: reținute de Stripe separat, din soldul contului —',
            '• Stripe Billing (~0,7% din abonamente), periodic;',
            '• taxele pentru dispute (chargeback).',
            ...(!totals.accountApplies
              ? ['Nu țin de un cabinet sau de un tip de plată: apar doar fără filtrele de cabinet, tip, factură și căutare.']
              : accountFees?.unavailable
                ? ['Cheia Stripe a aplicației nu are drept de citire pe Balance.']
                : totals.accountItems.length
                  ? ['', ...totals.accountItems.slice(0, 12).map(f =>
                    `${f.at ? new Date(f.at).toLocaleDateString('ro-RO') : ''} · ${ACCOUNT_FEE_LABEL[f.category]}: ${ron(f.amount)}`),
                    ...(totals.accountItems.length > 12 ? [`… și încă ${totals.accountItems.length - 12}`] : [])]
                  : []),
          ].join('\n')} />
        <Tile label="TVA taxare inversă (estimat)" value={ron(totals.vat)} sub={`ⓘ 21% din comisioane`}
          title={[
            `TVA = 21% × (${ron(totals.fees)} + ${ron(totals.otherFees)}) = ${ron(totals.vat)}`,
            '',
            'Stripe (Irlanda) facturează comisioanele fără TVA; ca PFA cu cod de TVA art. 317 datorezi',
            'TVA-ul cu taxare inversă statului (declarația 301). Nu se plătește către Stripe.',
            'Estimare pentru contabil: suma exactă se calculează din facturile Stripe de comisioane.',
          ].join('\n')} />
        <Tile label="De facturat" value={`${totals.toInvoice}/${totals.invoiceable}`} tone={totals.toInvoice ? 'warn' : undefined}
          sub={<>
            <div>fără factură / plăți de facturat · perioada filtrată</div>
            {totals.toInvoiceAll !== totals.toInvoice && <div>în toate perioadele: {totals.toInvoiceAll}</div>}
          </>}
          onClick={totals.toInvoice ? () => setInvoiceFilter('de-facturat') : undefined} />
      </div>
      {totals.refunds !== 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '.75rem' }}>
          <Tile label="Rambursat" value={ron(-totals.refunds)} tone="warn" />
        </div>
      )}

      {feesUnavailable && (
        <div role="status" style={{ border: '1px solid var(--y200)', background: 'var(--y50)', color: 'var(--a800, #92400e)', borderRadius: 8,
          padding: '.5rem .75rem', fontSize: '.8125rem' }}>
          Comisioanele Stripe nu se pot citi: cheia Stripe a aplicației nu are drept de citire pe PaymentIntents, Charges, Balance și Invoices.
          Sumele brute sunt corecte; comisioanele apar după ce adaugi drepturile.
        </div>
      )}

      <div className="card">
        <div className="card-body" style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '.8125rem', color: 'var(--s600)' }}>
          <strong style={{ color: 'var(--s800)' }}>Cabinete acum:</strong>
          <span>{states.monthly} abonamente lunare</span>
          <span>{states.yearly} anuale</span>
          {states.manual > 0 && <span>{states.manual} plătite manual</span>}
          <span>{states.credits} pe credite</span>
          <span>{states.trial} în probă</span>
          <span>{states.comp} cu acces gratuit</span>
          <span>{states.readOnly} în modul citire</span>
          {totals.disputes > 0 && <span style={{ color: 'var(--r600)', fontWeight: 600 }}>{totals.disputes} dispute în perioadă</span>}
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: '.5rem' }}>
          <span className="card-title">💳 Încasări</span>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={exportCsv} disabled={!filtered.length} title="Descarcă încasările filtrate, pentru contabil">
              <IconExport />Export CSV
            </button>
            <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}
              title="Recitește lista din aplicație (ce a trimis deja Stripe + încasările manuale); nu sincronizează cu Stripe">
              <IconRefresh /><BtnLabel busy={loading} dark>Actualizează lista</BtnLabel>
            </button>
            <button className="btn btn-primary btn-sm" title="Abonament sau credite plătite prin transfer, numerar etc."
              onClick={() => (wsFilter ? openManual(wsFilter) : setPicking(true))}><IconPlus />Încasare manuală</button>
          </div>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.875rem' }}>
            <select className="field-input" style={SELECT} value={period} onChange={e => setPeriod(e.target.value as Period)} aria-label="Perioada">
              <option value="luna">Luna curentă</option>
              <option value="luna-trecuta">Luna trecută</option>
              <option value="an">Anul curent</option>
              <option value="tot">Toate</option>
              <option value="interval">Interval…</option>
            </select>
            {period === 'interval' && (<>
              <input className="field-input" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: '9.5rem' }} aria-label="De la" />
              <input className="field-input" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: '9.5rem' }} aria-label="Până la" />
            </>)}
            <select className="field-input" style={SELECT} value={kind} onChange={e => setKind(e.target.value as KindFilter)} aria-label="Tipul">
              <option value="toate">Toate tipurile</option>
              <option value="subscription">Abonamente</option>
              <option value="credits">Credite</option>
              <option value="refund">Rambursări</option>
              <option value="dispute">Dispute</option>
            </select>
            <select className="field-input" style={SELECT} value={invoiceFilter} onChange={e => setInvoiceFilter(e.target.value as InvoiceFilter)} aria-label="Factura">
              <option value="toate">Orice factură</option>
              <option value="de-facturat">De facturat</option>
              <option value="facturat">Facturate</option>
            </select>
            <select className="field-input" style={{ ...SELECT, maxWidth: '14rem' }} value={wsFilter} onChange={e => setWsFilter(e.target.value)} aria-label="Cabinetul">
              <option value="">Toate cabinetele</option>
              {[...workspaces].sort((a, b) => a.name.localeCompare(b.name, 'ro')).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <input className="field-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Caută: cabinet, firmă, CUI, nr. factură"
              style={{ flex: '1 1 14rem' }} aria-label="Caută" />
          </div>

          {rows === null ? (
            <div className="card-sub">{loading ? 'Se încarcă…' : 'Nu s-au putut încărca încasările.'}</div>
          ) : filtered.length === 0 ? (
            <div className="card-sub">Nicio încasare pentru filtrele alese.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
                <thead>
                  <tr style={{ color: 'var(--s500)', textAlign: 'left' }}>
                    {COLUMNS.map(c => {
                      const active = sort.key === c.key
                      return (
                        <th key={c.key} style={{ ...TH, textAlign: c.right ? 'right' : 'left' }}
                          aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                          <button type="button" className={`th-sort${active ? ' is-active' : ''}`} onClick={() => toggleSort(c.key)}>
                            {c.label}
                            <span className="th-sort-arrow" aria-hidden>{active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => (
                    <tr key={`${r.kind}:${r.workspaceId}:${r.id}`} style={{ borderTop: '1px solid var(--s100)', color: 'var(--s700)', verticalAlign: 'top' }}>
                      <td style={{ ...TD, whiteSpace: 'nowrap' }}>{r.at ? new Date(r.at).toLocaleDateString('ro-RO') : '—'}</td>
                      <td style={TD}>{r.workspaceName || <span style={{ color: 'var(--s400)' }}>cabinet șters</span>}</td>
                      <td style={TD}>
                        <div>{r.billingName || '—'}</div>
                        {r.cui && <div style={{ color: 'var(--s500)' }}>CUI {r.cui}</div>}
                      </td>
                      <td style={TD}>
                        <span className={`chip ${r.kind === 'refund' || r.kind === 'dispute' ? 'chip-muted' : 'chip-primary'}`} style={{ marginRight: '.375rem' }}>
                          {KIND_LABEL[r.kind]}
                        </span>
                        {r.source === 'manual' && <span className="chip chip-muted" style={{ marginRight: '.375rem' }}>Manual</span>}
                        <span style={{ color: 'var(--s600)' }}>{describe(r).replace(/^(Abonament|Rambursare)\s?/, '')}</span>
                        {r.stripeCustomerId && r.source !== 'manual' && (
                          <div><a href={`https://dashboard.stripe.com/customers/${r.stripeCustomerId}`} target="_blank" rel="noreferrer"
                            style={{ fontSize: '.75rem' }}>Vezi în Stripe ↗</a></div>
                        )}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap',
                        color: r.amount < 0 ? 'var(--r600)' : r.kind === 'dispute' ? 'var(--a800, #92400e)' : 'var(--s900)' }}>{ron(r.amount)}</td>
                      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--s500)',
                        cursor: feeTooltip(r) ? 'help' : undefined, textDecoration: feeTooltip(r) ? 'underline dotted' : undefined }}
                        title={feeTooltip(r)}>
                        {r.fee !== undefined ? ron(-r.fee) : isIncome(r) && r.amount > 0 ? '…' : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {r.net !== undefined ? ron(r.net) : r.kind === 'refund' ? ron(r.amount) : isIncome(r) && r.amount === 0 ? ron(0) : '…'}
                        {r.feeCurrency && r.feeCurrency !== 'ron' && <div style={{ fontSize: '.7rem', color: 'var(--s400)' }}>în {r.feeCurrency.toUpperCase()}</div>}
                      </td>
                      <td style={TD}>{isIncome(r) ? <InvoiceCell row={r} onChange={inv => updateRow(r, inv)} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="card-sub" style={{ marginTop: '.75rem' }}>
            Brut = suma plătită de client; comisionul și netul vin din Stripe (citite o dată pe plată; „…” = încă necitit, apare la
            reîncărcare). TVA-ul cu taxare inversă pe comisioane nu e inclus. Plățile de 0 RON (coduri de 100%) nu se facturează.
          </p>
        </div>
      </div>
    </div>
  )
}

/** Evidența facturii emise manual: număr + „Marchează facturat”, sau numărul existent cu posibilitatea de anulare. */
/** Alegerea cabinetului pentru o încasare manuală: căutare după nume sau e-mail. */
function PickWorkspace({ workspaces, onPick, onClose }: { workspaces: Workspace[]; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const list = workspaces
    .filter(w => w.status !== 'pendingDeletion')
    .filter(w => !needle || w.name.toLowerCase().includes(needle)
      || Object.values(w.members ?? {}).some(m => (m.email ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ro'))
  return (
    <Modal onClose={onClose} ariaLabel="Alege cabinetul" boxStyle={{ maxWidth: '28rem', width: '100%' }}>
      <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--s900)' }}>Încasare manuală</div>
          <div style={{ fontSize: '.8125rem', color: 'var(--s500)' }}>Pentru ce cabinet? Se deschide fișa lui, cu formularul.</div>
        </div>
        <input className="field-input" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Caută: cabinet sau e-mail"
          aria-label="Caută cabinetul" onKeyDown={e => { if (e.key === 'Enter' && list.length === 1) onPick(list[0].id) }} />
        <div className="pick-ws-list" role="listbox" aria-label="Cabinete">
          {list.slice(0, 50).map(w => {
            const admin = Object.values(w.members ?? {}).find(m => m.role === 'admin')?.email
            return (
              <button key={w.id} type="button" role="option" aria-selected={false} className="pick-ws-item" onClick={() => onPick(w.id)}>
                <span>{w.name}</span>
                {admin && <small>{admin}</small>}
              </button>
            )
          })}
          {list.length === 0 && <div style={{ color: 'var(--s500)', fontSize: '.8125rem', padding: '.5rem' }}>Niciun cabinet găsit.</div>}
        </div>
      </div>
    </Modal>
  )
}

function InvoiceCell({ row, onChange }: { row: PaymentRow; onChange: (inv: PaymentRow['invoice']) => void }) {
  const { toast } = useApp()
  const [editing, setEditing] = useState(false)
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)
  if (row.amount <= 0) return <span style={{ color: 'var(--s400)' }}>nu e cazul (0 RON)</span>

  const save = async (value: string | null) => {
    setBusy(true)
    try {
      const { invoice } = await adminMarkInvoiced(row, value)
      onChange(invoice)
      setEditing(false)
      setNumber('')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (row.invoice?.status === 'manual') {
    return (
      <div style={{ display: 'flex', gap: '.375rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--g700)', fontWeight: 600 }}>✓ {row.invoice.number}</span>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save(null)} title="Marchează din nou ca nefacturată">Anulează</button>
      </div>
    )
  }
  if (!editing) {
    return (
      <div style={{ display: 'flex', gap: '.375rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--a800, #92400e)', fontWeight: 600 }}>de facturat</span>
        <button className="btn btn-sm" onClick={() => setEditing(true)}>Marchează facturat</button>
      </div>
    )
  }
  return (
    <form style={{ display: 'flex', gap: '.375rem', alignItems: 'center' }} onSubmit={e => { e.preventDefault(); if (number.trim()) void save(number.trim()) }}>
      <input className="field-input" autoFocus value={number} onChange={e => setNumber(e.target.value)} maxLength={60}
        placeholder="Seria și nr." style={{ width: '8rem' }} aria-label="Seria și numărul facturii" />
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !number.trim()}>Salvează</button>
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(false)}>×</button>
    </form>
  )
}

function Tile({ label, value, sub, strong, tone, title, onClick }: {
  label: string; value: string; sub?: React.ReactNode; strong?: boolean; tone?: 'warn'; title?: string; onClick?: () => void
}) {
  const body = (
    <>
      <div style={{ fontSize: '.75rem', color: 'var(--s500)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: strong ? '1.35rem' : '1.1rem', fontWeight: 800, letterSpacing: '-.01em',
        color: tone === 'warn' ? 'var(--a800, #92400e)' : 'var(--s900)' }}>{value}</div>
      {sub && <div style={{ fontSize: '.7rem', color: 'var(--s400)' }}>{sub}</div>}
    </>
  )
  const style: React.CSSProperties = { padding: '.75rem .875rem', textAlign: 'left', width: '100%',
    ...(strong ? { borderColor: 'var(--p500)' } : {}) }
  return onClick
    ? <button type="button" className="card" onClick={onClick} style={{ ...style, cursor: 'pointer', font: 'inherit' }} title="Arată plățile de facturat">{body}</button>
    : <div className="card" style={{ ...style, cursor: title ? 'help' : undefined }} title={title}>{body}</div>
}

const SELECT: React.CSSProperties = { width: 'auto' }
const TH: React.CSSProperties = { padding: '.375rem .5rem', fontWeight: 600, whiteSpace: 'nowrap' }
const TD: React.CSSProperties = { padding: '.5rem' }
