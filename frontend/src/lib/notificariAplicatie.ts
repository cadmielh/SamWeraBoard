import { useCallback, useEffect, useState } from 'react'
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore'
import { db } from './firebase'

/** Notificările „de aplicație” pentru super admini (superadmin_alerte.py): bani, cabinete, conversie, facturare. */
export type CategorieAplicatie = 'bani' | 'cabinete' | 'conversie' | 'facturare'
export interface NotificareAplicatie {
  id: string
  categorie: CategorieAplicatie
  severitate: 'info' | 'atentie' | 'urgent'
  titlu: string
  text: string
  link: string
  workspaceId: string | null
  creatLa: Date | null
}

const LIMITA = 60

/** Ultimele notificări de aplicație și momentul până la care super adminul le-a văzut (`users/{uid}.superAdminCititeLa`).
 *  `enabled` = false (nu e super admin): nicio citire. */
export function useNotificariAplicatie(enabled: boolean, uid: string | null) {
  const [notificari, setNotificari] = useState<NotificareAplicatie[]>([])
  const [cititeLa, setCititeLa] = useState<Date | null>(null)

  useEffect(() => {
    if (!enabled) return
    const q = query(collection(db, 'superAdminNotificari'), orderBy('creatLa', 'desc'), limit(LIMITA))
    return onSnapshot(q, snap => setNotificari(snap.docs.map(d => {
      const x = d.data()
      return {
        id: d.id, categorie: x.categorie, severitate: x.severitate ?? 'info', titlu: x.titlu ?? '', text: x.text ?? '',
        link: x.link ?? '/super-admin', workspaceId: x.workspaceId ?? null, creatLa: (x.creatLa as Timestamp | undefined)?.toDate() ?? null,
      }
    })), () => setNotificari([]))
  }, [enabled])

  useEffect(() => {
    if (!enabled || !uid) return
    return onSnapshot(doc(db, 'users', uid), snap => {
      const t = snap.data()?.superAdminCititeLa as Timestamp | undefined
      setCititeLa(t?.toDate() ?? null)
    }, () => {})
  }, [enabled, uid])

  /** Marchează ca văzute toate notificările de până acum (inclusiv în celelalte file/dispozitive). */
  const marcheazaCitite = useCallback(async () => {
    if (!uid) return
    setCititeLa(new Date())
    await setDoc(doc(db, 'users', uid), { superAdminCititeLa: serverTimestamp() }, { merge: true }).catch(() => {})
  }, [uid])

  const esteNoua = (n: NotificareAplicatie) => !!n.creatLa && (!cititeLa || n.creatLa > cititeLa)
  return { notificari: enabled ? notificari : [], esteNoua, marcheazaCitite }
}
