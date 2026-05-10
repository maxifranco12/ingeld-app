import { useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'

const API = import.meta.env.VITE_API_URL ?? ''

const STRATEGIES: { id: string; label: string }[] = [
  { id: 'rsi30', label: 'Comprar cuando RSI < 30' },
  { id: 'rsi30_macd_cross', label: 'Comprar cuando RSI < 30 y MACD cruza alcista' },
  { id: 'touch_ma200', label: 'Comprar cuando precio toca MA200' },
  { id: 'drop_month_20', label: 'Comprar cuando cae más de 20% en un mes' },
]

type Trade = {
  fecha_entrada: string
  fecha_salida: string
  precio_entrada: number
  precio_salida: number
  resultado_pct: number
}

type BacktestRes = {
  summary: {
    retorno_total_pct: number
    win_rate_pct: number
    avg_gain_pct: number
    avg_loss_pct: number
    max_drawdown_pct: number
    trades_totales: number
    capital_final: number
  }
  trades: Trade[]
  equity_curve: { date: string; equity: number }[]
  analisis_ia: string
}

export default function Backtest() {
  const [ticker, setTicker] = useState('SPY')
  const [estrategia, setEstrategia] = useState('rsi30')
  const [periodo, setPeriodo] = useState<'1Y' | '3Y' | '5Y'>('1Y')
  const [capital, setCapital] = useState(10000)
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<BacktestRes | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch(`${API}/api/market/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase(), estrategia, periodo, capital }),
      })
      if (!r.ok) throw new Error(await r.text())
      setRes((await r.json()) as BacktestRes)
    } catch (e) {
      setRes(null)
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <h1>Backtesting</h1>
      <p className="page-sub">Simulación histórica: entrada en señal, salida a 30 sesiones.</p>

      <div className="backtest-form panel">
        <label className="font-prose">
          Ticker
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
        </label>
        <label className="font-prose">
          Estrategia
          <select value={estrategia} onChange={(e) => setEstrategia(e.target.value)}>
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="font-prose">
          Período
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value as '1Y' | '3Y' | '5Y')}>
            <option value="1Y">1Y</option>
            <option value="3Y">3Y</option>
            <option value="5Y">5Y</option>
          </select>
        </label>
        <label className="font-prose">
          Capital inicial
          <input type="number" min={100} step={100} value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
        </label>
        <button type="button" className="portfolio-ai-btn" onClick={() => void run()} disabled={loading}>
          {loading ? 'Corriendo…' : 'Correr backtest'}
        </button>
      </div>

      {err ? <p className="error-box">{err}</p> : null}

      {res ? (
        <div className="backtest-results">
          <div className="panel">
            <h2>Resumen</h2>
            <ul className="font-prose">
              <li>Retorno total: <b>{res.summary.retorno_total_pct}%</b></li>
              <li>Win rate: <b>{res.summary.win_rate_pct}%</b></li>
              <li>Trades: <b>{res.summary.trades_totales}</b></li>
              <li>Capital final: <b>{res.summary.capital_final}</b></li>
              <li>Max drawdown: <b>{res.summary.max_drawdown_pct}%</b></li>
              <li>Avg gain / avg loss: <b>{res.summary.avg_gain_pct}%</b> / <b>{res.summary.avg_loss_pct}%</b></li>
            </ul>
          </div>

          <div className="panel equity-curve">
            <h2>Equity curve</h2>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={res.equity_curve}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="equity" stroke="#00a87a" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h2>Trades</h2>
            <div className="insider-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>Px entrada</th>
                    <th>Px salida</th>
                    <th>Resultado %</th>
                  </tr>
                </thead>
                <tbody>
                  {res.trades.map((t, i) => (
                    <tr key={`${t.fecha_entrada}-${i}`}>
                      <td>{t.fecha_entrada}</td>
                      <td>{t.fecha_salida}</td>
                      <td>{t.precio_entrada}</td>
                      <td>{t.precio_salida}</td>
                      <td className={t.resultado_pct >= 0 ? 'gain' : 'loss'}>{t.resultado_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {res.analisis_ia ? (
            <div className="panel">
              <h2>Interpretación IA</h2>
              <AnalysisMarkdown source={res.analisis_ia} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
