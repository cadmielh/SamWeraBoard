import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './AppLayout'
import ExtragerePage from './pages/ExtragerePage'
import WorkspaceSetupPage from './pages/WorkspaceSetupPage'
import ClientiPage from './pages/ClientiPage'
import MembriPage from './pages/MembriPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<ClientiPage />} />
          <Route path="extragere" element={<ExtragerePage />} />
          <Route path="workspace/setup" element={<WorkspaceSetupPage />} />
          <Route path="utilizatori" element={<MembriPage />} />
        </Route>
        <Route path="/signin" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
