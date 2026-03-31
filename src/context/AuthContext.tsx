import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const TOKEN_KEY = 'ingeld_token'
const API = import.meta.env.VITE_API_URL ?? ''

function parseApiError(text: string): string {
  try {
    const j = JSON.parse(text) as { detail?: unknown }
    const d = j.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d))
      return d
        .map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: string }).msg) : String(x)))
        .join(', ')
  } catch {
    /* noop */
  }
  return text
}

export interface AuthUser {
  id: number
  email: string
  username: string
  is_admin: boolean
  plan: string
}

interface AuthContextType {
  user: AuthUser | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
  isAdmin: boolean
  loading: boolean
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(() => readToken())
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    const t = readToken()
    if (!t) {
      setUser(null)
      setToken(null)
      return
    }
    try {
      const res = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY)
        setToken(null)
        setUser(null)
        return
      }
      const u = (await res.json()) as AuthUser
      setUser({
        id: u.id,
        email: u.email,
        username: u.username,
        is_admin: Boolean(u.is_admin),
        plan: u.plan ?? 'free',
      })
      setToken(t)
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      setToken(null)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      await refreshUser()
      setLoading(false)
    })()
  }, [refreshUser])

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(t || `HTTP ${res.status}`)
    }
    const j = (await res.json()) as { token: string; user: AuthUser }
    localStorage.setItem(TOKEN_KEY, j.token)
    setToken(j.token)
    setUser({
      id: j.user.id,
      email: j.user.email,
      username: j.user.username,
      is_admin: Boolean(j.user.is_admin),
      plan: j.user.plan ?? 'free',
    })
  }, [])

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      const res = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(parseApiError(t) || `HTTP ${res.status}`)
      }
      const j = (await res.json()) as { token: string; user: AuthUser }
      localStorage.setItem(TOKEN_KEY, j.token)
      setToken(j.token)
      setUser({
        id: j.user.id,
        email: j.user.email,
        username: j.user.username,
        is_admin: Boolean(j.user.is_admin),
        plan: j.user.plan ?? 'free',
      })
    },
    [],
  )

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      token,
      login,
      register,
      logout,
      isAuthenticated: Boolean(user && token),
      isAdmin: Boolean(user?.is_admin),
      loading,
      refreshUser,
    }),
    [user, token, login, register, logout, loading, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth dentro de AuthProvider')
  return ctx
}

export function getStoredToken(): string | null {
  return readToken()
}
