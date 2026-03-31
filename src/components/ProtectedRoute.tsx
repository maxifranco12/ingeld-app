import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Admin } from '../pages/Admin'

export function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth()
  const loc = useLocation()

  if (loading) {
    return (
      <div className="auth-loading font-prose">
        <p>Cargando sesión…</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }

  return <Outlet />
}

/** Ruta /admin dentro del mismo Layout; solo is_admin. */
export function AdminOnly() {
  const { isAdmin, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-loading font-prose">
        <p>Cargando…</p>
      </div>
    )
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />
  }

  return <Admin />
}
