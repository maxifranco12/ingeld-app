import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useAuth } from '../context/AuthContext'

const API = import.meta.env.VITE_API_URL ?? ''

type AssetRow = {
  id: number
  nombre: string
  tipo: string
  valor: number
  moneda: string
}

type LiabilityRow = {
  id: number
  nombre: string
  tipo: string
  monto: number
  moneda: string
}

type Pos = {
  ticker: string
  cantidad: number
  precioCompra: number
  moneda: string
}

function parsePortfolio(raw: unknown): Pos[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((x) => x as Record<string, unknown>)
    .filter(
      (x) =>
        x &&
        typeof x.ticker === 'string' &&
        typeof x.cantidad === 'number' &&
        typeof x.precioCompra === 'number',
    )
    .map((x) => ({
      ticker: String(x.ticker).trim().toUpperCase(),
      cantidad: x.cantidad as number,
      precioCompra: x.precioCompra as number,
      moneda: x.moneda === 'USD' ? 'USD' : 'ARS',
    }))
}

export function NetWorth() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [liabs, setLiabs] = useState<LiabilityRow[]>([])
  const [portfolioValUsd, setPortfolioValUsd] = useState(0)
  const [portfolioValArs, setPortfolioValArs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [modal, setModal] = useState<'asset' | 'liability' | null>(null)
  const [formA, setFormA] = useState({ nombre: '', tipo: 'inmueble', valor: '', moneda: 'USD' })
  const [formL, setFormL] = useState({ nombre: '', tipo: 'hipoteca', monto: '', moneda: 'USD' })

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setErr(null)
    try {
      const [ra, rl, rp] = await Promise.all([
        fetch(`${API}/api/auth/assets`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/api/auth/liabilities`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/api/auth/profile`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!ra.ok || !rl.ok || !rp.ok) throw new Error('Datos incompletos')
      const ja = (await ra.json()) as { items: AssetRow[] }
      const jl = (await rl.json()) as { items: LiabilityRow[] }
      const prof = (await rp.json()) as { portfolio?: unknown }
      setAssets(ja.items ?? [])
      setLiabs(jl.items ?? [])
      const positions = parsePortfolio(prof.portfolio)
      const tickers = [...new Set(positions.map((p) => p.ticker))]
      if (tickers.length === 0) {
        setPortfolioValUsd(0)
        setPortfolioValArs(0)
      } else {
        const qs = tickers.map(encodeURIComponent).join(',')
        const rq = await fetch(`${API}/api/market/quotes?symbols=${qs}`)
        if (!rq.ok) throw new Error(await rq.text())
        const qj = (await rq.json()) as {
          quotes: { symbol: string; price: number }[]
        }
        const qmap: Record<string, number> = {}
        for (const q of qj.quotes ?? []) {
          qmap[q.symbol.toUpperCase()] = q.price
        }
        let usd = 0
        let ars = 0
        for (const p of positions) {
          const px = qmap[p.ticker] ?? 0
          const v = p.cantidad * px
          if (p.moneda === 'USD') usd += v
          else ars += v
        }
        setPortfolioValUsd(usd)
        setPortfolioValArs(ars)
      }
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

  const totals = useMemo(() => {
    let taUsd = portfolioValUsd
    let taArs = portfolioValArs
    for (const a of assets) {
      if (a.moneda === 'USD') taUsd += a.valor
      else taArs += a.valor
    }
    let tlUsd = 0
    let tlArs = 0
    for (const l of liabs) {
      if (l.moneda === 'USD') tlUsd += l.monto
      else tlArs += l.monto
    }
    return { taUsd, taArs, tlUsd, tlArs }
  }, [assets, liabs, portfolioValUsd, portfolioValArs])

  const pieData = useMemo(() => {
    const slices: { name: string; value: number }[] = []
    if (portfolioValUsd + portfolioValArs > 0) {
      slices.push({ name: 'Portfolio inversiones', value: portfolioValUsd + portfolioValArs * 0.001 })
    }
    for (const a of assets) {
      slices.push({
        name: a.nombre,
        value: a.moneda === 'USD' ? a.valor : a.valor * 0.001,
      })
    }
    return slices.filter((s) => s.value > 0)
  }, [assets, portfolioValUsd, portfolioValArs])

  const submitAsset = async () => {
    if (!token) return
    const v = parseFloat(formA.valor)
    if (!formA.nombre.trim() || Number.isNaN(v) || v < 0) return
    const res = await fetch(`${API}/api/auth/assets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre: formA.nombre.trim(),
        tipo: formA.tipo,
        valor: v,
        moneda: formA.moneda,
      }),
    })
    if (!res.ok) {
      setErr(await res.text())
      return
    }
    setModal(null)
    setFormA({ nombre: '', tipo: 'inmueble', valor: '', moneda: 'USD' })
    void load()
  }

  const submitLiab = async () => {
    if (!token) return
    const v = parseFloat(formL.monto)
    if (!formL.nombre.trim() || Number.isNaN(v) || v < 0) return
    const res = await fetch(`${API}/api/auth/liabilities`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre: formL.nombre.trim(),
        tipo: formL.tipo,
        monto: v,
        moneda: formL.moneda,
      }),
    })
    if (!res.ok) {
      setErr(await res.text())
      return
    }
    setModal(null)
    setFormL({ nombre: '', tipo: 'hipoteca', monto: '', moneda: 'USD' })
    void load()
  }

  const delAsset = async (id: number) => {
    if (!token || !window.confirm('¿Eliminar activo?')) return
    await fetch(`${API}/api/auth/assets/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    void load()
  }

  const delLiab = async (id: number) => {
    if (!token || !window.confirm('¿Eliminar pasivo?')) return
    await fetch(`${API}/api/auth/liabilities/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    void load()
  }

  const COLORS = ['#00a87a', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981']

  return (
    <div className="networth-page">
      <h1 className="page-title">Patrimonio neto</h1>
      <p className="page-sub font-prose">
        Activos y pasivos fuera de mercado, más tu cartera INGELD valorizada al precio actual.
      </p>
      {err ? <div className="error-state">{err}</div> : null}
      {loading ? (
        <p className="page-sub">Cargando…</p>
      ) : (
        <>
          <header className="networth-header">
            <div>
              <p className="networth-label font-prose">Patrimonio neto (referencia)</p>
              <p className="networth-big">
                USD: {(totals.taUsd - totals.tlUsd).toLocaleString('es-AR', { maximumFractionDigits: 0 })}{' '}
                · ARS:{' '}
                {(totals.taArs - totals.tlArs).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </p>
              <p className="page-sub font-prose">
                USD y ARS se muestran por separado (sin tipo de cambio cruzado).
              </p>
            </div>
          </header>

          <div className="networth-columns">
            <section className="networth-col">
              <div className="networth-col-head">
                <h2 className="dash-zone-title">Activos</h2>
                <button type="button" className="portfolio-add-btn" onClick={() => setModal('asset')}>
                  + Activo
                </button>
              </div>
              <article className="asset-card asset-card--highlight">
                <h3>Portfolio de inversiones</h3>
                <p className="font-prose">
                  USD {portfolioValUsd.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                </p>
                <p className="font-prose">
                  ARS {portfolioValArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </p>
              </article>
              {assets.map((a) => (
                <article key={a.id} className="asset-card">
                  <div className="asset-card-row">
                    <div>
                      <h3>{a.nombre}</h3>
                      <p className="font-prose page-sub">{a.tipo}</p>
                    </div>
                    <div>
                      <strong>
                        {a.valor.toLocaleString('es-AR', { maximumFractionDigits: 2 })} {a.moneda}
                      </strong>
                      <button type="button" className="portfolio-remove" onClick={() => delAsset(a.id)}>
                        ×
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </section>

            <section className="networth-col">
              <div className="networth-col-head">
                <h2 className="dash-zone-title">Pasivos</h2>
                <button type="button" className="portfolio-add-btn" onClick={() => setModal('liability')}>
                  + Pasivo
                </button>
              </div>
              {liabs.map((l) => (
                <article key={l.id} className="asset-card">
                  <div className="asset-card-row">
                    <div>
                      <h3>{l.nombre}</h3>
                      <p className="font-prose page-sub">{l.tipo}</p>
                    </div>
                    <div>
                      <strong>
                        {l.monto.toLocaleString('es-AR', { maximumFractionDigits: 2 })} {l.moneda}
                      </strong>
                      <button type="button" className="portfolio-remove" onClick={() => delLiab(l.id)}>
                        ×
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {liabs.length === 0 ? <p className="page-sub font-prose">Sin pasivos cargados.</p> : null}
            </section>
          </div>

          {pieData.length > 0 ? (
            <div className="chart-container networth-pie-wrap">
              <h3 className="chart-title">Composición (ponderación aproximada)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label
                  >
                    {pieData.map((_, i) => (
                      <Cell key={String(i)} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </>
      )}

      {modal === 'asset' && (
        <div className="ingeld-modal-overlay" role="dialog" aria-modal="true">
          <div className="ingeld-modal">
            <h2 className="ingeld-modal-title">Nuevo activo</h2>
            <label className="ingeld-modal-field">
              Nombre
              <input
                className="ingeld-input"
                value={formA.nombre}
                onChange={(e) => setFormA((f) => ({ ...f, nombre: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Tipo
              <select
                className="ingeld-input"
                value={formA.tipo}
                onChange={(e) => setFormA((f) => ({ ...f, tipo: e.target.value }))}
              >
                <option value="inmueble">Inmueble</option>
                <option value="vehiculo">Vehículo</option>
                <option value="efectivo">Efectivo</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label className="ingeld-modal-field">
              Valor
              <input
                type="number"
                className="ingeld-input"
                value={formA.valor}
                onChange={(e) => setFormA((f) => ({ ...f, valor: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Moneda
              <select
                className="ingeld-input"
                value={formA.moneda}
                onChange={(e) => setFormA((f) => ({ ...f, moneda: e.target.value }))}
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
            </label>
            <div className="ingeld-modal-actions">
              <button type="button" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="button" className="ingeld-modal-primary" onClick={() => void submitAsset()}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'liability' && (
        <div className="ingeld-modal-overlay" role="dialog" aria-modal="true">
          <div className="ingeld-modal">
            <h2 className="ingeld-modal-title">Nuevo pasivo</h2>
            <label className="ingeld-modal-field">
              Nombre
              <input
                className="ingeld-input"
                value={formL.nombre}
                onChange={(e) => setFormL((f) => ({ ...f, nombre: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Tipo
              <select
                className="ingeld-input"
                value={formL.tipo}
                onChange={(e) => setFormL((f) => ({ ...f, tipo: e.target.value }))}
              >
                <option value="hipoteca">Hipoteca</option>
                <option value="prestamo">Préstamo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label className="ingeld-modal-field">
              Monto
              <input
                type="number"
                className="ingeld-input"
                value={formL.monto}
                onChange={(e) => setFormL((f) => ({ ...f, monto: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Moneda
              <select
                className="ingeld-input"
                value={formL.moneda}
                onChange={(e) => setFormL((f) => ({ ...f, moneda: e.target.value }))}
              >
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
            </label>
            <div className="ingeld-modal-actions">
              <button type="button" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button type="button" className="ingeld-modal-primary" onClick={() => void submitLiab()}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
