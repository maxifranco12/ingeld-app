import { useState } from 'react'
import { Link } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL ?? ''

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [step, setStep] = useState<'email' | 'reset'>('email')
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setOk(null)
    setPending(true)
    try {
      const res = await fetch(`${API}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      setOk('Si el email está registrado, recibirás un código en breve.')
      setStep('reset')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setPending(false)
    }
  }

  const resetPw = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setOk(null)
    if (code.trim().length !== 6) {
      setErr('El código tiene 6 dígitos')
      return
    }
    if (newPassword.length < 8) {
      setErr('La nueva contraseña debe tener al menos 8 caracteres')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
          new_password: newPassword,
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        let msg = t
        try {
          const j = JSON.parse(t) as { detail?: string }
          if (j.detail) msg = j.detail
        } catch {
          /* noop */
        }
        throw new Error(msg)
      }
      setOk('Contraseña actualizada. Podés iniciar sesión.')
      setStep('email')
      setCode('')
      setNewPassword('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">INGELD</div>
        <p className="auth-tagline font-prose">Recuperar contraseña</p>

        {step === 'email' ? (
          <form className="auth-form" onSubmit={sendCode}>
            <label className="font-prose">
              Email
              <input
                className="auth-input ingeld-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            {err ? <p className="auth-error font-prose">{err}</p> : null}
            {ok ? <p className="auth-success font-prose">{ok}</p> : null}
            <button type="submit" className="auth-btn" disabled={pending}>
              {pending ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={resetPw}>
            <p className="font-prose page-sub">Email: {email}</p>
            <label className="font-prose">
              Código de 6 dígitos
              <input
                className="auth-input ingeld-input"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
            </label>
            <label className="font-prose">
              Nueva contraseña
              <input
                className="auth-input ingeld-input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            {err ? <p className="auth-error font-prose">{err}</p> : null}
            {ok ? <p className="auth-success font-prose">{ok}</p> : null}
            <button type="submit" className="auth-btn" disabled={pending}>
              {pending ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
            <button
              type="button"
              className="auth-link-btn font-prose"
              onClick={() => {
                setStep('email')
                setErr(null)
              }}
            >
              Volver
            </button>
          </form>
        )}

        <p className="auth-links font-prose">
          <Link className="auth-link" to="/login">
            Volver al inicio de sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
