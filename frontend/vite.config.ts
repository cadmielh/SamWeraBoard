import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Catalogul alertelor stă la rădăcina repo-ului (îl citește și serverul, iar deploy-ul funcțiilor ignoră frontend/):
  // serverul de dezvoltare are voie să servească doar acest fișier din afara frontend/.
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../alerte_catalog.json'] } },
})
