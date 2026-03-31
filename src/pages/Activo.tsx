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
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { exportActivoPdf } from '../lib/exportActivoPdf'
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

type ValuationModelsPayload = {
  relative_multiples?: Record<string, unknown>
  dcf?: Record<string, unknown>
  ddm?: Record<string, unknown>
}

type FundamentalIaResponse = {
  valuacion: string
  confianza: string
  score_salud: number
  score_tecnico?: number
  score_fundamental?: number
  score_noticias?: number
  score_total?: number
  señal?: string
  precio_entrada_sugerido?: number | null
  precio_objetivo?: number | null
  stop_loss_sugerido?: number | null
  horizonte?: string
  fortalezas: string[]
  riesgos: string[]
  catalizadores?: string[]
  resumen: string
  accion_concreta?: string
  modelos_valuacion?: ValuationModelsPayload
}

type NewsItem = {
  titulo: string
  fecha: string
  url: string
  fuente?: string
  descripcion?: string
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

type FinancialsPayload = {
  años: number[]
  income: {
    revenue: Array<number | null>
    operating_income: Array<number | null>
    net_income: Array<number | null>
  }
  cashflow: {
    operating_cashflow: Array<number | null>
    free_cashflow: Array<number | null>
    net_income: Array<number | null>
  }
  valuacion_modelos: {
    dcf_20y?: number | null
    dfcf_20y?: number | null
    dni_20y?: number | null
    dfcf_terminal?: number | null
    mean_ps?: number | null
    mean_pe?: number | null
    mean_pb?: number | null
    precio_actual?: number | null
  }
}

const RANGES: ChartRange[] = ['1M', '3M', '6M', '1Y']

const GAIN = '#0a7c52'
const LOSS = '#c0293e'

function señalBadgeClass(s: string | undefined): string {
  const u = (s || 'MANTENER').toUpperCase()
  if (u === 'COMPRAR') return 'señal-badge señal-badge--comprar'
  if (u === 'VENDER') return 'señal-badge señal-badge--vender'
  if (u === 'ESPERAR') return 'señal-badge señal-badge--esperar'
  return 'señal-badge señal-badge--mantener'
}

function señalIcon(s: string | undefined): string {
  const u = (s || 'MANTENER').toUpperCase()
  if (u === 'COMPRAR') return '▲'
  if (u === 'VENDER') return '▼'
  if (u === 'ESPERAR') return '◉'
  return '◆'
}

function clampScore(n: number | undefined, fallback = 5): number {
  if (n == null || !Number.isFinite(n)) return fallback
  return Math.min(10, Math.max(1, Math.round(n)))
}

function fmtBig(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

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

async function postAnalizar(ticker: string, mensaje: string) {
  const res = await fetch(`${API}/api/chat/analizar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, mensaje, historial: [] }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  const j = (await res.json()) as { respuesta: string }
  return (j.respuesta ?? '').trim()
}

function sourceBadgeClass(source: string | undefined): string {
  const s = (source || '').toLowerCase()
  if (s.includes('bloomberg')) return 'news-source-bloomberg'
  if (s.includes('cnbc')) return 'news-source-cnbc'
  if (s.includes('reuters')) return 'news-source-reuters'
  if (s.includes('financial times') || s === 'ft' || s.includes(' ft ')) return 'news-source-ft'
  if (s.includes('wall street journal') || s.includes('wsj')) return 'news-source-wsj'
  return 'news-source-other'
}

export function Activo() {
  const { token } = useAuth()
  const { symbol: rawSymbol } = useParams<{ symbol: string }>()
  const navigate = useNavigate()
  const { toggleFavorito, esFavorito } = useFavoritos()
  const symbol = rawSymbol ? decodeURIComponent(rawSymbol) : ''
  const [range, setRange] = useState<ChartRange>('6M')
  const [data, setData] = useState<AssetPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assetNotFound, setAssetNotFound] = useState(false)
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
  const [financials, setFinancials] = useState<FinancialsPayload | null>(null)
  const [financialsLoading, setFinancialsLoading] = useState(false)
  const [financialsErr, setFinancialsErr] = useState<string | null>(null)

  const [aboutTextEs, setAboutTextEs] = useState<string | null>(null)
  const [aboutShowEs, setAboutShowEs] = useState(false)
  const [aboutTranslating, setAboutTranslating] = useState(false)
  const [livePulse, setLivePulse] = useState(false)
  const livePulseTimeoutRef = useRef<number | null>(null)

  const [newsTranslations, setNewsTranslations] = useState<
    Record<number, { titulo: string; descripcion: string }>
  >({})
  const [newsTranslating, setNewsTranslating] = useState<Record<number, boolean>>({})
  const [newsShowEs, setNewsShowEs] = useState<Record<number, boolean>>({})

  const load = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    setAssetNotFound(false)
    setData(null)
    try {
      const path = `${API}/api/market/asset/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}`
      const res = await fetch(path)
      if (!res.ok) {
        if (res.status === 404) {
          setAssetNotFound(true)
          setData(null)
          return
        }
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
    if (!data?.symbol) return
    let cancelled = false
    setFinancialsLoading(true)
    setFinancialsErr(null)
    setFinancials(null)
    void fetch(`${API}/api/market/financials/${encodeURIComponent(data.symbol)}`)
      .then(async (res) => {
        if (!res.ok) {
          const t = await res.text()
          throw new Error(t || `HTTP ${res.status}`)
        }
        return (await res.json()) as FinancialsPayload
      })
      .then((j) => {
        if (!cancelled) setFinancials(j)
      })
      .catch((e) => {
        if (!cancelled) {
          setFinancialsErr(e instanceof Error ? e.message : 'No disponible')
        }
      })
      .finally(() => {
        if (!cancelled) setFinancialsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [data?.symbol])

  useEffect(() => {
    setFundIa(null)
    setFundIaErr(null)
  }, [data?.symbol])

  useEffect(() => {
    if (!data?.symbol) return

    const poll = async () => {
      if (document.hidden) return
      try {
        const res = await fetch(
          `${API}/api/market/quotes?symbols=${encodeURIComponent(data.symbol)}`,
        )
        if (!res.ok) return
        const j = (await res.json()) as {
          quotes?: Array<{ symbol: string; price: number; changePct: number }>
        }
        const q = (j.quotes || [])[0]
        if (!q || !Number.isFinite(q.price) || !Number.isFinite(q.changePct)) return
        setData((prev) =>
          prev
            ? {
                ...prev,
                price: q.price,
                changePct: q.changePct,
              }
            : prev,
        )
        setLivePulse(true)
        if (livePulseTimeoutRef.current != null) {
          window.clearTimeout(livePulseTimeoutRef.current)
        }
        livePulseTimeoutRef.current = window.setTimeout(() => {
          setLivePulse(false)
        }, 900)
      } catch {
        /* noop */
      }
    }

    const id = window.setInterval(() => {
      void poll()
    }, 15000)

    return () => {
      window.clearInterval(id)
      if (livePulseTimeoutRef.current != null) {
        window.clearTimeout(livePulseTimeoutRef.current)
        livePulseTimeoutRef.current = null
      }
      setLivePulse(false)
    }
  }, [data?.symbol])

  useEffect(() => {
    setAboutTextEs(null)
    setAboutShowEs(false)
    setAboutTranslating(false)
    setNewsTranslations({})
    setNewsShowEs({})
    setNewsTranslating({})
  }, [data?.symbol])

  const handleAboutTranslateClick = () => {
    if (!data) return
    if (aboutShowEs) {
      setAboutShowEs(false)
      return
    }
    if (aboutTextEs) {
      setAboutShowEs(true)
      return
    }
    const raw = (
      data?.fundamentals?.description ||
      data.info.descripcion ||
      ''
    ).trim()
    if (!raw) return
    setAboutTranslating(true)
    void (async () => {
      try {
        const msg = `Traducí este texto al español de forma natural, sin agregar nada: ${raw}`
        const resp = await postAnalizar(data.symbol, msg)
        setAboutTextEs(resp)
        setAboutShowEs(true)
      } catch {
        /* noop; podríamos setear error local */
      } finally {
        setAboutTranslating(false)
      }
    })()
  }

  const handleTranslateNews = async (idx: number, n: NewsItem) => {
    if (!data) return
    if (newsTranslations[idx]) {
      setNewsShowEs((p) => ({ ...p, [idx]: !p[idx] }))
      return
    }
    setNewsTranslating((p) => ({ ...p, [idx]: true }))
    try {
      const res = await fetch(`${API}/api/chat/analizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: data.symbol,
          historial: [],
          mensaje: `Traducí al español. Devolvé SOLO JSON sin markdown: {"titulo": "...", "descripcion": "..."}
Título: ${n.titulo}
Descripción: ${n.descripcion || ''}`,
        }),
      })
      const json = (await res.json()) as { respuesta?: string }
      const text = (json.respuesta ?? '').replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(text) as { titulo: string; descripcion: string }
      setNewsTranslations((p) => ({ ...p, [idx]: parsed }))
      setNewsShowEs((p) => ({ ...p, [idx]: true }))
    } catch {
      /* noop */
    } finally {
      setNewsTranslating((p) => ({ ...p, [idx]: false }))
    }
  }

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
          tecnico: {
            rsi14: data.rsi14,
            macd_direccion: data.macd.direccion,
            precio_vs_bandas: data.bollinger.precio_vs_bandas,
            precio_vs_ma20: data.precio_vs_ma20,
            precio_vs_ma50: data.precio_vs_ma50,
          },
          contexto_noticias: newsData?.resumen_macro
            ? `${newsData.resumen_macro}${newsData.razon_oportunidad ? ` · Oportunidad: ${newsData.razon_oportunidad}` : ''}`
            : undefined,
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `HTTP ${res.status}`)
      }
      const parsed = (await res.json()) as FundamentalIaResponse
      setFundIa(parsed)
      if (token) {
        void fetch(`${API}/api/auth/historial`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ticker: data.symbol,
            tipo: 'fundamental',
            señal: parsed.señal ?? null,
            resumen: parsed.accion_concreta || parsed.resumen,
            score_total: parsed.score_total ?? null,
          }),
        })
      }
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

  const aboutBaseText = (f?.description || data?.info.descripcion || '').trim()
  const aboutDisplayText =
    aboutShowEs && aboutTextEs
      ? aboutTextEs
      : (f?.description || data?.info.descripcion || '')

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

  const incomeTrend = financials?.años?.map((y, i) => ({
    año: String(y),
    revenue: financials.income.revenue[i] ?? null,
    operating_income: financials.income.operating_income[i] ?? null,
    net_income: financials.income.net_income[i] ?? null,
  })) ?? []

  const cashflowTrend = financials?.años?.map((y, i) => ({
    año: String(y),
    operating_cashflow: financials.cashflow.operating_cashflow[i] ?? null,
    free_cashflow: financials.cashflow.free_cashflow[i] ?? null,
    net_income: financials.cashflow.net_income[i] ?? null,
  })) ?? []

  const valuationBars = financials
    ? [
        { modelo: 'DCF 20y', valor: financials.valuacion_modelos.dcf_20y ?? null },
        { modelo: 'DFCF 20y', valor: financials.valuacion_modelos.dfcf_20y ?? null },
        { modelo: 'DNI 20y', valor: financials.valuacion_modelos.dni_20y ?? null },
        { modelo: 'DFCF terminal', valor: financials.valuacion_modelos.dfcf_terminal ?? null },
        { modelo: 'Mean P/S', valor: financials.valuacion_modelos.mean_ps ?? null },
        { modelo: 'Mean P/E', valor: financials.valuacion_modelos.mean_pe ?? null },
        { modelo: 'Mean P/B', valor: financials.valuacion_modelos.mean_pb ?? null },
      ].filter((x) => x.valor != null && Number.isFinite(x.valor))
    : []

  const valuationNow = financials?.valuacion_modelos?.precio_actual ?? data?.price ?? null

  const valuationColor = (v: number) => {
    if (valuationNow == null || !Number.isFinite(valuationNow)) return '#b0b4ba'
    if (v > valuationNow * 1.3) return '#0a7c52'
    if (v >= valuationNow * 0.9) return '#b07a10'
    return '#c0293e'
  }

  return (
    <div className="activo-page">
      <button type="button" className="activo-back-alt font-prose" onClick={() => navigate(-1)}>
        ← Volver
      </button>

      {!symbol && (
        <p className="error-state">Símbolo no válido.</p>
      )}

      {error && !assetNotFound && <div className="error-state">{error}</div>}

      {assetNotFound && symbol && (
        <div className="error-state activo-not-found font-prose">
          <p>
            No encontramos datos para <strong>{symbol}</strong>. Verificá que el
            símbolo sea correcto.
          </p>
          <button
            type="button"
            className="activo-not-found-btn"
            onClick={() => navigate('/buscador')}
          >
            Volver al buscador
          </button>
        </div>
      )}

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
                <span className={`live-indicator ${livePulse ? 'is-updated' : ''}`}>
                  <span className="live-dot" aria-hidden />
                  EN VIVO
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
            <div className="activo-header-actions">
              <button
                type="button"
                className="activo-export-btn"
                onClick={() =>
                  exportActivoPdf({
                    symbol: data.symbol,
                    companyName: data.info.nombre,
                    exchange: data.info.exchange,
                    currency: data.info.moneda,
                    price: data.price,
                    changePct: data.changePct,
                    volume: data.volume,
                    rsi14: data.rsi14,
                    macd: data.macd,
                    bollinger: data.bollinger,
                    ma20: data.ma20,
                    ma50: data.ma50,
                    precioVsMa20: data.precio_vs_ma20,
                    precioVsMa50: data.precio_vs_ma50,
                    fundamentals: data.fundamentals ?? null,
                    fundamentalIa: fundIa ?? null,
                  })
                }
              >
                Exportar PDF
              </button>
              <button
                type="button"
                className="activo-ia-btn"
                onClick={() =>
                  navigate(`/analisis?ticker=${encodeURIComponent(data.symbol)}`)
                }
              >
                Analizar con IA
              </button>
            </div>
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

          <section className="financials-section" aria-labelledby="fin-h">
            <h2 id="fin-h" className="dash-zone-title">Tendencias financieras</h2>
            {financialsLoading ? (
              <div className="financials-chart-grid">
                <div className="chart-container"><div className="skeleton-card" style={{ height: 280 }} /></div>
                <div className="chart-container"><div className="skeleton-card" style={{ height: 280 }} /></div>
              </div>
            ) : null}
            {financialsErr && !financialsLoading ? (
              <p className="page-sub font-prose">Datos financieros no disponibles</p>
            ) : null}
            {!financialsLoading && financials && (
              <>
                <div className="financials-chart-grid">
                  <div className="chart-container">
                    <h3 className="chart-title">Ingresos y rentabilidad</h3>
                    <p className="chart-subtitle font-prose">Anual</p>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={incomeTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                        <XAxis dataKey="año" />
                        <YAxis tickFormatter={(v) => fmtBig(v)} />
                        <Tooltip
                          formatter={(v) => fmtBig(Number(v))}
                          contentStyle={{
                            borderRadius: 8,
                            border: '1px solid rgba(0,0,0,0.1)',
                            background: '#faf9f7',
                          }}
                        />
                        <Legend />
                        <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" />
                        <Bar dataKey="operating_income" name="Operating Income" fill="#f59e0b" />
                        <Bar dataKey="net_income" name="Net Income" fill="#10b981" />
                        <Line type="monotone" dataKey="net_income" name="Tendencia NI" stroke="#047857" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="chart-container">
                    <h3 className="chart-title">Flujo de caja</h3>
                    <p className="chart-subtitle font-prose">Anual</p>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={cashflowTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                        <XAxis dataKey="año" />
                        <YAxis tickFormatter={(v) => fmtBig(v)} />
                        <Tooltip
                          formatter={(v) => fmtBig(Number(v))}
                          contentStyle={{
                            borderRadius: 8,
                            border: '1px solid rgba(0,0,0,0.1)',
                            background: '#faf9f7',
                          }}
                        />
                        <Legend />
                        <Bar dataKey="operating_cashflow" name="Operating CF" fill="#10b981" />
                        <Bar dataKey="free_cashflow" name="FCF" fill="#047857" />
                        <Bar dataKey="net_income" name="Net Income" fill="#f59e0b" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="chart-container valuation-chart">
                  <h3 className="chart-title">¿A qué precio vale la empresa?</h3>
                  <p className="chart-subtitle font-prose">Comparación de modelos de valuación vs precio actual</p>
                  {valuationBars.length ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <BarChart data={valuationBars} layout="vertical" margin={{ left: 24, right: 24 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                        <XAxis type="number" tickFormatter={(v) => fmtBig(v)} />
                        <YAxis type="category" dataKey="modelo" width={110} />
                        {valuationNow != null && Number.isFinite(valuationNow) ? (
                          <ReferenceLine x={valuationNow} stroke="#111827" strokeDasharray="4 3" />
                        ) : null}
                        <Tooltip
                          formatter={(v) => fmtBig(Number(v))}
                          contentStyle={{
                            borderRadius: 8,
                            border: '1px solid rgba(0,0,0,0.1)',
                            background: '#faf9f7',
                          }}
                        />
                        <Bar dataKey="valor" name="Valor modelo">
                          {valuationBars.map((entry) => (
                            <Cell key={entry.modelo} fill={valuationColor(Number(entry.valor))} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="page-sub font-prose">Datos financieros no disponibles</p>
                  )}
                </div>
              </>
            )}
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

              <div className="activo-sec-title-row">
                <h3 className="activo-subsec-title activo-subsec-title--row">Sobre la empresa</h3>
                {aboutBaseText ? (
                  <button
                    type="button"
                    className="activo-translate-btn"
                    onClick={handleAboutTranslateClick}
                    disabled={aboutTranslating}
                  >
                    {aboutTranslating ? (
                      <span className="activo-translate-spinner" aria-hidden />
                    ) : null}
                    {aboutShowEs && aboutTextEs ? 'Ver en inglés' : 'Traducir al español'}
                  </button>
                ) : null}
              </div>
              <div className="activo-about">
                {f.sector ? (
                  <span className="activo-badge-sector">{f.sector}</span>
                ) : null}
                {f.industry ? (
                  <span className="activo-badge-industry">{f.industry}</span>
                ) : null}
                {aboutBaseText ? (
                  <p className="activo-about-desc font-prose">
                    {aboutDisplayText}
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
              {fundIa && data && (
                <div className="chat-panel activo-fund-ia-panel activo-fund-ia-panel--dario">
                  <div className="activo-fund-ia-header-dario">
                    <div className={señalBadgeClass(fundIa.señal)}>
                      <span className="señal-badge-icon" aria-hidden>
                        {señalIcon(fundIa.señal)}
                      </span>
                      <span className="señal-badge-text">
                        {(fundIa.señal || 'MANTENER').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <span className={`valuation-badge ${valuationClass}`}>
                      {fundIa.valuacion.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {fundIa.accion_concreta ? (
                    <p className="activo-accion-concreta font-prose">{fundIa.accion_concreta}</p>
                  ) : null}

                  <div className="score-grid">
                    <div className="score-card">
                      <span className="score-card-label">Técnico</span>
                      <span className="score-card-val">
                        {clampScore(fundIa.score_tecnico)}/10
                      </span>
                      <div className="score-bar-track">
                        <div
                          className="score-bar-fill score-bar-fill--tech"
                          style={{ width: `${clampScore(fundIa.score_tecnico) * 10}%` }}
                        />
                      </div>
                    </div>
                    <div className="score-card">
                      <span className="score-card-label">Fundamental</span>
                      <span className="score-card-val">
                        {clampScore(fundIa.score_fundamental)}/10
                      </span>
                      <div className="score-bar-track">
                        <div
                          className="score-bar-fill score-bar-fill--fund"
                          style={{ width: `${clampScore(fundIa.score_fundamental) * 10}%` }}
                        />
                      </div>
                    </div>
                    <div className="score-card">
                      <span className="score-card-label">Noticias</span>
                      <span className="score-card-val">
                        {clampScore(fundIa.score_noticias)}/10
                      </span>
                      <div className="score-bar-track">
                        <div
                          className="score-bar-fill score-bar-fill--news"
                          style={{ width: `${clampScore(fundIa.score_noticias) * 10}%` }}
                        />
                      </div>
                    </div>
                    <div className="score-card score-card--total">
                      <span className="score-card-label">Total</span>
                      <span className="score-card-val score-card-val--big">
                        {clampScore(fundIa.score_total)}/10
                      </span>
                      <div className="score-bar-track">
                        <div
                          className="score-bar-fill score-bar-fill--total"
                          style={{ width: `${clampScore(fundIa.score_total) * 10}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <p className="activo-fund-meta-row font-prose">
                    Confianza: <strong>{fundIa.confianza}</strong>
                    {' · '}
                    Salud: <strong>{fundIa.score_salud}/10</strong>
                    {fundIa.horizonte ? (
                      <>
                        {' · '}
                        Horizonte: <strong>{fundIa.horizonte}</strong>
                      </>
                    ) : null}
                  </p>

                  {(fundIa.precio_entrada_sugerido != null &&
                    Number.isFinite(fundIa.precio_entrada_sugerido)) ||
                  (fundIa.precio_objetivo != null && Number.isFinite(fundIa.precio_objetivo)) ||
                  (fundIa.stop_loss_sugerido != null && Number.isFinite(fundIa.stop_loss_sugerido)) ? (
                    <div className="precio-niveles">
                      <h4 className="activo-fund-mini-title">Niveles sugeridos</h4>
                      <ul className="precio-niveles-list font-prose">
                        {fundIa.precio_entrada_sugerido != null &&
                        Number.isFinite(fundIa.precio_entrada_sugerido) ? (
                          <li>
                            Entrada:{' '}
                            <strong>
                              {fundIa.precio_entrada_sugerido.toLocaleString('es-AR', {
                                maximumFractionDigits: 4,
                              })}{' '}
                              {data.info.moneda}
                            </strong>
                          </li>
                        ) : null}
                        {fundIa.precio_objetivo != null && Number.isFinite(fundIa.precio_objetivo) ? (
                          <li>
                            Objetivo:{' '}
                            <strong>
                              {fundIa.precio_objetivo.toLocaleString('es-AR', {
                                maximumFractionDigits: 4,
                              })}{' '}
                              {data.info.moneda}
                            </strong>
                            {data.price > 0 ? (
                              <span className="gain">
                                {' '}
                                (
                                {(
                                  ((fundIa.precio_objetivo - data.price) / data.price) *
                                  100
                                ).toFixed(2)}
                                % vs actual)
                              </span>
                            ) : null}
                          </li>
                        ) : null}
                        {fundIa.stop_loss_sugerido != null &&
                        Number.isFinite(fundIa.stop_loss_sugerido) ? (
                          <li>
                            Stop:{' '}
                            <strong>
                              {fundIa.stop_loss_sugerido.toLocaleString('es-AR', {
                                maximumFractionDigits: 4,
                              })}{' '}
                              {data.info.moneda}
                            </strong>
                            {data.price > 0 ? (
                              <span className="loss">
                                {' '}
                                (
                                {(
                                  ((fundIa.stop_loss_sugerido - data.price) / data.price) *
                                  100
                                ).toFixed(2)}
                                % vs actual)
                              </span>
                            ) : null}
                          </li>
                        ) : null}
                      </ul>
                      {(() => {
                        const pts = [
                          fundIa.stop_loss_sugerido,
                          fundIa.precio_entrada_sugerido,
                          data.price,
                          fundIa.precio_objetivo,
                        ].filter((x): x is number => x != null && Number.isFinite(x))
                        if (pts.length < 2) return null
                        const lo = Math.min(...pts)
                        const hi = Math.max(...pts)
                        const span = hi - lo || 1
                        const pct = (p: number) => ((p - lo) / span) * 100
                        return (
                          <div className="precio-niveles-bar-wrap" aria-hidden>
                            <div className="precio-niveles-bar">
                              {fundIa.stop_loss_sugerido != null &&
                              Number.isFinite(fundIa.stop_loss_sugerido) ? (
                                <span
                                  className="precio-nivel-marker precio-nivel-marker--stop"
                                  style={{ left: `${pct(fundIa.stop_loss_sugerido)}%` }}
                                  title="Stop"
                                />
                              ) : null}
                              {fundIa.precio_entrada_sugerido != null &&
                              Number.isFinite(fundIa.precio_entrada_sugerido) ? (
                                <span
                                  className="precio-nivel-marker precio-nivel-marker--entry"
                                  style={{ left: `${pct(fundIa.precio_entrada_sugerido)}%` }}
                                  title="Entrada"
                                />
                              ) : null}
                              <span
                                className="precio-nivel-marker precio-nivel-marker--px"
                                style={{ left: `${pct(data.price)}%` }}
                                title="Precio actual"
                              />
                              {fundIa.precio_objetivo != null &&
                              Number.isFinite(fundIa.precio_objetivo) ? (
                                <span
                                  className="precio-nivel-marker precio-nivel-marker--tgt"
                                  style={{ left: `${pct(fundIa.precio_objetivo)}%` }}
                                  title="Objetivo"
                                />
                              ) : null}
                            </div>
                            <div className="precio-niveles-legend font-prose">
                              <span>{lo.toFixed(2)}</span>
                              <span>Precio actual {data.price.toFixed(4)}</span>
                              <span>{hi.toFixed(2)}</span>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  ) : null}

                  {fundIa.modelos_valuacion ? (
                    <div className="valuacion-modelos">
                      <h4 className="activo-fund-mini-title">Modelos de valuación</h4>
                      <div className="valuacion-modelos-grid">
                        <article className="valuacion-modelo-card">
                          <div className="valuacion-modelo-head">
                            <span>Múltiplos relativos</span>
                            {(() => {
                              const rm = fundIa.modelos_valuacion?.relative_multiples as
                                | Record<string, unknown>
                                | undefined
                              const prom = rm?.promedio_descuento
                              const ok =
                                typeof prom === 'number' && Number.isFinite(prom) && prom > 3
                              const bad =
                                typeof prom === 'number' && Number.isFinite(prom) && prom < -3
                              return (
                                <span
                                  className={`modelo-semaforo ${ok ? 'on' : ''} ${bad ? 'warn' : ''}`}
                                />
                              )
                            })()}
                          </div>
                          <p className="font-prose modelo-desc">
                            {(fundIa.modelos_valuacion.relative_multiples as { valuacion_relativa?: string })
                              ?.valuacion_relativa || '—'}
                          </p>
                          {(() => {
                            const rm = fundIa.modelos_valuacion?.relative_multiples as
                              | Record<string, unknown>
                              | undefined
                            const p = rm?.promedio_descuento
                            return typeof p === 'number' && Number.isFinite(p) ? (
                              <p className="font-prose modelo-metric">
                                vs sector (prom. descuento múltiplos):{' '}
                                <strong>{p.toFixed(1)}%</strong>
                              </p>
                            ) : null
                          })()}
                        </article>
                        <article className="valuacion-modelo-card">
                          <div className="valuacion-modelo-head">
                            <span>DCF simplificado</span>
                            {(() => {
                              const d = fundIa.modelos_valuacion?.dcf as
                                | Record<string, unknown>
                                | undefined
                              const up = d?.upside_dcf
                              const ok =
                                d?.disponible === true &&
                                typeof up === 'number' &&
                                up > 0
                              const bad =
                                d?.disponible === true &&
                                typeof up === 'number' &&
                                up < 0
                              return (
                                <span
                                  className={`modelo-semaforo ${ok ? 'on' : ''} ${bad ? 'warn' : ''}`}
                                />
                              )
                            })()}
                          </div>
                          {(() => {
                            const d = fundIa.modelos_valuacion?.dcf as Record<string, unknown> | undefined
                            if (!d?.disponible) {
                              return (
                                <p className="font-prose modelo-desc">
                                  {String(d?.mensaje || 'datos insuficientes')}
                                </p>
                              )
                            }
                            return (
                              <>
                                <p className="font-prose modelo-metric">
                                  Valor intrínseco est.:{' '}
                                  <strong>
                                    {Number(d.valor_intrinseco).toLocaleString('es-AR', {
                                      maximumFractionDigits: 4,
                                    })}
                                  </strong>{' '}
                                  · Upside DCF:{' '}
                                  <strong>{Number(d.upside_dcf).toFixed(2)}%</strong> · Conf.:{' '}
                                  {String(d.confianza_dcf || '—')}
                                </p>
                              </>
                            )
                          })()}
                        </article>
                        <article className="valuacion-modelo-card">
                          <div className="valuacion-modelo-head">
                            <span>DDM (Gordon)</span>
                            {(() => {
                              const dm = fundIa.modelos_valuacion?.ddm as
                                | Record<string, unknown>
                                | undefined
                              const up = dm?.upside_ddm
                              const ok = dm?.aplicable === true && typeof up === 'number' && up > 0
                              const bad = dm?.aplicable === true && typeof up === 'number' && up < 0
                              return (
                                <span
                                  className={`modelo-semaforo ${ok ? 'on' : ''} ${bad ? 'warn' : ''}`}
                                />
                              )
                            })()}
                          </div>
                          {(() => {
                            const dm = fundIa.modelos_valuacion?.ddm as Record<string, unknown> | undefined
                            if (!dm?.aplicable) {
                              return (
                                <p className="font-prose modelo-desc">Sin dividendo relevante</p>
                              )
                            }
                            return (
                              <p className="font-prose modelo-metric">
                                Valor DDM:{' '}
                                <strong>
                                  {Number(dm.valor_ddm).toLocaleString('es-AR', {
                                    maximumFractionDigits: 4,
                                  })}
                                </strong>{' '}
                                · Upside: <strong>{Number(dm.upside_ddm).toFixed(2)}%</strong>
                              </p>
                            )
                          })()}
                        </article>
                      </div>
                    </div>
                  ) : null}

                  <div className="fortalezas-riesgos">
                    <div>
                      <h4 className="activo-fund-mini-title">✅ Fortalezas</h4>
                      <ul className="activo-fund-ul font-prose">
                        {fundIa.fortalezas.map((x, i) => (
                          <li key={`f-${i}-${x.slice(0, 24)}`}>{x}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="activo-fund-mini-title">⚠️ Riesgos</h4>
                      <ul className="activo-fund-ul font-prose">
                        {fundIa.riesgos.map((x, i) => (
                          <li key={`r-${i}-${x.slice(0, 24)}`}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {fundIa.catalizadores && fundIa.catalizadores.length > 0 ? (
                    <div className="activo-catalizadores">
                      <h4 className="activo-fund-mini-title">⚡ Catalizadores a monitorear</h4>
                      <ul className="activo-fund-ul font-prose">
                        {fundIa.catalizadores.map((x, i) => (
                          <li key={`c-${i}-${x.slice(0, 24)}`}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="chat-msg chat-msg-assistant activo-fund-resumen">
                    <div className="chat-msg-meta">Analista senior · Análisis INGELD</div>
                    <div className="chat-msg-body font-prose">{fundIa.resumen}</div>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="activo-noticias" aria-labelledby="news-h">
            <div className="activo-sec-title-row">
              <h2 id="news-h" className="dash-zone-title activo-subsec-title--row">
                Noticias
              </h2>
            </div>
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
                {newsData.noticias.map((n, idx) => {
                  const titulo = newsShowEs[idx]
                    ? (newsTranslations[idx]?.titulo ?? n.titulo)
                    : n.titulo
                  const desc = newsShowEs[idx]
                    ? (newsTranslations[idx]?.descripcion ?? n.descripcion)
                    : n.descripcion
                  return (
                    <article key={`${n.url}-${idx}`} className="news-card">
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
                        {titulo}
                      </a>
                      <div className="news-source-row">
                        <span className={`news-source-badge ${sourceBadgeClass(n.fuente)}`}>
                          {n.fuente || 'Fuente'}
                        </span>
                      </div>
                      {desc ? (
                        <p className="news-card-desc font-prose">{desc}</p>
                      ) : null}
                      <p className="news-card-time">{relTimeEs(n.fecha)}</p>
                      {n.analisis ? (
                        <p className="news-card-ai font-prose">{n.analisis}</p>
                      ) : null}
                      <button
                        type="button"
                        className="activo-translate-btn news-card-translate-btn"
                        onClick={() => void handleTranslateNews(idx, n)}
                        disabled={!!newsTranslating[idx]}
                      >
                        {newsTranslating[idx] ? (
                          <span className="activo-translate-spinner" aria-hidden />
                        ) : null}
                        {newsShowEs[idx]
                          ? 'Ver en inglés'
                          : 'Traducir al español'}
                      </button>
                    </article>
                  )
                })}
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
