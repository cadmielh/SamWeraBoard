import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

// Istoricul păstrează DOAR metadate (nume fișier/sursă și moment) — niciodată datele
// personale extrase (CNP, serie CI, adresă etc.): acelea nu au ce căuta în afara
// vault-ului criptat. Regulile Firestore refuză scrierea altor câmpuri.
const EXTRACTION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function logExtraction(uid: string, sourceFile: string): Promise<void> {
  await addDoc(collection(db, 'users', uid, 'extractions'), {
    createdAt: serverTimestamp(),
    sourceFile,
    expireAt: new Date(Date.now() + EXTRACTION_TTL_MS),
  })
}
