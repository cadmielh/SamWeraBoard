import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './AppLayout'
import GenerareDocumentePage from './pages/GenerareDocumentePage'
import WorkspaceSetupPage from './pages/WorkspaceSetupPage'
import ClientiPage from './pages/ClientiPage'
import MembriPage from './pages/MembriPage'
import SetariPage from './pages/SetariPage'
import DosarePage from './pages/DosarePage'
import SarciniPage from './pages/SarciniPage'

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
        </Route>
        <Route path="/signin" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
