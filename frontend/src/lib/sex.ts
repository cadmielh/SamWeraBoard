export type Sex = 'M' | 'F'

/** Sexul din prima cifră a CNP-ului: 1, 3, 5, 7 = bărbat; 2, 4, 6, 8 = femeie; 9 (străin fără rezidență) sau CNP lipsă/invalid = necunoscut. */
export function sexFromCnp(cnp?: string | null): Sex | null {
  const d = (cnp ?? '').replace(/\s+/g, '')
  if (!/^\d{13}$/.test(d)) return null
  return '1357'.includes(d[0]) ? 'M' : '2468'.includes(d[0]) ? 'F' : null
}

/** Sexul unei persoane: alegerea explicită din fișă are prioritate; altfel se deduce din CNP (dacă e în memorie, deci nu mascat). */
export function personSex(p?: { sex?: Sex | null; cnp?: string | null } | null): Sex | null {
  return p?.sex === 'M' || p?.sex === 'F' ? p.sex : sexFromCnp(p?.cnp)
}
