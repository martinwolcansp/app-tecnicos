import { Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'

export function TecnicoLayout() {
  const { profile, signOut } = useAuth()

  return (
    <div className="tecnico-shell">
      <header className="tecnico-header">
        <strong>App Técnicos</strong>
        <div className="tecnico-header-user">
          <span>{profile?.nombre}</span>
          <button className="btn-link" onClick={signOut}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <main className="tecnico-content">
        <Outlet />
      </main>
    </div>
  )
}
