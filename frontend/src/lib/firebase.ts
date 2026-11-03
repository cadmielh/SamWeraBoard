import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  updatePassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { DRIVE_SCOPE } from "./driveAuth";

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
auth.languageCode = "ro";   // limba e-mailurilor de verificare și de resetare
export const db   = getFirestore(app);

// Dezvoltare locală: `VITE_USE_EMULATORS=1` emulează Auth + Firestore; se pot alege și separat
// (`VITE_USE_AUTH_EMULATOR`, `VITE_USE_FIRESTORE_EMULATOR`) — ex. Auth real Google + Firestore local.
const emuAll = import.meta.env.VITE_USE_EMULATORS === "1";
if (emuAll || import.meta.env.VITE_USE_AUTH_EMULATOR === "1") {
  connectAuthEmulator(auth, `http://127.0.0.1:${import.meta.env.VITE_AUTH_EMULATOR_PORT ?? 9099}`, { disableWarnings: true });
}
if (emuAll || import.meta.env.VITE_USE_FIRESTORE_EMULATOR === "1") {
  connectFirestoreEmulator(db, "127.0.0.1", Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? 8080));
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

export async function signInPassword(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
}

/** Contul e creat de la primul pas. Numele și e-mailul de verificare nu îl blochează: ecranul de verificare permite retrimiterea. */
export async function registerPassword(name: string, email: string, password: string): Promise<void> {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(user, { displayName: name }).catch(() => {});
  await sendEmailVerification(user).catch(() => {});
}

export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email);
export const resendVerification = (user: User) => sendEmailVerification(user);

/** Cere parola curentă chiar și într-o sesiune recentă: o sesiune rămasă deschisă nu trebuie să poată schimba parola. */
export async function changePassword(user: User, current: string, next: string): Promise<void> {
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? "", current));
  await updatePassword(user, next);
}

/** Autentificare din nou înaintea unei ștergeri definitive: cu parola, dacă e dată, altfel cu Google. */
export async function reauthenticate(user: User, password?: string): Promise<void> {
  if (password !== undefined) await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? "", password));
  else await reauthenticateWithPopup(user, provider);
  await user.getIdToken(true);   // serverul verifică momentul autentificării din token
}

export const signOut = () => fbSignOut(auth);
export { onAuthStateChanged };
