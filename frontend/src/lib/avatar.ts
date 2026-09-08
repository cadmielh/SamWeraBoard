// Extras din ClientView.tsx (era privat acolo) — sursă unică pentru inițiale
// și culoarea avatarului, refolosită de ClientView și TaskCard.

export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

const AVATAR_PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#0ea5e9', '#d97706', '#16a34a']

export function getAvatarColor(seed: string): string {
  let h = 0
  for (const ch of seed) h = ((h << 5) - h) + ch.charCodeAt(0)
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]
}
