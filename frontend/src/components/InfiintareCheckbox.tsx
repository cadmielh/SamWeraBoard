/** Textul din câmpurile CUI / J ale unei firme în înființare. */
export const INFIINTARE_PLACEHOLDER = 'se completează după înregistrarea la ONRC'

/** Bifa „firmă în curs de înființare” din formularele de client: CUI-ul și J-ul nu mai sunt obligatorii,
 * iar în documente rămân ca loc de completat de mână. Folosită de ClientModal și CompanyInfoForm. */
export default function InfiintareCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8125rem', color: 'var(--s600)', cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        Firmă în curs de înființare (nu are încă CUI și nr. de înregistrare)
      </label>
      {checked && (
        <span className="cv2-anaf-note">
          CUI-ul și J-ul nu sunt obligatorii acum. În documente vor apărea ca loc de completat de mână; adaugă-le după înregistrare.
        </span>
      )}
    </>
  )
}
