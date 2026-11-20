import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import { fetchAnafCompany } from '../lib/api'
import {
  formatDate, getBilling, getCredits, openPortal, saveBillingDetails, startCheckout, startCreditsCheckout, syncBilling,
  toDate, type BillingDetails, type BillingOverview, type CreditPack, type CreditsOverview,
} from '../lib/billing'
import NotificariBell from '../components/NotificariBell'

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
const DEFAULT_PACKS: BillingOverview['packs'] = {
  '10': { credits: 10, ron: 300 }, '30': { credits: 30, ron: 750 }, '50': { credits: 50, ron: 1000 },
}

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

export default function AbonamentPage() {
  const { activeWorkspace, billing, userRole, toast } = useApp()
  const isAdmin = userRole === 'admin'
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [overview, setOverview] = useState<BillingOverview | null>(null)
  const [details, setDetails] = useState<BillingDetails>(EMPTY_DETAILS)
  const [savedDetails, setSavedDetails] = useState<BillingDetails | null>(null)
  // Planul sau pachetul ales pe carduri (din adresă); null = încă la pasul 1.
  const choice = parseChoice(params.get('alege'))
  // Fila deschisă la pasul 1: a alegerii curente, altfel Credite pentru un cabinet deja pe credite.
  const [offerTab, setOfferTab] = useState<'sub' | 'credits'>(() =>
    choice ? (choice.kind === 'pack' ? 'credits' : 'sub') : billing.reason === 'credits' ? 'credits' : 'sub')
  const [credits, setCredits] = useState<CreditsOverview | null>(null)
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
          // Doar profesioniști: datele vechi de persoană fizică se completează din nou ca firmă / PFA / II / IF.
          setDetails({ ...EMPTY_DETAILS, ...o.details, tip: 'PJ' })
          setSavedDetails(o.details)
          setEditing(!detailsComplete({ ...EMPTY_DETAILS, ...o.details }))
        }
      })
      .catch(e => { if (!cancelled) toast((e as Error).message, 'err') })
    return () => { cancelled = true }
  }, [isAdmin, workspaceId, toast])

  // Istoricul creditelor: reîncărcat când se schimbă soldul (cumpărare, consum, acordare).
  const lotsKey = JSON.stringify(activeWorkspace?.billing?.credits?.lots ?? [])
  useEffect(() => {
    if (!isAdmin || !workspaceId) return
    let cancelled = false
    getCredits().then(c => { if (!cancelled) setCredits(c) }).catch(() => { /* panoul rămâne ascuns */ })
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
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const { billing: b } = await syncBilling(sessionId)
          if (sessionId && b.credits?.lots?.some(l => l.id === sessionId)) { toast('Creditele au fost adăugate. Mulțumim!', 'ok'); break }
          if (b.hasSubscription) { toast('Abonamentul este activ. Mulțumim!', 'ok'); break }
        } catch { /* reîncercăm */ }
        await new Promise(r => setTimeout(r, 2500))
      }
      setProcessing(false)
    })()
  }, [params, setParams, toast])

  if (!activeWorkspace) return null
  const raw = activeWorkspace.billing
  // Oglinda billing.trial_end_for_checkout: zilele gratuite rămase (probă sau acces gratuit) se păstrează.
  const freeUntil = [toDate(raw?.trialEndsAt), toDate(raw?.compUntil)]
    .reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null)
  const freeCarries = !!freeUntil && freeUntil.getTime() - openedAt >= 48 * 3600_000
  const prices = overview?.prices ?? { month: 200, year: 2000 }
  const packs = overview?.packs ?? DEFAULT_PACKS
  const nextPrices = overview?.nextPrices ?? null
  const nextPacks = overview?.nextPacks ?? null
  // Ultima zi la prețul curent: ziua dinaintea intrării în vigoare a prețurilor noi (ora României).
  const nextFrom = toDate(overview?.nextPricesFrom ?? null)
  const priceDeadline = nextFrom ? new Date(nextFrom.getTime() - 1) : null
  // Oferta de lansare: prețurile de acum până la priceDeadline; cele de după apar tăiate pe carduri.
  const offerDaysLeft = nextFrom ? Math.max(0, Math.ceil((nextFrom.getTime() - openedAt) / 86_400_000)) : null
  const yearSaving = prices.month * 12 - prices.year
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

  return (
    <div className="page--data">
      <div className="page-top">
        <div className="page-header">
          <div>
            <div className="page-title">Abonament</div>
            <div className="page-subtitle">Perioada de probă, plata și datele de facturare ale cabinetului</div>
          </div>
          <div className="page-actions"><NotificariBell /></div>
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

          {isAdmin && canBuyCredits && (
            <Stepper step={choice ? 2 : 1} onStep1={choice && busy === '' ? backToStep1 : undefined} />
          )}

          {isAdmin && canBuyCredits && !choice && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {priceDeadline && offerDaysLeft !== null && (nextPrices || nextPacks) && (
                <OfferBanner until={priceDeadline} daysLeft={offerDaysLeft} />
              )}
              {!canBuySub && (
                <p style={{ ...KEY_LINE, fontSize: '.875rem' }}>
                  Abonamentul a fost anulat și se încheie pe <strong>{formatDate(billing.currentPeriodEnd)}</strong>. Ca să nu ajungi în
                  modul citire, poți lua de acum un pachet de credite: se consumă abia după această dată, iar valabilitatea lui de un an
                  curge de la cumpărare. Ca să păstrezi abonamentul, îl reactivezi din „Gestionează abonamentul”.
                </p>
              )}
              {canBuySub && <div role="tablist" aria-label="Variantă de plată" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.25rem',
                background: 'var(--surface-2)', border: '1px solid var(--s200)', borderRadius: 10, padding: '.25rem' }}>
                {([['sub', 'Abonament', 'documente nelimitate'], ['credits', 'Credite', 'plătești per client']] as const).map(([key, label, sub]) => (
                  <button key={key} type="button" role="tab" aria-selected={offerTab === key} onClick={() => setOfferTab(key)}
                    style={{ border: 'none', borderRadius: 8, padding: '.5rem .75rem', cursor: 'pointer', font: 'inherit', textAlign: 'center',
                      background: offerTab === key ? 'var(--surface)' : 'transparent',
                      boxShadow: offerTab === key ? '0 1px 3px rgba(0,0,0,.15)' : 'none' }}>
                    <div style={{ fontWeight: 700, color: offerTab === key ? 'var(--p600)' : 'var(--s700)' }}>{label}</div>
                    <div style={{ fontSize: '.75rem', color: 'var(--s500)' }}>{sub}</div>
                  </button>
                ))}
              </div>}

              {offerTab === 'sub' && canBuySub && (<>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '1rem' }}>
                  <PlanCard title="Lunar" price={prices.month} was={nextPrices?.month} unit="lună" bullets={['Documente nelimitate', 'Anulezi oricând']}
                    action="Alege lunar" onChoose={() => choose({ kind: 'sub', interval: 'month' })} />
                  <PlanCard title="Anual" price={prices.year} was={nextPrices?.year} unit="an" highlight
                    badge={yearSaving > 0 ? `Economisești ${yearSaving} RON` : undefined}
                    bullets={['Documente nelimitate', `2 luni gratuite (${Math.round(prices.year / 12)} RON/lună)`]}
                    action="Alege anual" onChoose={() => choose({ kind: 'sub', interval: 'year' })} />
                </div>
                {nextPrices && priceDeadline && (
                  <p style={KEY_LINE}>
                    Te abonezi până pe {formatDate(priceDeadline)} și păstrezi prețul de ofertă cât timp rămâi abonat.
                  </p>
                )}
              </>)}

              {(offerTab === 'credits' || !canBuySub) && (<>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1rem' }}>
                  {PACKS.map(p => (
                    <PlanCard key={p} title={`${packs[p].credits} credite`} price={packs[p].ron} was={nextPacks?.[p].ron} unit="an"
                      highlight={p === '30'} bullets={[`${Math.round(packs[p].ron / packs[p].credits)} RON / client`]}
                      action="Alege pachetul" onChoose={() => choose({ kind: 'pack', pack: p })} />
                  ))}
                </div>
                <p style={KEY_LINE}>
                  1 credit = 1 client timp de 30 de zile, cu toate documentele și corecturile lui. Valabile un an.
                  Plată unică, fără reînnoire.
                </p>
                {nextPacks && priceDeadline && (
                  <p style={KEY_LINE}>
                    Creditele cumpărate la prețul de ofertă rămân valabile un an de la cumpărare.
                  </p>
                )}
              </>)}

              {canBuySub && (
              <p style={{ color: 'var(--s600)', fontSize: '.8125rem', margin: 0 }}>
                <strong style={{ color: 'var(--s800)' }}>Cum aleg?</strong> Până la aproximativ 6–10 clienți pe lună, creditele ies mai
                ieftin; peste, abonamentul. Poți trece oricând de la o variantă la alta.
              </p>
              )}

              <details style={{ fontSize: '.8125rem', color: 'var(--s600)' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--s800)' }}>Detalii și condiții</summary>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '.75rem 1.5rem', marginTop: '.625rem' }}>
                  <DetailList title="Orice variantă include" items={FEATURES} />
                  <DetailList title="Abonament" items={[
                    'Se reînnoiește automat; îl anulezi oricând din portalul de plată, cu efect la sfârșitul perioadei plătite.',
                    'Dacă o plată eșuează, accesul se păstrează încă 7 zile, cât timp plata se reîncearcă.',
                    'Zilele gratuite rămase (probă sau acces gratuit) se păstrează: prima plată vine după ce se termină.',
                    'Cât ai abonament, creditele nu se consumă (dar expiră la data lor).',
                  ]} />
                  <DetailList title="Credite" items={[
                    'Exemplu: o constituire cu 6 acte, regenerate de două ori după corecturi, consumă un singur credit.',
                    'Scanarea actelor (până la 30 pe zi), sugestiile AI (10 pe zi), clienții, dosarele și sarcinile nu consumă credite.',
                    'Pachetele se adună; se consumă întâi creditele care expiră primele.',
                    'Creditele neconsumate în un an expiră și nu se rambursează.',
                    'Înainte de fiecare generare vezi dacă documentul consumă un credit sau e inclus.',
                  ]} />
                  <DetailList title="Plată și facturare" items={[
                    'Vânzare exclusiv către firme și profesioniști (PJ, PFA, II, IF), cu CUI.',
                    'Prețuri finale per cabinet, pentru toți colegii (furnizor neplătitor de TVA).',
                    'Plata se face cu cardul, pe pagina securizată Stripe; codurile promoționale se introduc acolo.',
                    'Pentru fiecare plată se emite factură, pe datele de facturare de la pasul 2.',
                  ]} />
                </div>
              </details>
            </div>
          )}

          {isAdmin && choice && (choice.kind === 'pack' ? canBuyCredits : canBuySub) && (
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
                    {choice.kind === 'pack'
                      ? `${packs[choice.pack].credits} credite · ${packs[choice.pack].ron} RON, valabile un an`
                      : `Abonament ${choice.interval === 'month' ? `lunar · ${prices.month} RON/lună` : `anual · ${prices.year} RON/an`}`}
                  </strong>
                  <button className="btn btn-ghost btn-sm" onClick={backToStep1} disabled={busy !== ''}>Schimbă</button>
                </div>
                {detailsBlock}
                {choice.kind === 'sub' && freeCarries && (billing.reason === 'trial' || billing.reason === 'comp') && (
                  <p style={{ color: 'var(--g700)', fontSize: '.8125rem', margin: '1rem 0 0' }}>
                    {billing.reason === 'trial' ? 'Zilele de probă rămase se păstrează' : 'Accesul gratuit rămas se păstrează'}: prima plată se face pe {formatDate(freeUntil)}.
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

          {isAdmin && credits && (credits.balance > 0 || credits.ledger.length > 0) && (
            <CreditsCard credits={credits} subscribed={billing.hasSubscription} members={activeWorkspace.members} />
          )}

          {isAdmin && billing.hasSubscription && !choice && (
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

function PlanCard({ title, price, was, unit, bullets, badge, highlight, action, onChoose }: {
  title: string; price: number; unit: string; bullets: string[]; badge?: string; highlight?: boolean
  /** Prețul de după ofertă, afișat tăiat (lipsă = fără ofertă). */
  was?: number
  action: string; onChoose: () => void
}) {
  const discount = was && was > price ? Math.round((1 - price / was) * 100) : 0
  return (
    <div className="card" style={{ position: 'relative', overflow: 'visible',
      ...(highlight ? { borderColor: 'var(--p500)', boxShadow: '0 0 0 1px var(--p500)' } : {}) }}>
      {discount > 0 && (
        <span aria-label={`Reducere ${discount}%`} style={{ position: 'absolute', top: -10, left: 14, background: 'var(--r500)', color: '#fff',
          fontSize: '.6875rem', fontWeight: 800, letterSpacing: '.03em', padding: '.15rem .55rem', borderRadius: 'var(--r-full)',
          boxShadow: '0 2px 6px rgba(239,68,68,.35)', transform: 'rotate(-3deg)' }}>−{discount}% OFERTĂ</span>
      )}
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--s900)' }}>{title}</span>
          {badge && <span className="chip chip-success">{badge}</span>}
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--s900)', letterSpacing: '-.02em' }}>
          {discount > 0 && (
            <s style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--s400)', marginRight: '.4rem',
              textDecorationColor: 'var(--r500)', textDecorationThickness: 2 }}>{was}</s>
          )}
          {price} RON<span style={{ fontSize: '.9rem', fontWeight: 500, color: 'var(--s500)' }}> / {unit}</span>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1, color: 'var(--s600)', fontSize: '.8125rem', lineHeight: 1.7 }}>
          {bullets.map(b => <li key={b}><span style={{ color: 'var(--g600)', marginRight: '.375rem' }}>✓</span>{b}</li>)}
        </ul>
        <button className={`btn ${highlight ? 'btn-primary' : 'btn-ghost'}`} onClick={onChoose}>{action}</button>
      </div>
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

const KEY_LINE: React.CSSProperties = { color: 'var(--s700)', fontSize: '.8125rem', margin: 0 }

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div style={{ fontWeight: 600, color: 'var(--s800)', marginBottom: '.25rem' }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.6 }}>
        {items.map(i => <li key={i}>{i}</li>)}
      </ul>
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
                <p style={{ color: 'var(--s600)', fontSize: '.8125rem', margin: '0 0 .875rem' }}>
                  Facturăm doar firme și profesioniști: persoană juridică, PFA, II sau IF, cu CUI.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '.875rem' }}>
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
                  <Field id="bd-denumire" label="Denumire (firmă, PFA, II sau IF)" value={details.denumire} onChange={set('denumire')} />
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
      return `Perioadă de probă: ${b.daysLeft} zile rămase (până pe ${until}). Toate funcțiile sunt disponibile.`
    case 'comp':
      return `Cabinetul are acces gratuit până pe ${until}.`
    case 'credits':
      return b.credits.balance > 0
        ? `Cabinetul folosește credite: ${b.credits.balance === 1 ? 'un credit disponibil' : `${b.credits.balance} credite disponibile`}`
          + `${b.credits.firstExpiry ? `, primele expiră pe ${formatDate(b.credits.firstExpiry)}` : ''}. `
          + 'Primul document pentru un client consumă un credit; documentele pentru el în următoarele 30 de zile sunt incluse.'
        : `Nu mai aveți credite. Clienții pentru care ați consumat deja un credit rămân disponibili până pe ${formatDate(b.credits.coveredUntil)}.`
    default:
      return b.cancelAtPeriodEnd
        ? `Abonamentul a fost anulat și rămâne activ până pe ${formatDate(b.currentPeriodEnd)}.`
        : `Abonament ${b.interval === 'year' ? 'anual' : 'lunar'} activ. Următoarea plată: ${formatDate(b.currentPeriodEnd)}.`
  }
}

const LEDGER_LABEL: Record<string, string> = {
  purchase: 'Pachet cumpărat', grant: 'Credite gratuite', consume: 'Consum', adjust: 'Ajustare',
}

function CreditsCard({ credits, subscribed, members }: {
  credits: CreditsOverview
  subscribed: boolean
  members: Record<string, { email?: string }>
}) {
  const [all, setAll] = useState(false)
  const rows = all ? credits.ledger : credits.ledger.slice(0, 10)
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
          <ul style={{ margin: '0 0 1rem', paddingLeft: '1.1rem', color: 'var(--s700)', lineHeight: 1.7 }}>
            {credits.lots.map(l => (
              <li key={l.id}>{l.remaining === 1 ? '1 credit' : `${l.remaining} credite`} valabile până pe {formatDate(toDate(l.expiresAt))}</li>
            ))}
          </ul>
        )}
        {credits.ledger.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
              <thead>
                <tr style={{ color: 'var(--s500)', textAlign: 'left' }}>
                  <th style={{ padding: '.375rem .5rem .375rem 0' }}>Data</th>
                  <th style={{ padding: '.375rem .5rem' }}>Mișcare</th>
                  <th style={{ padding: '.375rem .5rem' }}>Detalii</th>
                  <th style={{ padding: '.375rem 0 .375rem .5rem', textAlign: 'right' }}>Credite</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(e => (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--s100)', color: 'var(--s700)' }}>
                    <td style={{ padding: '.375rem .5rem .375rem 0', whiteSpace: 'nowrap' }}>{formatDate(toDate(e.at))}</td>
                    <td style={{ padding: '.375rem .5rem' }}>{LEDGER_LABEL[e.kind] ?? e.kind}</td>
                    <td style={{ padding: '.375rem .5rem', color: 'var(--s600)' }}>
                      {e.kind === 'consume'
                        ? [e.clientName ?? 'client șters', e.document, e.uid ? members[e.uid]?.email : null].filter(Boolean).join(' · ')
                        : e.kind === 'purchase' || e.kind === 'grant'
                          ? [e.reason, e.expiresAt ? `valabile până pe ${formatDate(toDate(e.expiresAt))}` : null].filter(Boolean).join(' · ')
                          : e.reason}
                    </td>
                    <td style={{ padding: '.375rem 0 .375rem .5rem', textAlign: 'right', fontWeight: 600,
                      color: e.amount > 0 ? 'var(--g700)' : 'var(--s700)' }}>{e.amount > 0 ? `+${e.amount}` : e.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {credits.ledger.length > 10 && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: '.5rem' }} onClick={() => setAll(a => !a)}>
                {all ? 'Arată mai puțin' : `Arată tot istoricul (${credits.ledger.length})`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
