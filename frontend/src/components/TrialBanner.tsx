import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import { formatDate, openPortal } from '../lib/billing'
import BtnLabel from './BtnLabel'

type Tone = 'info' | 'warn' | 'danger'

const TONES: Record<Tone, React.CSSProperties> = {
  info: { background: 'var(--p50)', borderBottom: '1px solid var(--p200)', color: 'var(--p700)' },
  warn: { background: 'var(--y50)', borderBottom: '1px solid var(--y200)', color: 'var(--a800, #92400e)' },
  danger: { background: 'var(--r50)', borderBottom: '1px solid var(--r200)', color: 'var(--r600)' },
}

/** Banda de sub antet cu starea abonamentului: zilele de probă rămase, plată eșuată, credite puține, modul citire.
 *  Acțiunile (abonare, portal) apar doar pentru administrator; ceilalți membri primesc doar informația. */
export default function TrialBanner() {
  const { activeWorkspace, billing, userRole, toast } = useApp()
  const [opening, setOpening] = useState(false)
  if (!activeWorkspace) return null
  const isAdmin = userRole === 'admin'

  const portal = async () => {
    setOpening(true)
    try {
      await openPortal()
    } catch (e) {
      toast((e as Error).message, 'err')
      setOpening(false)
    }
  }
  const subscribeLink = isAdmin
    ? <Link to="/setari/plan" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>Alege un plan</Link>
    : null
  const buyLink = isAdmin
    ? <Link to="/setari/plan" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>Cumpără credite</Link>
    : null
  const portalButton = isAdmin
    ? <button className="btn btn-primary btn-sm" onClick={portal} disabled={opening}><BtnLabel busy={opening}>Actualizează plata</BtnLabel></button>
    : null
  const until = formatDate(billing.accessUntil)
  const days = billing.daysLeft ?? 0
  const credits = billing.credits
  const firstExpiryDays = credits.firstExpiryDays

  let tone: Tone
  let text: string
  let action: React.ReactNode
  if (!billing.full) {
    tone = 'danger'
    text = 'Cabinetul este în modul citire: datele rămân vizibile și se pot exporta, dar nu se mai pot adăuga sau modifica.'
      + (isAdmin ? '' : ' Administratorul poate alege un abonament sau un pachet de credite.')
    action = subscribeLink
  } else if (billing.reason === 'past_due') {
    tone = 'danger'
    text = `Plata abonamentului a eșuat. Actualizează metoda de plată până pe ${until}, altfel cabinetul trece în modul citire.`
    action = portalButton
  } else if (billing.reason === 'trial') {
    tone = days <= 5 ? 'warn' : 'info'
    text = days <= 1
      ? 'Perioada de probă se încheie azi.'
      : `Perioadă de probă: mai ai ${days} zile (până pe ${until}).`
    action = subscribeLink
  } else if (billing.reason === 'comp' && days <= 14) {
    tone = 'warn'
    text = `Accesul gratuit al cabinetului se încheie pe ${until}.`
    action = subscribeLink
  } else if (billing.reason === 'credits' && credits.balance === 0) {
    tone = 'warn'
    text = `Nu mai ai credite. Clienții pentru care ai consumat deja un credit rămân disponibili până pe ${formatDate(credits.coveredUntil)}; `
      + 'pentru un client nou e nevoie de un pachet nou.'
    action = buyLink
  } else if (billing.reason === 'credits' && credits.balance <= 3) {
    tone = 'warn'
    text = credits.balance === 1 ? 'Mai ai un singur credit.' : `Mai ai ${credits.balance} credite.`
    action = buyLink
  } else if (billing.reason === 'credits' && firstExpiryDays !== null && firstExpiryDays <= 30) {
    tone = 'info'
    text = `O parte din credite expiră pe ${formatDate(credits.firstExpiry)}. Creditele se consumă începând cu cele care expiră primele.`
    action = null
  } else if (billing.reason === 'subscription' && billing.cancelAtPeriodEnd) {
    tone = 'warn'
    text = `Abonamentul a fost anulat și se încheie pe ${formatDate(billing.currentPeriodEnd)}.`
    action = isAdmin ? <button className="btn btn-ghost btn-sm" onClick={portal} disabled={opening}>Reactivează</button> : null
  } else {
    return null
  }

  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className="trial-banner"
      style={{ ...TONES[tone], fontSize: '.8125rem', padding: '.5rem 1rem', display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
      <span style={{ flex: '1 1 16rem' }}>{text}</span>
      {action}
    </div>
  )
}
