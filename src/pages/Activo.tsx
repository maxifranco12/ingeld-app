import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  ColorType,
  createChart,
  CandlestickSeries,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useNavigate, useParams } from 'react-router-dom'
import { useFavoritos } from '../hooks/useFavoritos'

const API = import.meta.env.VITE_API_URL ?? ''

type ChartRange = '1M' | '3M' | '6M' | '1Y'

type AssetBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type Fundamentals = {
  pe_ratio?: number | null
  pb_ratio?: number | null
  ps_ratio?: number | null
  eps?: number | null
  revenue?: number | null
  revenue_growth?: number | null
  earnings_growth?: number | null
  profit_margin?: number | null
  debt_to_equity?: number | null
  roe?: number | null
  free_cash_flow?: number | null
  market_cap?: number | null
  dividend_yield?: number | null
  '52w_high'?: number | null
  '52w_low'?: number | null
  target_price?: number | null
  analyst_recommendation?: string | null
  sector?: string | null
  industry?: string | null
  description?: string | null
}

type AssetPayload = {
  symbol: string
  range: ChartRange
  price: number
  changePct: number
  volume: number
  rsi14: number | null
  macd: {
    linea: number
    senal: number
    histograma: number
    direccion: string
  }
  bollinger: {
    superior: number
    media: number
    inferior: number
    precio_vs_bandas: string
  }
  ma20: number | null
  ma50: number | null
  precio_vs_ma20: string
  precio_vs_ma50: string | null
  bars: AssetBar[]
  info: {
    nombre: string
    exchange: string
    moneda: string
    descripcion: string
  }
  fundamentals?: Fundamentals
}

type FundamentalIaResponse = {
  valuacion: string
  confianza: string
  score_salud: number
  fortalezas: string[]
  riesgos: string[]
  resumen: string
}

type NewsItem = {
  titulo: string
  fecha: string
  url: string
  impacto: string
  es_fundamental: boolean
  analisis: string
}

type NewsPayload = {
  noticias: NewsItem[]
  resumen_macro: string
  oportunidad: boolean
  razon_oportunidad: string
}

const RANGES: ChartRange[] = ['1M', '3M', '6M', '1Y']

const GAIN = '#0a7c52'
const LOSS = '#c0293e'

function rsiZone(rsi: number | null): 'oversold' | 'overbought' | 'neutral' {
  if (rsi == null) return 'neutral'
  if (rsi < 30) return 'oversold'
  if (rsi > 70) return 'overbought'
  return 'neutral'
}

function fmtCap(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)} B`
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} mil M`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)} M`
  return n.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

function semaforoPe(pe: number | null | undefined): 'green' | 'yellow' | 'red' | 'muted' {
  if (pe == null || !Number.isFinite(pe) || pe <= 0) return 'muted'
  if (pe < 15) return 'green'
  if (pe <= 25) return 'yellow'
  return 'red'
}

function semaforoPb(pb: number | null | undefined): 'green' | 'yellow' | 'red' | 'muted' {
  if (pb == null || !Number.isFinite(pb) || pb < 0) return 'muted'
  if (pb < 1) return 'green'
  if (pb <= 3) return 'yellow'
  return 'red'
}

function pctBar01(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0
  return Math.min(100, Math.max(0, v * 100))
}

function relTimeEs(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const t = d.getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  if (diff < 0) return d.toLocaleString('es-AR')
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'hace un momento'
  const min = Math.floor(sec / 60)
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const days = Math.floor(h / 24)
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`
  return d.toLocaleDateString('es-AR')
}

function recoLabel(key: string | null | undefined): string {
  if (!key) return '—'
  const k = key.toLowerCase()
  const map: Record<string, string> = {
    strong_buy: 'Compra fuerte',
    buy: 'Compra',
    hold: 'Mantener',
    sell: 'Venta',
    strong_sell: 'Venta fuerte',
  }
  return map[k] ?? key
}

export function Activo() {
  const { symbol: rawSymbol } = useParams<{ symbol: string }>()
  const navigate = useNavigate()
  const { toggleFavorito, esFavorito } = useFavoritos()
  const symbol = rawSymbol ? decodeURIComponent(rawSymbol) : ''
  const [range, setRange] = useState<ChartRange>('6M')
  const [data, setData] = useState<AssetPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const chartApiRef = useRef<ReturnType<typeof createChart> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null)

  const [fundIa, setFundIa] = useState<FundamentalIaResponse | null>(null)
  const [fundIaLoading, setFundIaLoading] = useState(false)
  const [fundIaErr, setFundIaErr] = useState<string | null>(null)

  const [newsData, setNewsData] = useState<NewsPayload | null>(null)
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsErr, setNewsErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const path = `${API}/api/market/asset/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}`
      const res = await fetch(path)
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `HTTP ${res.status}`)
      }
      setData((await res.json()) as AssetPayload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [symbol, range])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!data?.symbol) return
    let cancelled = false
    setNewsLoading(true)
    setNewsErr(null)
    setNewsData(null)
    void fetch(`${API}/api/news/${encodeURIComponent(data.symbol)}`)
      .then(async (res) => {
        if (!res.ok) {
          const t = await res.text()
          throw new Error(t || `HTTP ${res.status}`)
        }
        return (await res.json()) as NewsPayload
      })
      .then((j) => {
        if (!cancelled) setNewsData(j)
      })
      .catch((e) => {
        if (!cancelled) {
          setNewsErr(e instanceof Error ? e.message : 'Error al cargar noticias')
        }
      })
      .finally(() => {
        if (!cancelled) setNewsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [data?.symbol])

  useEffect(() => {
    setFundIa(null)
    setFundIaErr(null)
  }, [data?.symbol])

  const runFundamentalIa = async () => {
    if (!data?.fundamentals) return
    setFundIaLoading(true)
    setFundIaErr(null)
    try {
      const res = await fetch(`${API}/api/analysis/fundamental`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: data.symbol,
          fundamentals: data.fundamentals,
          precio_actual: data.price,
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `HTTP ${res.status}`)
      }
      setFundIa((await res.json()) as FundamentalIaResponse)
    } catch (e) {
      setFundIaErr(e instanceof Error ? e.message : 'Error')
      setFundIa(null)
    } finally {
      setFundIaLoading(false)
    }
  }

  useEffect(() => {
    const el = chartRef.current
    if (!el || !data?.bars?.length) {
      if (chartApiRef.current) {
        chartApiRef.current.remove()
        chartApiRef.current = null
        seriesRef.current = null
      }
      return undefined
    }

    const grid = 'rgba(0, 0, 0, 0.06)'

    if (!chartApiRef.current) {
      const chart = createChart(el, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: 'rgba(26, 28, 32, 0.75)',
        },
        grid: {
          vertLines: { color: grid },
          horzLines: { color: grid },
        },
        width: el.clientWidth,
        height: 380,
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      })
      const series = chart.addSeries(CandlestickSeries, {
        upColor: GAIN,
        downColor: LOSS,
        borderUpColor: GAIN,
        borderDownColor: LOSS,
        wickUpColor: GAIN,
        wickDownColor: LOSS,
      })
      chartApiRef.current = chart
      seriesRef.current = series
    }

    const chart = chartApiRef.current
    const series = seriesRef.current
    if (!chart || !series) return

    const candleData = data.bars.map((b) => ({
      time: b.time as UTCTimestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))
    series.setData(candleData)
    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      if (!chartRef.current || !chartApiRef.current) return
      chartApiRef.current.resize(
        chartRef.current.clientWidth,
        380,
      )
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [data])

  useEffect(() => {
    return () => {
      chartApiRef.current?.remove()
      chartApiRef.current = null
      seriesRef.current = null
    }
  }, [])

  const pos = data ? data.changePct >= 0 : false
  const zone = rsiZone(data?.rsi14 ?? null)
  const f = data?.fundamentals

  const w52High = f?.['52w_high']
  const w52Low = f?.['52w_low']
  const range52 =
    w52High != null &&
    w52Low != null &&
    Number.isFinite(w52High) &&
    Number.isFinite(w52Low) &&
    w52High > w52Low
      ? ((data!.price - w52Low) / (w52High - w52Low)) * 100
      : null

  const target = f?.target_price
  const upside =
    target != null &&
    Number.isFinite(target) &&
    data &&
    data.price > 0
      ? ((target - data.price) / data.price) * 100
      : null

  const valuationClass =
    fundIa?.valuacion === 'INFRAVALORADA'
      ? 'valuation-badge--infra'
      : fundIa?.valuacion === 'SOBREVALORADA'
        ? 'valuation-badge--sobre'
        : 'valuation-badge--justa'

  return (
    <div className="activo-page">
      <button type="button" className="activo-back-alt font-prose" onClick={() => navigate(-1)}>
        ← Volver
      </button>

      {!symbol && (
        <p className="error-state">Símbolo no válido.</p>
      )}

      {error && <div className="error-state">{error}</div>}

      {loading && !data && (
        <p className="page-sub font-prose">Cargando activo…</p>
      )}

      {data && (
        <>
          <header className="activo-header">
            <div className="activo-header-main">
              <div className="activo-title-row">
                <h1 className="activo-ticker">{data.symbol}</h1>
              </div>
              <div className="activo-nombre-row">
                <p className="activo-nombre font-prose">{data.info.nombre}</p>
                <button
                  type="button"
                  className={`fav-star fav-star--header ${esFavorito(data.symbol) ? 'active' : 'inactive'}`}
                  aria-label="Favorito"
                  onClick={() => toggleFavorito(data.symbol)}
                >
                  {esFavorito(data.symbol) ? '★' : '☆'}
                </button>
              </div>
              {data.info.exchange && (
                <p className="activo-meta font-prose">
                  {data.info.exchange}
                  {data.info.moneda ? ` · ${data.info.moneda}` : ''}
                </p>
              )}
              <div className="activo-price-row">
                <span className="activo-precio">
                  {data.price.toLocaleString('es-AR', {
                    maximumFractionDigits: 6,
                  })}{' '}
                  {data.info.moneda}
                </span>
                <span className={`activo-var ${pos ? 'gain' : 'loss'}`}>
                  {pos ? '+' : ''}
                  {data.changePct.toFixed(2)}%
                </span>
              </div>
              <p className="activo-vol font-prose">
                Volumen: {data.volume.toLocaleString('es-AR')}
              </p>
            </div>
            <button
              type="button"
              className="activo-ia-btn"
              onClick={() =>
                navigate(`/analisis?ticker=${encodeURIComponent(data.symbol)}`)
              }
            >
              Analizar con IA
            </button>
          </header>

          <div className="activo-chart-wrap">
            <div className="activo-range-tabs" role="tablist" aria-label="Período">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={range === r}
                  className={`activo-range-tab ${range === r ? 'active' : ''}`}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <div ref={chartRef} className="activo-chart" />
          </div>

          <section className="activo-indicadores" aria-labelledby="ind-h">
            <h2 id="ind-h" className="dash-zone-title">
              Indicadores
            </h2>
            <div className="activo-ind-grid">
              <article className="scanner-card activo-ind-card">
                <h3 className="activo-ind-title">RSI (14)</h3>
                <div className="activo-rsi-val">
                  {data.rsi14 != null ? data.rsi14.toFixed(1) : '—'}
                </div>
                <div
                  className={`activo-rsi-gauge ${zone}`}
                  aria-hidden
                >
                  <div
                    className="activo-rsi-fill"
                    style={{
                      width: `${data.rsi14 != null ? Math.min(100, Math.max(0, data.rsi14)) : 0}%`,
                    }}
                  />
                </div>
                <p className="activo-rsi-hint font-prose">
                  {zone === 'oversold' && 'Zona sobrevendido (<30)'}
                  {zone === 'overbought' && 'Zona sobrecomprado (>70)'}
                  {zone === 'neutral' && 'Neutro'}
                </p>
              </article>

              <article className="scanner-card activo-ind-card">
                <h3 className="activo-ind-title">MACD (12,26,9)</h3>
                <div className="scanner-pills">
                  <span className="scanner-pill">
                    Línea {data.macd.linea.toFixed(4)}
                  </span>
                  <span className="scanner-pill">
                    Señal {data.macd.senal.toFixed(4)}
                  </span>
                  <span className="scanner-pill">
                    Hist. {data.macd.histograma.toFixed(4)}
                  </span>
                  <span className="scanner-pill">{data.macd.direccion}</span>
                </div>
              </article>

              <article className="scanner-card activo-ind-card">
                <h3 className="activo-ind-title">Bollinger (20, 2σ)</h3>
                <p className="font-prose activo-ind-line">
                  Sup. {data.bollinger.superior.toFixed(4)} · Media{' '}
                  {data.bollinger.media.toFixed(4)} · Inf.{' '}
                  {data.bollinger.inferior.toFixed(4)}
                </p>
                <p className="scanner-pill activo-bb-vs">
                  Precio: {data.bollinger.precio_vs_bandas.replace(/_/g, ' ')}
                </p>
              </article>

              <article className="scanner-card activo-ind-card">
                <h3 className="activo-ind-title">Medias móviles</h3>
                <p className="font-prose activo-ind-line">
                  MA20: {data.ma20 != null ? data.ma20.toFixed(4) : '—'} (
                  {data.precio_vs_ma20})
                </p>
                <p className="font-prose activo-ind-line">
                  MA50: {data.ma50 != null ? data.ma50.toFixed(4) : '—'}
                  {data.precio_vs_ma50 != null
                    ? ` (${data.precio_vs_ma50})`
                    : ''}
                </p>
              </article>
            </div>
          </section>

          {f && (
            <section className="activo-fundamental" aria-labelledby="fund-h">
              <h2 id="fund-h" className="dash-zone-title">
                Análisis fundamental
              </h2>

              <h3 className="activo-subsec-title">Valuación</h3>
              <div className="fundamental-grid">
                <article
                  className="metric-card"
                  title="Precio sobre ganancias: cuánto se paga por unidad de beneficio. Menor suele indicar mejor relación precio/beneficio, según el sector."
                >
                  <div className="metric-card-head">
                    <span className="metric-card-label">P/E</span>
                    <span
                      className={`metric-semaforo metric-semaforo--${semaforoPe(f.pe_ratio ?? undefined)}`}
                      aria-label="Semáforo valuación P/E"
                    />
                  </div>
                  <p className="metric-card-val">
                    {f.pe_ratio != null && Number.isFinite(f.pe_ratio)
                      ? f.pe_ratio.toFixed(2)
                      : '—'}
                  </p>
                </article>
                <article
                  className="metric-card"
                  title="Precio sobre valor contable: relación entre cotización y patrimonio por acción."
                >
                  <div className="metric-card-head">
                    <span className="metric-card-label">P/B</span>
                    <span
                      className={`metric-semaforo metric-semaforo--${semaforoPb(f.pb_ratio ?? undefined)}`}
                      aria-label="Semáforo P/B"
                    />
                  </div>
                  <p className="metric-card-val">
                    {f.pb_ratio != null && Number.isFinite(f.pb_ratio)
                      ? f.pb_ratio.toFixed(2)
                      : '—'}
                  </p>
                </article>
                <article
                  className="metric-card"
                  title="Beneficio por acción (trailing EPS)."
                >
                  <div className="metric-card-head">
                    <span className="metric-card-label">EPS</span>
                    <span className="metric-semaforo metric-semaforo--muted" />
                  </div>
                  <p className="metric-card-val">
                    {f.eps != null && Number.isFinite(f.eps)
                      ? f.eps.toLocaleString('es-AR', { maximumFractionDigits: 4 })
                      : '—'}
                  </p>
                </article>
                <article
                  className="metric-card"
                  title="Capitalización de mercado."
                >
                  <div className="metric-card-head">
                    <span className="metric-card-label">Market cap</span>
                    <span className="metric-semaforo metric-semaforo--muted" />
                  </div>
                  <p className="metric-card-val">{fmtCap(f.market_cap ?? undefined)}</p>
                </article>
              </div>

              <h3 className="activo-subsec-title">Salud financiera</h3>
              <div className="fundamental-grid">
                <article className="metric-card metric-card--wide">
                  <span className="metric-card-label">Revenue</span>
                  <p className="metric-card-val">{fmtCap(f.revenue ?? undefined)}</p>
                </article>
                <article className="metric-card metric-card--wide">
                  <span className="metric-card-label">Crecimiento ingresos</span>
                  <p className="metric-card-val">
                    {f.revenue_growth != null && Number.isFinite(f.revenue_growth)
                      ? `${(f.revenue_growth * 100).toFixed(2)}%`
                      : '—'}
                  </p>
                  {f.revenue_growth != null && Number.isFinite(f.revenue_growth) && (
                    <div className="metric-progress-wrap" aria-hidden>
                      <div
                        className="metric-progress-fill metric-progress-fill--growth"
                        style={{
                          width: `${Math.min(100, Math.max(0, 50 + f.revenue_growth * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                </article>
                <article className="metric-card metric-card--wide">
                  <span className="metric-card-label">Margen beneficio</span>
                  <p className="metric-card-val">
                    {f.profit_margin != null && Number.isFinite(f.profit_margin)
                      ? `${(f.profit_margin * 100).toFixed(2)}%`
                      : '—'}
                  </p>
                  <div className="metric-progress-wrap" aria-hidden>
                    <div
                      className="metric-progress-fill"
                      style={{ width: `${pctBar01(f.profit_margin ?? undefined)}%` }}
                    />
                  </div>
                </article>
                <article className="metric-card metric-card--wide">
                  <span className="metric-card-label">ROE</span>
                  <p className="metric-card-val">
                    {f.roe != null && Number.isFinite(f.roe)
                      ? `${(f.roe * 100).toFixed(2)}%`
                      : '—'}
                  </p>
                  <div className="metric-progress-wrap" aria-hidden>
                    <div
                      className="metric-progress-fill metric-progress-fill--roe"
                      style={{
                        width: `${Math.min(100, Math.max(0, (f.roe ?? 0) * 100))}%`,
                      }}
                    />
                  </div>
                </article>
                <article className="metric-card metric-card--wide">
                  <span className="metric-card-label">Deuda / patrimonio</span>
                  <p className="metric-card-val">
                    {f.debt_to_equity != null && Number.isFinite(f.debt_to_equity)
                      ? f.debt_to_equity.toFixed(2)
                      : '—'}
                  </p>
                </article>
              </div>

              <h3 className="activo-subsec-title">Precio objetivo</h3>
              <div className="activo-target-block">
                {target != null && Number.isFinite(target) && upside != null ? (
                  <>
                    <p className="font-prose activo-target-line">
                      Actual:{' '}
                      <strong>
                        {data.price.toLocaleString('es-AR', {
                          maximumFractionDigits: 4,
                        })}{' '}
                        {data.info.moneda}
                      </strong>
                      {' · '}
                      Objetivo analistas:{' '}
                      <strong>
                        {target.toLocaleString('es-AR', {
                          maximumFractionDigits: 4,
                        })}
                      </strong>
                    </p>
                    <p
                      className={`activo-upside font-prose ${upside >= 0 ? 'gain' : 'loss'}`}
                    >
                      Potencial: {upside >= 0 ? '+' : ''}
                      {upside.toFixed(2)}%
                    </p>
                    <p className="font-prose activo-reco">
                      Recomendación consenso:{' '}
                      <strong>{recoLabel(f.analyst_recommendation ?? undefined)}</strong>
                    </p>
                  </>
                ) : (
                  <p className="font-prose activo-target-muted">
                    No hay precio objetivo de analistas disponible para este activo.
                  </p>
                )}
                {range52 != null && w52Low != null && w52High != null && (
                  <div className="price-range-bar-wrap">
                    <div className="price-range-labels">
                      <span>{w52Low.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
                      <span className="price-range-mid">52 semanas</span>
                      <span>{w52High.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="price-range-bar" aria-hidden>
                      <div
                        className="price-range-marker"
                        style={{ left: `${Math.min(100, Math.max(0, range52))}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <h3 className="activo-subsec-title">Sobre la empresa</h3>
              <div className="activo-about">
                {f.sector ? (
                  <span className="activo-badge-sector">{f.sector}</span>
                ) : null}
                {f.industry ? (
                  <span className="activo-badge-industry">{f.industry}</span>
                ) : null}
                {(f.description || data.info.descripcion) ? (
                  <p className="activo-about-desc font-prose">
                    {f.description || data.info.descripcion}
                  </p>
                ) : (
                  <p className="activo-target-muted font-prose">Sin descripción disponible.</p>
                )}
              </div>

              <div className="activo-fund-ia-toolbar">
                <button
                  type="button"
                  className="activo-fund-ia-btn"
                  onClick={() => void runFundamentalIa()}
                  disabled={fundIaLoading}
                >
                  {fundIaLoading ? 'Generando…' : 'Análisis fundamental IA'}
                </button>
              </div>
              {fundIaErr && <div className="error-state">{fundIaErr}</div>}
              {fundIa && (
                <div className="chat-panel activo-fund-ia-panel">
                  <div className="activo-fund-ia-head">
                    <span className={`valuation-badge ${valuationClass}`}>
                      {fundIa.valuacion.replace(/_/g, ' ')}
                    </span>
                    <span className="activo-fund-meta">
                      Confianza: <strong>{fundIa.confianza}</strong>
                      {' · '}
                      Salud: <strong>{fundIa.score_salud}/10</strong>
                    </span>
                  </div>
                  <div className="activo-fund-lists">
                    <div>
                      <h4 className="activo-fund-mini-title">Fortalezas</h4>
                      <ul className="activo-fund-ul font-prose">
                        {fundIa.fortalezas.map((x, i) => (
                          <li key={`f-${i}-${x.slice(0, 24)}`}>{x}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="activo-fund-mini-title">Riesgos</h4>
                      <ul className="activo-fund-ul font-prose">
                        {fundIa.riesgos.map((x, i) => (
                          <li key={`r-${i}-${x.slice(0, 24)}`}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="chat-msg chat-msg-assistant activo-fund-resumen">
                    <div className="chat-msg-meta">Claude</div>
                    <div className="chat-msg-body font-prose">{fundIa.resumen}</div>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="activo-noticias" aria-labelledby="news-h">
            <h2 id="news-h" className="dash-zone-title">
              Noticias
            </h2>
            {newsLoading && (
              <p className="page-sub font-prose">Analizando noticias con IA…</p>
            )}
            {newsErr && <div className="error-state">{newsErr}</div>}
            {newsData?.oportunidad && (
              <div className="oportunidad-banner" role="status">
                INGELD detectó una posible oportunidad en {data.symbol}
                {newsData.razon_oportunidad
                  ? ` — ${newsData.razon_oportunidad}`
                  : ''}
              </div>
            )}
            {newsData?.resumen_macro && !newsLoading && (
              <p className="news-macro font-prose">{newsData.resumen_macro}</p>
            )}
            {newsData?.noticias?.length ? (
              <div className="news-cards-grid">
                {newsData.noticias.map((n) => (
                  <article key={n.url + n.titulo} className="news-card">
                    <div className="news-card-badges">
                      <span
                        className={
                          n.impacto === 'POSITIVO'
                            ? 'news-badge-positivo'
                            : n.impacto === 'NEGATIVO'
                              ? 'news-badge-negativo'
                              : 'news-badge-neutro'
                        }
                      >
                        {n.impacto}
                      </span>
                      {!n.es_fundamental && n.impacto === 'POSITIVO' ? (
                        <span className="news-badge-oportunidad">⚡ OPORTUNIDAD</span>
                      ) : null}
                    </div>
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="news-card-title"
                    >
                      {n.titulo}
                    </a>
                    <p className="news-card-time">{relTimeEs(n.fecha)}</p>
                    {n.analisis ? (
                      <p className="news-card-ai font-prose">{n.analisis}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
            {!newsLoading && newsData && !newsData.noticias?.length && !newsErr ? (
              <p className="page-sub font-prose">No hay noticias recientes.</p>
            ) : null}
          </section>
        </>
      )}
    </div>
  )
}
