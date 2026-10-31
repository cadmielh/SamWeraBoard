import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import { fetchAnafCompany } from '../lib/api'
import {
  formatDate, getBilling, openPortal, saveBillingDetails, startCheckout, syncBilling, toDate,
  type BillingDetails, type BillingOverview,
} from '../lib/billing'

const EMPTY_DETAILS: BillingDetails = {
  tip: 'PJ', denumire: '', cui: '', regCom: '', adresa: '', localitate: '', judet: '', email: '',
}
const FEATURES = [
  'Clienți, dosare și sarcini nelimitate',
  'Scanare acte de identitate (OCR)',
  'Generare documente din șabloane, inclusiv sugestii AI',
  'Toți colegii cabinetului, fără cost per utilizator',
]

function detailsComplete(d: BillingDetails): boolean {
  return !!(d.denumire.trim() && d.adresa.trim() && d.localitate.trim() && d.judet.trim() && d.email.trim()
    && (d.tip === 'PF' || d.cui.trim()))
}

export default function AbonamentPage() {
  const { activeWorkspace, billing, userRole, toast } = useApp()
  const isAdmin = userRole === 'admin'
  const [params, setParams] = useSearchParams()
  const [overview, setOverview] = useState<BillingOverview | null>(null)
  const [details, setDetails] = useState<BillingDetails>(EMPTY_DETAILS)
  const [savedDetails, setSavedDetails] = useState<BillingDetails | null>(null)
  // Planul ales pe carduri; null = încă la pasul 1.
  const [period, setPeriod] = useState<'month' | 'year' | null>(null)
  // Datele salvate apar ca rezumat; formularul se deschide doar la „Modifică” sau dacă lipsesc.
  const [editing, setEditing] = useState(true)
  const [busy, setBusy] = useState<'' | 'checkout' | 'portal' | 'details' | 'anaf'>('')
  // Întoarcere reușită din Checkout: arătăm „se procesează” până confirmă Stripe.
  const [processing, setProcessing] = useState(() => params.get('checkout') === 'success')
  const [openedAt] = useState(() => Date.now())
  const handledReturn = useRef(false)

  const workspaceId = activeWorkspace?.id
  useEffect(() => {
    if (!isAdmin || !workspaceId) return
    let cancelled = false
    getBilling()
      .then(o => {
        if (cancelled) return
        setOverview(o)
        if (o.details) {
          setDetails({ ...EMPTY_DETAILS, ...o.details })
          setSavedDetails(o.details)
          setEditing(!detailsComplete({ ...EMPTY_DETAILS, ...o.details }))
        }
      })
      .catch(e => { if (!cancelled) toast((e as Error).message, 'err') })
    return () => { cancelled = true }
  }, [isAdmin, workspaceId, toast])

  // Întoarcerea din Stripe Checkout: recitim abonamentul imediat (nu așteptăm webhook-ul), cu câteva reîncercări.
  useEffect(() => {
    if (handledReturn.current) return
    const status = params.get('checkout')
    if (!status) return
    handledReturn.current = true
    const sessionId = params.get('session_id') ?? undefined
    setParams({}, { replace: true })
    if (status !== 'success') { toast('Plata a fost anulată. Nu s-a încasat nimic.', 'info'); return }
    void (async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const { billing: b } = await syncBilling(sessionId)
          if (b.hasSubscription) { toast('Abonamentul este activ. Mulțumim!', 'ok'); break }
        } catch { /* reîncercăm */ }
        await new Promise(r => setTimeout(r, 2500))
      }
      setProcessing(false)
    })()
  }, [params, setParams, toast])

  if (!activeWorkspace) return null
  const raw = activeWorkspace.billing
  const trialEnd = toDate(raw?.trialEndsAt)
  const trialCarries = !!trialEnd && trialEnd.getTime() - openedAt >= 48 * 3600_000
  const prices = overview?.prices ?? { month: 200, year: 2000 }
  const yearSaving = prices.month * 12 - prices.year

  const choosePlan = (iv: 'month' | 'year') => {
    setPeriod(iv)
    window.scrollTo?.({ top: 0 })
  }
  const checkout = async (iv: 'month' | 'year') => {
    setBusy('checkout')
    try {
      await startCheckout(iv)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'subscription_exists') await portal()
      else toast((e as Error).message, 'err')
      setBusy('')
    }
  }
  const portal = async () => {
    setBusy('portal')
    try {
      await openPortal()
    } catch (e) {
      toast((e as Error).message, 'err')
      setBusy('')
    }
  }
  const saveDetails = async (quiet = false): Promise<boolean> => {
    setBusy('details')
    try {
      const { details: saved } = await saveBillingDetails(details)
      setDetails(saved)
      setSavedDetails(saved)
      setEditing(false)
      if (!quiet) toast('Datele de facturare au fost salvate', 'ok')
      return true
    } catch (e) {
      toast((e as Error).message, 'err')
      return false
    } finally {
      setBusy('')
    }
  }
  // Un singur buton la pasul 2: salvăm datele (dacă s-au schimbat), apoi plecăm spre Stripe.
  const saveAndCheckout = async () => {
    if (!period) return
    if (detailsDirty && !(await saveDetails(true))) return
    await checkout(period)
  }
  const fromAnaf = async () => {
    if (!details.cui.trim()) return
    setBusy('anaf')
    try {
      const r = await fetchAnafCompany(details.cui)
      if (!r.found) { toast('CUI-ul nu a fost găsit în baza de date ANAF', 'info'); return }
      const c = r.adresaSediuComponente
      setDetails(d => ({
        ...d,
        denumire: r.denumire ?? d.denumire,
        regCom: r.nrRegCom ?? d.regCom,
        adresa: c ? [c.strada, c.numar, c.detaliiAdresa].filter(Boolean).join(' ').trim() || (r.adresa ?? d.adresa) : (r.adresa ?? d.adresa),
        localitate: c?.localitate || d.localitate,
        judet: c?.judet || d.judet,
      }))
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy('')
    }
  }

  const detailsDirty = JSON.stringify(details) !== JSON.stringify(savedDetails ?? EMPTY_DETAILS)
  const detailsBlock = editing || !savedDetails
    ? <DetailsForm details={details} setDetails={setDetails} onAnaf={() => void fromAnaf()} anafBusy={busy === 'anaf'} disabled={busy !== ''} />
    : <DetailsSummary d={savedDetails} onEdit={() => setEditing(true)} disabled={busy !== ''} />

  return (
    <div className="page--data">
      <div className="page-top">
        <div className="page-header">
          <div>
            <div className="page-title">Abonament</div>
            <div className="page-subtitle">Perioada de probă, plata și datele de facturare ale cabinetului</div>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 720 }}>
          <div className="card">
            <div className="card-head"><span className="card-title">Starea abonamentului</span>{statusChip(billing)}</div>
            <div className="card-body">
              {processing
                ? <p style={{ display: 'flex', gap: '.5rem', alignItems: 'center', color: 'var(--s600)' }}><span className="spin spin-dark" />Se procesează plata…</p>
                : <p style={{ color: 'var(--s600)', fontSize: '.9rem', lineHeight: 1.55 }}>{statusText(billing)}</p>}
              {isAdmin && billing.hasSubscription && (
                <div style={{ marginTop: '1rem' }}>
                  <button className="btn btn-primary" onClick={portal} disabled={busy !== ''}>
                    {busy === 'portal' ? <span className="spin" /> : 'Gestionează abonamentul'}
                  </button>
                  <p style={{ color: 'var(--s400)', fontSize: '.75rem', marginTop: '.5rem' }}>
                    Card, istoric plăți, trecere lunar ↔ anual, anulare — în portalul securizat Stripe.
                  </p>
                </div>
              )}
              {!isAdmin && (
                <p style={{ color: 'var(--s400)', fontSize: '.8125rem', marginTop: '.75rem' }}>
                  Abonamentul se gestionează de administratorul cabinetului.
                </p>
              )}
            </div>
          </div>

          {isAdmin && !billing.hasSubscription && !period && (
            <div>
              <div style={{ fontWeight: 700, color: 'var(--s900)', marginBottom: '.25rem' }}>1. Alege planul</div>
              <p style={{ color: 'var(--s500)', fontSize: '.8125rem', marginBottom: '.875rem' }}>
                Aceleași funcții în ambele variante. Preț final per cabinet (furnizor neplătitor de TVA);
                se poate anula oricând, cu efect la sfârșitul perioadei plătite.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '1rem' }}>
                <PlanCard title="Lunar" price={prices.month} unit="lună" note="Plătești lună de lună."
                  onChoose={() => choosePlan('month')} />
                <PlanCard title="Anual" price={prices.year} unit="an" highlight
                  badge={yearSaving > 0 ? `Economisești ${yearSaving} RON` : undefined}
                  note={`Echivalent ${Math.round(prices.year / 12)} RON/lună · 2 luni gratuite.`}
                  onChoose={() => choosePlan('year')} />
              </div>
              <ul style={{ margin: '1rem 0 0', paddingLeft: '1.1rem', color: 'var(--s600)', fontSize: '.875rem', lineHeight: 1.7 }}>
                {FEATURES.map(f => <li key={f}>{f}</li>)}
              </ul>
            </div>
          )}

          {isAdmin && !billing.hasSubscription && period && (
            <div className="card">
              <div className="card-head">
                <span className="card-title">2. Date de facturare și plată</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setPeriod(null)} disabled={busy !== ''}>Schimbă planul</button>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <span style={{ color: 'var(--s600)', fontSize: '.875rem' }}>Plan ales:</span>
                  <strong style={{ color: 'var(--s900)' }}>
                    Cabinio Standard {period === 'month' ? `lunar · ${prices.month} RON/lună` : `anual · ${prices.year} RON/an`}
                  </strong>
                </div>
                {detailsBlock}
                {trialCarries && billing.reason === 'trial' && (
                  <p style={{ color: 'var(--g700)', fontSize: '.8125rem', margin: '1rem 0 0' }}>
                    Zilele de probă rămase se păstrează: prima plată se face pe {formatDate(trialEnd)}.
                  </p>
                )}
                <div style={{ marginTop: '1rem' }}>
                  <button className="btn btn-primary" onClick={saveAndCheckout} disabled={!detailsComplete(details) || busy !== ''}>
                    {busy === 'checkout' || busy === 'details' ? <span className="spin" /> : 'Continuă spre plată'}
                  </button>
                  <p style={{ color: 'var(--s400)', fontSize: '.75rem', marginTop: '.5rem' }}>
                    Plata se face pe pagina securizată Stripe. Ai un cod promoțional? Îl introduci acolo.
                  </p>
                </div>
              </div>
            </div>
          )}

          {isAdmin && billing.hasSubscription && (
            <div className="card">
              <div className="card-head"><span className="card-title">Date de facturare</span></div>
              <div className="card-body">
                {detailsBlock}
                {editing && (
                  <div style={{ marginTop: '1rem' }}>
                    <button className="btn btn-primary" onClick={() => void saveDetails()} disabled={!detailsComplete(details) || !detailsDirty || busy !== ''}>
                      {busy === 'details' ? <span className="spin" /> : 'Salvează'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PlanCard({ title, price, unit, note, badge, highlight, onChoose }: {
  title: string; price: number; unit: string; note: string; badge?: string; highlight?: boolean
  onChoose: () => void
}) {
  return (
    <div className="card" style={highlight ? { borderColor: 'var(--p500)', boxShadow: '0 0 0 1px var(--p500)' } : undefined}>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--s900)' }}>{title}</span>
          {badge && <span className="chip chip-success">{badge}</span>}
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--s900)', letterSpacing: '-.02em' }}>
          {price} RON<span style={{ fontSize: '.9rem', fontWeight: 500, color: 'var(--s500)' }}> / {unit}</span>
        </div>
        <p style={{ color: 'var(--s500)', fontSize: '.8125rem', flex: 1 }}>{note}</p>
        <button className={`btn ${highlight ? 'btn-primary' : 'btn-ghost'}`} onClick={onChoose}>Alege {title.toLowerCase()}</button>
      </div>
    </div>
  )
}

function DetailsForm({ details, setDetails, onAnaf, anafBusy, disabled }: {
  details: BillingDetails
  setDetails: React.Dispatch<React.SetStateAction<BillingDetails>>
  onAnaf: () => void
  anafBusy: boolean
  disabled: boolean
}) {
  const set = (k: keyof BillingDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDetails(d => ({ ...d, [k]: e.target.value }))
  return (
    <>
                <div role="radiogroup" aria-label="Tip client" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '.875rem' }}>
                  {(['PJ', 'PF'] as const).map(t => (
                    <label key={t} style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                      <input type="radio" checked={details.tip === t} onChange={() => setDetails(d => ({ ...d, tip: t }))} />
                      {t === 'PJ' ? 'Persoană juridică / PFA / cabinet' : 'Persoană fizică'}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '.875rem' }}>
                  {details.tip === 'PJ' && (
                    <div className="field">
                      <label className="field-label" htmlFor="bd-cui">CUI</label>
                      <div style={{ display: 'flex', gap: '.5rem' }}>
                        <input id="bd-cui" className="field-input" value={details.cui} onChange={set('cui')} placeholder="ex: RO12345678"
                          onKeyDown={e => { if (e.key === 'Enter') onAnaf() }} />
                        <button className="btn btn-ghost btn-sm" onClick={onAnaf} disabled={!details.cui.trim() || disabled}>
                          {anafBusy ? <span className="spin spin-dark" /> : 'Completează din ANAF'}
                        </button>
                      </div>
                    </div>
                  )}
                  <Field id="bd-denumire" label={details.tip === 'PJ' ? 'Denumire' : 'Nume și prenume'} value={details.denumire} onChange={set('denumire')} />
                  {details.tip === 'PJ' && <Field id="bd-regcom" label="Nr. Reg. Com. (opțional)" value={details.regCom} onChange={set('regCom')} />}
                  <Field id="bd-adresa" label="Adresă" value={details.adresa} onChange={set('adresa')} />
                  <Field id="bd-localitate" label="Localitate" value={details.localitate} onChange={set('localitate')} />
                  <Field id="bd-judet" label="Județ" value={details.judet} onChange={set('judet')} />
                  <Field id="bd-email" label="E-mail pentru facturi" type="email" value={details.email} onChange={set('email')} />
                </div>
    </>
  )
}

function DetailsSummary({ d, onEdit, disabled }: { d: BillingDetails; onEdit: () => void; disabled: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start',
      background: 'var(--s50)', border: '1px solid var(--s100)', borderRadius: 8, padding: '.75rem 1rem', fontSize: '.875rem' }}>
      <div style={{ color: 'var(--s700)', lineHeight: 1.55 }}>
        <div style={{ fontWeight: 600, color: 'var(--s900)' }}>{d.denumire}</div>
        {d.tip === 'PJ' && <div>CUI {d.cui}{d.regCom ? ` · ${d.regCom}` : ''}</div>}
        <div>{[d.adresa, d.localitate, d.judet].filter(Boolean).join(', ')}</div>
        <div style={{ color: 'var(--s500)' }}>Facturile se trimit la {d.email}</div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onEdit} disabled={disabled}>Modifică</button>
    </div>
  )
}

function Field({ id, label, value, onChange, type = 'text' }: {
  id: string; label: string; value: string; type?: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} className="field-input" type={type} value={value} onChange={onChange} />
    </div>
  )
}

function statusChip(b: ReturnType<typeof useApp>['billing']) {
  if (!b.full) return <span className="badge badge-inactiv">Mod citire</span>
  if (b.reason === 'past_due') return <span className="badge badge-inactiv">Plată eșuată</span>
  if (b.reason === 'trial') return <span className="chip chip-primary">Perioadă de probă</span>
  if (b.reason === 'comp') return <span className="chip chip-success">Acces gratuit</span>
  return <span className="badge badge-activ">Activ</span>
}

function statusText(b: ReturnType<typeof useApp>['billing']): string {
  const until = formatDate(b.accessUntil)
  if (!b.full) {
    return 'Cabinetul este în modul citire: puteți consulta și exporta toate datele, dar nu puteți adăuga sau modifica, ' +
      'scana acte ori genera documente. Activați abonamentul pentru a continua.'
  }
  switch (b.reason) {
    case 'past_due':
      return `Ultima plată a eșuat. Stripe reîncearcă automat; actualizați cardul până pe ${until} ca să păstrați accesul complet.`
    case 'trial':
      return `Perioadă de probă: ${b.daysLeft} zile rămase (până pe ${until}). Toate funcțiile sunt disponibile.`
    case 'comp':
      return `Cabinetul are acces gratuit până pe ${until}.`
    default:
      return b.cancelAtPeriodEnd
        ? `Abonamentul a fost anulat și rămâne activ până pe ${formatDate(b.currentPeriodEnd)}.`
        : `Abonament ${b.interval === 'year' ? 'anual' : 'lunar'} activ. Următoarea plată: ${formatDate(b.currentPeriodEnd)}.`
  }
}
