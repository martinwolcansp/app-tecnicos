import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import type { Rol } from '../lib/types'

/**
 * Bloquea el acceso a sus hijos salvo que haya sesión activa Y el perfil
 * tenga uno de los roles permitidos. Redirige a /login si no hay sesión, o
 * a "/" (que a su vez resuelve según rol) si el rol no alcanza.
 */
export function ProtectedRoute({
  roles,
  children,
}: {
  roles: Rol[]
  children: ReactNode
}) {
  const { session, profile, loading, error } = useAuth()

  if (loading) {
    return <div className="page-loading">Cargando…</div>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (error) {
    return (
      <div className="page">
        <div className="alert alert-error">{error}</div>
      </div>
    )
  }

  if (!profile || !roles.includes(profile.rol)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
