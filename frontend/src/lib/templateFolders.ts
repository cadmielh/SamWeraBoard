/** Folderele șabloanelor proprii, organizate de adminul cabinetului (Workspace.templateFolders / templateFolderOf).
 * Un singur nivel deocamdată; `parentId` e rezervat pentru subfoldere, ca să nu fie nevoie de migrare mai târziu. */
export interface TemplateFolder {
  id: string
  name: string
  parentId?: string | null
}

export interface FolderGroup<T> {
  /** null = șabloanele fără folder */
  folder: TemplateFolder | null
  items: T[]
}

/** Grupele, în ordinea afișării: întâi șabloanele fără folder, apoi folderele, în ordinea stabilită de admin (și cele
 * goale, ca să se vadă unde poți muta). În fiecare grupă, ordinea primită (cea din Workspace.templateOrder). Un șablon
 * pus într-un folder care între timp a fost șters ajunge la „fără folder”. */
export function groupByFolder<T>(
  items: T[], keyOf: (t: T) => string, folders: TemplateFolder[] | undefined, placement: Record<string, string> | undefined,
): FolderGroup<T>[] {
  const list = folders ?? []
  const known = new Set(list.map(f => f.id))
  const folderOf = (t: T) => {
    const id = placement?.[keyOf(t)]
    return id && known.has(id) ? id : null
  }
  return [
    { folder: null, items: items.filter(t => folderOf(t) === null) },
    ...list.map(f => ({ folder: f, items: items.filter(t => folderOf(t) === f.id) })),
  ]
}

export function newFolderId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Mută un șablon într-un folder (null = scos din folder). */
export function placeInFolder(placement: Record<string, string> | undefined, key: string, folderId: string | null): Record<string, string> {
  const next = { ...(placement ?? {}) }
  if (folderId) next[key] = folderId
  else delete next[key]
  return next
}

/** Ștergerea unui folder nu șterge șabloane: ale lui ajung la „fără folder”. */
export function removeFolder(folders: TemplateFolder[], placement: Record<string, string> | undefined, id: string) {
  return {
    folders: folders.filter(f => f.id !== id),
    placement: Object.fromEntries(Object.entries(placement ?? {}).filter(([, f]) => f !== id)),
  }
}

/** Ordinea întreagă a șabloanelor proprii după o mutare într-o grupă: grupele, una după alta, cu grupa schimbată. */
export function orderAfterGroupReorder<T>(groups: FolderGroup<T>[], keyOf: (t: T) => string, changed: TemplateFolder | null, ids: string[]): string[] {
  return groups.flatMap(g => (g.folder?.id ?? null) === (changed?.id ?? null) ? ids : g.items.map(keyOf))
}
