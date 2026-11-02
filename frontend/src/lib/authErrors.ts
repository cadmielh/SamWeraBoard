/** Reguli și mesaje pentru autentificarea cu parolă. Mesajele nu confirmă niciodată dacă o adresă are cont. */

export const MIN_PASSWORD_LENGTH = 12

/** Formularul cu parolă apare doar după activarea providerului Email/Password (vezi docs/login-parola.md). */
export const passwordLoginEnabled = (): boolean => import.meta.env.VITE_PASSWORD_LOGIN === '1'

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'E-mail sau parolă incorecte.',
  'auth/invalid-login-credentials': 'E-mail sau parolă incorecte.',
  'auth/wrong-password': 'E-mail sau parolă incorecte.',
  'auth/user-not-found': 'E-mail sau parolă incorecte.',
  'auth/user-disabled': 'E-mail sau parolă incorecte.',
  'auth/invalid-email': 'Adresa de e-mail nu este validă.',
  'auth/email-already-in-use': 'Contul nu a putut fi creat. Dacă aveți deja cont, autentificați-vă sau resetați parola.',
  'auth/weak-password': `Parola trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.`,
  'auth/password-does-not-meet-requirements': `Parola trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.`,
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
