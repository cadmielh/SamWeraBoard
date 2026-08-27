// Limitele săptămânii curente (convenție ISO — luni 00:00 local), folosite
// identic de board (coloana Finalizat) și de arhivă, ca ambele praguri să fie
// mereu sincronizate — un card e "pe board" dacă completedAt >= startOfWeek(),
// altfel e "în arhivă".

/** Luni, ora 00:00:00, a săptămânii care conține `d`. */
export function startOfWeek(d: Date = new Date()): Date {
  const day = d.getDay()             // 0=duminică..6=sâmbătă
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

/** Luni, ora 00:00:00, a săptămânii următoare (limită exclusivă). */
export function endOfWeek(d: Date = new Date()): Date {
  const start = startOfWeek(d)
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
}
