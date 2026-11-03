import { useState, type CSSProperties, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { authErrorMessage, MIN_PASSWORD_LENGTH, PASSWORD_REQUIREMENTS, passwordMeetsRules, resetErrorMessage } from '../lib/authErrors'
import LogoMark from './LogoMark'
import Modal from './Modal'
import PasswordRules from './PasswordRules'

/** Operațiunile cu parolă; le furnizează AppLayout, ca pagina publică să nu depindă direct de Firebase. */
export interface PasswordAuth {
  signIn: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  reset: (email: string) => Promise<void>
}

type Mode = 'choose' | 'login' | 'register' | 'reset'

const SUBMIT: Record<Exclude<Mode, 'choose'>, string> = { login: 'Autentificare', register: 'Creează contul', reset: 'Trimite linkul' }
const WIDE_BTN: CSSProperties = { width: '100%', justifyContent: 'center', minHeight: 44 }
const SMALL_TEXT: CSSProperties = { fontSize: '.8125rem', color: 'var(--s500)', textAlign: 'center', lineHeight: 1.5 }
const TEXT_LINK: CSSProperties = { background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--p500)', cursor: 'pointer' }

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.5 13.6 17.8 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.9 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.9c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 7.1-10.3 7.1-17.7Z" />
      <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-8-6.2a24 24 0 0 0 0 21.6l8-6.2Z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-8 6.2C6.5 42.6 14.6 48 24 48Z" />
    </svg>
  )
}

export default function AuthDialog({ auth, onGoogle, onClose }: { auth: PasswordAuth; onGoogle: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('choose')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const switchTo = (next: Mode) => {
    setMode(next)
    setPassword('')
    setConfirmation('')
    setError(null)
    setInfo(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    if (mode === 'register' && !passwordMeetsRules(password)) {
      setError(PASSWORD_REQUIREMENTS)
      return
    }
    if (mode === 'register' && password !== confirmation) {
      setError('Parolele nu coincid.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') await auth.signIn(email.trim(), password)
      else if (mode === 'register') await auth.register(name.trim(), email.trim(), password)
      else {
        try {
          await auth.reset(email.trim())
        } catch (err) {
          const msg = resetErrorMessage(err)
          if (msg) { setError(msg); return }
        }
        setInfo('Dacă adresa are un cont, veți primi un e-mail cu linkul de resetare.')
      }
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} ariaLabel="Autentificare în Cabinio" boxStyle={{ maxWidth: 400, width: '100%' }}>
      <div style={{ padding: '2rem 1.75rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.625rem', marginBottom: '.5rem' }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 64, height: 64, borderRadius: 16, background: 'var(--p500)', color: '#fff' }}>
            <LogoMark size={40} />
          </span>
          <div style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--s900)' }}>Cabinio</div>
          <div style={{ fontSize: '.9375rem', color: 'var(--s500)', textAlign: 'center' }}>Clienții și dosarele cabinetului, într-un singur loc.</div>
        </div>

        {mode === 'choose' ? (
          <>
            <button type="button" className="btn btn-ghost" style={{ ...WIDE_BTN, gap: '.625rem', border: '1.5px solid var(--s200)' }} onClick={onGoogle}>
              <GoogleMark /> Continuați cu Google
            </button>
            <div style={SMALL_TEXT}>Recomandat dacă folosiți Google Drive</div>
            <div style={SMALL_TEXT}>sau</div>
            <button type="button" className="btn btn-ghost" style={{ ...WIDE_BTN, border: '1.5px solid var(--s200)' }} onClick={() => switchTo('login')}>
              Continuați cu e-mail
            </button>
          </>
        ) : (
          <>
            <form onSubmit={e => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              {mode === 'register' && (
                <input className="field-input" name="name" aria-label="Nume" placeholder="Nume" autoComplete="name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} style={{ minHeight: 44 }} />
              )}
              <input className="field-input" name="email" type="email" aria-label="E-mail" placeholder="Adresă de e-mail" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} style={{ minHeight: 44 }} />
              {mode !== 'reset' && (
                <div style={{ position: 'relative' }}>
                  <input
                    className="field-input"
                    name="password"
                    type="password"
                    aria-label="Parolă"
                    placeholder="Parolă"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    minLength={mode === 'register' ? MIN_PASSWORD_LENGTH : undefined}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    style={{ minHeight: 44, paddingRight: mode === 'login' ? '5.5rem' : undefined }}
                  />
                  {mode === 'login' && (
                    <button type="button" style={{ ...TEXT_LINK, position: 'absolute', right: '.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '.8125rem' }} onClick={() => switchTo('reset')}>
                      Ați uitat?
                    </button>
                  )}
                </div>
              )}
              {mode === 'register' && (
                <input className="field-input" name="confirm-password" type="password" aria-label="Confirmați parola" placeholder="Confirmați parola" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} style={{ minHeight: 44 }} />
              )}
              {mode === 'register' && <PasswordRules password={password} />}
              {error && <div role="alert" style={{ color: 'var(--r600)', fontSize: '.8125rem' }}>{error}</div>}
              {info && <div role="status" style={{ color: 'var(--s600)', fontSize: '.8125rem' }}>{info}</div>}
              <button type="submit" className="btn btn-primary" style={WIDE_BTN} disabled={busy}>
                {busy ? <span className="spin" /> : SUBMIT[mode]}
              </button>
            </form>

            {mode === 'login' && <div style={SMALL_TEXT}>Nu aveți cont? <button type="button" style={TEXT_LINK} onClick={() => switchTo('register')}>Creați unul</button></div>}
            {mode === 'register' && <div style={SMALL_TEXT}>Aveți deja cont? <button type="button" style={TEXT_LINK} onClick={() => switchTo('login')}>Autentificați-vă</button></div>}
            <div style={SMALL_TEXT}>
              <button type="button" style={{ ...TEXT_LINK, color: 'var(--s600)' }} onClick={() => switchTo(mode === 'reset' ? 'login' : 'choose')}>
                {mode === 'reset' ? '← Înapoi la autentificare' : '← Înapoi la opțiuni'}
              </button>
            </div>
          </>
        )}

        <div style={{ ...SMALL_TEXT, fontSize: '.75rem', marginTop: '.25rem' }}>
          Detalii în <Link to="/termeni">Termeni și condiții</Link> și <Link to="/confidentialitate">Confidențialitate</Link>.
        </div>
      </div>
    </Modal>
  )
}
