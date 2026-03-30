import { useCallback, useEffect, useState, type FocusEvent } from 'react'

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

type AssetPreview = {
  price: number
  changePct: number
  moneda: string
  nombre: string
}

function tipoLabel(t: string) {
  return TIPOS.find((x) => x.id === t)?.label ?? t
}

function fmtNum(n: number, maxFrac = 4) {
  return n.toLocaleString('es-AR', { maximumFractionDigits: maxFrac })
}

/** Texto claro para cards y banner (sin jerga técnica del tipo). */
function descripcionAlerta(a: Alerta): string {
  const t = a.ticker.toUpperCase()
  const v = a.valor
  switch (a.tipo) {
    case 'precio_sube':
      return `${t} llega o supera ${fmtNum(v, 4)}`
    case 'precio_baja':
      return `${t} baja o llega a ${fmtNum(v, 4)} o menos`
    case 'sube_pct':
      return `${t} sube más de ${fmtNum(v, 2)}% en el día`
    case 'baja_pct':
      return `${t} baja más de ${fmtNum(v, 2)}% en el día`
    case 'rsi_alto':
      return `RSI de ${t} supera ${fmtNum(v, 1)}`
    case 'rsi_bajo':
      return `RSI de ${t} cae por debajo de ${fmtNum(v, 1)}`
    default:
      return `${t} · ${tipoLabel(a.tipo)} · ${v}`
  }
}

function iconForTipo(tipo: string): string {
  switch (tipo) {
    case 'precio_sube':
      return '↑'
    case 'precio_baja':
      return '↓'
    case 'sube_pct':
      return '📈'
    case 'baja_pct':
      return '📉'
    case 'rsi_alto':
    case 'rsi_bajo':
      return '⚡'
    default:
      return '•'
  }
}

function iconClassForTipo(tipo: string): string {
  switch (tipo) {
    case 'precio_sube':
    case 'sube_pct':
      return 'alerta-card-icon--gain'
    case 'precio_baja':
    case 'baja_pct':
      return 'alerta-card-icon--loss'
    case 'rsi_alto':
      return 'alerta-card-icon--rsi-high'
    case 'rsi_bajo':
      return 'alerta-card-icon--rsi-low'
    default:
      return ''
  }
}

function valorFieldLabel(tipo: string, preview: AssetPreview | null): string {
  const mon = preview?.moneda?.trim() || 'ARS'
  const actual =
    preview != null
      ? `${fmtNum(preview.price, 4)} ${mon}`
      : null
  switch (tipo) {
    case 'precio_sube':
    case 'precio_baja':
      return actual
        ? `¿A qué precio? (actual: ${actual})`
        : '¿A qué precio?'
    case 'sube_pct':
    case 'baja_pct':
      return '¿Qué % del día? (ej: 5)'
    case 'rsi_alto':
    case 'rsi_bajo':
      return '¿Valor de RSI? (ej: 70)'
    default:
      return 'Valor'
  }
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
  const [tickerPreview, setTickerPreview] = useState<AssetPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

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

  useEffect(() => {
    if (!modal) {
      setTickerPreview(null)
      setPreviewLoading(false)
    }
  }, [modal])

  const fetchTickerPreview = useCallback(async (tickerRaw: string) => {
    const raw = tickerRaw.trim().toUpperCase()
    if (raw.length < 2) {
      setTickerPreview(null)
      return
    }
    setPreviewLoading(true)
    try {
      const res = await fetch(
        `${API}/api/market/asset/${encodeURIComponent(raw)}?range=${encodeURIComponent('1M')}`,
      )
      if (!res.ok) {
        setTickerPreview(null)
        return
      }
      const j = (await res.json()) as {
        price: number
        changePct: number
        info?: { moneda?: string; nombre?: string }
      }
      setTickerPreview({
        price: j.price,
        changePct: j.changePct,
        moneda: (j.info?.moneda || 'ARS').trim() || 'ARS',
        nombre: (j.info?.nombre || raw).trim() || raw,
      })
    } catch {
      setTickerPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  const handleTickerBlur = (e: FocusEvent<HTMLInputElement>) => {
    void fetchTickerPreview(e.currentTarget.value)
  }

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
    setTickerPreview(null)
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

  const openModal = () => {
    setForm({ ticker: '', tipo: 'precio_sube', valor: '' })
    setTickerPreview(null)
    setModal(true)
  }

  const valorLabel = valorFieldLabel(form.tipo, tickerPreview)

  return (
    <div className="alertas-page">
      {banner.length > 0 && (
        <div className="alerta-banner" role="alert">
          <strong>Alertas disparadas:</strong>{' '}
          {banner.map((a) => descripcionAlerta(a)).join(' · ')}
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
          onClick={openModal}
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
        <div className="alertas-empty" role="status">
          <p className="alertas-empty-title">No tenés alertas configuradas.</p>
          <p className="alertas-empty-text">
            Creá una para que INGELD te avise cuando un activo llegue a tu precio
            objetivo.
          </p>
        </div>
      ) : (
        <div className="alertas-cards-grid">
          {alerts.map((a) => (
            <article key={a.id} className="alerta-card">
              <button
                type="button"
                className="alerta-card-remove"
                onClick={() => void eliminar(a.id)}
                aria-label={`Eliminar alerta ${a.ticker}`}
              >
                ×
              </button>
              <div className="alerta-card-top">
                <span
                  className={`alerta-card-icon ${iconClassForTipo(a.tipo)}`}
                  aria-hidden
                >
                  {iconForTipo(a.tipo)}
                </span>
                <h3 className="alerta-card-ticker">{a.ticker.toUpperCase()}</h3>
              </div>
              <p className="alerta-card-desc font-prose">{descripcionAlerta(a)}</p>
              <span
                className={
                  a.estado === 'disparada'
                    ? 'alerta-badge-disparada'
                    : 'alerta-badge-activa'
                }
              >
                {a.estado === 'disparada' ? 'DISPARADA' : 'ACTIVA'}
              </span>
            </article>
          ))}
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
            className="ingeld-modal ingeld-modal--alerta"
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
                onChange={(e) => {
                  setTickerPreview(null)
                  setForm((f) => ({ ...f, ticker: e.target.value }))
                }}
                onBlur={handleTickerBlur}
                placeholder="GGAL.BA"
              />
            </label>
            {previewLoading && (
              <p className="alerta-preview-hint">Cargando cotización…</p>
            )}
            {!previewLoading && tickerPreview && (
              <div className="alerta-preview-box">
                <p className="alerta-preview-price">
                  {fmtNum(tickerPreview.price, 4)}{' '}
                  <span className="alerta-preview-moneda">
                    {tickerPreview.moneda}
                  </span>
                </p>
                <p
                  className={
                    tickerPreview.changePct >= 0
                      ? 'alerta-preview-chg gain'
                      : 'alerta-preview-chg loss'
                  }
                >
                  {tickerPreview.changePct >= 0 ? '+' : ''}
                  {tickerPreview.changePct.toFixed(2)}% hoy
                </p>
                <p className="alerta-preview-name">{tickerPreview.nombre}</p>
              </div>
            )}
            <label className="ingeld-modal-field">
              Tipo
              <select
                value={form.tipo}
                onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
              >
                {TIPOS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ingeld-modal-field">
              {valorLabel}
              <input
                type="text"
                className="ingeld-input"
                value={form.valor}
                onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
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
