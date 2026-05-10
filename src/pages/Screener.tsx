import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'

const API = import.meta.env.VITE_API_URL ?? ''

type Row = {
  ticker: string
  name: string
  sector: string
  price: number
  changePct: number
  pe: number | null
  pb: number | null
  roe: number | null
  dividend_yield: number | null
  revenue_growth: number | null
  rsi: number | null
  market_cap: number | null
  cap_bucket: string
}

type SortKey = keyof Row | 'none'
const CAPS = ['', 'Small', 'Mid', 'Large', 'Mega']

function fmtCap(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  return n.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

function fmtPctDecimal(v: number | null, asPercentFromDecimal = true): string {
  if (v == null || Number.isNaN(v)) return '—'
  const x = asPercentFromDecimal && Math.abs(v) <= 2 ? v * 100 : v
  return `${x.toFixed(2)}%`
}

export default function Screener() {
  const [peMin, setPeMin] = useState(0)
  const [peMax, setPeMax] = useState(500)
  const [pbMin, setPbMin] = useState(0)
  const [pbMax, setPbMax] = useState(100)
  const [roeMin, setRoeMin] = useState(0)
  const [divMin, setDivMin] = useState(0)
  const [revGMin, setRevGMin] = useState(0)
  const [rsiMin, setRsiMin] = useState(0)
  const [rsiMax, setRsiMax] = useState(100)
  const [cap, setCap] = useState('')
  const [sector, setSector] = useState('')
  const [sectors, setSectors] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('ticker')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [iaText, setIaText] = useState<string | null>(null)
  const [iaLoading, setIaLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API}/api/market/screener/sectors`)
        if (!res.ok) return
        const j = (await res.json()) as { sectors?: string[] }
        setSectors(j.sectors ?? [])
      } catch {
        /* noop */
      }
    })()
  }, [])

  const fetchResults = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (peMin > 0) p.set('pe_min', String(peMin))
      if (peMax < 500) p.set('pe_max', String(peMax))
      if (pbMin > 0) p.set('pb_min', String(pbMin))
      if (pbMax < 100) p.set('pb_max', String(pbMax))
      if (roeMin > 0) p.set('roe_min', String(roeMin))
      if (divMin > 0) p.set('dividend_yield_min', String(divMin))
      if (revGMin > 0) p.set('revenue_growth_min', String(revGMin))
      if (rsiMin > 0) p.set('rsi_min', String(rsiMin))
      if (rsiMax < 100) p.set('rsi_max', String(rsiMax))
      if (cap) p.set('market_cap', cap)
      if (sector) p.set('sector', sector)
      const res = await fetch(`${API}/api/market/screener?${p.toString()}`)
      if (!res.ok) throw new Error('screener')
      const j = (await res.json()) as { results?: Row[] }
      setRows(j.results ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [peMin, peMax, pbMin, pbMax, roeMin, divMin, revGMin, rsiMin, rsiMax, cap, sector])

  useEffect(() => {
    void fetchResults()
  }, [fetchResults])

  const sorted = useMemo(() => {
    const k = sortKey === 'none' ? 'ticker' : sortKey
    const arr = [...rows]
    arr.sort((a, b) => {
      const va = a[k as keyof Row]
      const vb = b[k as keyof Row]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va
      }
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va))
    })
    return arr
  }, [rows, sortKey, sortDir])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('asc')
    }
  }

  const onAnalyzeIa = async () => {
    const top = sorted.slice(0, 5)
    if (top.length === 0) return
    setIaLoading(true)
    try {
      const res = await fetch(`${API}/api/market/screener/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: top }),
      })
      if (!res.ok) throw new Error('ia')
      const j = (await res.json()) as { analisis?: string }
      setIaText(j.analisis ?? '')
    } catch {
      setIaText('No se pudo obtener el análisis IA.')
    } finally {
      setIaLoading(false)
    }
  }

  return (
    <div className="page">
      <h1>Screener avanzado</h1>
      <p className="page-sub">Universo de 30 activos — fundamentales y técnico (RSI).</p>

      <div className="screener-layout">
        <aside className="screener-filters">
          <h2>Filtros</h2>
          <label className="font-prose">
            P/E mín: {peMin}
            <input type="range" min={0} max={500} value={peMin} onChange={(e) => setPeMin(Number(e.target.value))} />
          </label>
          <label className="font-prose">
            P/E máx: {peMax}
            <input type="range" min={0} max={500} value={peMax} onChange={(e) => setPeMax(Number(e.target.value))} />
          </label>
          <label className="font-prose">
            P/B mín: {pbMin}
            <input type="range" min={0} max={100} value={pbMin} onChange={(e) => setPbMin(Number(e.target.value))} />
          </label>
          <label className="font-prose">
            P/B máx: {pbMax}
            <input type="range" min={0} max={100} value={pbMax} onChange={(e) => setPbMax(Number(e.target.value))} />
          </label>
          <label className="font-prose">
            ROE mín (%)
            <input type="number" min={0} max={100} value={roeMin || ''} onChange={(e) => setRoeMin(Number(e.target.value) || 0)} />
          </label>
          <label className="font-prose">
            Dividend yield mín (%)
            <input type="number" min={0} step={0.1} value={divMin || ''} onChange={(e) => setDivMin(Number(e.target.value) || 0)} />
          </label>
          <label className="font-prose">
            Revenue growth mín (%)
            <input type="number" min={0} step={0.5} value={revGMin || ''} onChange={(e) => setRevGMin(Number(e.target.value) || 0)} />
          </label>
          <label className="font-prose">
            RSI mín: {rsiMin}
            <input type="range" min={0} max={100} value={rsiMin} onChange={(e) => setRsiMin(Number(e.target.value))} />
          </label>
          <label className="font-prose">
            RSI máx: {rsiMax}
            <input type="range" min={0} max={100} value={rsiMax} onChange={(e) => setRsiMax(Number(e.target.value))} />
          </label>
          <label className="font-prose">
            Market cap
            <select value={cap} onChange={(e) => setCap(e.target.value)}>
              {CAPS.map((c) => (
                <option key={c || 'all'} value={c}>
                  {c || 'Todos'}
                </option>
              ))}
            </select>
          </label>
          <label className="font-prose">
            Sector
            <select value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">Todos</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="portfolio-ai-btn" onClick={() => void fetchResults()} disabled={loading}>
            {loading ? 'Actualizando…' : 'Aplicar filtros'}
          </button>
        </aside>

        <div className="screener-results">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span className="page-sub">{sorted.length} resultado(s)</span>
            <button type="button" className="portfolio-refresh-btn" onClick={() => void onAnalyzeIa()} disabled={iaLoading || sorted.length === 0}>
              {iaLoading ? 'IA…' : 'Analizar selección con IA (top 5)'}
            </button>
          </div>
          <div className="panel" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {(
                    [
                      ['ticker', 'Ticker'],
                      ['name', 'Nombre'],
                      ['sector', 'Sector'],
                      ['price', 'Precio'],
                      ['changePct', '% día'],
                      ['pe', 'P/E'],
                      ['pb', 'P/B'],
                      ['roe', 'ROE'],
                      ['dividend_yield', 'Div. yield'],
                      ['rsi', 'RSI'],
                      ['market_cap', 'Mkt cap'],
                    ] as const
                  ).map(([k, lab]) => (
                    <th key={k}>
                      <button type="button" className="table-sort-btn" onClick={() => toggleSort(k)}>
                        {lab}
                        {sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.ticker}>
                    <td>
                      <Link to={`/activo/${r.ticker}`}>{r.ticker}</Link>
                    </td>
                    <td>{r.name}</td>
                    <td>{r.sector}</td>
                    <td>{r.price?.toLocaleString('es-AR', { maximumFractionDigits: 4 })}</td>
                    <td className={r.changePct >= 0 ? 'gain' : 'loss'}>{r.changePct?.toFixed(2)}%</td>
                    <td>{r.pe != null ? r.pe.toFixed(2) : '—'}</td>
                    <td>{r.pb != null ? r.pb.toFixed(2) : '—'}</td>
                    <td>{fmtPctDecimal(r.roe, true)}</td>
                    <td>{fmtPctDecimal(r.dividend_yield, true)}</td>
                    <td>{r.rsi != null ? r.rsi.toFixed(1) : '—'}</td>
                    <td>{fmtCap(r.market_cap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {iaText ? (
            <div className="panel" style={{ marginTop: '1rem' }}>
              <h3>Análisis IA</h3>
              <AnalysisMarkdown source={iaText} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
