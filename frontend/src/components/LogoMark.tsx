/** Simbolul Cabinio: pagină tăiată de raza de scanare (sus actul, jos documentul). Culoarea vine din `color` (currentColor), deci urmează tema. */
export default function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M16 6h24l12 12v9H12V10a4 4 0 0 1 4-4ZM25.5 14.5a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0ZM21 27a9 6 0 0 1 18 0ZM2 30h60v4H2ZM12 37h40v17a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4ZM19 42h26v4H19ZM19 49h18v4H19Z"
      />
    </svg>
  )
}
