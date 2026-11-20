import type { ReactNode } from 'react'

/** Conținutul unui buton care poate lucra: cât timp `busy`, textul devine invizibil (dar își păstrează locul)
 *  și deasupra lui apare spinnerul, deci butonul nu-și schimbă lățimea și nimic din jur nu sare.
 *  `busy` acceptă orice valoare (ex. `busy && checked`); contează doar dacă e adevărată. */
export default function BtnLabel({ busy: busyValue, dark, children }: { busy: unknown; dark?: boolean; children: ReactNode }) {
  const busy = !!busyValue
  return (
    <span className={`btn-label${busy ? ' is-busy' : ''}`}>
      <span className="btn-label-text">{children}</span>
      {busy && <span className={`spin${dark ? ' spin-dark' : ''}`} role="status" aria-label="Se procesează" />}
    </span>
  )
}
