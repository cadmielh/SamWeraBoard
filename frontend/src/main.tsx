import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonturi auto-găzduite (fără cereri către Google Fonts: nu trimitem IP-ul utilizatorilor către terți).
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/montserrat'
import './styles/tokens.css'
import App from './App.tsx'
import { SettingsProvider } from './SettingsContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
)
