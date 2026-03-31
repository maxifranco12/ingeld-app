import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { TickerTape } from './TickerTape'

const nav: { to: string; label: string; end?: boolean }[] = [
  { to: '/panel', label: 'Panel', end: true },
  { to: '/buscador', label: 'Buscador' },
  { to: '/scanner', label: 'Scanner' },
  { to: '/favoritos', label: 'Favoritos' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/alertas', label: 'Alertas' },
  { to: '/analisis', label: 'Análisis' },
  { to: '/comparador', label: 'Comparador' },
]

export function Layout() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/panel" className="brand" end>
          <span className="brand-mark">INGELD</span>
          <span className="brand-tag">Financial Assistant</span>
        </NavLink>
        <div className="header-trailing">
          <nav className="nav" aria-label="Principal">
            {nav.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={Boolean(end)}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/configuracion"
            className={({ isActive }) =>
              ['config-icon', isActive ? 'active' : ''].filter(Boolean).join(' ')
            }
            aria-label="Configuración"
            title="Configuración"
          >
            ⚙
          </NavLink>
          {isAuthenticated && user ? (
            <div className="header-user-wrap" ref={menuRef}>
              <button
                type="button"
                className="header-user-btn font-prose"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
              >
                {user.username}
                {isAdmin ? <span className="header-admin-badge">ADMIN</span> : null}
                <span className="header-user-caret" aria-hidden>
                  ▾
                </span>
              </button>
              {menuOpen ? (
                <div className="header-user-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="header-user-menu-item font-prose"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/historial')
                    }}
                  >
                    Mi historial
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="header-user-menu-item font-prose"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/perfil')
                    }}
                  >
                    Mi perfil
                  </button>
                  <div className="header-user-sep" />
                  {isAdmin ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="header-user-menu-item font-prose"
                      onClick={() => {
                        setMenuOpen(false)
                        navigate('/admin')
                      }}
                    >
                      Admin
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className="header-user-menu-item font-prose"
                    onClick={() => {
                      setMenuOpen(false)
                      logout()
                      navigate('/login')
                    }}
                  >
                    Cerrar sesión
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="header-auth-btns">
              <NavLink to="/login" className="header-auth-link font-prose">
                Iniciar sesión
              </NavLink>
              <NavLink to="/register" className="header-auth-register font-prose">
                Registrarse
              </NavLink>
            </div>
          )}
        </div>
      </header>
      <TickerTape />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
