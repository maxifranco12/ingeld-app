import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const API = import.meta.env.VITE_API_URL ?? ''

export function Perfil() {
  const { user, token, logout } = useAuth()
  const navigate = useNavigate()
  const [favCount, setFavCount] = useState(0)
  const [posCount, setPosCount] = useState(0)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwdErr, setPwdErr] = useState<string | null>(null)
  const [pwdOk, setPwdOk] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)

  const loadProfile = useCallback(async () => {
    if (!token) return
    const res = await fetch(`${API}/api/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const j = (await res.json()) as {
      favoritos: string[]
      portfolio: unknown[]
    }
    setFavCount(Array.isArray(j.favoritos) ? j.favoritos.length : 0)
    setPosCount(Array.isArray(j.portfolio) ? j.portfolio.length : 0)
  }, [token])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwdErr(null)
    setPwdOk(false)
    if (newPw.length < 8) {
      setPwdErr('La nueva contraseña debe tener al menos 8 caracteres')
      return
    }
    if (newPw !== confirmPw) {
      setPwdErr('Las contraseñas no coinciden')
      return
    }
    if (!token) return
    setPwdLoading(true)
    try {
      const res = await fetch(`${API}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_password: currentPw,
          new_password: newPw,
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
      setPwdOk(true)
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      setPwdOpen(false)
    } catch (e) {
      setPwdErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setPwdLoading(false)
    }
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="perfil-page">
      <h1 className="dash-zone-title">Mi perfil</h1>
      <div className="perfil-card">
        <p className="font-prose">
          <strong>Usuario:</strong> {user.username}
        </p>
        <p className="font-prose">
          <strong>Email:</strong> {user.email}
        </p>
        <p className="font-prose">
          <strong>Plan:</strong>{' '}
          {user.plan === 'pro' ? 'Pro' : 'Free'}
        </p>
        <div className="perfil-stats font-prose">
          <p>Favoritos guardados: {favCount}</p>
          <p>Posiciones en portfolio: {posCount}</p>
        </div>
        <div className="perfil-actions">
          <button
            type="button"
            className="activo-fund-ia-btn"
            onClick={() => {
              setPwdOpen(true)
              setPwdErr(null)
              setPwdOk(false)
            }}
          >
            Cambiar contraseña
          </button>
          <button
            type="button"
            className="auth-btn auth-btn--ghost"
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      {pwdOpen ? (
        <div className="perfil-modal-overlay" role="presentation">
          <div className="perfil-modal" role="dialog" aria-modal="true">
            <h2 className="font-prose">Cambiar contraseña</h2>
            <form onSubmit={handleChangePassword} className="auth-form">
              <label className="font-prose">
                Contraseña actual
                <input
                  className="auth-input ingeld-input"
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  required
                />
              </label>
              <label className="font-prose">
                Nueva contraseña
                <input
                  className="auth-input ingeld-input"
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  minLength={8}
                  required
                />
              </label>
              <label className="font-prose">
                Confirmar nueva contraseña
                <input
                  className="auth-input ingeld-input"
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  required
                />
              </label>
              {pwdErr ? <p className="auth-error font-prose">{pwdErr}</p> : null}
              {pwdOk ? (
                <p className="auth-success font-prose">Contraseña actualizada</p>
              ) : null}
              <div className="perfil-modal-actions">
                <button type="submit" className="auth-btn" disabled={pwdLoading}>
                  {pwdLoading ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  className="auth-link-btn font-prose"
                  onClick={() => setPwdOpen(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
