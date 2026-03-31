import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function Register() {
  const { register, isAuthenticated, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!loading && isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!EMAIL_RE.test(email.trim())) {
      setErr('Ingresá un email válido')
      return
    }
    const u = username.trim()
    if (u.length < 3 || u.length > 20) {
      setErr('El usuario debe tener entre 3 y 20 caracteres')
      return
    }
    if (!/^[a-zA-Z0-9_]+$/.test(u)) {
      setErr('Usuario: solo letras, números y guión bajo')
      return
    }
    if (password.length < 8) {
      setErr('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (password !== confirm) {
      setErr('Las contraseñas no coinciden')
      return
    }
    if (!accepted) {
      setErr('Debés aceptar el aviso legal para continuar')
      return
    }
    setPending(true)
    try {
      await register(email.trim(), u, password)
      navigate('/', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo registrar')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">INGELD</div>
        <p className="auth-tagline font-prose">Crear cuenta</p>
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
            Usuario (3–20 caracteres)
            <input
              className="auth-input ingeld-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              maxLength={20}
              required
            />
          </label>
          <label className="font-prose">
            Contraseña
            <input
              className="auth-input ingeld-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="font-prose">
            Confirmar contraseña
            <input
              className="auth-input ingeld-input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
          <label className="auth-checkbox font-prose">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />{' '}
            Acepto que este análisis es informativo y no constituye asesoramiento
            financiero
          </label>
          {err ? <p className="auth-error font-prose">{err}</p> : null}
          <button type="submit" className="auth-btn" disabled={pending}>
            {pending ? 'Creando…' : 'Crear cuenta'}
          </button>
        </form>
        <p className="auth-links font-prose">
          <Link className="auth-link" to="/login">
            ¿Ya tenés cuenta? Iniciá sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
