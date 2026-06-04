import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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

const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive");
provider.addScope("https://www.googleapis.com/auth/documents");
provider.setCustomParameters({ prompt: "select_account" });

export async function signIn(): Promise<{ user: User; accessToken: string }> {
  const result    = await signInWithPopup(auth, provider);
  const cred      = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = cred?.accessToken ?? "";
  return { user: result.user, accessToken };
}

export const signOut = () => fbSignOut(auth);
export { onAuthStateChanged };
