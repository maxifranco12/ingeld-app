import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ColorType,
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'
import { computeIndicatorData } from '../lib/technicalIndicators'

const GAIN = '#0a7c52'
const LOSS = '#c0293e'

const API = import.meta.env.VITE_API_URL ?? ''
type LabTab = 'fundamentals' | 'technicals'
type Range = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y'

type SearchItem = { symbol: string; name?: string }
type AssetBar = { time: number; open: number; high: number; low: number; close: number; volume: number }
type AssetPayload = {
  symbol: string
  price?: number
  fundamentals?: Record<string, unknown>
  info?: { description?: string; nombre?: string }
  bars: AssetBar[]
}
type FinancialsPayload = {
  income?: { revenue?: Array<number | null>; net_income?: Array<number | null> }
  años?: number[]
  valuacion_modelos?: { precio_actual?: number | null; mean_pe?: number | null; dcf_20y?: number | null }
}

const RANGES: Range[] = ['1D', '1W', '1M', '3M', '6M', '1Y']

function fmtNum(x: unknown): string {
  if (x == null || Number.isNaN(Number(x))) return '—'
  return Number(x).toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

function scoreClass(ok: boolean, warn = false): string {
  if (ok) return 'lab-pill lab-pill--ok'
  if (warn) return 'lab-pill lab-pill--warn'
  return 'lab-pill lab-pill--bad'
}

export default function StockLab() {
  const [tickerInput, setTickerInput] = useState('MSFT')
  const [ticker, setTicker] = useState('MSFT')
  const [tab, setTab] = useState<LabTab>('fundamentals')
  const [range, setRange] = useState<Range>('6M')
  const [suggestions, setSuggestions] = useState<SearchItem[]>([])
  const [asset, setAsset] = useState<AssetPayload | null>(null)
  const [financials, setFinancials] = useState<FinancialsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fundIa, setFundIa] = useState<string | null>(null)
  const [techIa, setTechIa] = useState<string | null>(null)
  const [fundLoading, setFundLoading] = useState(false)
  const [techLoading, setTechLoading] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)

  const loadAsset = useCallback(async (sym: string, r: Range) => {
    const res = await fetch(`${API}/api/market/asset/${encodeURIComponent(sym)}?range=${r}`)
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()) as AssetPayload
  }, [])

  const loadFinancials = useCallback(async (sym: string) => {
    const res = await fetch(`${API}/api/market/financials/${encodeURIComponent(sym)}`)
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()) as FinancialsPayload
  }, [])

  const runAnalyze = useCallback(
    async (nextTicker?: string) => {
      const sym = (nextTicker ?? tickerInput).trim().toUpperCase()
      if (!sym) return
      setTicker(sym)
      setLoading(true)
      setError(null)
      try {
        const [a, f] = await Promise.all([loadAsset(sym, range), loadFinancials(sym)])
        setAsset(a)
        setFinancials(f)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al analizar')
      } finally {
        setLoading(false)
      }
    },
    [tickerInput, range, loadAsset, loadFinancials],
  )

  useEffect(() => {
    void runAnalyze(ticker)
  }, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = tickerInput.trim()
    if (q.length < 1) {
      setSuggestions([])
      return
    }
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/market/search?q=${encodeURIComponent(q)}`)
        if (!res.ok) return
        const j = (await res.json()) as
          | { items?: Array<{ symbol?: string; name?: string }> }
          | Array<{ symbol?: string; name?: string }>
        const list = Array.isArray(j) ? j : (j.items ?? [])
        setSuggestions(
          list
            .map((x) => ({ symbol: x.symbol ?? '', name: x.name }))
            .filter((x) => x.symbol)
            .slice(0, 8),
        )
      } catch {
        setSuggestions([])
      }
    }, 220)
    return () => clearTimeout(id)
  }, [tickerInput])

  useEffect(() => {
    const el = chartRef.current
    if (!el || tab !== 'technicals' || !asset?.bars?.length) return

    const MAIN_H = 260
    const ROW_VOL = 64
    const ROW_RSI = 72
    const ROW_MACD = 88
    const totalH = MAIN_H + ROW_VOL + ROW_RSI + ROW_MACD

    const chart = createChart(el, {
      width: el.clientWidth,
      height: totalH,
      layout: { background: { type: ColorType.Solid, color: '#faf9f7' }, textColor: '#1a1c20' },
      grid: { vertLines: { color: '#ece8e2' }, horzLines: { color: '#ece8e2' } },
      rightPriceScale: { borderColor: '#ddd6cf' },
      timeScale: { borderColor: '#ddd6cf' },
    })

    const bars = asset.bars.map((b) => ({
      time: b.time as UTCTimestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }))

    const candles = chart.addSeries(
      CandlestickSeries,
      {
        upColor: GAIN,
        downColor: LOSS,
        borderUpColor: GAIN,
        borderDownColor: LOSS,
        wickUpColor: GAIN,
        wickDownColor: LOSS,
      },
      0,
    )
    candles.setData(
      bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    )

    const ind = computeIndicatorData(asset.bars)

    const ma20 = chart.addSeries(
      LineSeries,
      { color: '#00a87a', lineWidth: 2, priceLineVisible: false, lastValueVisible: false },
      0,
    )
    ma20.setData(ind.ma20)
    const ma50 = chart.addSeries(
      LineSeries,
      { color: '#6366f1', lineWidth: 2, priceLineVisible: false, lastValueVisible: false },
      0,
    )
    ma50.setData(ind.ma50)
    const bbU = chart.addSeries(
      LineSeries,
      { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      0,
    )
    bbU.setData(ind.bbUpper)
    const bbL = chart.addSeries(
      LineSeries,
      { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      0,
    )
    bbL.setData(ind.bbLower)

    chart.addPane()
    chart.panes()[1]?.setHeight(ROW_VOL)
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceScaleId: 'left', color: GAIN },
      1,
    )
    volume.setData(
      bars.map((b) => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? 'rgba(10, 124, 82, 0.55)' : 'rgba(192, 41, 62, 0.55)',
      })),
    )

    chart.addPane()
    chart.panes()[2]?.setHeight(ROW_RSI)
    const rsiS = chart.addSeries(
      LineSeries,
      { color: '#7c3aed', lineWidth: 2, priceLineVisible: false, lastValueVisible: true },
      2,
    )
    rsiS.setData(ind.rsi)

    chart.addPane()
    chart.panes()[3]?.setHeight(ROW_MACD)
    const macdHist = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'price', precision: 4, minMove: 0.0001 }, priceScaleId: 'left' },
      3,
    )
    macdHist.setData(ind.macdHist)
    const macdLine = chart.addSeries(
      LineSeries,
      { color: '#2563eb', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      3,
    )
    macdLine.setData(ind.macdLine)
    const macdSig = chart.addSeries(
      LineSeries,
      { color: '#ea580c', lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      3,
    )
    macdSig.setData(ind.macdSignal)

    chart.panes()[0]?.setHeight(MAIN_H)
    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [asset, tab])

  const fund = asset?.fundamentals ?? {}
  const revData = useMemo(() => {
    const ys = financials?.años ?? []
    const rev = financials?.income?.revenue ?? []
    const earn = financials?.income?.net_income ?? []
    return ys.map((y, i) => ({ año: String(y), revenue: rev[i] ?? 0, earnings: earn[i] ?? 0 }))
  }, [financials])

  const priceNow = Number(financials?.valuacion_modelos?.precio_actual ?? asset?.price ?? 0)
  const target = Number(financials?.valuacion_modelos?.mean_pe ?? financials?.valuacion_modelos?.dcf_20y ?? 0)
  const targetPct = priceNow > 0 && target > 0 ? Math.max(0, Math.min(100, (target / (priceNow * 1.6)) * 100)) : 0

  const ind = useMemo(() => (asset?.bars?.length ? computeIndicatorData(asset.bars) : null), [asset])
  const close = asset?.bars?.at(-1)?.close ?? null
  const rsi = ind?.rsi.at(-1)?.value ?? null
  const macd = ind?.macdLine.at(-1)?.value ?? null
  const macdSignal = ind?.macdSignal.at(-1)?.value ?? null
  const bbUpper = ind?.bbUpper.at(-1)?.value ?? null
  const bbLower = ind?.bbLower.at(-1)?.value ?? null
  const ma20v = ind?.ma20.at(-1)?.value ?? null
  const ma50v = ind?.ma50.at(-1)?.value ?? null
  const vol = asset?.bars?.at(-1)?.volume ?? null

  const onFundIa = async () => {
    if (!asset || !ticker) return
    setFundLoading(true)
    try {
      const res = await fetch(`${API}/api/analysis/fundamental`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          fundamentals: fund,
          precio_actual: Number(asset.price ?? priceNow ?? 0),
          tecnico: { rsi, macd, macdSignal, ma20: ma20v, ma50: ma50v, bollUpper: bbUpper, bollLower: bbLower },
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { resumen?: string }
      setFundIa(j.resumen ?? JSON.stringify(j, null, 2))
    } catch (e) {
      setFundIa(e instanceof Error ? e.message : 'Error IA fundamental')
    } finally {
      setFundLoading(false)
    }
  }

  const onTechIa = async () => {
    if (!ticker) return
    setTechLoading(true)
    try {
      const res = await fetch(`${API}/api/chat/analizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          historial: [],
          mensaje:
            `Hacé análisis técnico de ${ticker}. Indicadores actuales: RSI ${fmtNum(rsi)}, ` +
            `MACD ${fmtNum(macd)} vs señal ${fmtNum(macdSignal)}, MA20 ${fmtNum(ma20v)}, MA50 ${fmtNum(ma50v)}, ` +
            `Bollinger sup ${fmtNum(bbUpper)} inf ${fmtNum(bbLower)}. Dame señal concreta.`,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { respuesta?: string }
      setTechIa(j.respuesta ?? '(Sin respuesta)')
    } catch (e) {
      setTechIa(e instanceof Error ? e.message : 'Error IA técnica')
    } finally {
      setTechLoading(false)
    }
  }

  return (
    <div className="page">
      <h1>Stock Lab</h1>
      <p className="page-sub">Laboratorio de análisis fundamental y técnico por ticker.</p>

      <div className="stock-lab-input">
        <input
          value={tickerInput}
          onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
          placeholder="Ej: AAPL, MSFT, GGAL.BA"
        />
        <button className="portfolio-ai-btn" onClick={() => void runAnalyze()} disabled={loading}>
          {loading ? 'Analizando…' : 'Analizar'}
        </button>
      </div>
      {suggestions.length > 0 ? (
        <div className="stock-lab-suggest">
          {suggestions.map((s) => (
            <button key={s.symbol} type="button" onClick={() => { setTickerInput(s.symbol); setSuggestions([]); void runAnalyze(s.symbol) }}>
              {s.symbol} {s.name ? `· ${s.name}` : ''}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="error-box">{error}</p> : null}

      <div className="stock-lab-tabs">
        <button className={tab === 'fundamentals' ? 'active' : ''} onClick={() => setTab('fundamentals')}>
          Fundamentals
        </button>
        <button className={tab === 'technicals' ? 'active' : ''} onClick={() => setTab('technicals')}>
          Technicals
        </button>
      </div>

      {tab === 'fundamentals' ? (
        <div className="stock-lab-grid">
          <div className="panel">
            <h2>Valuación</h2>
            <div className="lab-grid-2">
              <p>P/E: <span className={scoreClass(Number(fund.pe_ratio ?? 0) > 0 && Number(fund.pe_ratio ?? 0) < 28, Number(fund.pe_ratio ?? 0) < 40)}>{fmtNum(fund.pe_ratio)}</span></p>
              <p>P/B: <span className={scoreClass(Number(fund.pb_ratio ?? 0) > 0 && Number(fund.pb_ratio ?? 0) < 5)}>{fmtNum(fund.pb_ratio)}</span></p>
              <p>EPS: <span className={scoreClass(Number(fund.eps ?? 0) > 0)}>{fmtNum(fund.eps)}</span></p>
              <p>Market Cap: <span className={scoreClass(Number(fund.market_cap ?? 0) > 0)}>{fmtNum(fund.market_cap)}</span></p>
            </div>
            <h3>Salud</h3>
            <div className="lab-grid-2">
              <p>Revenue: <b>{fmtNum(fund.revenue)}</b></p>
              <p>Growth: <span className={scoreClass(Number(fund.revenue_growth ?? 0) > 0)}>{fmtNum(Number(fund.revenue_growth ?? 0) * 100)}%</span></p>
              <p>Margin: <span className={scoreClass(Number(fund.profit_margin ?? 0) > 0)}>{fmtNum(Number(fund.profit_margin ?? 0) * 100)}%</span></p>
              <p>ROE: <span className={scoreClass(Number(fund.roe ?? 0) > 0.08)}>{fmtNum(Number(fund.roe ?? 0) * 100)}%</span></p>
              <p>D/E: <span className={scoreClass(Number(fund.debt_to_equity ?? 0) < 1.2, Number(fund.debt_to_equity ?? 0) < 2)}>{fmtNum(fund.debt_to_equity)}</span></p>
            </div>
            <h3>Precio objetivo</h3>
            <p>Actual: <b>{fmtNum(priceNow)}</b> · Objetivo: <b>{fmtNum(target)}</b></p>
            <div className="lab-target-track"><div className="lab-target-fill" style={{ width: `${targetPct}%` }} /></div>
          </div>

          <div className="panel">
            <h2>Revenue & Earnings</h2>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="año" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="#00a87a" name="Revenue" />
                  <Bar dataKey="earnings" fill="#6366f1" name="Earnings" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <h3>Descripción</h3>
            <p className="font-prose">{String(asset?.info?.description ?? fund.description ?? 'Sin descripción')}</p>
            <button className="portfolio-ai-btn" onClick={() => void onFundIa()} disabled={fundLoading}>
              {fundLoading ? 'Generando…' : 'Análisis fundamental IA'}
            </button>
            {fundIa ? <div className="panel"><AnalysisMarkdown source={fundIa} /></div> : null}
          </div>
        </div>
      ) : (
        <div className="stock-lab-grid">
          <div className="panel">
            <div className="lab-range-row">
              {RANGES.map((r) => (
                <button key={r} className={r === range ? 'active' : ''} onClick={() => setRange(r)}>{r}</button>
              ))}
            </div>
            <div ref={chartRef} style={{ width: '100%', minHeight: 500 }} />
          </div>
          <div className="panel">
            <h2>Indicadores</h2>
            <div className="lab-grid-2">
              <p>RSI: <span className={scoreClass((rsi ?? 50) > 35 && (rsi ?? 50) < 70, (rsi ?? 50) < 80)}>{fmtNum(rsi)}</span></p>
              <p>MACD: <span className={scoreClass((macd ?? 0) >= (macdSignal ?? 0))}>{fmtNum(macd)}</span></p>
              <p>Bollinger: <span className={scoreClass((close ?? 0) <= (bbUpper ?? Infinity) && (close ?? 0) >= (bbLower ?? -Infinity))}>{fmtNum(close)}</span></p>
              <p>MA20: <span className={scoreClass((close ?? 0) >= (ma20v ?? 0))}>{fmtNum(ma20v)}</span></p>
              <p>MA50: <span className={scoreClass((close ?? 0) >= (ma50v ?? 0))}>{fmtNum(ma50v)}</span></p>
              <p>Volumen: <b>{fmtNum(vol)}</b></p>
            </div>
            <button className="portfolio-ai-btn" onClick={() => void onTechIa()} disabled={techLoading}>
              {techLoading ? 'Generando…' : 'Análisis técnico IA'}
            </button>
            {techIa ? <div className="panel"><AnalysisMarkdown source={techIa} /></div> : null}
          </div>
        </div>
      )}
    </div>
  )
}
