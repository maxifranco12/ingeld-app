import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const API = import.meta.env.VITE_API_URL ?? ''

type GoalRow = {
  id: number
  nombre: string
  monto_objetivo: number
  monto_actual: number
  moneda: string
  fecha_objetivo: string | null
  color: string
  created_at: string | null
}

export function Metas() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<GoalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<GoalRow | null>(null)
  const [form, setForm] = useState({
    nombre: '',
    monto_objetivo: '',
    monto_actual: '',
    moneda: 'USD',
    fecha_objetivo: '',
    color: '#00a87a',
  })

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`${API}/api/auth/metas`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { items: GoalRow[] }
      setItems(j.items ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true })
      return
    }
    void load()
  }, [token, navigate, load])

  const openNew = () => {
    setEditing(null)
    setForm({
      nombre: '',
      monto_objetivo: '',
      monto_actual: '0',
      moneda: 'USD',
      fecha_objetivo: '',
      color: '#00a87a',
    })
    setModal(true)
  }

  const openEdit = (g: GoalRow) => {
    setEditing(g)
    setForm({
      nombre: g.nombre,
      monto_objetivo: String(g.monto_objetivo),
      monto_actual: String(g.monto_actual),
      moneda: g.moneda,
      fecha_objetivo: g.fecha_objetivo ? g.fecha_objetivo.slice(0, 10) : '',
      color: g.color,
    })
    setModal(true)
  }

  const saveGoal = async () => {
    if (!token) return
    const mo = parseFloat(form.monto_objetivo)
    const ma = parseFloat(form.monto_actual)
    if (!form.nombre.trim() || Number.isNaN(mo) || mo <= 0) return
    try {
      if (editing) {
        const res = await fetch(`${API}/api/auth/metas/${editing.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            nombre: form.nombre.trim(),
            monto_objetivo: mo,
            monto_actual: Number.isNaN(ma) ? 0 : ma,
            moneda: form.moneda,
            fecha_objetivo: form.fecha_objetivo || null,
            color: form.color,
          }),
        })
        if (!res.ok) throw new Error(await res.text())
      } else {
        const res = await fetch(`${API}/api/auth/metas`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            nombre: form.nombre.trim(),
            monto_objetivo: mo,
            monto_actual: Number.isNaN(ma) ? 0 : ma,
            moneda: form.moneda,
            fecha_objetivo: form.fecha_objetivo || null,
            color: form.color,
          }),
        })
        if (!res.ok) throw new Error(await res.text())
      }
      setModal(false)
      void load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    }
  }

  const updateProgress = async (g: GoalRow) => {
    const raw = window.prompt('Nuevo monto actual', String(g.monto_actual))
    if (raw == null) return
    const v = parseFloat(raw)
    if (Number.isNaN(v) || v < 0) return
    if (!token) return
    try {
      const res = await fetch(`${API}/api/auth/metas/${g.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ monto_actual: v }),
      })
      if (!res.ok) throw new Error(await res.text())
      void load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    }
  }

  const remove = async (id: number) => {
    if (!token || !window.confirm('¿Eliminar esta meta?')) return
    try {
      const res = await fetch(`${API}/api/auth/metas/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      void load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    }
  }

  return (
    <div className="metas-page">
      <div className="metas-page-head">
        <h1 className="page-title">Metas financieras</h1>
        <button type="button" className="portfolio-add-btn" onClick={openNew}>
          + Nueva meta
        </button>
      </div>
      <p className="page-sub font-prose">
        Definí objetivos y seguí el progreso respecto de tu cartera.
      </p>
      {err ? <div className="error-state">{err}</div> : null}
      {loading ? (
        <p className="page-sub">Cargando…</p>
      ) : (
        <div className="metas-grid">
          {items.map((g) => {
            const pct = g.monto_objetivo > 0 ? Math.min(100, (g.monto_actual / g.monto_objetivo) * 100) : 0
            let daysLeft: number | null = null
            if (g.fecha_objetivo) {
              const end = new Date(g.fecha_objetivo).getTime()
              daysLeft = Math.ceil((end - Date.now()) / (86400 * 1000))
            }
            return (
              <article key={g.id} className="goal-card" style={{ borderColor: g.color }}>
                <h2 className="goal-card-title">{g.nombre}</h2>
                <div className="goal-progress-wrap">
                  <div className="goal-progress-bar">
                    <div
                      className="goal-progress-fill"
                      style={{ width: `${pct}%`, background: g.color }}
                    />
                  </div>
                  <p className="goal-pct font-prose">{pct.toFixed(1)}% completado</p>
                </div>
                <p className="goal-amounts font-prose">
                  {g.monto_actual.toLocaleString('es-AR', { maximumFractionDigits: 2 })} /{' '}
                  {g.monto_objetivo.toLocaleString('es-AR', { maximumFractionDigits: 2 })}{' '}
                  {g.moneda}
                </p>
                {daysLeft != null && (
                  <p className="goal-days font-prose">
                    {daysLeft >= 0 ? `${daysLeft} días restantes` : 'Fecha objetivo pasada'}
                  </p>
                )}
                <div className="goal-actions">
                  <button type="button" className="portfolio-refresh-btn" onClick={() => updateProgress(g)}>
                    Actualizar progreso
                  </button>
                  <button type="button" className="portfolio-refresh-btn" onClick={() => openEdit(g)}>
                    Editar
                  </button>
                  <button type="button" className="portfolio-remove" onClick={() => remove(g.id)}>
                    Eliminar
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {modal && (
        <div className="ingeld-modal-overlay" role="dialog" aria-modal="true">
          <div className="ingeld-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h2 className="ingeld-modal-title">{editing ? 'Editar meta' : 'Nueva meta'}</h2>
            <label className="ingeld-modal-field">
              Nombre
              <input
                className="ingeld-input"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Monto objetivo
              <input
                type="number"
                className="ingeld-input"
                value={form.monto_objetivo}
                onChange={(e) => setForm((f) => ({ ...f, monto_objetivo: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Monto actual
              <input
                type="number"
                className="ingeld-input"
                value={form.monto_actual}
                onChange={(e) => setForm((f) => ({ ...f, monto_actual: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Moneda
              <select
                className="ingeld-input"
                value={form.moneda}
                onChange={(e) => setForm((f) => ({ ...f, moneda: e.target.value }))}
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
            </label>
            <label className="ingeld-modal-field">
              Fecha objetivo (opcional)
              <input
                type="date"
                className="ingeld-input"
                value={form.fecha_objetivo}
                onChange={(e) => setForm((f) => ({ ...f, fecha_objetivo: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Color
              <input
                type="color"
                className="ingeld-input"
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              />
            </label>
            <div className="ingeld-modal-actions">
              <button type="button" onClick={() => setModal(false)}>
                Cancelar
              </button>
              <button type="button" className="ingeld-modal-primary" onClick={() => void saveGoal()}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
