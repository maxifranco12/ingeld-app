import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL ?? ''

type ERow = {
  ticker: string
  nombre: string
  fecha: string
  dias_para: number
  eps_estimado: number | null
  eps_anterior: number | null
  revenue_estimado: number | null
}

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  const day = x.getDay()
  const diff = x.getDate() - day + (day === 0 ? -6 : 1)
  x.setDate(diff)
  x.setHours(0, 0, 0, 0)
  return x
}

function weekLabel(wk: Date): string {
  return `Semana del ${wk.toLocaleDateString('es-AR')}`
}

export default function Earnings() {
  const [rows, setRows] = useState<ERow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const res = await fetch(`${API}/api/market/earnings-calendar`)
        if (!res.ok) throw new Error('fail')
        const j = (await res.json()) as { proximos_earnings?: ERow[] }
        setRows(j.proximos_earnings ?? [])
      } catch {
        setRows([])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const today = new Date()
  const endWeek = new Date(today)
  endWeek.setDate(today.getDate() + (7 - today.getDay()))

  const byWeek = useMemo(() => {
    const m = new Map<string, ERow[]>()
    for (const r of rows) {
      const d = new Date(r.fecha + 'T12:00:00')
      if (Number.isNaN(d.getTime())) continue
      const wk = startOfWeek(d)
      const key = wk.toISOString().slice(0, 10)
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(r)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [rows])

  const isThisWeek = (fecha: string) => {
    const d = new Date(fecha + 'T12:00:00')
    return d >= startOfWeek(today) && d <= endWeek
  }

  return (
    <div className="page">
      <h1>Calendario de earnings</h1>
      <p className="page-sub">{loading ? 'Cargando…' : `${rows.length} próximos eventos (universo 30 tickers)`}</p>

      <div className="earnings-calendar">
        {!loading && byWeek.length === 0 ? (
          <p className="page-sub font-prose">No hay fechas de earnings próximas en el universo (o yfinance no devolvió calendario).</p>
        ) : null}
        {byWeek.map(([key, list]) => {
          const wk = new Date(key + 'T12:00:00')
          return (
            <section key={key} className="earnings-week">
              <h2 className="earnings-week-title">{weekLabel(wk)}</h2>
              <div className="earnings-week-grid">
                {list.map((r) => (
                  <article key={r.ticker + r.fecha} className="earnings-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <Link to={`/activo/${r.ticker}`}>
                        <strong>{r.ticker}</strong>
                      </Link>
                      {isThisWeek(r.fecha) ? <span className="earnings-badge">ESTA SEMANA</span> : null}
                    </div>
                    <p className="font-prose page-sub">{r.nombre}</p>
                    <p>
                      <b>{r.fecha}</b> · en {r.dias_para} días
                    </p>
                    <p className="page-sub">
                      EPS est. {r.eps_estimado != null ? r.eps_estimado.toFixed(2) : '—'} vs ant.{' '}
                      {r.eps_anterior != null ? r.eps_anterior.toFixed(2) : '—'}
                    </p>
                    {r.revenue_estimado != null ? (
                      <p className="page-sub">Revenue ref. {r.revenue_estimado.toLocaleString('es-AR')}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
