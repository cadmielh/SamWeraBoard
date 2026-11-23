interface Props {
  size?: number
}

/** Iconiță „reîncarcă lista” (săgeată circulară), stil consecvent cu IconExport/IconTrash. */
export default function IconRefresh({ size = 14 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  )
}
