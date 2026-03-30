import { NavLink, Outlet } from 'react-router-dom'
import { TickerTape } from './TickerTape'

const nav: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Panel', end: true },
  { to: '/buscador', label: 'Buscador' },
  { to: '/scanner', label: 'Scanner' },
  { to: '/favoritos', label: 'Favoritos' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/alertas', label: 'Alertas' },
  { to: '/analisis', label: 'Análisis' },
]

export function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="brand" end>
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
        </div>
      </header>
      <TickerTape />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
