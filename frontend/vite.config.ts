import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Catalogul alertelor stă la rădăcina repo-ului (îl citește și serverul, iar deploy-ul funcțiilor ignoră frontend/):
  // serverul de dezvoltare are voie să servească doar acest fișier din afara frontend/.
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../alerte_catalog.json'] } },
  // Bibliotecile încărcate doar la nevoie (previzualizarea PDF/Word) se pregătesc de la pornire: altfel, la prima
  // folosire, serverul de dezvoltare le descoperă și reîncarcă toată pagina (pierzând starea, ex. un tur în curs).
  optimizeDeps: { include: ['pdfjs-dist', 'docx-preview'] },
})
