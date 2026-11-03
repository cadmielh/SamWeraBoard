/** Reguli și mesaje pentru autentificarea cu parolă. Mesajele nu confirmă niciodată dacă o adresă are cont. */

export const MIN_PASSWORD_LENGTH = 12

// Oglinda politicii de parolă din Firebase (Authentication → Settings → Password policy), care rămâne verificarea finală.
export const PASSWORD_RULES: { label: string; test: (password: string) => boolean }[] = [
  { label: `Cel puțin ${MIN_PASSWORD_LENGTH} caractere`, test: p => p.length >= MIN_PASSWORD_LENGTH },
  { label: 'O literă mare (A–Z)', test: p => /[A-Z]/.test(p) },
  { label: 'O literă mică (a–z)', test: p => /[a-z]/.test(p) },
  { label: 'O cifră', test: p => /[0-9]/.test(p) },
  { label: 'Un caracter special (de ex. ! @ # - ?)', test: p => /[!-/:-@[-`{-~]/.test(p) },   // semnele de punctuație ASCII
]

export const PASSWORD_REQUIREMENTS = `Parola trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere, o literă mare, o literă mică, o cifră și un caracter special.`

export const passwordMeetsRules = (password: string): boolean => PASSWORD_RULES.every(rule => rule.test(password))

/** Formularul cu parolă apare doar după activarea providerului Email/Password (vezi docs/login-parola.md). */
export const passwordLoginEnabled = (): boolean => import.meta.env.VITE_PASSWORD_LOGIN === '1'

/** Coduri la reîmprospătarea tokenului care înseamnă că sesiunea s-a încheiat (spre deosebire de o problemă de rețea). */
export const SESSION_ENDED_CODES = ['auth/user-token-expired', 'auth/user-not-found', 'auth/user-disabled', 'auth/invalid-user-token']

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'E-mail sau parolă incorecte.',
  'auth/invalid-login-credentials': 'E-mail sau parolă incorecte.',
  'auth/wrong-password': 'E-mail sau parolă incorecte.',
  'auth/user-not-found': 'E-mail sau parolă incorecte.',
  'auth/user-disabled': 'E-mail sau parolă incorecte.',
  'auth/invalid-email': 'Adresa de e-mail nu este validă.',
  'auth/email-already-in-use': 'Contul nu a putut fi creat. Dacă aveți deja cont, autentificați-vă sau resetați parola.',
  'auth/weak-password': PASSWORD_REQUIREMENTS,
  'auth/password-does-not-meet-requirements': PASSWORD_REQUIREMENTS,
  'auth/too-many-requests': 'Prea multe încercări. Așteptați câteva minute și reîncercați.',
  'auth/network-request-failed': 'Conexiune indisponibilă. Verificați internetul și reîncercați.',
  'auth/operation-not-allowed': 'Autentificarea cu parolă nu este disponibilă momentan.',
}

export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? ''
  return MESSAGES[code] ?? 'Operațiunea nu a reușit. Reîncercați.'
}

/** La resetare, doar problemele de conexiune sau de limitare sunt erori afișate: restul ar dezvălui existența contului. */
export function resetErrorMessage(err: unknown): string | null {
  const code = (err as { code?: string } | null)?.code ?? ''
  return code === 'auth/too-many-requests' || code === 'auth/network-request-failed' || code === 'auth/invalid-email'
    ? authErrorMessage(err)
    : null
}
