import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Login() {
  const { login, isAuthenticated, loading } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!loading && isAuthenticated) {
    return <Navigate to={loc.state?.from ?? '/'} replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setPending(true)
    try {
      await login(email.trim(), password)
      navigate(loc.state?.from ?? '/', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo iniciar sesión')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">INGELD</div>
        <p className="auth-tagline font-prose">Financial Assistant</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="font-prose">
            Email
            <input
              className="auth-input ingeld-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="font-prose">
            Contraseña
            <input
              className="auth-input ingeld-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {err ? <p className="auth-error font-prose">{err}</p> : null}
          <button type="submit" className="auth-btn" disabled={pending}>
            {pending ? 'Ingresando…' : 'Iniciar sesión'}
          </button>
        </form>
        <p className="auth-links font-prose">
          <Link className="auth-link" to="/register">
            ¿No tenés cuenta? Registrate
          </Link>
        </p>
        <p className="auth-links font-prose">
          <Link className="auth-link" to="/forgot-password">
            ¿Olvidaste tu contraseña?
          </Link>
        </p>
      </div>
    </div>
  )
}
