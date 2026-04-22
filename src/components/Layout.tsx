import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { TickerTape } from './TickerTape'

const navBeforePf: { to: string; label: string; end?: boolean }[] = [
  { to: '/panel', label: 'Panel', end: true },
  { to: '/buscador', label: 'Buscador' },
  { to: '/stock-lab', label: 'Stock Lab' },
  { to: '/scanner', label: 'Scanner' },
  { to: '/favoritos', label: 'Favoritos' },
]

const navAfterPf: { to: string; label: string; end?: boolean }[] = [
  { to: '/alertas', label: 'Alertas' },
  { to: '/analisis', label: 'Análisis' },
  { to: '/portfolios-ia', label: 'Portfolios IA' },
  { to: '/idea-semanal', label: '💡 Idea' },
  { to: '/comparador', label: 'Comparador' },
]

const PF_ROUTES = ['/portfolio', '/metas', '/networth']

export function Layout() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pfOpen, setPfOpen] = useState(false)
  const pfRef = useRef<HTMLDivElement>(null)
  const pfNavActive = PF_ROUTES.some((p) => loc.pathname === p || loc.pathname.startsWith(`${p}/`))

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
      if (!pfRef.current?.contains(e.target as Node)) setPfOpen(false)
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
            {navBeforePf.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={Boolean(end)}
                className={({ isActive }) =>
                  ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
                }
              >
                {label}
              </NavLink>
            ))}
            <div className="nav-dropdown" ref={pfRef}>
              <button
                type="button"
                className={['nav-link', pfNavActive ? 'active' : ''].filter(Boolean).join(' ')}
                aria-expanded={pfOpen}
                aria-haspopup="true"
                onClick={() => setPfOpen((v) => !v)}
              >
                Portfolio <span aria-hidden>▾</span>
              </button>
              {pfOpen ? (
                <div className="nav-dropdown-menu" role="menu">
                  <NavLink
                    to="/portfolio"
                    className={({ isActive }) =>
                      ['nav-dropdown-item', isActive ? 'active' : '']
                        .filter(Boolean)
                        .join(' ')
                    }
                    role="menuitem"
                    onClick={() => setPfOpen(false)}
                  >
                    Mi Portfolio
                  </NavLink>
                  <NavLink
                    to="/metas"
                    className={({ isActive }) =>
                      ['nav-dropdown-item', isActive ? 'active' : '']
                        .filter(Boolean)
                        .join(' ')
                    }
                    role="menuitem"
                    onClick={() => setPfOpen(false)}
                  >
                    Metas
                  </NavLink>
                  <NavLink
                    to="/networth"
                    className={({ isActive }) =>
                      ['nav-dropdown-item', isActive ? 'active' : '']
                        .filter(Boolean)
                        .join(' ')
                    }
                    role="menuitem"
                    onClick={() => setPfOpen(false)}
                  >
                    Patrimonio Neto
                  </NavLink>
                </div>
              ) : null}
            </div>
            {navAfterPf.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={Boolean(end)}
                className={({ isActive }) =>
                  ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
                }
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
