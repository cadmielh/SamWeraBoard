import { formatMarime, type Folder } from '../../lib/fisiere'
import type { useIncarcari } from './useIncarcari'
import IconRefresh from '../IconRefresh'

/** Lista încărcărilor în curs pentru clientul deschis: progres, erori cu „Reîncearcă”, duplicate cu „Încarcă oricum”. */
export default function CoadaIncarcare({ coada, foldere }: { coada: ReturnType<typeof useIncarcari>; foldere: Folder[] }) {
  const { items, reincearca, renunta, inchideTerminate } = coada
  const gata = items.filter(i => i.stare === 'gata').length
  const active = items.filter(i => i.stare === 'asteptare' || i.stare === 'incarcare' || i.stare === 'pauza').length
  const probleme = items.length - gata - active
  const numeFolder = (id: string | null) => id ? foldere.find(f => f.id === id)?.nume ?? 'alt folder' : 'Documente'

  const fisiereText = (n: number) => `${n} ${n === 1 ? 'fișier' : 'fișiere'}`
  const rezumat = active
    ? `Se încarcă ${fisiereText(active)}…${gata ? ` · ${gata} gata` : ''}`
    : probleme
      ? `${gata ? `${fisiereText(gata)} ${gata === 1 ? 'încărcat' : 'încărcate'} · ` : ''}${fisiereText(probleme)} de verificat`
      : `✓ ${gata === 1 ? 'Fișier încărcat' : `${fisiereText(gata)} încărcate`}`

  return (
    <div className="doc-queue">
      <div className="doc-queue-head">
        <span role="status" aria-live="polite">{rezumat}</span>
        {!active && <button type="button" className="btn btn-ghost btn-xs" onClick={inchideTerminate}>Închide</button>}
      </div>
      <ul className="doc-queue-list">
        {items.map(it => (
          <li key={it.id} className={`doc-queue-item doc-queue-item--${it.stare}`}>
            <div className="doc-queue-row">
              <span className="doc-queue-name" title={it.file.name}>{it.file.name}</span>
              <span className="doc-meta">{formatMarime(it.file.size)}</span>
              {it.stare === 'gata' && <span className="doc-queue-ok" aria-label="Încărcat">✓</span>}
              {it.stare === 'pauza' && <span className="doc-meta">reia în câteva secunde…</span>}
              {(it.stare === 'asteptare' || it.stare === 'incarcare' || it.stare === 'pauza') && (
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => renunta(it.id)}>Anulează</button>
              )}
            </div>
            {it.stare === 'incarcare' && (
              <div className="doc-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(it.progres * 100)} aria-label={`Încărcare ${it.file.name}`}>
                <span style={{ width: `${Math.max(4, it.progres * 100)}%` }} />
              </div>
            )}
            {it.stare === 'eroare' && (
              <div className="doc-queue-msg">
                <span>{it.mesaj}</span>
                <span className="doc-queue-btns">
                  {/* Erorile verificate în browser (mărime, tip) nu se rezolvă reîncercând. */}
                  {!it.local && <button type="button" className="btn btn-ghost btn-xs" onClick={() => reincearca(it.id)}><IconRefresh size={12} /> Reîncearcă</button>}
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => renunta(it.id)}>Elimină</button>
                </span>
              </div>
            )}
            {it.stare === 'duplicat' && (
              <div className="doc-queue-msg doc-queue-msg--warn">
                <span>Există deja, cu același conținut, ca „{it.existent?.nume}” în „{numeFolder(it.existent?.folderId ?? null)}”.</span>
                <span className="doc-queue-btns">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => renunta(it.id)}>Nu mai încărca</button>
                  <button type="button" className="btn btn-outline-primary btn-xs" onClick={() => reincearca(it.id, true)}>Încarcă oricum</button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
