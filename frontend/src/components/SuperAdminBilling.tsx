import { useState } from 'react'
import { billingAccess, formatDate, toDate } from '../lib/billing'
import { adminCredits, adminExtendTrial, adminSetComp, adminSyncBilling } from '../lib/superAdmin'
import type { WorkspaceBilling } from '../types'
import ManualPayments from './superadmin/ManualPayments'

const REASON_LABEL: Record<string, string> = {
  trial: 'Perioadă de probă', subscription: 'Abonament', past_due: 'Plată eșuată', manual: 'Abonament manual', comp: 'Acces gratuit', credits: 'Credite',
  expired: 'Mod citire',
}

/** Starea abonamentului unui cabinet + acțiunile super adminului (prelungire probă, acces gratuit, încasări manuale,
 *  resincronizare). */
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
  const [creditAmount, setCreditAmount] = useState('5')
  const [creditReason, setCreditReason] = useState('')
  const access = billingAccess(billing)
  const compUntil = toDate(billing?.compUntil)
  const manualUntil = toDate(billing?.manualUntil ?? null)
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
  const nCredits = Number(creditAmount)
  const creditsOk = Number.isInteger(nCredits) && nCredits !== 0 && Math.abs(nCredits) <= 1000

  return (
    <div style={{ borderTop: '1px solid var(--s100)', paddingTop: '.625rem', marginBottom: '.75rem', fontSize: '.8125rem' }}>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <span className={`chip ${access.full ? 'chip-success' : 'chip-muted'}`}>{billing ? REASON_LABEL[access.reason] : 'Nemigrat'}</span>
        <span style={{ color: 'var(--s600)' }}>
          {access.full ? `acces complet până pe ${formatDate(access.accessUntil)} (${access.daysLeft} zile)` : 'fără acces complet'}
          {access.hasSubscription && ` · abonament ${access.interval === 'year' ? 'anual' : 'lunar'}`}
          {manualUntil && ` · plătit manual până pe ${formatDate(manualUntil)}`}
          {compUntil && ` · gratuit până pe ${formatDate(compUntil)}${billing?.compReason ? ` (${billing.compReason})` : ''}`}
          {trialEnd && ` · probă până pe ${formatDate(trialEnd)}`}
          {access.credits.balance > 0 &&
            ` · ${access.credits.balance} credite${access.credits.firstExpiry ? ` (primele expiră pe ${formatDate(access.credits.firstExpiry)})` : ''}`}
        </span>
      </div>
      <div className="sa-billing-grid" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: '.75rem', rowGap: '.5rem', alignItems: 'center' }}>
        <span style={ROW_LABEL}>Perioadă de probă</span>
        <div style={ROW}>
          <span>Prelungește cu</span>
          <input className="field-input" type="number" min={1} max={365} value={days} onChange={e => setDays(e.target.value)}
            style={{ width: '4.5rem' }} aria-label="Zile de prelungire a probei" disabled={paying} />
          <span>zile</span>
          <button className="btn btn-sm" disabled={busy || paying || !(nDays >= 1 && nDays <= 365)}
            title={paying ? 'Cabinetul plătește abonamentul: prelungirea probei nu are efect.' : 'Adaugă zile la perioada de probă'}
            onClick={() => void run(() => adminExtendTrial(workspaceId, nDays),
              b => `Proba se încheie acum pe ${formatDate(toDate(b.trialEndsAt))}.`)}>Prelungește proba</button>
        </div>

        <span style={ROW_LABEL}>Acces gratuit</span>
        <div style={ROW}>
          <span>Până la</span>
          <input className="field-input" type="date" value={until} onChange={e => setUntil(e.target.value)}
            style={{ width: '10rem' }} aria-label="Acces gratuit până la" />
          <button className="btn btn-sm" disabled={busy || !until} title={until ? undefined : 'Alege întâi o dată'}
            onClick={() => void run(() => adminSetComp(workspaceId, until, 'manual'),
              b => `Acces gratuit până pe ${formatDate(toDate(b.compUntil))}.`
                + (b.hasSubscription && !b.cancelAtPeriodEnd ? ' Următoarea plată Stripe se face după această dată.' : ''))}>Acordă gratuitatea</button>
          {compUntil && (
            <button className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => void run(() => adminSetComp(workspaceId, null), () => 'Accesul gratuit a fost retras.')}>Retrage gratuitatea</button>
          )}
        </div>

        <span style={ROW_LABEL}>Credite</span>
        <div style={ROW}>
          <input className="field-input" type="number" min={-1000} max={1000} value={creditAmount} onChange={e => setCreditAmount(e.target.value)}
            style={{ width: '4.5rem' }} aria-label="Număr de credite (negativ = scade)" />
          <span>credite</span>
          <input className="field-input" value={creditReason} onChange={e => setCreditReason(e.target.value)} maxLength={120}
            style={{ width: '10rem' }} placeholder="Motiv (opțional)" aria-label="Motivul creditelor" />
          <button className="btn btn-sm" disabled={busy || !creditsOk}
            title={creditsOk ? 'Funcționează și pe un cabinet în modul citire' : 'Scrie un număr diferit de 0 (negativ = scade)'}
            onClick={() => void run(() => adminCredits(workspaceId, nCredits, creditReason.trim()),
              b => `${nCredits > 0 ? `Adăugate ${nCredits} credite` : `Scăzute ${-nCredits} credite`}. Sold: ${billingAccess(b).credits.balance}.`)}>
            {nCredits < 0 ? 'Scade creditele' : 'Dă creditele'}
          </button>
        </div>

        <span style={{ ...ROW_LABEL, alignSelf: 'start', paddingTop: '.3rem' }}>Încasare manuală</span>
        <div style={{ ...ROW, flexDirection: 'column', alignItems: 'stretch' }}>
          <ManualPayments workspaceId={workspaceId} billing={billing} onChange={onChange} />
        </div>

        <span style={ROW_LABEL}>Stripe</span>
        <div style={ROW}>
          <button className="btn btn-ghost btn-sm" disabled={busy} title="Recitește abonamentul direct din Stripe"
            onClick={() => void run(() => adminSyncBilling(workspaceId), () => 'Resincronizat cu Stripe.')}>Resincronizează abonamentul</button>
        </div>
      </div>
      <div style={{ color: 'var(--s500)', fontSize: '.75rem', marginTop: '.375rem', display: 'flex', alignItems: 'center', gap: '.375rem' }}>
        Accesul complet ține până la cea mai îndepărtată dintre: sfârșitul probei, accesul gratuit, abonamentul plătit (Stripe sau manual) și creditele.
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

const ROW_LABEL: React.CSSProperties = { fontWeight: 600, color: 'var(--s700)', whiteSpace: 'nowrap' }
const ROW: React.CSSProperties = { display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', color: 'var(--s600)' }

const HELP_ROWS: [string, string][] = [
  ['Prelungește proba (N zile)', 'Adaugă N zile la perioada de probă (de azi, dacă proba s-a încheiat). Dacă cabinetul e abonat și încă în probă în Stripe, mută și data primei plăți. Inactiv pe un abonament plătit, unde n-ar avea efect.'],
  ['Acordă gratuitatea — fără abonament sau cu abonament încheiat', 'Acces gratuit până la sfârșitul zilei alese.'],
  ['Acordă gratuitatea — abonament anulat, încă în curs', 'Acces gratuit și după încheierea abonamentului. Nu se mai încasează nimic, iar în Stripe nu se schimbă nimic.'],
  ['Acordă gratuitatea — abonament activ, care s-ar reînnoi', 'Acces gratuit. Dacă data e după sfârșitul perioadei plătite, următoarea plată Stripe se mută la sfârșitul gratuității (nu se încasează nimic între timp). Dacă perioada plătită acoperă deja data, Stripe nu se modifică.'],
  ['Retrage gratuitatea', 'Șterge accesul gratuit; rămâne cel din probă sau abonament. Dacă plata fusese amânată, se încasează acum (sau la sfârșitul probei inițiale, dacă mai ține).'],
  ['Dă / Scade creditele', 'Un număr pozitiv adaugă credite gratuite, valabile 12 luni (bonus, compensație). Un număr negativ scade din credite, începând cu cele care expiră ultimele, de exemplu după o rambursare făcută din Stripe. Motivul apare în istoricul creditelor cabinetului.'],
  ['Înregistrează o încasare — abonament', 'Plată primită în afara Stripe (transfer, numerar) pentru o perioadă: clientul are „Abonament activ” până la sfârșitul ei, fără consum de credite. Mai multe perioade se adună (accesul ține până la cea mai târzie). Nu se reînnoiește singur: primești notificare cu 7 zile înainte. Refuzat dacă un abonament Stripe s-ar reînnoi în aceeași perioadă (plată dublă).'],
  ['Înregistrează o încasare — credite', 'Pachet de credite vândut în afara Stripe: creditele intră imediat în sold, valabile 12 luni.'],
  ['Anulează (încasare manuală)', 'Pentru o încasare greșită: rămâne în istoric ca anulată și dispare din Încasări. La abonament, accesul se recalculează din celelalte perioade; la credite, se scot creditele rămase din pachet (cele consumate rămân consumate).'],
  ['Resincronizează abonamentul', 'Recitește abonamentul direct din Stripe, de exemplu dacă s-a pierdut un webhook.'],
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
