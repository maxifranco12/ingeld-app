import { useState } from 'react'
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'

const API = import.meta.env.VITE_API_URL ?? ''

type Trade = {
  name: string
  title: string
  date: string
  action: string
  shares: number | null
  value: number | null
}

type Payload = {
  ticker: string
  insider_trades: Trade[]
  summary: { total_buys_6m: number; total_sells_6m: number; net_sentiment: string }
}

export default function Insiders() {
  const [ticker, setTicker] = useState('AAPL')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [ia, setIa] = useState<string | null>(null)
  const [iaLoad, setIaLoad] = useState(false)

  const load = async () => {
    const sym = ticker.trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    setIa(null)
    try {
      const res = await fetch(`${API}/api/market/insiders/${encodeURIComponent(sym)}`)
      if (!res.ok) throw new Error(await res.text())
      setData((await res.json()) as Payload)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const interpret = async () => {
    if (!data) return
    setIaLoad(true)
    try {
      const res = await fetch(`${API}/api/market/insiders/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          insider_trades: data.insider_trades.slice(0, 40),
        }),
      })
      if (!res.ok) throw new Error('ia')
      const j = (await res.json()) as { analisis?: string }
      setIa(j.analisis ?? '')
    } catch {
      setIa('No se pudo generar el análisis IA.')
    } finally {
      setIaLoad(false)
    }
  }

  const bull = data && data.summary.total_buys_6m > data.summary.total_sells_6m
  const bear = data && data.summary.total_sells_6m > data.summary.total_buys_6m

  return (
    <div className="page">
      <h1>Insider trading</h1>
      <p className="page-sub">Compras y ventas declaradas por directivos (fuente yfinance).</p>

      <div className="backtest-form panel" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
        <label className="font-prose">
          Ticker
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
        </label>
        <button type="button" className="portfolio-ai-btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Cargando…' : 'Buscar'}
        </button>
      </div>

      {data ? (
        <>
          <header style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{data.ticker}</h2>
            <span
              className={bull ? 'lab-pill lab-pill--ok' : bear ? 'lab-pill lab-pill--bad' : 'lab-pill lab-pill--warn'}
              title="Últimos 6 meses (heurístico)"
            >
              {bull ? 'Más compras' : bear ? 'Más ventas' : 'Balanceado'} · {data.summary.net_sentiment}
            </span>
            <span className="page-sub">
              Compras 6m: {data.summary.total_buys_6m} · Ventas 6m: {data.summary.total_sells_6m}
            </span>
          </header>

          <div className="insider-table-wrap panel" style={{ marginTop: '1rem' }}>
            <table className="data-table insider-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Insider</th>
                  <th>Rol</th>
                  <th>Acción</th>
                  <th>Acciones</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.insider_trades.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="page-sub">
                      Sin datos de insider_transactions para este ticker.
                    </td>
                  </tr>
                ) : (
                  data.insider_trades.map((r, i) => (
                    <tr key={`${r.date}-${i}`}>
                      <td>{r.date}</td>
                      <td>{r.name}</td>
                      <td>{r.title}</td>
                      <td>{r.action}</td>
                      <td>{r.shares != null ? r.shares.toLocaleString('es-AR') : '—'}</td>
                      <td>{r.value != null ? r.value.toLocaleString('es-AR') : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <button type="button" className="portfolio-refresh-btn" style={{ marginTop: '0.75rem' }} onClick={() => void interpret()} disabled={iaLoad}>
            {iaLoad ? 'IA…' : 'Análisis IA: ¿insiders comprando o vendiendo?'}
          </button>
          {ia ? (
            <div className="panel" style={{ marginTop: '1rem' }}>
              <AnalysisMarkdown source={ia} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
