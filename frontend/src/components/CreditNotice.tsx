import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'
import { CREDITS_EVENT, setGenerationClient, type CreditsUse } from '../lib/api'
import { creditQuote, formatDate, type CreditQuote } from '../lib/billing'
import type { ToastItem } from '../types'

/** La cabinetele pe credite: spune înainte de generare ce se întâmplă pentru clientul ales (consumă un credit,
 *  e inclus în fereastra clientului sau nu mai sunt credite) și anunță după generare creditul consumat.
 *  Ține și clientul curent pentru cererile de generare (setGenerationClient). Nu afișează nimic în probă,
 *  cu acces gratuit sau cu abonament. */
export default function CreditNotice({ clientId, clientName, onToast, onBlockedChange }: {
  clientId: string | null | undefined
  clientName?: string
  onToast: (msg: string, type: ToastItem['type']) => void
  /** Motivul pentru care generarea nu e posibilă acum (fără credite / fără client salvat), sau null. */
  onBlockedChange?: (reason: string | null) => void
}) {
  const { billing, userRole } = useApp()
  const onCredits = billing.credits.mode !== 'unlimited'
  const [quote, setQuote] = useState<CreditQuote | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    setGenerationClient(clientId)
    return () => setGenerationClient(null)
  }, [clientId])

  useEffect(() => {
    if (!onCredits) return
    let cancelled = false
    creditQuote(clientId).then(q => { if (!cancelled) setQuote(q) }).catch(() => { if (!cancelled) setQuote(null) })
    return () => { cancelled = true }
  }, [onCredits, clientId, refresh])

  useEffect(() => {
    const onUse = (e: Event) => {
      const use = (e as CustomEvent<CreditsUse>).detail
      if (use.consumed) {
        const left = use.balance ?? 0
        onToast(`S-a consumat 1 credit pentru ${clientName || 'acest client'}. ${left === 1 ? 'A rămas 1 credit' : `Au rămas ${left} credite`}.`, 'info')
      }
      setRefresh(n => n + 1)
    }
    window.addEventListener(CREDITS_EVENT, onUse)
    return () => window.removeEventListener(CREDITS_EVENT, onUse)
  }, [clientName, onToast])

  const blocked = !onCredits || !quote || quote.mode === 'unlimited' ? null
    : !clientId ? 'Salvează întâi clientul în portofoliu: cabinetul folosește credite.'
      : quote.mode === 'none' ? 'Nu mai ai credite pentru un client nou.' : null
  useEffect(() => { onBlockedChange?.(blocked) }, [blocked, onBlockedChange])

  if (!onCredits || !quote || quote.mode === 'unlimited') return null
  const who = clientName ? `„${clientName}”` : 'acest client'
  let tone: 'info' | 'ok' | 'warn' = 'info'
  let text: string
  if (!clientId) {
    tone = 'warn'
    text = 'Cabinetul folosește credite: salvează întâi clientul în portofoliu, ca generarea să se lege de el.'
  } else if (quote.mode === 'included') {
    tone = 'ok'
    text = `Inclus: ${who} are credit activ până pe ${formatDate(quote.coveredUntil ? new Date(quote.coveredUntil) : null)}. `
      + 'Documentele și regenerările pentru el nu mai consumă credite până atunci.'
  } else if (quote.mode === 'consume') {
    text = `Primul document pentru ${who} consumă 1 credit (ai ${quote.balance}). `
      + 'Toate documentele pentru el în următoarele 30 de zile sunt apoi incluse.'
  } else {
    tone = 'warn'
    text = 'Nu mai ai credite pentru un client nou.'
  }
  const colors = {
    info: { background: 'var(--p50)', border: '1px solid var(--p200)', color: 'var(--p700)' },
    ok: { background: 'var(--g50)', border: '1px solid var(--g200, #bbf7d0)', color: 'var(--g700)' },
    warn: { background: 'var(--y50)', border: '1px solid var(--y200)', color: 'var(--a800, #92400e)' },
  }[tone]
  return (
    <div role="status" style={{ ...colors, borderRadius: 8, padding: '.5rem .75rem', fontSize: '.8125rem', marginBottom: '.75rem',
      display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
      <span style={{ flex: '1 1 16rem' }}>{text}</span>
      {quote.mode === 'none' && userRole === 'admin' && (
        <Link to="/setari/plan" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>Cumpără credite</Link>
      )}
    </div>
  )
}
