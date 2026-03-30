import { useCallback, useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL ?? ''

type Alerta = {
  id: string
  ticker: string
  tipo: string
  valor: number
  estado: string
}

const TIPOS: { id: string; label: string }[] = [
  { id: 'precio_sube', label: 'Precio ≥ umbral' },
  { id: 'precio_baja', label: 'Precio ≤ umbral' },
  { id: 'sube_pct', label: 'Sube % día ≥' },
  { id: 'baja_pct', label: 'Baja % día ≥' },
  { id: 'rsi_alto', label: 'RSI > umbral' },
  { id: 'rsi_bajo', label: 'RSI < umbral' },
]

function tipoLabel(t: string) {
  return TIPOS.find((x) => x.id === t)?.label ?? t
}

export function Alertas() {
  const [alerts, setAlerts] = useState<Alerta[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({
    ticker: '',
    tipo: 'precio_sube',
    valor: '',
  })
  const [checkLoading, setCheckLoading] = useState(false)
  const [banner, setBanner] = useState<Alerta[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/alerts/`)
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { alerts: Alerta[] }
      setAlerts(j.alerts ?? [])
    } catch {
      setAlerts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleGuardar = async () => {
    console.log('form alerta:', form)
    const t = form.ticker.trim().toUpperCase()
    const v = parseFloat(form.valor.replace(',', '.'))
    if (!t || !Number.isFinite(v)) return
    const res = await fetch(`${API}/api/alerts/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: t, tipo: form.tipo, valor: v }),
    })
    if (!res.ok) return
    setModal(false)
    setForm({ ticker: '', tipo: 'precio_sube', valor: '' })
    void load()
  }

  const eliminar = async (id: string) => {
    const res = await fetch(`${API}/api/alerts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!res.ok) return
    void load()
  }

  const verificar = async () => {
    setCheckLoading(true)
    setBanner([])
    try {
      const res = await fetch(`${API}/api/alerts/check`)
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { disparadas: Alerta[] }
      const d = j.disparadas ?? []
      setBanner(d)
      void load()
    } catch {
      setBanner([])
    } finally {
      setCheckLoading(false)
    }
  }

  return (
    <div className="alertas-page">
      {banner.length > 0 && (
        <div className="alerta-banner" role="alert">
          <strong>Alertas disparadas:</strong>{' '}
          {banner.map((a) => `${a.ticker} (${tipoLabel(a.tipo)})`).join(' · ')}
          <button
            type="button"
            className="alerta-banner-close"
            onClick={() => setBanner([])}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      )}

      <h1 className="page-title">Alertas</h1>
      <p className="page-sub">
        Definí condiciones sobre precio, variación del día o RSI. Verificá con el
        botón cuando quieras.
      </p>

      <div className="alertas-toolbar">
        <button
          type="button"
          className="alertas-new-btn"
          onClick={() => setModal(true)}
        >
          Nueva alerta
        </button>
        <button
          type="button"
          className="alertas-check-btn"
          onClick={() => void verificar()}
          disabled={checkLoading}
        >
          {checkLoading ? 'Verificando…' : 'Verificar ahora'}
        </button>
      </div>

      {loading ? (
        <p className="page-sub font-prose">Cargando…</p>
      ) : alerts.length === 0 ? (
        <p className="page-sub font-prose">No hay alertas configuradas.</p>
      ) : (
        <div className="alertas-table-wrap">
          <table className="alertas-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="alerta-tick">{a.ticker}</td>
                  <td>{tipoLabel(a.tipo)}</td>
                  <td>{a.valor}</td>
                  <td>
                    <span
                      className={
                        a.estado === 'disparada'
                          ? 'alerta-badge-disparada'
                          : 'alerta-badge-activa'
                      }
                    >
                      {a.estado === 'disparada' ? 'DISPARADA' : 'ACTIVA'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="alerta-del"
                      onClick={() => void eliminar(a.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div
          className="ingeld-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="al-modal-title"
        >
          <div
            className="ingeld-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="al-modal-title" className="ingeld-modal-title">
              Nueva alerta
            </h2>
            <label className="ingeld-modal-field">
              Ticker
              <input
                type="text"
                className="ingeld-input"
                value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value }))}
                placeholder="GGAL.BA"
              />
            </label>
            <label className="ingeld-modal-field">
              Tipo
              <select
                value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
              >
                {TIPOS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ingeld-modal-field">
              Valor numérico (precio, % o RSI según tipo)
              <input
                type="text"
                className="ingeld-input"
                value={form.valor}
                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
                inputMode="decimal"
              />
            </label>
            <div className="ingeld-modal-actions">
              <button type="button" onClick={() => setModal(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="ingeld-modal-primary"
                onClick={() => void handleGuardar()}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
