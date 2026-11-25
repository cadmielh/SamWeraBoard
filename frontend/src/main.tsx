import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonturi auto-găzduite (fără cereri către Google Fonts: nu trimitem IP-ul utilizatorilor către terți).
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/montserrat'
import './styles/tokens.css'
import './styles/ux.css'
import './styles/mobile.css'
import App from './App.tsx'
import { SettingsProvider } from './SettingsContext.tsx'

// Adresa publică e cabinio.ro. Adresele tehnice ale aceluiași site Firebase (Hosting nu poate redirecționa după domeniu)
// duc acolo, pe aceeași pagină; sesiunea e oricum legată de cabinio.ro (domeniul de autentificare).
const ADRESE_TEHNICE = ['cabinio.web.app', 'cabinio.firebaseapp.com']

if (ADRESE_TEHNICE.includes(window.location.hostname)) {
  const { pathname, search, hash } = window.location
  window.location.replace(`https://cabinio.ro${pathname}${search}${hash}`)
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </StrictMode>,
  )
}
