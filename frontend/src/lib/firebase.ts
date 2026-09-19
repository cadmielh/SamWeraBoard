import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { DRIVE_SCOPE } from "./drive";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// Dezvoltare locală: `VITE_USE_EMULATORS=1` emulează Auth + Firestore; se pot alege și separat
// (`VITE_USE_AUTH_EMULATOR`, `VITE_USE_FIRESTORE_EMULATOR`) — ex. Auth real Google + Firestore local.
const emuAll = import.meta.env.VITE_USE_EMULATORS === "1";
if (emuAll || import.meta.env.VITE_USE_AUTH_EMULATOR === "1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
if (emuAll || import.meta.env.VITE_USE_FIRESTORE_EMULATOR === "1") {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const provider = new GoogleAuthProvider();
// Doar `drive.file`: fișierele create de aplicație sau alese explicit de utilizator (Google Picker). Nu cere verificare
// Google (nu e permisiune sensibilă) și nu acordă acces la restul Drive-ului. Tokenul rămâne în browser.
provider.addScope(DRIVE_SCOPE);
provider.setCustomParameters({ prompt: "select_account" });

export async function signIn(): Promise<{ user: User; accessToken: string }> {
  const result    = await signInWithPopup(auth, provider);
  const cred      = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = cred?.accessToken ?? "";
  return { user: result.user, accessToken };
}

export const signOut = () => fbSignOut(auth);
export { onAuthStateChanged };
