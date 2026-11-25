/** Adresele serverului, fără nimic din Firebase: le folosesc și paginile publice (portalul clientului). */
export const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";
// OCR calls go directly to Cloud Run to bypass Firebase Hosting's 60s proxy timeout
export const OCR_BASE = import.meta.env.VITE_OCR_BASE ?? BASE;
/** Încărcările și descărcările de documente merg direct la funcția dedicată `documente` (main.py), cu mai multe transferuri
 * pe instanță, fără plafonul de timp al Hosting-ului. Fără VITE_FILES_BASE (dezvoltare locală): același server ca OCR-ul. */
export const FILES_BASE = import.meta.env.VITE_FILES_BASE ?? OCR_BASE;
