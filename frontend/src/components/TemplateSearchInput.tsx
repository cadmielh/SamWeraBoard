/** Căutarea după nume din listele de șabloane (biblioteca și pasul de generare); filtrarea: matchesTemplateSearch. */
export default function TemplateSearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="search"
      className="field-input"
      value={value}
      onChange={e => onChange(e.target.value)}
      // Escape golește căutarea, fără să închidă panoul în care se află.
      onKeyDown={e => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange('') } }}
      placeholder="Caută șablon după nume…"
      aria-label="Caută șablon după nume"
      autoComplete="off"
    />
  )
}
