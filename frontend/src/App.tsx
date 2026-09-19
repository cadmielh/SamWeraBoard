import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './AppLayout'
import GenerareDocumentePage from './pages/GenerareDocumentePage'
import WorkspaceSetupPage from './pages/WorkspaceSetupPage'
import ClientiPage from './pages/ClientiPage'
import MembriPage from './pages/MembriPage'
import SetariPage from './pages/SetariPage'
import DosarePage from './pages/DosarePage'
import SarciniPage from './pages/SarciniPage'
import SuperAdminPage from './pages/SuperAdminPage'
import { TermeniPage, ConfidentialitatePage, DpaPage, SubImputernicitiPage, SecuritatePage } from './pages/legal/LegalPages'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<ClientiPage />} />
          <Route path="dosare" element={<DosarePage />} />
          <Route path="sarcini" element={<SarciniPage />} />
          <Route path="extragere" element={<GenerareDocumentePage />} />
          <Route path="workspace/setup" element={<WorkspaceSetupPage />} />
          <Route path="utilizatori" element={<MembriPage />} />
          <Route path="setari" element={<SetariPage />} />
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
