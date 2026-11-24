import { useMemo, useState } from 'react'
import Modal from '../Modal'
import BtnLabel from '../BtnLabel'
import { arbore, caleFolder, descendenti, inaltime, MAX_ADANCIME, type Folder } from '../../lib/fisiere'
import { IconFolder } from './icons'

export interface ElementMutat { tip: 'fisier' | 'folder'; id: string; nume: string }

interface Props {
  foldere: Folder[]
  /** Ce se mută (unul sau mai multe elemente, din același folder `folderCurent`). Folderele se mută cu tot ce conțin. */
  elemente: ElementMutat[]
  folderCurent: string | null
  onMove: (folderId: string | null) => Promise<void>
  onClose: () => void
}

const RADACINA = '__radacina__'

/** „Mută în…”: arborele de foldere al clientului. Destinațiile imposibile (folderul curent, un folder în el însuși
 * sau în propriul subfolder, peste numărul maxim de niveluri) apar dezactivate, cu motivul în titlu. */
export default function MutaModal({ foldere, elemente, folderCurent, onMove, onClose }: Props) {
  const [ales, setAles] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const optiuni = useMemo(() => {
    const folderele = elemente.filter(e => e.tip === 'folder')
    const interzise = new Set(folderele.flatMap(e => [...descendenti(foldere, e.id)]))
    const h = Math.max(0, ...folderele.map(e => inaltime(foldere, e.id)))
    return arbore(foldere).map(({ folder, nivel }) => {
      let motiv = ''
      if (folder.id === folderCurent) motiv = 'Se află deja aici'
      else if (interzise.has(folder.id)) motiv = 'Un folder nu poate fi mutat în el însuși'
      else if (h && caleFolder(foldere, folder.id).length + h > MAX_ADANCIME) motiv = 'Prea multe niveluri'
      return { folder, nivel, motiv }
    })
  }, [foldere, elemente, folderCurent])

  const muta = async () => {
    if (ales === null) return
    setBusy(true)
    try {
      await onMove(ales === RADACINA ? null : ales)
      onClose()
    } catch {
      // mesajul îl afișează `onMove`; fereastra rămâne deschisă pentru altă alegere
    } finally {
      setBusy(false)
    }
  }

  const rand = (key: string, label: string, nivel: number, motiv: string) => (
    <li key={key}>
      <button
        type="button" className={`doc-tree-item${ales === key ? ' is-selected' : ''}`} style={{ paddingLeft: `${0.75 + nivel * 1.25}rem` }}
        disabled={!!motiv} title={motiv || undefined} aria-pressed={ales === key} onClick={() => setAles(key)}
      >
        <IconFolder size={16} /> <span className="doc-tree-name">{label}</span>
        {motiv && <span className="doc-tree-note">{motiv}</span>}
      </button>
    </li>
  )

  const titlu = elemente.length === 1 ? `Mută „${elemente[0].nume}”` : `Mută ${elemente.length} elemente`

  return (
    <Modal onClose={onClose} className="modal-box--sm" ariaLabel="Mută">
      <div className="modal-head">
        <span className="modal-title">{titlu}</span>
        <button className="modal-close" onClick={onClose} aria-label="Închide">×</button>
      </div>
      <div className="modal-body">
        <ul className="doc-tree" aria-label="Alege folderul de destinație">
          {rand(RADACINA, 'Documente (fără folder)', 0, folderCurent === null ? 'Se află deja aici' : '')}
          {optiuni.map(o => rand(o.folder.id, o.folder.nume, o.nivel + 1, o.motiv))}
        </ul>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Anulează</button>
        <button className="btn btn-primary" onClick={muta} disabled={ales === null || busy}>
          <BtnLabel busy={busy}>Mută aici</BtnLabel>
        </button>
      </div>
    </Modal>
  )
}
