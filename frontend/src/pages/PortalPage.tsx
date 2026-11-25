import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import LogoMark from '../components/LogoMark'
import IconPlus from '../components/IconPlus'
import IconRefresh from '../components/IconRefresh'
import { IconCamera, IconIncarca } from '../components/documente/icons'
import { formatDateRo } from '../lib/dates'
import { formatMarime } from '../lib/fisiere'
import {
  ETICHETA_STARE_PORTAL, EroarePortal, INDICATII, LinkInactiv, anuleazaLipsa, citestePortal, incarcaAct, marcheazaLipsa,
  pregatesteFisier, retrageFisier, rezolvat, totulTrimis, type ActPortal, type Calitate, type ParteCi, type Portal,
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
              <IconRefresh size={16} /> Reîncearcă
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
  const trimise = p.acte.filter(rezolvat).length
  const lipsa = p.acte.some(a => a.stare === 'lipsa')
  return (
    <>
      <header className="portal-cap">
        <div className="portal-cap-cabinet">
          <div className="portal-cabinet">{cabinet}</div>
          {p.cerutDe && <div className="portal-cerut">Cerere trimisă de {p.cerutDe}</div>}
        </div>
        {/* Discret: cabinetul e cel care cere actele; Cabinio e doar platforma, numită și în informarea de jos. */}
        <div className="portal-marca" aria-label="Cabinio">
          <LogoMark size={22} /><span>Cabin<b>io</b></span>
        </div>
      </header>

      {gata ? (
        <section className="portal-final" role="status">
          <span className="portal-final-semn" aria-hidden>✓</span>
          <div>
            <h1>Gata, mulțumim!</h1>
            <p>{cabinet} a primit {lipsa ? 'răspunsul dumneavoastră și îl va verifica' : 'documentele și le va verifica'}. Dacă e nevoie de altceva,
              cabinetul vă va anunța. Puteți închide pagina.</p>
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
        <div className="portal-progres" aria-label={`${trimise} din ${p.acte.length} acte gata`}>
          <div className="portal-progres-bara"><span style={{ width: `${(trimise / p.acte.length) * 100}%` }} /></div>
          <span>{trimise} din {p.acte.length} gata</span>
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

interface InCurs { cheie: string; nume: string; progres: number; parte?: ParteCi }

/** O poză care pare neclară sau întunecată, oprită până când clientul alege: o reface sau o trimite oricum. */
interface DeConfirmat { blob: Blob; nume: string; parte?: ParteCi; url: string; calitate: Calitate }

const textCalitate = (c: Calitate) =>
  c.intunecata && c.neclara ? 'Poza pare întunecată și neclară.' : c.intunecata ? 'Poza pare prea întunecată.' : 'Poza pare neclară (mișcată sau nefocalizată).'

function ActCard({ a, token, deschisa, onSchimbat, onInactiv }: {
  a: ActPortal; token: string; deschisa: boolean; onSchimbat: () => Promise<void>; onInactiv: () => void
}) {
  const [inCurs, setInCurs] = useState<InCurs[]>([])
  const [eroare, setEroare] = useState('')
  const [ocupat, setOcupat] = useState<string | null>(null)
  const [deConfirmat, setDeConfirmat] = useState<DeConfirmat | null>(null)
  const [nuAm, setNuAm] = useState<string | null>(null)        // nota în lucru pentru „Nu am acest act”
  // Miniaturile pozelor trimise acum, doar pe acest telefon (serverul nu arată conținutul pe link).
  const [miniaturi, setMiniaturi] = useState<Record<string, string>>({})
  const urlRef = useRef<string[]>([])
  const refacRef = useRef<HTMLInputElement>(null)
  const contor = useRef(0)
  useEffect(() => () => urlRef.current.forEach(u => URL.revokeObjectURL(u)), [])
  const [atingere] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches)

  const poateTrimite = deschisa && a.stare !== 'acceptat'
  const areFisiere = a.fisiere.length > 0
  const ci = a.tip === 'ci'

  const trateaza = (e: unknown) => {
    if (e instanceof LinkInactiv) onInactiv()
    else setEroare(e instanceof EroarePortal ? e.message : 'Trimiterea nu a reușit. Vă rugăm să reîncercați.')
  }
  const urlPoza = (blob: Blob) => {
    if (!blob.type.startsWith('image/')) return null
    const u = URL.createObjectURL(blob)
    urlRef.current.push(u)
    return u
  }

  const urca = async (blob: Blob, nume: string, parte: ParteCi | undefined, url: string | null): Promise<boolean> => {
    const cheie = String(++contor.current)
    setInCurs(v => [...v, { cheie, nume, progres: 0, parte }])
    try {
      const f = await incarcaAct(token, a.id, blob, nume, pr => setInCurs(v => v.map(x => (x.cheie === cheie ? { ...x, progres: pr } : x))), parte)
      const u = f ? url ?? urlPoza(blob) : null
      if (f && u) setMiniaturi(m => ({ ...m, [f.id]: u }))
      return true
    } catch (e) {
      trateaza(e)
      return false
    } finally {
      setInCurs(v => v.filter(x => x.cheie !== cheie))
    }
  }

  const trimite = async (lista: FileList | null, parte?: ParteCi) => {
    const de = Array.from(lista ?? [])
    if (!de.length) return
    setEroare('')
    setDeConfirmat(null)
    let trimisCeva = false
    for (const f of de) {
      let pregatit
      try { pregatit = await pregatesteFisier(f) } catch (e) { trateaza(e); continue }
      // O singură poză (din cameră sau aleasă): dacă pare neclară sau întunecată, clientul decide înainte de trimitere.
      if (de.length === 1 && pregatit.calitate && (pregatit.calitate.intunecata || pregatit.calitate.neclara)) {
        const url = urlPoza(pregatit.blob)
        if (url) { setDeConfirmat({ ...pregatit, calitate: pregatit.calitate, parte, url }); return }
      }
      if (await urca(pregatit.blob, pregatit.nume, parte, null)) trimisCeva = true
    }
    if (trimisCeva) await onSchimbat()
  }

  const trimiteOricum = async () => {
    if (!deConfirmat) return
    const { blob, nume, parte, url } = deConfirmat
    setDeConfirmat(null)
    if (await urca(blob, nume, parte, url)) await onSchimbat()
  }

  const actiune = async (cheie: string, fn: () => Promise<void>) => {
    setOcupat(cheie)
    setEroare('')
    try { await fn(); await onSchimbat() } catch (e) { trateaza(e) } finally { setOcupat(null) }
  }

  const zona = (parte?: ParteCi) => {
    const fis = a.fisiere.filter(f => !ci || (parte === 'verso' ? f.parte === 'verso' : f.parte !== 'verso'))
    const incarcari = inCurs.filter(x => x.parte === parte)
    const secundar = parte === 'verso'
    return (
      <div className={`portal-zona${ci ? ' portal-zona--parte' : ''}`} key={parte ?? 'tot'}>
        {ci && (
          <div className="portal-zona-titlu">
            {parte === 'verso' ? 'Verso' : 'Față'}
            {parte === 'verso' && <span> · doar la cartea de identitate electronică (cu cip)</span>}
          </div>
        )}
        {fis.length > 0 && (
          <ul className="portal-fisiere">
            {fis.map(f => (
              <li key={f.id}>
                {miniaturi[f.id] && <img className="portal-miniatura" src={miniaturi[f.id]} alt="" />}
                <span className="portal-fisier-nume">{f.nume}</span>
                <span className="portal-fisier-marime">{formatMarime(f.marime)}</span>
                {deschisa && (
                  <button type="button" className="portal-retrage" onClick={() => void actiune(`r:${f.id}`, () => retrageFisier(token, f.id))}
                    disabled={ocupat === `r:${f.id}`} aria-label={`Retrage ${f.nume}`} title="Retrage (am trimis greșit)">
                    {ocupat === `r:${f.id}` ? '…' : '×'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {incarcari.map(x => (
          <div key={x.cheie} className="portal-incarcare" role="status">
            <span className="portal-fisier-nume">{x.nume}</span>
            <div className="portal-progres-bara"><span style={{ width: `${Math.round(x.progres * 100)}%` }} /></div>
          </div>
        ))}
        {deConfirmat && deConfirmat.parte === parte && (
          <div className="portal-verifica" role="alert">
            <img className="portal-verifica-poza" src={deConfirmat.url} alt="Poza aleasă" />
            <div className="portal-verifica-text">
              <strong>{textCalitate(deConfirmat.calitate)}</strong>
              <span>Verificați dacă textul se citește. O poză clară scutește o nouă cerere de la cabinet.</span>
              <div className="portal-actiuni portal-actiuni--mic">
                <input ref={refacRef} type="file" accept="image/*" capture="environment" hidden
                onChange={e => { void trimite(e.target.files, parte); e.target.value = '' }} />
              <button type="button" className="portal-btn portal-btn--principal" onClick={() => refacRef.current?.click()}>
                  <IconCamera size={16} /> O refac
                </button>
                <button type="button" className="portal-btn" onClick={() => void trimiteOricum()}>Trimite oricum</button>
              </div>
            </div>
          </div>
        )}
        {poateTrimite && !deConfirmat && (
          <Butoane mic={fis.length > 0 || secundar} atingere={atingere} areFisiere={fis.length > 0} ocupat={inCurs.length > 0}
            onFisiere={l => void trimite(l, parte)} />
        )}
      </div>
    )
  }

  return (
    <li className={`portal-act portal-act--${a.stare}`}>
      <div className="portal-act-cap">
        <h2 className="portal-act-nume">
          {a.eticheta}
          {a.optional && <span className="portal-optional">opțional</span>}
        </h2>
        <span className={`portal-stare portal-stare--${a.stare}`}>{ETICHETA_STARE_PORTAL[a.stare]}</span>
      </div>

      {a.stare === 'respins' && (
        <div className="portal-respins">
          <strong>Cabinetul vă roagă să trimiteți din nou acest act.</strong>
          {a.motiv && <span> Motiv: {a.motiv}</span>}
        </div>
      )}
      {a.stare === 'lipsa' && (
        <div className="portal-lipsa">
          <span>Ați spus că nu aveți acest act{a.notaClient ? <>: „{a.notaClient}”</> : '.'}</span>
          {deschisa && (
            <button type="button" className="portal-link" disabled={ocupat === 'lipsa'}
              onClick={() => void actiune('lipsa', () => anuleazaLipsa(token, a.id))}>Anulează</button>
          )}
        </div>
      )}
      {a.stare === 'acceptat' && <p className="portal-act-text">Cabinetul a verificat și a păstrat acest act.</p>}
      {poateTrimite && !areFisiere && a.stare !== 'lipsa' && (
        <p className="portal-act-text">{a.optional ? 'Dacă îl aveți. ' : ''}{INDICATII[a.tip]}</p>
      )}

      {a.stare === 'acceptat' ? null : ci ? <>{zona('fata')}{zona('verso')}</> : zona()}

      {eroare && <p className="portal-eroare" role="alert">{eroare}</p>}

      {poateTrimite && !areFisiere && a.stare !== 'lipsa' && !deConfirmat && inCurs.length === 0 && (
        nuAm === null ? (
          <button type="button" className="portal-link portal-nu-am" onClick={() => setNuAm('')}>Nu am acest act</button>
        ) : (
          <div className="portal-nu-am-form">
            <label>
              <span>O notă pentru cabinet (opțional)</span>
              <textarea rows={2} maxLength={300} value={nuAm} autoFocus onChange={e => setNuAm(e.target.value)}
                placeholder="Ex. Îl trimit săptămâna viitoare / Nu există un astfel de act" />
            </label>
            <div className="portal-actiuni portal-actiuni--mic">
              <button type="button" className="portal-btn portal-btn--principal" disabled={ocupat === 'lipsa'}
                onClick={() => void actiune('lipsa', async () => { await marcheazaLipsa(token, a.id, nuAm.trim()); setNuAm(null) })}>
                Trimite
              </button>
              <button type="button" className="portal-btn" onClick={() => setNuAm(null)}>Renunță</button>
            </div>
          </div>
        )
      )}
    </li>
  )
}

function Butoane({ mic, atingere, areFisiere, ocupat, onFisiere }: {
  mic: boolean; atingere: boolean; areFisiere: boolean; ocupat: boolean; onFisiere: (l: FileList | null) => void
}) {
  const camera = useRef<HTMLInputElement>(null)
  const fisiere = useRef<HTMLInputElement>(null)
  return (
    <div className={`portal-actiuni${mic ? ' portal-actiuni--mic' : ''}`}>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { onFisiere(e.target.files); e.target.value = '' }} />
      <input ref={fisiere} type="file" accept="image/*,application/pdf,.pdf" multiple hidden
        onChange={e => { onFisiere(e.target.files); e.target.value = '' }} />
      {atingere && (
        <button type="button" className={`portal-btn${mic ? '' : ' portal-btn--principal'}`} onClick={() => camera.current?.click()} disabled={ocupat}>
          <IconCamera size={mic ? 16 : 18} /> {areFisiere ? 'Mai fac o poză' : 'Fotografiază'}
        </button>
      )}
      <button type="button" className={`portal-btn${atingere || mic ? '' : ' portal-btn--principal'}`}
        onClick={() => fisiere.current?.click()} disabled={ocupat}>
        {areFisiere ? <IconPlus size={15} /> : <IconIncarca size={mic ? 16 : 18} />} {areFisiere ? 'Adaugă alt fișier' : atingere ? 'Din telefon' : 'Alege fișierul'}
      </button>
    </div>
  )
}
