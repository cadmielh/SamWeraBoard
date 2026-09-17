import { collection, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

export interface SuperAdminGrant {
  email: string
  used: boolean
}

function encodeEmail(email: string) {
  return email.replace(/\./g, '_DOT_').replace(/@/g, '_AT_')
}

/** Listează grant-urile de super admin existente — vizibilă din pagina de
 * super admin, permisă de regula de `read` din firestore.rules (orice super
 * admin poate lista toate). */
export async function listSuperAdminGrants(): Promise<SuperAdminGrant[]> {
  const snap = await getDocs(collection(db, 'superAdminGrants'))
  return snap.docs.map(d => ({ email: d.data().email as string, used: d.data().used === true }))
}

/** Creează un grant de super admin pentru un email — mirror al inviteMember()
 * din workspace.ts, dar pentru rolul de aplicație, nu pentru un workspace. */
export async function grantSuperAdmin(email: string, grantedByUid: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  await setDoc(doc(db, 'superAdminGrants', encodeEmail(normalizedEmail)), {
    email: normalizedEmail,
    grantedBy: grantedByUid,
    grantedAt: serverTimestamp(),
    used: false,
  })
}

/** Apelat la fiecare autentificare (mirror checkAndJoinInvitations) — dacă
 * există un grant valid, în așteptare, pentru emailul acestui user, îl
 * promovează la super admin și marchează grant-ul ca folosit. Non-blocking:
 * majoritatea userilor nu au niciun grant, deci nu fac nimic aici. */
export async function applyPendingSuperAdminGrant(uid: string, email: string): Promise<void> {
  const grantRef = doc(db, 'superAdminGrants', encodeEmail(email.trim().toLowerCase()))
  const grantSnap = await getDoc(grantRef)
  if (!grantSnap.exists() || grantSnap.data().used === true) return
  await updateDoc(doc(db, 'users', uid), { isSuperAdmin: true })
  await setDoc(grantRef, { used: true }, { merge: true })
}
