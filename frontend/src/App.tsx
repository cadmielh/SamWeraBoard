import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AppLayout from './AppLayout'
import ClientiPage from './pages/ClientiPage'
import {
  DosarePage, GenerareDocumentePage, MembriPage, SarciniPage, SetariPage, SuperAdminPage, WorkspaceSetupPage,
} from './routes'
import { TermeniPage, ConfidentialitatePage, DpaPage, SubImputernicitiPage, SecuritatePage } from './pages/legal/LegalPages'

/** /abonament s-a mutat în Setări. Parametrii rămân (?checkout=success&session_id=… vin de la Stripe, pe adresa veche). */
function AbonamentRedirect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/setari/plan', search }} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          {/* Pagina de start rămâne în pachetul principal: e prima afișată după autentificare. */}
          <Route index element={<ClientiPage />} />
          <Route path="dosare" element={<DosarePage />} />
          <Route path="sarcini" element={<SarciniPage />} />
          <Route path="extragere" element={<GenerareDocumentePage />} />
          <Route path="workspace/setup" element={<WorkspaceSetupPage />} />
          <Route path="utilizatori" element={<MembriPage />} />
          <Route path="setari" element={<SetariPage />} />
          <Route path="setari/:sectiune" element={<SetariPage />} />
          <Route path="abonament" element={<AbonamentRedirect />} />
          <Route path="super-admin" element={<SuperAdminPage />} />
        </Route>
        {/* Pagini legale publice — în afara AppLayout, accesibile fără autentificare */}
        <Route path="/termeni" element={<TermeniPage />} />
        <Route path="/confidentialitate" element={<ConfidentialitatePage />} />
        <Route path="/dpa" element={<DpaPage />} />
        <Route path="/sub-imputerniciti" element={<SubImputernicitiPage />} />
        <Route path="/securitate" element={<SecuritatePage />} />
        <Route path="/signin" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
