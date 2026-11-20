import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import { fetchAnafCompany } from '../lib/api'
import {
  formatDate, getBilling, getCredits, openPortal, saveBillingDetails, startCheckout, startCreditsCheckout, syncBilling,
  toDate, type BillingDetails, type BillingOverview, type CreditPack, type CreditsOverview,
} from '../lib/billing'
import BtnLabel from './BtnLabel'
import { Skeleton } from './Skeleton'

const EMPTY_DETAILS: BillingDetails = {
  tip: 'PJ', denumire: '', cui: '', regCom: '', adresa: '', localitate: '', judet: '', email: '', professional: false,
}
const FEATURES = [
  'Clienți, dosare și sarcini nelimitate',
  'Scanare acte de identitate (OCR)',
  'Generare documente din șabloane, inclusiv sugestii AI',
  'Toți colegii cabinetului, fără cost per utilizator',
]

const PACKS: CreditPack[] = ['10', '30', '50']
/** Durata perioadei de probă, pentru bara de zile rămase. */
const TRIAL_DAYS = 14

type Choice = { kind: 'sub'; interval: 'month' | 'year' } | { kind: 'pack'; pack: CreditPack }

// Alegerea stă în adresă (?alege=month|year|c10|c30|c50): pasul 2 e o intrare în istoric, deci butonul Înapoi al
// browserului (sau gestul de pe telefon) duce înapoi la pasul 1.
function parseChoice(v: string | null): Choice | null {
  if (v === 'month' || v === 'year') return { kind: 'sub', interval: v }
  const pack = v?.startsWith('c') ? v.slice(1) : null
  return pack && (PACKS as string[]).includes(pack) ? { kind: 'pack', pack: pack as CreditPack } : null
}
const choiceParam = (c: Choice) => (c.kind === 'sub' ? c.interval : `c${c.pack}`)

function detailsComplete(d: BillingDetails): boolean {
  return !!(d.tip === 'PJ' && d.cui.trim() && d.professional && d.denumire.trim() && d.adresa.trim() && d.localitate.trim()
    && d.judet.trim() && d.email.trim())
}

/** Setări › Plan și credite: starea planului, cumpărarea (abonament sau credite), creditele și datele de facturare. */
export default function PlanSection() {
  const { activeWorkspace, billing, userRole, toast } = useApp()
  const isAdmin = userRole === 'admin'
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [overview, setOverview] = useState<BillingOverview | null>(null)
  // Citirea prețurilor/datelor de facturare a eșuat: mesaj cu „Reîncearcă”, nu schelet la nesfârșit.
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [details, setDetails] = useState<BillingDetails>(EMPTY_DETAILS)
  const [savedDetails, setSavedDetails] = useState<BillingDetails | null>(null)
  // Planul sau pachetul ales pe carduri (din adresă); null = încă la pasul 1.
  const choice = parseChoice(params.get('alege'))
  // Fila deschisă la pasul 1: a alegerii curente, altfel Credite pentru un cabinet deja pe credite.
  const [offerTab, setOfferTab] = useState<'sub' | 'credits'>(() =>
    choice ? (choice.kind === 'pack' ? 'credits' : 'sub') : billing.reason === 'credits' ? 'credits' : 'sub')
  // Ofertele stau deschise când e nevoie de ele (probă, citire, credite puține); cine are credite destule (inclusiv
  // lângă un abonament) vine de obicei să-și vadă soldul, deci le deschide din butonul de sus.
  const [offersOpen, setOffersOpen] = useState(() => !(billing.full && billing.credits.balance > 3))
  const [credits, setCredits] = useState<CreditsOverview | null>(null)
  // Datele salvate apar ca rezumat; formularul se deschide doar la „Modifică” sau dacă lipsesc.
  const [editing, setEditing] = useState(true)
  const [busy, setBusy] = useState<'' | 'checkout' | 'portal' | 'details' | 'anaf'>('')
  // Întoarcere reușită din Checkout: arătăm „se confirmă” până confirmă Stripe, apoi reușita.
  const [processing, setProcessing] = useState(() => params.get('checkout') === 'success')
  const [paid, setPaid] = useState<'' | 'credits' | 'sub'>('')
  const [openedAt] = useState(() => Date.now())
  const handledReturn = useRef(false)
  const offersRef = useRef<HTMLDivElement>(null)

  const workspaceId = activeWorkspace?.id
  useEffect(() => {
    if (!isAdmin || !workspaceId) return
    let cancelled = false
    getBilling(workspaceId)
      .then(o => {
        if (cancelled) return
        setOverview(o)
        if (o.details) {
          // Doar profesioniști: datele vechi de persoană fizică se completează din nou ca firmă / PFA / II / IF.
          setDetails({ ...EMPTY_DETAILS, ...o.details, tip: 'PJ' })
          setSavedDetails(o.details)
          setEditing(!detailsComplete({ ...EMPTY_DETAILS, ...o.details }))
        }
      })
      .catch(e => { if (!cancelled) setOverviewError(friendlyError(e)) })
    return () => { cancelled = true }
  }, [isAdmin, workspaceId, reloadKey])

  // Istoricul creditelor: reîncărcat când se schimbă soldul (cumpărare, consum, acordare).
  const lotsKey = JSON.stringify(activeWorkspace?.billing?.credits?.lots ?? [])
  useEffect(() => {
    if (!isAdmin || !workspaceId) return
    let cancelled = false
    getCredits(workspaceId, lotsKey).then(c => { if (!cancelled) setCredits(c) }).catch(() => { /* panoul rămâne ascuns */ })
    return () => { cancelled = true }
  }, [isAdmin, workspaceId, lotsKey])

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
      let confirmed = false
      for (let attempt = 0; attempt < 4 && !confirmed; attempt++) {
        try {
          const { billing: b } = await syncBilling(sessionId)
          if (sessionId && b.credits?.lots?.some(l => l.id === sessionId)) { setPaid('credits'); confirmed = true; break }
          if (b.hasSubscription) { setPaid('sub'); confirmed = true; break }
        } catch { /* reîncercăm */ }
        await new Promise(r => setTimeout(r, 2500))
      }
      // Webhook-ul Stripe poate întârzia: starea se actualizează singură când ajunge (documentul cabinetului e urmărit live).
      if (!confirmed) toast('Plata se confirmă în câteva momente; pagina se actualizează singură.', 'info')
      setProcessing(false)
    })()
  }, [params, setParams, toast])

  if (!activeWorkspace) return null
  const raw = activeWorkspace.billing
  // Oglinda billing.trial_end_for_checkout: zilele gratuite rămase (probă sau acces gratuit) se păstrează.
  const freeUntil = [toDate(raw?.trialEndsAt), toDate(raw?.compUntil)]
    .reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null)
  const freeCarries = !!freeUntil && freeUntil.getTime() - openedAt >= 48 * 3600_000
  const prices = overview?.prices
  const packs = overview?.packs
  const nextPrices = overview?.nextPrices ?? null
  const nextPacks = overview?.nextPacks ?? null
  // Ultima zi la prețul curent: ziua dinaintea intrării în vigoare a prețurilor noi (ora României).
  const nextFrom = toDate(overview?.nextPricesFrom ?? null)
  const priceDeadline = nextFrom ? new Date(nextFrom.getTime() - 1) : null
  // Oferta de lansare: prețurile de acum până la priceDeadline; cele de după apar tăiate pe carduri.
  const offerDaysLeft = nextFrom ? Math.max(0, Math.ceil((nextFrom.getTime() - openedAt) / 86_400_000)) : null
  // Abonament nou: doar fără abonament. Credite: și cu un abonament anulat (se încheie sigur), nu cu unul care se reînnoiește.
  const canBuySub = !billing.hasSubscription
  const canBuyCredits = !billing.hasSubscription || billing.cancelAtPeriodEnd

  const choose = (c: Choice) => {
    setOfferTab(c.kind === 'pack' ? 'credits' : 'sub')
    setParams({ alege: choiceParam(c) }, { state: { fromStep1: true } })
    window.scrollTo?.({ top: 0 })
  }
  // Înapoi la pasul 1: prin istoric, dacă pasul 2 a fost deschis de aici (ca butonul Înapoi al browserului să rămână
  // coerent); altfel (link direct) doar scoatem alegerea din adresă.
  const backToStep1 = () => {
    if ((location.state as { fromStep1?: boolean } | null)?.fromStep1) navigate(-1)
    else setParams({}, { replace: true })
  }
  const retryOverview = () => { setOverviewError(null); setReloadKey(k => k + 1) }
  const openOffers = () => {
    setOffersOpen(true)
    requestAnimationFrame(() => offersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const checkout = async (c: Choice) => {
    setBusy('checkout')
    try {
      if (c.kind === 'sub') await startCheckout(c.interval)
      else await startCreditsCheckout(c.pack)
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
    if (!choice) return
    if (detailsDirty && !(await saveDetails(true))) return
    await checkout(choice)
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

  // Suma de pe butonul de plată; abonamentul cu zile gratuite rămase nu se încasează acum.
  const payLabel = !choice || !prices || !packs ? 'Continuă spre plată'
    : choice.kind === 'pack' ? `Plătește ${packs[choice.pack].ron} RON`
      : freeCarries && (billing.reason === 'trial' || billing.reason === 'comp') ? 'Activează abonamentul'
        : `Plătește ${choice.interval === 'month' ? prices.month : prices.year} RON`

  // Butonul principal din cardul planului: portalul (abonament activ) sau deschiderea ofertelor.
  const heroAction: 'portal' | 'offers' | null = !isAdmin ? null
    : billing.hasSubscription ? 'portal'  // și anulat: din portal se reactivează
      : !choice && canBuyCredits && !offersOpen ? 'offers' : null

  return (
    <>
      {(busy === 'checkout' || busy === 'portal') && (
        <div className="redirect-overlay" role="status" aria-live="polite">
          <div>
            <span className="spin spin-dark" style={{ width: 28, height: 28, borderWidth: 3 }} />
            <b>{busy === 'checkout' ? 'Te ducem la pagina securizată de plată…' : 'Deschidem portalul de plată…'}</b>
            <span>Stripe · conexiune criptată</span>
          </div>
        </div>
      )}

      {paid && (
        <div className="plan-success" role="status">
          <span className="plan-success-check" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </span>
          <div>
            <b>{paid === 'credits' ? 'Creditele au fost adăugate. Mulțumim!' : 'Abonamentul este activ. Mulțumim!'}</b>
            <p>{paid === 'credits' ? 'Soldul de mai jos este deja actualizat.' : 'Toate funcțiile rămân disponibile, fără întrerupere.'}</p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><span className="card-title">Planul cabinetului</span>{statusChip(billing)}</div>
        <div className="card-body">
          <div className="plan-hero">
            <div>
              {processing
                ? <div className="plan-hero-sub" style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><span className="spin spin-dark" />Se confirmă plata…</div>
                : <>
                  <HeroValue billing={billing} />
                  <p className="plan-hero-sub">{statusText(billing)}</p>
                  {billing.reason !== 'credits' && billing.credits.balance > 0 && (
                    <button type="button" className="plan-hero-credits"
                      onClick={() => document.getElementById('plan-credite')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                      <b><AnimatedNumber value={billing.credits.balance} /> {billing.credits.balance === 1 ? 'credit' : 'credite'}</b>
                      <span>
                        {billing.hasSubscription && billing.cancelAtPeriodEnd
                          ? `se folosesc după ${formatDate(billing.currentPeriodEnd)}`
                          : billing.hasSubscription ? 'nu se consumă cât abonamentul e activ' : 'se folosesc după perioada gratuită'}
                        {billing.credits.firstExpiry ? ` · primele expiră pe ${formatDate(billing.credits.firstExpiry)}` : ''}
                      </span>
                    </button>
                  )}
                  {billing.reason === 'trial' && billing.daysLeft !== null && (
                    <div className={`plan-meter${billing.daysLeft <= 3 ? ' plan-meter--warn' : ''}`} aria-hidden>
                      <span style={{ width: `${Math.min(100, (billing.daysLeft / TRIAL_DAYS) * 100)}%` }} />
                    </div>
                  )}
                </>}
            </div>
            {heroAction && (
              <div className="plan-hero-actions">
                <button className="btn btn-primary" onClick={heroAction === 'portal' ? () => void portal() : openOffers} disabled={busy !== ''}>
                  <BtnLabel busy={busy === 'portal'}>
                    {heroAction === 'portal' ? 'Gestionează abonamentul' : billing.reason === 'credits' ? 'Cumpără credite' : 'Alege un plan'}
                  </BtnLabel>
                </button>
                {heroAction === 'portal' && <small>Card, facturi, lunar ↔ anual, anulare: în portalul securizat Stripe.</small>}
                {heroAction === 'portal' && !choice && canBuyCredits && !offersOpen && (
                  <button className="btn btn-ghost btn-sm" onClick={openOffers} disabled={busy !== ''}>Cumpără credite</button>
                )}
              </div>
            )}
          </div>
          {!isAdmin && (
            <p style={{ color: 'var(--s400)', fontSize: '.8125rem', marginTop: '.75rem' }}>
              Abonamentul și creditele se gestionează de administratorul cabinetului.
            </p>
          )}
        </div>
      </div>

      {isAdmin && canBuyCredits && (offersOpen || choice) && (
        <div ref={offersRef} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', scrollMarginTop: '1rem' }}>
          <Stepper step={choice ? 2 : 1} onStep1={choice && busy === '' ? backToStep1 : undefined} />

          {!choice && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {priceDeadline && offerDaysLeft !== null && (nextPrices || nextPacks) && (
                <OfferBanner until={priceDeadline} daysLeft={offerDaysLeft} />
              )}
              {!canBuySub && (
                <p className="plan-note" style={{ fontSize: '.875rem' }}>
                  Abonamentul a fost anulat și se încheie pe <strong>{formatDate(billing.currentPeriodEnd)}</strong>. Ca să nu ajungi în
                  modul citire, poți lua de acum un pachet de credite: se consumă abia după această dată, iar valabilitatea lui de un an
                  curge de la cumpărare. Ca să păstrezi abonamentul, îl reactivezi din „Gestionează abonamentul”.
                </p>
              )}
              {canBuySub && (
                <div role="tablist" aria-label="Variantă de plată" className="plan-tabs">
                  {([['sub', 'Abonament', 'documente nelimitate'], ['credits', 'Credite', 'plătești per client']] as const).map(([key, label, sub]) => (
                    <button key={key} type="button" role="tab" aria-selected={offerTab === key} className="plan-tab" onClick={() => setOfferTab(key)}>
                      <b>{label}</b><span>{sub}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Prețurile vin de la server (ofertă, prețuri viitoare): până atunci, schelete în forma cardurilor, nu prețuri presupuse. */}
              {overviewError && <LoadError message={overviewError} onRetry={retryOverview} />}
              {(!prices || !packs) && !overviewError && (
                <div className="plan-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }} role="status" aria-label="Se încarcă prețurile">
                  {[0, 1].map(i => (
                    <div key={i} className="card"><div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                      <Skeleton w="40%" h={14} /><Skeleton w="65%" h={28} /><Skeleton w="80%" h={10} /><Skeleton h={34} r={8} />
                    </div></div>
                  ))}
                </div>
              )}

              {prices && offerTab === 'sub' && canBuySub && (<>
                <div className="plan-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))' }}>
                  <PlanCard title="Lunar" price={prices.month} was={nextPrices?.month} unit="pe lună" bullets={['Documente nelimitate', 'Anulezi oricând']}
                    action="Alege lunar" onChoose={() => choose({ kind: 'sub', interval: 'month' })} />
                  <PlanCard title="Anual" price={prices.year} was={nextPrices?.year} unit="pe an" highlight
                    badge={prices.month * 12 - prices.year > 0 ? `Economisești ${prices.month * 12 - prices.year} RON` : undefined}
                    bullets={['Documente nelimitate', `2 luni gratuite (${Math.round(prices.year / 12)} RON/lună)`]}
                    action="Alege anual" onChoose={() => choose({ kind: 'sub', interval: 'year' })} />
                </div>
                {nextPrices && priceDeadline && (
                  <p className="plan-note">Te abonezi până pe {formatDate(priceDeadline)} și păstrezi prețul de ofertă cât timp rămâi abonat.</p>
                )}
              </>)}

              {packs && (offerTab === 'credits' || !canBuySub) && (<>
                <div className="plan-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))' }}>
                  {PACKS.map(p => (
                    <PlanCard key={p} title={`${packs[p].credits} credite`} price={packs[p].ron} was={nextPacks?.[p].ron}
                      unit="plată unică · valabile 12 luni" highlight={p === '30'} badge={p === '30' ? 'Recomandat' : undefined}
                      bullets={[`${Math.round(packs[p].ron / packs[p].credits)} RON / client`]}
                      action="Alege pachetul" onChoose={() => choose({ kind: 'pack', pack: p })} />
                  ))}
                </div>
                <p className="plan-note">
                  1 credit = 1 client timp de 30 de zile, cu toate documentele și corecturile lui. Valabile un an.
                  Plată unică, fără reînnoire.
                </p>
                {nextPacks && priceDeadline && (
                  <p className="plan-note">Creditele cumpărate la prețul de ofertă rămân valabile un an de la cumpărare.</p>
                )}
              </>)}

              {canBuySub && prices && packs && <CostCalculator prices={prices} packs={packs} />}

              <Faq />
            </div>
          )}

          {choice && (choice.kind === 'pack' ? canBuyCredits : canBuySub) && (
            <div className="card">
              <div className="card-head" style={{ justifyContent: 'flex-start', gap: '.75rem' }}>
                <button className="btn btn-ghost btn-sm" onClick={backToStep1} disabled={busy !== ''}>← Înapoi la variante</button>
                <span className="card-title">Date de facturare și plată</span>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem',
                  background: 'var(--surface-2)', border: '1px solid var(--s100)', borderRadius: 8, padding: '.5rem .75rem' }}>
                  <span style={{ color: 'var(--s600)', fontSize: '.875rem' }}>Ai ales:</span>
                  <strong style={{ color: 'var(--s900)', flex: 1 }}>
                    {!prices || !packs ? <Skeleton w={200} h={14} />
                      : choice.kind === 'pack'
                        ? `${packs[choice.pack].credits} credite · ${packs[choice.pack].ron} RON, plată unică, valabile un an`
                        : `Abonament ${choice.interval === 'month' ? `lunar · ${prices.month} RON/lună` : `anual · ${prices.year} RON/an`}`}
                  </strong>
                  <button className="btn btn-ghost btn-sm" onClick={backToStep1} disabled={busy !== ''}>Schimbă</button>
                </div>
                {overviewError ? <LoadError message={overviewError} onRetry={retryOverview} />
                  : !overview ? <Skeleton h={88} r={8} /> : detailsBlock}
                {choice.kind === 'sub' && freeCarries && (billing.reason === 'trial' || billing.reason === 'comp') && (
                  <p style={{ color: 'var(--g700)', fontSize: '.8125rem', margin: '1rem 0 0' }}>
                    {billing.reason === 'trial' ? 'Zilele de probă rămase se păstrează' : 'Accesul gratuit rămas se păstrează'}: prima plată se face pe {formatDate(freeUntil)}.
                  </p>
                )}
                <div style={{ marginTop: '1rem' }}>
                  <button className="btn btn-primary" onClick={saveAndCheckout} disabled={!detailsComplete(details) || busy !== ''}>
                    <BtnLabel busy={busy === 'checkout' || busy === 'details'}>{payLabel} →</BtnLabel>
                  </button>
                  <p style={{ color: 'var(--s400)', fontSize: '.75rem', marginTop: '.5rem' }}>
                    Plata se face pe pagina securizată Stripe. Ai un cod promoțional? Îl introduci acolo.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {isAdmin && !credits && billing.credits.balance > 0 && (
        <div className="card" role="status" aria-label="Se încarcă creditele"><div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
          <Skeleton w="30%" h={14} /><Skeleton h={36} r={8} /><Skeleton h={12} /><Skeleton h={12} /><Skeleton w="70%" h={12} />
        </div></div>
      )}
      {isAdmin && credits && (credits.balance > 0 || credits.ledger.length > 0) && (
        <div id="plan-credite" style={{ scrollMarginTop: '1rem' }}>
          <CreditsCard credits={credits} subscribed={billing.hasSubscription} members={activeWorkspace.members} />
        </div>
      )}

      {isAdmin && billing.hasSubscription && !choice && (
        <div className="card">
          <div className="card-head"><span className="card-title">Date de facturare</span></div>
          <div className="card-body">
            {overviewError ? <LoadError message={overviewError} onRetry={retryOverview} />
              : !overview ? <Skeleton h={88} r={8} /> : detailsBlock}
            {editing && overview && (
              <div style={{ marginTop: '1rem' }}>
                <button className="btn btn-primary" onClick={() => void saveDetails()} disabled={!detailsComplete(details) || !detailsDirty || busy !== ''}>
                  <BtnLabel busy={busy === 'details'}>Salvează</BtnLabel>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** Mesajul pentru o citire eșuată: „Failed to fetch” (rețea, limită de cereri, server oprit) nu spune nimic utilizatorului. */
function friendlyError(e: unknown): string {
  const err = e as Error & { status?: number }
  if (err.status === 429) return 'Prea multe cereri într-un timp scurt. Reîncearcă peste un minut.'
  if (!err.status || err instanceof TypeError) return 'Nu s-a putut contacta serverul. Verifică conexiunea și reîncearcă.'
  return err.message || 'Datele nu s-au putut încărca.'
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap', padding: '.75rem 1rem',
      border: '1px solid var(--r200)', background: 'var(--r50)', borderRadius: 8, fontSize: '.875rem', color: 'var(--r600)' }}>
      <span style={{ flex: 1 }}>{message}</span>
      <button className="btn btn-ghost btn-sm" onClick={onRetry}>Reîncearcă</button>
    </div>
  )
}

/** Cifra mare din cardul planului (credite, zile de probă sau tipul abonamentului). */
function HeroValue({ billing: b }: { billing: ReturnType<typeof useApp>['billing'] }) {
  if (!b.full) return <div className="plan-hero-value">Mod citire</div>
  switch (b.reason) {
    case 'credits':
      return <div className="plan-hero-value"><AnimatedNumber value={b.credits.balance} /><small>{b.credits.balance === 1 ? 'credit' : 'credite'}</small></div>
    case 'trial':
      return <div className="plan-hero-value">{b.daysLeft}<small>{b.daysLeft === 1 ? 'zi de probă' : 'zile de probă'}</small></div>
    case 'comp':
      return <div className="plan-hero-value">Acces gratuit</div>
    case 'past_due':
      return <div className="plan-hero-value">Plată eșuată</div>
    default:
      return <div className="plan-hero-value">{b.interval === 'year' ? 'Anual' : 'Lunar'}<small>abonament</small></div>
  }
}

/** Numărul crește (sau scade) animat până la valoarea nouă, ca schimbarea soldului să se vadă. */
function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    if (start === value) return
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700)
      setShown(Math.round(start + (value - start) * (1 - (1 - k) ** 3)))
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); from.current = value }
  }, [value])
  return <>{shown}</>
}

function PlanCard({ title, price, was, unit, bullets, badge, highlight, action, onChoose }: {
  title: string; price: number; unit: string; bullets: string[]; badge?: string; highlight?: boolean
  /** Prețul de după ofertă, afișat tăiat (lipsă = fără ofertă). */
  was?: number
  action: string; onChoose: () => void
}) {
  const discount = was && was > price ? Math.round((1 - price / was) * 100) : 0
  return (
    <div className={`card plan-card${highlight ? ' plan-card--hl' : ''}`}>
      {discount > 0 && <span className="plan-card-ribbon" aria-label={`Reducere ${discount}%`}>−{discount}% OFERTĂ</span>}
      <div className="card-body">
        <div className="plan-card-title">
          <span>{title}</span>
          {badge && <span className="chip chip-success">{badge}</span>}
        </div>
        <div className="plan-card-price">
          {discount > 0 && <s>{was}</s>}
          {price} RON
          <span className="plan-card-unit">{unit}</span>
        </div>
        <ul>{bullets.map(b => <li key={b}>{b}</li>)}</ul>
        <button className={`btn ${highlight ? 'btn-primary' : 'btn-ghost'}`} onClick={onChoose}>{action}</button>
      </div>
    </div>
  )
}

/** Costul minim al pachetelor care acoperă `need` credite (pachetele se pot combina și repeta). */
function packsCost(need: number, packs: BillingOverview['packs']): number {
  const opts = PACKS.map(p => packs[p])
  const max = need + Math.max(...opts.map(o => o.credits))
  const best = new Array<number>(max + 1).fill(Infinity)
  best[0] = 0
  for (let n = 1; n <= max; n++) for (const o of opts) best[n] = Math.min(best[n], best[Math.max(0, n - o.credits)] + o.ron)
  return Math.min(...best.slice(need))
}

/** „Ce variantă mă costă mai puțin?”: cursorul de clienți pe lună și costul lunar estimat al fiecărei variante. */
function CostCalculator({ prices, packs }: { prices: BillingOverview['prices']; packs: BillingOverview['packs'] }) {
  const [perMonth, setPerMonth] = useState(5)
  const rows = [
    { key: 'credits', label: 'Credite', cost: packsCost(perMonth * 12, packs) / 12 },
    { key: 'year', label: 'Abonament anual', cost: prices.year / 12 },
    { key: 'month', label: 'Abonament lunar', cost: prices.month },
  ]
  const min = Math.min(...rows.map(r => r.cost))
  const max = Math.max(...rows.map(r => r.cost))
  return (
    <div className="card plan-calc">
      <div className="card-head"><span className="card-title">Ce variantă îți convine?</span></div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <label htmlFor="calc-clienti" style={{ fontSize: '.875rem', color: 'var(--s700)' }}>
          Pentru câți clienți generezi documente într-o lună? <strong style={{ color: 'var(--s900)' }}>{perMonth}</strong>
        </label>
        <input id="calc-clienti" type="range" min={1} max={30} value={perMonth} onChange={e => setPerMonth(Number(e.target.value))} />
        <div>
          {rows.map(r => (
            <div key={r.key} className={`plan-calc-row${r.cost === min ? ' plan-calc-row--best' : ''}`}>
              <span>{r.label}</span>
              <span className="plan-calc-bar"><span style={{ width: `${Math.max(4, (r.cost / max) * 100)}%` }} /></span>
              <b>{Math.round(r.cost)} RON/lună</b>
            </div>
          ))}
        </div>
        <p className="plan-note" style={{ color: 'var(--s500)' }}>
          Estimare pe un an: un client consumă un credit pentru 30 de zile; pachetele se combină la costul cel mai mic.
        </p>
      </div>
    </div>
  )
}

/** Întrebări frecvente: aceleași condiții ca înainte, fiecare deschisă separat. */
function Faq() {
  const items: [string, string[]][] = [
    ['Ce include orice variantă?', FEATURES],
    ['Cum funcționează abonamentul?', [
      'Se reînnoiește automat; îl anulezi oricând din portalul de plată, cu efect la sfârșitul perioadei plătite.',
      'Dacă o plată eșuează, accesul se păstrează încă 7 zile, cât timp plata se reîncearcă.',
      'Zilele gratuite rămase (probă sau acces gratuit) se păstrează: prima plată vine după ce se termină.',
      'Cât ai abonament, creditele nu se consumă (dar expiră la data lor).',
    ]],
    ['Ce consumă un credit?', [
      'Exemplu: o constituire cu 6 acte, regenerate de două ori după corecturi, consumă un singur credit.',
      'Scanarea actelor (până la 30 pe zi), sugestiile AI (10 pe zi), clienții, dosarele și sarcinile nu consumă credite.',
      'Pachetele se adună; se consumă întâi creditele care expiră primele.',
      'Creditele neconsumate în un an expiră și nu se rambursează.',
      'Înainte de fiecare generare vezi dacă documentul consumă un credit sau e inclus.',
    ]],
    ['Plată și facturare', [
      'Vânzare exclusiv către firme și profesioniști (PJ, PFA, II, IF), cu CUI.',
      'Prețuri finale per cabinet, pentru toți colegii (furnizor neplătitor de TVA).',
      'Plata se face cu cardul, pe pagina securizată Stripe; codurile promoționale se introduc acolo.',
      'Pentru fiecare plată se emite factură, pe datele de facturare de la pasul 2.',
    ]],
  ]
  return (
    <div className="plan-faq">
      {items.map(([q, a]) => (
        <details key={q}>
          <summary>{q}</summary>
          <div><ul>{a.map(i => <li key={i}>{i}</li>)}</ul></div>
        </details>
      ))}
    </div>
  )
}

/** Banda ofertei de lansare: până când, câte zile mai sunt, ce înseamnă prețurile tăiate. */
function OfferBanner({ until, daysLeft }: { until: Date; daysLeft: number }) {
  return (
    <div role="note" style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap', borderRadius: 10,
      padding: '.625rem .875rem', border: '1px solid var(--r200)',
      background: 'linear-gradient(90deg, color-mix(in srgb, var(--r500) 14%, transparent), color-mix(in srgb, var(--y400) 14%, transparent))' }}>
      <span style={{ fontSize: '1.25rem' }} aria-hidden>🎉</span>
      <span style={{ flex: '1 1 16rem', fontSize: '.875rem', color: 'var(--s800)', lineHeight: 1.45 }}>
        <strong>Ofertă de lansare până pe {formatDate(until)}.</strong> Prețurile tăiate se aplică de la 1 ianuarie 2027.
      </span>
      <span style={{ fontWeight: 800, fontSize: '.8125rem', color: '#fff', background: 'var(--r500)', borderRadius: 'var(--r-full)',
        padding: '.2rem .65rem', whiteSpace: 'nowrap' }}>
        {daysLeft <= 1 ? 'Ultima zi' : `Încă ${daysLeft} zile`}
      </span>
    </div>
  )
}

/** Pașii fluxului de plată; pasul 1 e clicabil de pe pasul 2 (înapoi la variante). */
function Stepper({ step, onStep1 }: { step: 1 | 2; onStep1?: () => void }) {
  const item = (n: 1 | 2, label: string, onClick?: () => void) => {
    const active = step === n
    const content = (
      <>
        <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '.75rem', fontWeight: 700, background: active ? 'var(--p500)' : 'var(--s200)', color: active ? '#fff' : 'var(--s600)' }}>{n}</span>
        <span style={{ fontWeight: active ? 700 : 500, color: active ? 'var(--s900)' : 'var(--s500)' }}>{label}</span>
      </>
    )
    return onClick
      ? <button type="button" onClick={onClick} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}
          title="Înapoi la alegerea variantei">{content}</button>
      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }} aria-current={active ? 'step' : undefined}>{content}</span>
  }
  return (
    <nav aria-label="Pașii plății" style={{ display: 'flex', alignItems: 'center', gap: '.75rem', fontSize: '.875rem', flexWrap: 'wrap' }}>
      {item(1, 'Alege varianta', onStep1)}
      <span style={{ color: 'var(--s300)' }}>›</span>
      {item(2, 'Facturare și plată')}
    </nav>
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
      <p style={{ color: 'var(--s600)', fontSize: '.8125rem', margin: '0 0 .875rem' }}>
        Facturăm doar firme și profesioniști: persoană juridică, PFA, II sau IF, cu CUI.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: '.875rem', alignItems: 'end' }}>
        <div className="field">
          <label className="field-label" htmlFor="bd-cui">CUI</label>
          {/* Același tipar ca la fișa societății (CompanyInfoForm): câmpul ocupă rândul, butonul ANAF e compact. */}
          <div className="field-with-btn">
            <input id="bd-cui" className="field-input" value={details.cui} onChange={set('cui')} placeholder="ex: RO12345678"
              onKeyDown={e => { if (e.key === 'Enter') onAnaf() }} />
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={onAnaf} disabled={!details.cui.trim() || disabled}
              title="Completează denumirea și adresa din ANAF" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              <BtnLabel busy={anafBusy} dark>🔍 ANAF</BtnLabel>
            </button>
          </div>
        </div>
        <Field id="bd-denumire" label="Denumire" value={details.denumire} onChange={set('denumire')} />
        <Field id="bd-regcom" label="Nr. Reg. Com. (opțional)" value={details.regCom} onChange={set('regCom')} />
        <Field id="bd-adresa" label="Adresă" value={details.adresa} onChange={set('adresa')} />
        <Field id="bd-localitate" label="Localitate" value={details.localitate} onChange={set('localitate')} />
        <Field id="bd-judet" label="Județ" value={details.judet} onChange={set('judet')} />
        <Field id="bd-email" label="E-mail pentru facturi" type="email" value={details.email} onChange={set('email')} />
      </div>
      <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', marginTop: '1rem', fontSize: '.875rem', color: 'var(--s700)', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!details.professional} style={{ marginTop: '.2rem' }}
          onChange={e => setDetails(d => ({ ...d, professional: e.target.checked }))} />
        <span>Confirm că achiziționez în numele unei firme, PFA, II sau IF, în scopul activității profesionale.</span>
      </label>
    </>
  )
}

function DetailsSummary({ d, onEdit, disabled }: { d: BillingDetails; onEdit: () => void; disabled: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start',
      background: 'var(--s50)', border: '1px solid var(--s100)', borderRadius: 8, padding: '.75rem 1rem', fontSize: '.875rem' }}>
      <div style={{ color: 'var(--s700)', lineHeight: 1.55 }}>
        <div style={{ fontWeight: 600, color: 'var(--s900)' }}>{d.denumire}</div>
        <div>CUI {d.cui}{d.regCom ? ` · ${d.regCom}` : ''}</div>
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
  if (b.reason === 'credits') return <span className="chip chip-primary">Credite</span>
  return <span className="badge badge-activ">Activ</span>
}

function statusText(b: ReturnType<typeof useApp>['billing']): string {
  const until = formatDate(b.accessUntil)
  if (!b.full) {
    return 'Cabinetul este în modul citire: puteți consulta și exporta toate datele, dar nu puteți adăuga sau modifica, ' +
      'scana acte ori genera documente. Alegeți un abonament sau un pachet de credite pentru a continua.'
  }
  switch (b.reason) {
    case 'past_due':
      return `Ultima plată a eșuat. Stripe reîncearcă automat; actualizați cardul până pe ${until} ca să păstrați accesul complet.`
    case 'trial':
      return `Perioadă de probă până pe ${until}. Toate funcțiile sunt disponibile.`
    case 'comp':
      return `Cabinetul are acces gratuit până pe ${until}.`
    case 'credits':
      return b.credits.balance > 0
        ? `${b.credits.firstExpiry ? `Primele expiră pe ${formatDate(b.credits.firstExpiry)}. ` : ''}`
          + 'Primul document pentru un client consumă un credit; documentele pentru el în următoarele 30 de zile sunt incluse.'
        : `Nu mai aveți credite. Clienții pentru care ați consumat deja un credit rămân disponibili până pe ${formatDate(b.credits.coveredUntil)}.`
    default:
      return b.cancelAtPeriodEnd
        ? `Abonamentul a fost anulat și rămâne activ până pe ${formatDate(b.currentPeriodEnd)}.`
        : `Documente nelimitate. Următoarea plată: ${formatDate(b.currentPeriodEnd)}.`
  }
}

const LEDGER_LABEL: Record<string, string> = {
  purchase: 'Pachet cumpărat', grant: 'Credite gratuite', consume: 'Consum', adjust: 'Ajustare',
}

/** Detaliul unui rând din istoric (client și document la consum, motiv și valabilitate la intrări). */
function ledgerDetail(e: CreditsOverview['ledger'][number], members: Record<string, { email?: string }>): string {
  if (e.kind === 'consume') return [e.clientName ?? 'client șters', e.document, e.uid ? members[e.uid]?.email : null].filter(Boolean).join(' · ')
  if (e.kind === 'purchase' || e.kind === 'grant') {
    return [e.reason, e.expiresAt ? `valabile până pe ${formatDate(toDate(e.expiresAt))}` : null].filter(Boolean).join(' · ')
  }
  return e.reason ?? ''
}

/** Istoricul creditelor ca CSV (Excel îl deschide direct; BOM-ul păstrează diacriticele). */
function downloadLedgerCsv(ledger: CreditsOverview['ledger'], members: Record<string, { email?: string }>) {
  // Textele care încep cu = + - @ (ex. un nume de client) ar rula ca formule în Excel: le prefixăm cu apostrof.
  // Numerele (coloana Credite) rămân numere.
  const q = (v: string | number) => {
    const t = typeof v === 'number' ? String(v) : /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
    return `"${t.replace(/"/g, '""')}"`
  }
  const lines = [['Data', 'Mișcare', 'Detalii', 'Credite'].map(q).join(';')]
  for (const e of ledger) {
    lines.push([formatDate(toDate(e.at)), LEDGER_LABEL[e.kind] ?? e.kind, ledgerDetail(e, members), e.amount].map(q).join(';'))
  }
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `cabinio-istoric-credite-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function CreditsCard({ credits, subscribed, members }: {
  credits: CreditsOverview
  subscribed: boolean
  members: Record<string, { email?: string }>
}) {
  const [all, setAll] = useState(false)
  const [filter, setFilter] = useState<'all' | 'consume' | 'in'>('all')
  const [now] = useState(() => Date.now())
  const filtered = credits.ledger.filter(e => filter === 'all' || (filter === 'consume' ? e.kind === 'consume' : e.kind !== 'consume'))
  const rows = all ? filtered : filtered.slice(0, 10)
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Credite</span>
        <span className="chip chip-primary">{credits.balance === 1 ? '1 credit' : `${credits.balance} credite`}</span>
      </div>
      <div className="card-body" style={{ fontSize: '.875rem' }}>
        {subscribed && credits.balance > 0 && (
          <p style={{ color: 'var(--s600)', marginBottom: '.75rem' }}>
            Cât timp abonamentul e activ, creditele nu se consumă. Ele expiră totuși la data lor.
          </p>
        )}
        {credits.lots.length > 0 && (
          <div className="plan-lots">
            {credits.lots.map(l => {
              const exp = toDate(l.expiresAt)
              const days = exp ? Math.ceil((exp.getTime() - now) / 86_400_000) : null
              // Pachetele care expiră în cel mult 30 de zile ies în evidență: creditele lor se pierd dacă nu se folosesc.
              const soon = days !== null && days <= 30
              return (
                <div key={l.id} className={`plan-lot${soon ? ' plan-lot--soon' : ''}`}>
                  <b>{l.remaining === 1 ? '1 credit' : `${l.remaining} credite`}</b>
                  <span>{soon ? `expiră în ${days} ${days === 1 ? 'zi' : 'zile'} · ${formatDate(exp)}` : `valabile până pe ${formatDate(exp)}`}</span>
                </div>
              )
            })}
          </div>
        )}
        {credits.ledger.length > 0 && (
          <>
            <div className="plan-ledger-tools">
              <div className="seg" role="group" aria-label="Filtrează istoricul">
                {([['all', 'Toate'], ['consume', 'Consum'], ['in', 'Intrări']] as const).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
                ))}
              </div>
              <button className="btn btn-ghost btn-xs" style={{ marginLeft: 'auto' }} onClick={() => downloadLedgerCsv(filtered, members)}>
                Descarcă CSV
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="plan-ledger">
                <thead>
                  <tr><th>Data</th><th>Mișcare</th><th>Detalii</th><th>Credite</th></tr>
                </thead>
                <tbody>
                  {rows.map(e => (
                    <tr key={e.id}>
                      <td>{formatDate(toDate(e.at))}</td>
                      <td>{LEDGER_LABEL[e.kind] ?? e.kind}</td>
                      <td style={{ color: 'var(--s600)' }}>{ledgerDetail(e, members)}</td>
                      <td className={e.amount > 0 ? 'plus' : undefined}>{e.amount > 0 ? `+${e.amount}` : e.amount}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={4} style={{ color: 'var(--s400)', textAlign: 'center', padding: '1rem' }}>Nicio mișcare de acest tip.</td></tr>
                  )}
                </tbody>
              </table>
              {filtered.length > 10 && (
                <button className="btn btn-ghost btn-sm" style={{ marginTop: '.5rem' }} onClick={() => setAll(a => !a)}>
                  {all ? 'Arată mai puțin' : `Arată tot istoricul (${filtered.length})`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
