import { useState } from 'react'
import { billingAccess, formatDate, toDate } from '../lib/billing'
import { adminExtendTrial, adminSetComp, adminSyncBilling } from '../lib/superAdmin'
import type { WorkspaceBilling } from '../types'

const REASON_LABEL: Record<string, string> = {
  trial: 'Perioadă de probă', subscription: 'Abonament', past_due: 'Plată eșuată', comp: 'Acces gratuit', expired: 'Mod citire',
}

/** Starea abonamentului unui cabinet + acțiunile super adminului (prelungire probă, acces gratuit, resincronizare). */
export default function SuperAdminBilling({ workspaceId, billing, onChange }: {
  workspaceId: string
  billing: WorkspaceBilling | undefined
  onChange: (b: WorkspaceBilling) => void
}) {
  const [days, setDays] = useState('7')
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const access = billingAccess(billing)
  const compUntil = toDate(billing?.compUntil)
  const trialEnd = toDate(billing?.trialEndsAt)
  // Pe un abonament plătit, proba nu mai contează (accesul vine din plată); în Stripe se mută doar un trial activ.
  const paying = !!billing?.hasSubscription && billing.subscriptionStatus !== 'trialing'

  const run = async (action: () => Promise<{ billing: WorkspaceBilling }>, message: (b: WorkspaceBilling) => string) => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const b = (await action()).billing
      onChange(b)
      setDone(message(b))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const nDays = Number(days)

  return (
    <div style={{ borderTop: '1px solid var(--s100)', paddingTop: '.625rem', marginBottom: '.75rem', fontSize: '.8125rem' }}>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <span className={`chip ${access.full ? 'chip-success' : 'chip-muted'}`}>{billing ? REASON_LABEL[access.reason] : 'Nemigrat'}</span>
        <span style={{ color: 'var(--s600)' }}>
          {access.full ? `acces complet până pe ${formatDate(access.accessUntil)} (${access.daysLeft} zile)` : 'fără acces complet'}
          {access.hasSubscription && ` · abonament ${access.interval === 'year' ? 'anual' : 'lunar'}`}
          {compUntil && ` · gratuit până pe ${formatDate(compUntil)}${billing?.compReason ? ` (${billing.compReason})` : ''}`}
          {trialEnd && ` · probă până pe ${formatDate(trialEnd)}`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="field-input" type="number" min={1} max={365} value={days} onChange={e => setDays(e.target.value)}
          style={{ width: '5rem' }} aria-label="Zile de prelungire" disabled={paying} />
        <button className="btn btn-sm" disabled={busy || paying || !(nDays >= 1 && nDays <= 365)}
          title={paying ? 'Cabinetul plătește abonamentul: prelungirea probei nu are efect.' : 'Adaugă zile la perioada de probă'}
          onClick={() => void run(() => adminExtendTrial(workspaceId, nDays),
            b => `Proba se încheie acum pe ${formatDate(toDate(b.trialEndsAt))}.`)}>Prelungește proba</button>
        <input className="field-input" type="date" value={until} onChange={e => setUntil(e.target.value)}
          style={{ width: '10rem' }} aria-label="Acces gratuit până la" />
        <button className="btn btn-sm" disabled={busy || !until} title={until ? undefined : 'Alege întâi o dată'}
          onClick={() => void run(() => adminSetComp(workspaceId, until, 'manual'),
            b => `Acces gratuit până pe ${formatDate(toDate(b.compUntil))}.`
              + (b.hasSubscription && !b.cancelAtPeriodEnd ? ' Următoarea plată Stripe se face după această dată.' : ''))}>Gratuit până la</button>
        {compUntil && (
          <button className="btn btn-sm" disabled={busy}
            onClick={() => void run(() => adminSetComp(workspaceId, null), () => 'Accesul gratuit a fost retras.')}>Retrage gratuitatea</button>
        )}
        <button className="btn btn-ghost btn-sm" disabled={busy} title="Recitește abonamentul direct din Stripe"
          onClick={() => void run(() => adminSyncBilling(workspaceId), () => 'Resincronizat cu Stripe.')}>Resincronizează</button>
      </div>
      <div style={{ color: 'var(--s500)', fontSize: '.75rem', marginTop: '.375rem', display: 'flex', alignItems: 'center', gap: '.375rem' }}>
        Accesul complet ține până la cea mai îndepărtată dintre: sfârșitul probei, accesul gratuit și abonamentul plătit.
        <button type="button" onClick={() => setInfoOpen(o => !o)} aria-expanded={infoOpen}
          aria-label="Cum funcționează butoanele" title="Cum funcționează butoanele"
          style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid var(--s300)', background: infoOpen ? 'var(--s100)' : 'transparent',
            color: 'var(--s600)', fontSize: '.7rem', fontWeight: 700, fontStyle: 'italic', fontFamily: 'Georgia, serif',
            lineHeight: '16px', padding: 0, cursor: 'pointer', flexShrink: 0 }}>i</button>
      </div>
      {infoOpen && <BillingHelp />}
      {done && <div role="status" style={{ color: 'var(--g700)', marginTop: '.375rem' }}>{done}</div>}
      {error && <div style={{ color: 'var(--r600)', marginTop: '.375rem' }}>{error}</div>}
    </div>
  )
}

const HELP_ROWS: [string, string][] = [
  ['Prelungește proba (N zile)', 'Adaugă N zile la perioada de probă (de azi, dacă proba s-a încheiat). Dacă cabinetul e abonat și încă în probă în Stripe, mută și data primei plăți. Inactiv pe un abonament plătit, unde n-ar avea efect.'],
  ['Gratuit până la — fără abonament sau cu abonament încheiat', 'Acces gratuit până la sfârșitul zilei alese.'],
  ['Gratuit până la — abonament anulat, încă în curs', 'Acces gratuit și după încheierea abonamentului. Nu se mai încasează nimic, iar în Stripe nu se schimbă nimic.'],
  ['Gratuit până la — abonament activ, care s-ar reînnoi', 'Acces gratuit. Dacă data e după sfârșitul perioadei plătite, următoarea plată Stripe se mută la sfârșitul gratuității (nu se încasează nimic între timp). Dacă perioada plătită acoperă deja data, Stripe nu se modifică.'],
  ['Retrage gratuitatea', 'Șterge accesul gratuit; rămâne cel din probă sau abonament. Dacă plata fusese amânată, se încasează acum (sau la sfârșitul probei inițiale, dacă mai ține).'],
  ['Resincronizează', 'Recitește abonamentul direct din Stripe, de exemplu dacă s-a pierdut un webhook.'],
]

function BillingHelp() {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '.5rem', fontSize: '.75rem', color: 'var(--s600)' }}>
      <tbody>
        {HELP_ROWS.map(([k, v]) => (
          <tr key={k} style={{ borderTop: '1px solid var(--s100)' }}>
            <td style={{ padding: '.375rem .75rem .375rem 0', fontWeight: 600, color: 'var(--s800)', verticalAlign: 'top', width: '38%' }}>{k}</td>
            <td style={{ padding: '.375rem 0', lineHeight: 1.5 }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
