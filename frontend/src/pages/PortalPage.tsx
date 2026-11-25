import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { formatDateRo } from '../lib/dates'
import { formatMarime } from '../lib/fisiere'
import {
  ETICHETA_STARE_PORTAL, EroarePortal, INDICATII, LinkInactiv, citestePortal, incarcaAct, pregatesteFisier, retrageFisier,
  totulTrimis, type ActPortal, type Portal,
} from '../lib/portal'
import '../styles/portal.css'

type Stare = { fel: 'incarca' } | { fel: 'inactiv' } | { fel: 'eroare'; mesaj: string } | { fel: 'gata'; p: Portal }

/** Pagina pe care clientul o deschide din linkul primit de la cabinet: actele cerute, fotografierea sau alegerea lor și
 * ce a trimis deja (doar nume și mărime). Fără cont, fără nimic altceva din cabinet. */
export default function PortalPage() {
  const { token = '' } = useParams()
  const [stare, setStare] = useState<Stare>({ fel: 'incarca' })

  const reincarca = useCallback(() => citestePortal(token).then(
    p => setStare({ fel: 'gata', p }),
    e => setStare(e instanceof LinkInactiv ? { fel: 'inactiv' } : { fel: 'eroare', mesaj: (e as Error).message }),
  ), [token])

  useEffect(() => {
    // Linkul nu trebuie indexat și nici trimis mai departe altor site-uri.
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    const titlu = document.title
    return () => { meta.remove(); document.title = titlu }
  }, [])

  useEffect(() => {
    let viu = true
    citestePortal(token).then(
      p => { if (viu) setStare({ fel: 'gata', p }) },
      e => { if (viu) setStare(e instanceof LinkInactiv ? { fel: 'inactiv' } : { fel: 'eroare', mesaj: (e as Error).message }) },
    )
    return () => { viu = false }
  }, [token])

  useEffect(() => {
    if (stare.fel === 'gata') document.title = stare.p.cabinet ? `Acte pentru ${stare.p.cabinet}` : 'Acte cerute'
  }, [stare])

  return (
    <div className="portal">
      <main className="portal-pagina">
        {stare.fel === 'incarca' && <div className="portal-incarca" role="status" aria-label="Se încarcă"><span className="portal-spinner" /></div>}
        {stare.fel === 'inactiv' && (
          <section className="portal-mesaj">
            <h1>Linkul nu mai este activ</h1>
            <p>Termenul a expirat sau cererea a fost închisă. Dacă mai aveți de trimis acte, vă rugăm să contactați cabinetul
              care v-a trimis linkul.</p>
          </section>
        )}
        {stare.fel === 'eroare' && (
          <section className="portal-mesaj">
            <h1>Pagina nu s-a putut încărca</h1>
            <p>{stare.mesaj}</p>
            <button type="button" className="portal-btn portal-btn--principal" onClick={() => { setStare({ fel: 'incarca' }); void reincarca() }}>
              Reîncearcă
            </button>
          </section>
        )}
        {stare.fel === 'gata' && <Cerere p={stare.p} token={token} onSchimbat={reincarca} onInactiv={() => setStare({ fel: 'inactiv' })} />}
      </main>
    </div>
  )
}

function Cerere({ p, token, onSchimbat, onInactiv }: {
  p: Portal; token: string; onSchimbat: () => Promise<void>; onInactiv: () => void
}) {
  const cabinet = p.cabinet || 'Cabinetul'
  const gata = totulTrimis(p)
  const trimise = p.acte.filter(a => a.stare === 'primit' || a.stare === 'acceptat').length
  return (
    <>
      <header className="portal-cap">
        <div className="portal-cabinet">{cabinet}</div>
        {p.cerutDe && <div className="portal-cerut">Cerere trimisă de {p.cerutDe}</div>}
      </header>

      {gata ? (
        <section className="portal-final" role="status">
          <span className="portal-final-semn" aria-hidden>✓</span>
          <div>
            <h1>Gata, mulțumim!</h1>
            <p>{cabinet} a primit documentele și le va verifica. Dacă e nevoie de altceva, cabinetul vă va anunța. Puteți închide pagina.</p>
          </div>
        </section>
      ) : (
        <section className="portal-intro">
          <h1>Acte cerute</h1>
          <p>Bună ziua! {cabinet} vă roagă să trimiteți actele de mai jos. Le puteți fotografia direct cu telefonul sau
            alege din fișiere.</p>
          {p.mesaj && <blockquote className="portal-nota">{p.mesaj}</blockquote>}
        </section>
      )}

      {!gata && p.acte.length > 1 && (
        <div className="portal-progres" aria-label={`${trimise} din ${p.acte.length} acte trimise`}>
          <div className="portal-progres-bara"><span style={{ width: `${(trimise / p.acte.length) * 100}%` }} /></div>
          <span>{trimise} din {p.acte.length} trimise</span>
        </div>
      )}

      <ul className="portal-acte">
        {p.acte.map(a => (
          <ActCard key={a.id} a={a} token={token} deschisa={p.stare === 'deschisa'} onSchimbat={onSchimbat} onInactiv={onInactiv} />
        ))}
      </ul>

      {p.expiraLa && p.stare === 'deschisa' && (
        <p className="portal-termen">Linkul e valabil până pe {formatDateRo(p.expiraLa)}. Puteți reveni pe el oricând până atunci.</p>
      )}

      <footer className="portal-subsol">
        <p>Documentele ajung doar la {cabinet}, care le folosește pentru serviciile pe care vi le oferă, în calitate de operator
          al datelor dumneavoastră. Sunt transmise criptat și păstrate în Cabinio, platforma folosită de cabinet. Pentru orice
          întrebare despre datele dumneavoastră, contactați cabinetul.</p>
        <p>Trimiteți doar actele cerute. Nu aveți nevoie de cont și nu se instalează nimic pe telefon.</p>
      </footer>
    </>
  )
}

interface InCurs { cheie: string; nume: string; progres: number }

function ActCard({ a, token, deschisa, onSchimbat, onInactiv }: {
  a: ActPortal; token: string; deschisa: boolean; onSchimbat: () => Promise<void>; onInactiv: () => void
}) {
  const camera = useRef<HTMLInputElement>(null)
  const fisiere = useRef<HTMLInputElement>(null)
  const [inCurs, setInCurs] = useState<InCurs[]>([])
  const [eroare, setEroare] = useState('')
  const [retrage, setRetrage] = useState<string | null>(null)
  const [atingere] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches)
  const poateTrimite = deschisa && a.stare !== 'acceptat'
  const areFisiere = a.fisiere.length > 0

  const trateaza = (e: unknown) => {
    if (e instanceof LinkInactiv) onInactiv()
    else setEroare(e instanceof EroarePortal ? e.message : 'Trimiterea nu a reușit. Vă rugăm să reîncercați.')
  }

  const trimite = async (lista: FileList | null) => {
    const de = Array.from(lista ?? [])
    if (!de.length) return
    setEroare('')
    let trimisCeva = false
    for (const [i, f] of de.entries()) {
      const cheie = `${Date.now()}-${i}`
      setInCurs(v => [...v, { cheie, nume: f.name || 'poză', progres: 0 }])
      try {
        const { blob, nume } = await pregatesteFisier(f)
        await incarcaAct(token, a.id, blob, nume, pr => setInCurs(v => v.map(x => (x.cheie === cheie ? { ...x, progres: pr } : x))))
        trimisCeva = true
      } catch (e) {
        trateaza(e)
        if (e instanceof LinkInactiv) return
      } finally {
        setInCurs(v => v.filter(x => x.cheie !== cheie))
      }
    }
    if (trimisCeva) await onSchimbat()
  }

  const sterge = async (fid: string) => {
    setRetrage(fid)
    setEroare('')
    try { await retrageFisier(token, fid); await onSchimbat() } catch (e) { trateaza(e) } finally { setRetrage(null) }
  }

  return (
    <li className={`portal-act portal-act--${a.stare}`}>
      <div className="portal-act-cap">
        <h2 className="portal-act-nume">{a.eticheta}</h2>
        <span className={`portal-stare portal-stare--${a.stare}`}>{ETICHETA_STARE_PORTAL[a.stare]}</span>
      </div>

      {a.stare === 'respins' && (
        <div className="portal-respins">
          <strong>Cabinetul vă roagă să trimiteți din nou acest act.</strong>
          {a.motiv && <span> Motiv: {a.motiv}</span>}
        </div>
      )}
      {a.stare === 'acceptat' && <p className="portal-act-text">Cabinetul a verificat și a păstrat acest act.</p>}
      {poateTrimite && !areFisiere && <p className="portal-act-text">{INDICATII[a.tip]}</p>}

      {areFisiere && (
        <ul className="portal-fisiere">
          {a.fisiere.map(f => (
            <li key={f.id}>
              <span className="portal-fisier-nume">{f.nume}</span>
              <span className="portal-fisier-marime">{formatMarime(f.marime)}</span>
              {deschisa && (
                <button type="button" className="portal-retrage" onClick={() => void sterge(f.id)} disabled={retrage === f.id}
                  aria-label={`Retrage ${f.nume}`} title="Retrage (am trimis greșit)">
                  {retrage === f.id ? '…' : '×'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {inCurs.map(x => (
        <div key={x.cheie} className="portal-incarcare" role="status">
          <span className="portal-fisier-nume">{x.nume}</span>
          <div className="portal-progres-bara"><span style={{ width: `${Math.round(x.progres * 100)}%` }} /></div>
        </div>
      ))}
      {eroare && <p className="portal-eroare" role="alert">{eroare}</p>}

      {poateTrimite && (
        <div className={`portal-actiuni${areFisiere ? ' portal-actiuni--mic' : ''}`}>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden
            onChange={e => { void trimite(e.target.files); e.target.value = '' }} />
          <input ref={fisiere} type="file" accept="image/*,application/pdf,.pdf" multiple hidden
            onChange={e => { void trimite(e.target.files); e.target.value = '' }} />
          {atingere && (
            <button type="button" className={`portal-btn${areFisiere ? '' : ' portal-btn--principal'}`} onClick={() => camera.current?.click()}
              disabled={inCurs.length > 0}>
              {areFisiere ? 'Mai fac o poză' : 'Fotografiază'}
            </button>
          )}
          <button type="button" className={`portal-btn${atingere || areFisiere ? '' : ' portal-btn--principal'}`}
            onClick={() => fisiere.current?.click()} disabled={inCurs.length > 0}>
            {areFisiere ? 'Adaugă alt fișier' : atingere ? 'Alege din telefon' : 'Alege fișierul'}
          </button>
        </div>
      )}
    </li>
  )
}
