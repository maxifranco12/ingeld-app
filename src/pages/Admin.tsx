import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth } from '../context/AuthContext'

const API = import.meta.env.VITE_API_URL ?? ''

type Stats = {
  total_users: number
  active_last_7_days: number
  users_by_plan: Record<string, number>
  registrations_per_day: { date: string; count: number }[]
}

type UserRow = {
  id: number
  email: string
  username: string
  plan: string
  is_active: boolean
  created_at: string | null
  last_login: string | null
}

export function Admin() {
  const { token } = useAuth()
  const [tab, setTab] = useState<'dash' | 'users'>('dash')
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [planFilter, setPlanFilter] = useState<string>('')
  const [activeFilter, setActiveFilter] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)

  const authHeaders: HeadersInit = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const loadStats = useCallback(async () => {
    if (!token) return
    const res = await fetch(`${API}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(await res.text())
    setStats((await res.json()) as Stats)
  }, [token])

  const loadUsers = useCallback(async () => {
    if (!token) return
    const res = await fetch(
      `${API}/api/admin/users?page=${page}&limit=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) throw new Error(await res.text())
    const j = (await res.json()) as { users: UserRow[]; total: number }
    setUsers(j.users ?? [])
    setTotal(j.total ?? 0)
  }, [token, page])

  useEffect(() => {
    if (!token) return
    void (async () => {
      try {
        setErr(null)
        await loadStats()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error')
      }
    })()
  }, [token, loadStats])

  useEffect(() => {
    if (!token || tab !== 'users') return
    void (async () => {
      try {
        setErr(null)
        await loadUsers()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error')
      }
    })()
  }, [token, tab, loadUsers])

  const toggleActive = async (u: UserRow) => {
    if (!token) return
    if (u.is_active) {
      const res = await fetch(`${API}/api/admin/users/${u.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setErr(await res.text())
        return
      }
    } else {
      const res = await fetch(`${API}/api/admin/users/${u.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ is_active: true }),
      })
      if (!res.ok) {
        setErr(await res.text())
        return
      }
    }
    await loadUsers()
    await loadStats()
  }

  const setAdmin = async (u: UserRow, is_admin: boolean) => {
    if (!token) return
    const res = await fetch(`${API}/api/admin/users/${u.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ is_admin }),
    })
    if (!res.ok) {
      setErr(await res.text())
      return
    }
    await loadUsers()
  }

  const filteredUsers = users.filter((u) => {
    if (planFilter && u.plan !== planFilter) return false
    if (activeFilter === 'active' && !u.is_active) return false
    if (activeFilter === 'inactive' && u.is_active) return false
    return true
  })

  const chartData = (stats?.registrations_per_day ?? []).map((d) => ({
    ...d,
    dateShort: d.date.slice(5),
  }))

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1 className="dash-zone-title">
          Administración{' '}
          <span className="admin-badge">ADMIN</span>
        </h1>
      </header>
      <div className="admin-tabs">
        <button
          type="button"
          className={tab === 'dash' ? 'admin-tab active' : 'admin-tab'}
          onClick={() => setTab('dash')}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={tab === 'users' ? 'admin-tab active' : 'admin-tab'}
          onClick={() => setTab('users')}
        >
          Usuarios
        </button>
      </div>

      {err ? <div className="error-state">{err}</div> : null}

      {tab === 'dash' && stats && (
        <div className="admin-dash">
          <div className="admin-stat-grid">
            <div className="admin-stat-card">
              <span className="admin-stat-label">Total usuarios</span>
              <strong className="admin-stat-value">{stats.total_users}</strong>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-label">Activos (7 días)</span>
              <strong className="admin-stat-value">
                {stats.active_last_7_days}
              </strong>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-label">Plan Free</span>
              <strong className="admin-stat-value">
                {stats.users_by_plan.free ?? 0}
              </strong>
            </div>
            <div className="admin-stat-card">
              <span className="admin-stat-label">Plan Pro</span>
              <strong className="admin-stat-value">
                {stats.users_by_plan.pro ?? 0}
              </strong>
            </div>
          </div>
          <div className="admin-chart-wrap">
            <h3 className="admin-chart-title font-prose">Registros por día (30 días)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <XAxis dataKey="dateShort" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="admin-users">
          <div className="admin-filters font-prose">
            <label>
              Plan{' '}
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="ingeld-input"
              >
                <option value="">Todos</option>
                <option value="free">free</option>
                <option value="pro">pro</option>
              </select>
            </label>
            <label>
              Estado{' '}
              <select
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value)}
                className="ingeld-input"
              >
                <option value="">Todos</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
              </select>
            </label>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Email</th>
                  <th>Plan</th>
                  <th>Activo</th>
                  <th>Último login</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.email}</td>
                    <td>{u.plan}</td>
                    <td>{u.is_active ? 'Sí' : 'No'}</td>
                    <td>
                      {u.last_login
                        ? new Date(u.last_login).toLocaleString('es-AR')
                        : '—'}
                    </td>
                    <td className="admin-actions">
                      <button
                        type="button"
                        className="admin-mini-btn"
                        onClick={() => void toggleActive(u)}
                      >
                        {u.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        type="button"
                        className="admin-mini-btn"
                        onClick={() => void setAdmin(u, true)}
                      >
                        Admin
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="page-sub font-prose">
            Total listado: {filteredUsers.length} / API total: {total}
          </p>
          <div className="admin-pagination font-prose">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <span>Página {page}</span>
            <button type="button" onClick={() => setPage((p) => p + 1)}>
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
