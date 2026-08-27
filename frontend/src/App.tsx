import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Login } from './pages/Login'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminFormularios } from './pages/admin/AdminFormularios'
import { AdminFormularioEditor } from './pages/admin/AdminFormularioEditor'
import { AdminEnvios } from './pages/admin/AdminEnvios'
import { AdminEnvioDetalle } from './pages/admin/AdminEnvioDetalle'
import { AdminUsuarios } from './pages/admin/AdminUsuarios'
import { TecnicoLayout } from './pages/tecnico/TecnicoLayout'
import { TecnicoFormularios } from './pages/tecnico/TecnicoFormularios'
import { TecnicoWizard } from './pages/tecnico/TecnicoWizard'
import './App.css'
import './styles/app.css'

/** "/" no renderiza nada propio: solo decide a dónde mandar según el rol. */
function Inicio() {
  const { loading, profile } = useAuth()

  if (loading) return <div className="page-loading">Cargando…</div>
  if (!profile) return <Navigate to="/login" replace />
  if (profile.rol === 'tecnico') return <Navigate to="/tecnico" replace />
  return <Navigate to="/admin/formularios" replace />
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Inicio />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['administrador', 'superadministrador']}>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="formularios" replace />} />
            <Route path="formularios" element={<AdminFormularios />} />
            <Route path="formularios/:formId" element={<AdminFormularioEditor />} />
            <Route path="formularios/:formId/probar" element={<TecnicoWizard modoPrueba />} />
            <Route path="envios" element={<AdminEnvios />} />
            <Route path="envios/:submissionId" element={<AdminEnvioDetalle />} />
            <Route path="usuarios" element={<AdminUsuarios />} />
          </Route>

          <Route
            path="/tecnico"
            element={
              <ProtectedRoute roles={['tecnico']}>
                <TecnicoLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<TecnicoFormularios />} />
            <Route path="formulario/:formId" element={<TecnicoWizard />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
