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

          {data.info.descripcion ? (
            <p className="activo-desc font-prose">{data.info.descripcion}</p>
          ) : null}
        </>
      )}
    </div>
  )
}
