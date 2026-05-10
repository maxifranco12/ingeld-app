import { useEffect, useRef, useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'

const API = import.meta.env.VITE_API_URL ?? ''

const DEBOUNCE_MS = 400

type SearchHit = {
  symbol: string
  name: string
  exchange?: string
  type?: string
}

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
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [estrategia, setEstrategia] = useState('rsi30')
  const [periodo, setPeriodo] = useState<'1Y' | '3Y' | '5Y'>('1Y')
  const [capital, setCapital] = useState(10000)
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<BacktestRes | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const v = ticker.trim()
    if (!v) {
      setHits([])
      setSearchLoading(false)
      return () => {
        cancelled = true
      }
    }
    const t = window.setTimeout(() => {
      setSearchLoading(true)
      ;(async () => {
        try {
          const res = await fetch(`${API}/api/market/search?q=${encodeURIComponent(v)}`)
          if (cancelled || !res.ok) return
          const raw = await res.json()
          const list = Array.isArray(raw)
            ? raw
            : ((raw as { items?: SearchHit[] }).items ?? [])
          const mapped = list
            .map((h) => ({
              symbol: String((h as SearchHit).symbol ?? '').trim(),
              name: String((h as SearchHit).name ?? '').trim(),
              exchange: (h as SearchHit).exchange,
              type: (h as SearchHit).type,
            }))
            .filter((h) => h.symbol)
          if (!cancelled) setHits(mapped.slice(0, 6))
        } catch {
          if (!cancelled) setHits([])
        } finally {
          if (!cancelled) setSearchLoading(false)
        }
      })()
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [ticker])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

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
        <label className="font-prose" style={{ gridColumn: 'span 2', maxWidth: '24rem' }}>
          Ticker
          <div className="buscador-search-wrap" ref={wrapRef} style={{ margin: '0.35rem 0 0', maxWidth: '100%' }}>
            <input
              className="buscador-input"
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                setSearchOpen(false)
                void run()
              }}
              placeholder="Ticker o empresa — ej: SPY, AAPL"
              aria-label="Ticker para backtest"
              autoComplete="off"
            />
            {searchOpen && (ticker.trim() || searchLoading) && (
              <div className="buscador-dropdown" role="listbox">
                {searchLoading && (
                  <div className="buscador-dd-muted font-prose">Buscando…</div>
                )}
                {!searchLoading &&
                  hits.slice(0, 6).map((h) => (
                    <button
                      key={h.symbol}
                      type="button"
                      role="option"
                      className="buscador-dd-item"
                      onClick={() => {
                        setTicker(h.symbol)
                        setSearchOpen(false)
                      }}
                    >
                      <span className="buscador-dd-name font-prose">{h.name || h.symbol}</span>
                      <span className="buscador-dd-meta">
                        <strong>{h.symbol}</strong>
                        {h.exchange ? ` · ${h.exchange}` : ''}
                        {h.type ? ` · ${h.type}` : ''}
                      </span>
                    </button>
                  ))}
                {!searchLoading && ticker.trim() && hits.length === 0 && (
                  <div className="buscador-dd-muted font-prose">Sin resultados.</div>
                )}
              </div>
            )}
          </div>
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
