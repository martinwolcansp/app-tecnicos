import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'

export function AdminLayout() {
  const { profile, signOut } = useAuth()

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-header">
          <strong>App Técnicos</strong>
          <span className="badge badge-admin">Administrador</span>
          <div className="app-sidebar-usuario">
            <span>{profile?.nombre}</span>
            <button className="btn-link" onClick={signOut}>
              Cerrar sesión
            </button>
          </div>
        </div>

        <nav className="app-nav">
          <NavLink to="/admin/formularios" className={({ isActive }) => (isActive ? 'active' : '')}>
            Formularios
          </NavLink>
          <NavLink to="/admin/envios" className={({ isActive }) => (isActive ? 'active' : '')}>
            Envíos
          </NavLink>
          <NavLink to="/admin/usuarios" className={({ isActive }) => (isActive ? 'active' : '')}>
            Usuarios
          </NavLink>
        </nav>
      </aside>

      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
