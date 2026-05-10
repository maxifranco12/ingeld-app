import { useEffect, useRef, useState } from 'react'
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'

const API = import.meta.env.VITE_API_URL ?? ''

const DEBOUNCE_MS = 400

type SearchHit = {
  symbol: string
  name: string
  exchange?: string
  type?: string
}

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
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [ia, setIa] = useState<string | null>(null)
  const [iaLoad, setIaLoad] = useState(false)

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
        <label className="font-prose" style={{ display: 'block', width: '100%', maxWidth: '22rem', marginBottom: 0 }}>
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
                void load()
              }}
              placeholder="Ticker o empresa — ej: AAPL, MSFT"
              aria-label="Ticker para insiders"
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
