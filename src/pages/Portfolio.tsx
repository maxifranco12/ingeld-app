import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import Papa from 'papaparse'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useAuth } from '../context/AuthContext'
import { exportPortfolioPdf } from '../lib/exportAnalisisPdf'
import { exportPortfolioExcel } from '../lib/exportPortfolioExcel'
import {
  ASSET_COLORS,
  classifyAssetType,
  classifyGeo,
  type AssetBucket,
} from '../lib/portfolioClassify'
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'

const API = import.meta.env.VITE_API_URL ?? ''
const LS_KEY = 'ingeld_portfolio'

type Moneda = 'USD' | 'ARS'

type Position = {
  id: string
  ticker: string
  cantidad: number
  precioCompra: number
  moneda: Moneda
  /** ISO date YYYY-MM-DD — opcional, para CSV y gráfico de performance */
  fechaCompra?: string
}

type QuoteRow = {
  symbol: string
  name: string
  price: number
  changePct: number
  currency: string
}

/** Campos del modal "Nueva posición" (strings en inputs controlados). */
type PortfolioFormState = {
  ticker: string
  cantidad: string
  precioCompra: string
  moneda: Moneda
  fechaCompra: string
}

function loadPositions(): Position[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const p = JSON.parse(raw) as unknown
    if (!Array.isArray(p)) return []
    return p
      .map((x) => x as Position)
      .filter(
        (x) =>
          x &&
          typeof x.ticker === 'string' &&
          typeof x.cantidad === 'number' &&
          typeof x.precioCompra === 'number' &&
          (x.moneda === 'USD' || x.moneda === 'ARS'),
      )
      .map((x) => {
        const o = x as Position & { fechaCompra?: string }
        const fc =
          typeof o.fechaCompra === 'string' && /^\d{4}-\d{2}-\d{2}/.test(o.fechaCompra)
            ? o.fechaCompra.slice(0, 10)
            : undefined
        return fc ? { ...o, fechaCompra: fc } : o
      })
  } catch {
    return []
  }
}

function savePositions(list: Position[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

function parsePortfolioRaw(raw: unknown): Position[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((x) => x as Position)
    .filter(
      (x) =>
        x &&
        typeof x.id === 'string' &&
        typeof x.ticker === 'string' &&
        typeof x.cantidad === 'number' &&
        typeof x.precioCompra === 'number' &&
        (x.moneda === 'USD' || x.moneda === 'ARS'),
    )
    .map((x) => {
      const fc = x.fechaCompra
      if (typeof fc === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fc)) {
        return { ...x, fechaCompra: fc.slice(0, 10) }
      }
      const { fechaCompra: _, ...rest } = x
      return rest
    })
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function Portfolio() {
  const { token, isAuthenticated } = useAuth()
  const [positions, setPositions] = useState<Position[]>(() => loadPositions())
  const [profileHydrated, setProfileHydrated] = useState(false)
  const [quotes, setQuotes] = useState<Record<string, QuoteRow>>({})
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<PortfolioFormState>({
    ticker: '',
    cantidad: '',
    precioCompra: '',
    moneda: 'ARS',
    fechaCompra: '',
  })
  const [aiLoading, setAiLoading] = useState(false)
  const [aiText, setAiText] = useState<string | null>(null)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const [modalFormErr, setModalFormErr] = useState<string | null>(null)

  const [sectorByTicker, setSectorByTicker] = useState<Record<string, string>>({})
  const [benchmark, setBenchmark] = useState<{ returnPct: number } | null>(null)
  const [perfSeries, setPerfSeries] = useState<
    { fecha: string; portfolio: number; sp500: number }[]
  >([])
  const [dividendByTicker, setDividendByTicker] = useState<
    Record<
      string,
      {
        yield_anual: number | null
        dividendos: { fecha: string; monto: number }[]
        proximo_dividendo: string | null
      }
    >
  >({})
  const [csvOpen, setCsvOpen] = useState(false)
  const [csvPreview, setCsvPreview] = useState<Position[]>([])
  const [csvErr, setCsvErr] = useState<string | null>(null)

  const tickers = useMemo(
    () => [...new Set(positions.map((p) => p.ticker.trim().toUpperCase()))],
    [positions],
  )

  const refreshQuotes = useCallback(async () => {
    if (tickers.length === 0) {
      setQuotes({})
      return
    }
    setLoading(true)
    try {
      const qs = tickers.map(encodeURIComponent).join(',')
      const res = await fetch(`${API}/api/market/quotes?symbols=${qs}`)
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { quotes: QuoteRow[] }
      const map: Record<string, QuoteRow> = {}
      for (const q of j.quotes ?? []) {
        map[q.symbol.toUpperCase()] = q
      }
      setQuotes(map)
    } catch {
      setQuotes({})
    } finally {
      setLoading(false)
    }
  }, [tickers])

  useEffect(() => {
    void refreshQuotes()
  }, [refreshQuotes])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API}/api/market/benchmark?symbols=SPY&period=6mo`)
        if (!res.ok) return
        const j = (await res.json()) as { returnPct: number }
        setBenchmark({ returnPct: j.returnPct })
      } catch {
        setBenchmark(null)
      }
    })()
  }, [])

  const tickersKey = tickers.join(',')

  useEffect(() => {
    if (tickers.length === 0) {
      setSectorByTicker({})
      return
    }
    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      for (const sym of tickers) {
        try {
          const res = await fetch(
            `${API}/api/market/asset/${encodeURIComponent(sym)}?range=6M`,
          )
          if (!res.ok) continue
          const j = (await res.json()) as { fundamentals?: { sector?: string | null } }
          const s = j.fundamentals?.sector
          next[sym] = typeof s === 'string' && s.trim() ? s.trim() : 'Sin sector'
        } catch {
          next[sym] = 'Sin sector'
        }
      }
      if (!cancelled) setSectorByTicker(next)
    })()
    return () => {
      cancelled = true
    }
  }, [tickersKey])

  useEffect(() => {
    if (tickers.length === 0) {
      setDividendByTicker({})
      return
    }
    let cancelled = false
    void (async () => {
      const next: typeof dividendByTicker = {}
      for (const sym of tickers) {
        try {
          const res = await fetch(
            `${API}/api/market/dividends/${encodeURIComponent(sym)}`,
          )
          if (!res.ok) continue
          const j = (await res.json()) as {
            yield_anual: number | null
            dividendos: { fecha: string; monto: number }[]
            proximo_dividendo: string | null
          }
          next[sym] = {
            yield_anual: j.yield_anual,
            dividendos: j.dividendos ?? [],
            proximo_dividendo: j.proximo_dividendo ?? null,
          }
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setDividendByTicker(next)
    })()
    return () => {
      cancelled = true
    }
  }, [tickersKey])

  useEffect(() => {
    if (tickers.length === 0 || positions.length === 0) {
      setPerfSeries([])
      return
    }
    let cancelled = false
    const period = '6mo'
    void (async () => {
      try {
        const spyRes = await fetch(
          `${API}/api/market/history/${encodeURIComponent('^GSPC')}?period=${period}`,
        )
        const spyAlt = spyRes.ok
          ? spyRes
          : await fetch(`${API}/api/market/history/SPY?period=${period}`)
        if (!spyAlt.ok) return
        const spyJ = (await spyAlt.json()) as {
          bars: { time: string; close: number }[]
        }
        const spyBars = spyJ.bars ?? []
        if (spyBars.length === 0) return
        const dates = spyBars.map((b) => b.time.slice(0, 10))
        const spyFirst = spyBars[0].close
        const spyNorm = spyBars.map((b) =>
          spyFirst ? (b.close / spyFirst) * 100 : 100,
        )
        const seriesBySym: Record<string, number[]> = {}
        for (const sym of tickers) {
          const hr = await fetch(
            `${API}/api/market/history/${encodeURIComponent(sym)}?period=${period}`,
          )
          if (!hr.ok) continue
          const hj = (await hr.json()) as { bars: { time: string; close: number }[] }
          const bars = hj.bars ?? []
          const map = new Map<string, number>()
          for (const b of bars) {
            map.set(b.time.slice(0, 10), b.close)
          }
          let last = NaN
          const vals = dates.map((d) => {
            const v = map.get(d)
            if (v != null) last = v
            return last
          })
          seriesBySym[sym] = vals
        }
        const out: { fecha: string; portfolio: number; sp500: number }[] = []
        for (let i = 0; i < dates.length; i++) {
          let v0 = 0
          let vt = 0
          for (const pos of positions) {
            const sym = pos.ticker.trim().toUpperCase()
            const arr = seriesBySym[sym]
            if (!arr) continue
            const p0 = arr[0]
            const pt = arr[i]
            if (!Number.isFinite(p0) || !Number.isFinite(pt)) continue
            v0 += pos.cantidad * p0
            vt += pos.cantidad * pt
          }
          const pnorm = v0 > 0 ? (vt / v0) * 100 : 100
          out.push({
            fecha: dates[i],
            portfolio: pnorm,
            sp500: spyNorm[i] ?? 100,
          })
        }
        if (!cancelled) setPerfSeries(out)
      } catch {
        if (!cancelled) setPerfSeries([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tickersKey, positions])

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setProfileHydrated(true)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${API}/api/auth/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('profile')
        const j = (await res.json()) as { portfolio?: unknown }
        const server = parsePortfolioRaw(j.portfolio)
        const local = loadPositions()
        if (cancelled) return
        if (server.length > 0) {
          setPositions(server)
          savePositions(server)
        } else if (local.length > 0) {
          await fetch(`${API}/api/auth/profile`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ portfolio: local }),
          })
        }
      } catch {
        /* localStorage ya cargado */
      } finally {
        if (!cancelled) setProfileHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, token])

  useEffect(() => {
    savePositions(positions)
  }, [positions])

  useEffect(() => {
    if (!profileHydrated || !token) return
    const handle = setTimeout(() => {
      void fetch(`${API}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ portfolio: positions }),
      })
    }, 500)
    return () => clearTimeout(handle)
  }, [positions, token, profileHydrated])

  const rows = useMemo(() => {
    return positions.map((p) => {
      const sym = p.ticker.trim().toUpperCase()
      const q = quotes[sym]
      const price = q?.price ?? 0
      const inv = p.cantidad * p.precioCompra
      const cur = p.cantidad * price
      const pl = cur - inv
      const plPct = inv !== 0 ? (pl / inv) * 100 : 0
      return {
        pos: p,
        sym,
        name: q?.name ?? sym,
        price,
        hasQuote: Boolean(q),
        inv,
        cur,
        pl,
        plPct,
        currency: p.moneda,
      }
    })
  }, [positions, quotes])

  const allocationPie = useMemo(() => {
    const buckets: Record<AssetBucket, number> = {
      'Acciones AR': 0,
      'Acciones USA': 0,
      Crypto: 0,
      ETFs: 0,
      Bonos: 0,
    }
    for (const r of rows) {
      if (!r.hasQuote) continue
      const k = classifyAssetType(r.sym)
      buckets[k] += r.cur
    }
    return (Object.entries(buckets) as [AssetBucket, number][])
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }))
  }, [rows])

  const sectorBarData = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) {
      if (!r.hasQuote) continue
      const sec = sectorByTicker[r.sym] ?? 'Sin sector'
      m[sec] = (m[sec] ?? 0) + r.cur
    }
    const total = Object.values(m).reduce((a, b) => a + b, 0)
    return Object.entries(m)
      .map(([name, value]) => ({
        name: name.length > 22 ? `${name.slice(0, 20)}…` : name,
        fullName: name,
        pct: total > 0 ? (value / total) * 100 : 0,
        value,
      }))
      .sort((a, b) => b.value - a.value)
  }, [rows, sectorByTicker])

  const geoPie = useMemo(() => {
    const g: Record<string, number> = {
      Argentina: 0,
      USA: 0,
      Global: 0,
      Otro: 0,
    }
    for (const r of rows) {
      if (!r.hasQuote) continue
      g[classifyGeo(r.sym)] += r.cur
    }
    return Object.entries(g)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }))
  }, [rows])

  const incomeStats = useMemo(() => {
    let yieldWeighted = 0
    let w = 0
    let expectedAnnual = 0
    const historic: {
      sym: string
      fecha: string
      montoPorAccion: number
      estimado: number
    }[] = []
    for (const r of rows) {
      if (!r.hasQuote) continue
      const d = dividendByTicker[r.sym]
      if (!d) continue
      const y = d.yield_anual
      if (y != null && Number.isFinite(y)) {
        yieldWeighted += y * r.cur
        w += r.cur
        expectedAnnual += r.cur * (y / 100)
      }
      for (const div of d.dividendos) {
        historic.push({
          sym: r.sym,
          fecha: div.fecha,
          montoPorAccion: div.monto,
          estimado: div.monto * r.pos.cantidad,
        })
      }
    }
    historic.sort((a, b) => b.fecha.localeCompare(a.fecha))
    return {
      avgYield: w > 0 ? yieldWeighted / w : 0,
      expectedAnnual,
      historic: historic.slice(0, 40),
    }
  }, [rows, dividendByTicker])

  const fechaAnalisisLabel = useMemo(
    () =>
      new Date().toLocaleDateString('es-AR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [],
  )

  const fileDateSlug = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [],
  )

  const summary = useMemo(() => {
    let invUSD = 0
    let invARS = 0
    let curUSD = 0
    let curARS = 0
    for (const r of rows) {
      if (r.pos.moneda === 'USD') {
        invUSD += r.inv
        curUSD += r.cur
      } else {
        invARS += r.inv
        curARS += r.cur
      }
    }
    const plUSD = curUSD - invUSD
    const plARS = curARS - invARS
    const pctUSD = invUSD !== 0 ? (plUSD / invUSD) * 100 : 0
    const pctARS = invARS !== 0 ? (plARS / invARS) * 100 : 0
    const withPct = rows.filter((r) => r.hasQuote && r.inv !== 0)
    let best: { sym: string; pct: number } | null = null
    let worst: { sym: string; pct: number } | null = null
    for (const r of withPct) {
      if (best === null || r.plPct > best.pct) best = { sym: r.sym, pct: r.plPct }
      if (worst === null || r.plPct < worst.pct) worst = { sym: r.sym, pct: r.plPct }
    }
    return {
      invUSD,
      invARS,
      curUSD,
      curARS,
      plUSD,
      plARS,
      pctUSD,
      pctARS,
      best,
      worst,
    }
  }, [rows])

  const benchDiffUsd = useMemo(() => {
    if (!benchmark) return null
    return summary.pctUSD - benchmark.returnPct
  }, [benchmark, summary.pctUSD])

  const handleGuardarPosicion = () => {
    setModalFormErr(null)
    const { ticker, cantidad, precioCompra, moneda, fechaCompra } = form
    const cantidadNum = parseFloat(cantidad)
    const precioNum = parseFloat(precioCompra)

    if (
      !ticker.trim() ||
      isNaN(cantidadNum) ||
      cantidadNum <= 0 ||
      isNaN(precioNum) ||
      precioNum <= 0
    ) {
      setModalFormErr('Completá ticker, cantidad y precio (números > 0)')
      return
    }
    const t = ticker.trim().toUpperCase()
    let fc: string | undefined
    if (fechaCompra.trim()) {
      const d = fechaCompra.trim().slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) fc = d
    }
    const nuevaPosicion: Position = {
      id: uid(),
      ticker: t,
      cantidad: cantidadNum,
      precioCompra: precioNum,
      moneda,
      ...(fc ? { fechaCompra: fc } : {}),
    }
    setPositions((prev) => {
      const next = [...prev, nuevaPosicion]
      savePositions(next)
      return next
    })
    setForm({
      ticker: '',
      cantidad: '',
      precioCompra: '',
      moneda: 'ARS',
      fechaCompra: '',
    })
    setModalFormErr(null)
    setModal(false)
  }

  const remove = (id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id))
  }

  const runAi = async () => {
    if (rows.length === 0) return
    setAiLoading(true)
    setAiErr(null)
    setAiText(null)
    const lines = rows.map((r) => {
      const q = quotes[r.sym]
      const nombre = q?.name ?? r.sym
      return (
        `- ${r.sym} (${nombre}): cantidad ${r.pos.cantidad}, compra ${r.pos.precioCompra} ${r.pos.moneda}, ` +
        `actual ${r.hasQuote ? r.price.toFixed(4) : 'N/D'}, P&L ${r.plPct.toFixed(2)}% (${r.pl.toFixed(2)} ${r.pos.moneda})`
      )
    })
    const mensaje = `Cartera del usuario:\n${lines.join('\n')}\n\nResumí riesgos, diversificación y próximos pasos.`
    try {
      const res = await fetch(`${API}/api/chat/analizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: 'PORTFOLIO',
          mensaje,
          historial: [],
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { respuesta: string }
      setAiText(j.respuesta ?? '')
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setAiLoading(false)
    }
  }

  const handleExportPdf = () => {
    if (!aiText) return
    exportPortfolioPdf({
      rows: rows.map((r) => ({
        sym: r.sym,
        cantidad: r.pos.cantidad,
        precioCompra: r.pos.precioCompra,
        precioActual: r.hasQuote ? r.price : null,
        pl: r.hasQuote ? r.pl : null,
        plPct: r.hasQuote ? r.plPct : null,
        moneda: r.pos.moneda,
        hasQuote: r.hasQuote,
      })),
      summary: {
        invARS: summary.invARS,
        invUSD: summary.invUSD,
        curARS: summary.curARS,
        curUSD: summary.curUSD,
        plARS: summary.plARS,
        plUSD: summary.plUSD,
      },
      aiMarkdown: aiText,
    })
  }

  const handleExportExcel = () => {
    if (!aiText) return
    exportPortfolioExcel({
      fileDateSlug,
      rows: rows.map((r) => ({
        ticker: r.sym,
        nombre: r.hasQuote ? r.name : '—',
        cantidad: r.pos.cantidad,
        precioCompra: r.pos.precioCompra,
        precioActual: r.hasQuote
          ? r.price.toLocaleString('es-AR', { maximumFractionDigits: 4 })
          : '—',
        pl: r.hasQuote
          ? `${r.pl >= 0 ? '+' : ''}${r.pl.toLocaleString('es-AR', {
              maximumFractionDigits: 2,
            })} ${r.pos.moneda}`
          : '—',
        plPct: r.hasQuote
          ? `${r.plPct >= 0 ? '+' : ''}${r.plPct.toFixed(2)}%`
          : '—',
        valorTotal: r.hasQuote
          ? r.cur.toLocaleString('es-AR', { maximumFractionDigits: 2 })
          : '—',
        moneda: r.pos.moneda,
      })),
      summary: {
        totalInvertidoARS:
          summary.invARS > 0
            ? `${summary.invARS.toLocaleString('es-AR', {
                maximumFractionDigits: 0,
              })} ARS`
            : '—',
        totalInvertidoUSD:
          summary.invUSD > 0
            ? `${summary.invUSD.toLocaleString('es-AR', {
                maximumFractionDigits: 2,
              })} USD`
            : '—',
        valorActualARS:
          summary.curARS > 0
            ? `${summary.curARS.toLocaleString('es-AR', {
                maximumFractionDigits: 0,
              })} ARS`
            : '—',
        valorActualUSD:
          summary.curUSD > 0
            ? `${summary.curUSD.toLocaleString('es-AR', {
                maximumFractionDigits: 2,
              })} USD`
            : '—',
        plARS:
          summary.invARS > 0
            ? `${summary.plARS >= 0 ? '+' : ''}${summary.plARS.toLocaleString(
                'es-AR',
                { maximumFractionDigits: 0 },
              )} ARS`
            : '—',
        plUSD:
          summary.invUSD > 0
            ? `${summary.plUSD >= 0 ? '+' : ''}${summary.plUSD.toLocaleString(
                'es-AR',
                { maximumFractionDigits: 2 },
              )} USD`
            : '—',
        mejorPosicion: summary.best
          ? `${summary.best.sym} (${summary.best.pct >= 0 ? '+' : ''}${summary.best.pct.toFixed(2)}%)`
          : '—',
        peorPosicion: summary.worst
          ? `${summary.worst.sym} (${summary.worst.pct.toFixed(2)}%)`
          : '—',
      },
    })
  }

  const onCsvFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setCsvErr(null)
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data
        const parsed: Position[] = []
        const errs: string[] = []
        for (let i = 0; i < data.length; i++) {
          const row = data[i]
          const ticker = String(row.ticker ?? row.Ticker ?? '').trim().toUpperCase()
          const cant = parseFloat(String(row.cantidad ?? row.Cantidad ?? ''))
          const precio = parseFloat(
            String(row.precio_compra ?? row.precioCompra ?? row['precio compra'] ?? ''),
          )
          const monRaw = String(row.moneda ?? row.Moneda ?? 'ARS')
            .trim()
            .toUpperCase()
          const moneda: Moneda = monRaw === 'USD' ? 'USD' : 'ARS'
          const fechaRaw = String(row.fecha ?? row.Fecha ?? '').trim()
          if (!ticker || Number.isNaN(cant) || cant <= 0 || Number.isNaN(precio) || precio <= 0) {
            errs.push(`Fila ${i + 2}`)
            continue
          }
          let fechaCompra: string | undefined
          if (fechaRaw && /^\d{4}-\d{2}-\d{2}/.test(fechaRaw)) {
            fechaCompra = fechaRaw.slice(0, 10)
          }
          parsed.push({
            id: uid(),
            ticker,
            cantidad: cant,
            precioCompra: precio,
            moneda,
            ...(fechaCompra ? { fechaCompra } : {}),
          })
        }
        if (errs.length) setCsvErr(`Filas omitidas: ${errs.join(', ')}`)
        setCsvPreview(parsed)
        setCsvOpen(true)
      },
      error: (err) => setCsvErr(err.message),
    })
  }

  const confirmCsvImport = () => {
    if (csvPreview.length === 0) return
    setPositions((prev) => {
      const next = [...prev, ...csvPreview]
      savePositions(next)
      return next
    })
    setCsvOpen(false)
    setCsvPreview([])
    setCsvErr(null)
  }

  return (
    <div className="portfolio-page">
      <h1 className="page-title">Portfolio</h1>
      <p className="page-sub">
        Cargá posiciones manualmente. El valor actual se actualiza con
        cotizaciones en vivo.
      </p>

      <section className="dash-zone" aria-labelledby="pf-pos">
        <div className="portfolio-toolbar">
          <h2 id="pf-pos" className="dash-zone-title">
            Mis posiciones
          </h2>
          <button
            type="button"
            className="portfolio-add-btn"
            onClick={() => setModal(true)}
          >
            Agregar posición
          </button>
          <button
            type="button"
            className="portfolio-refresh-btn"
            onClick={() => void refreshQuotes()}
            disabled={loading || tickers.length === 0}
          >
            {loading ? 'Actualizando…' : 'Actualizar cotizaciones'}
          </button>
          <label className="portfolio-csv-btn">
            <input
              type="file"
              accept=".csv,text/csv"
              className="portfolio-csv-input"
              onChange={onCsvFile}
            />
            Importar CSV
          </label>
        </div>

        {positions.length === 0 ? (
          <p className="page-sub font-prose">No hay posiciones aún.</p>
        ) : (
          <div className="portfolio-table-wrap">
            <table className="portfolio-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Nombre</th>
                  <th>Cantidad</th>
                  <th>P. Compra</th>
                  <th>P. Actual</th>
                  <th>P&L $</th>
                  <th>P&L %</th>
                  <th>Valor total</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const plPos = r.pl >= 0
                  return (
                    <tr key={r.pos.id}>
                      <td className="pf-tick">{r.sym}</td>
                      <td className="font-prose">{r.hasQuote ? r.name : '—'}</td>
                      <td>{r.pos.cantidad}</td>
                      <td>
                        {r.pos.precioCompra.toLocaleString('es-AR', {
                          maximumFractionDigits: 4,
                        })}{' '}
                        {r.pos.moneda}
                      </td>
                      <td>
                        {r.hasQuote
                          ? `${r.price.toLocaleString('es-AR', { maximumFractionDigits: 4 })}`
                          : '—'}
                      </td>
                      <td className={plPos ? 'gain' : 'loss'}>
                        {r.hasQuote
                          ? `${r.pl >= 0 ? '+' : ''}${r.pl.toLocaleString('es-AR', {
                              maximumFractionDigits: 2,
                            })} ${r.pos.moneda}`
                          : '—'}
                      </td>
                      <td className={plPos ? 'gain' : 'loss'}>
                        {r.hasQuote
                          ? `${r.plPct >= 0 ? '+' : ''}${r.plPct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td>
                        {r.hasQuote
                          ? `${r.cur.toLocaleString('es-AR', {
                              maximumFractionDigits: 2,
                            })} ${r.pos.moneda}`
                          : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="portfolio-remove"
                          onClick={() => remove(r.pos.id)}
                          aria-label="Quitar"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {positions.length > 0 && (
        <section className="dash-zone" aria-labelledby="pf-sum">
          <h2 id="pf-sum" className="dash-zone-title">
            Resumen de cartera
          </h2>
          <div className="portfolio-summary">
            <article className="portfolio-sum-card">
              <h3>Total invertido</h3>
              <p className="pf-sum-num">
                {summary.invARS > 0 && (
                  <>
                    {summary.invARS.toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    ARS
                    <br />
                  </>
                )}
                {summary.invUSD > 0 && (
                  <>
                    {summary.invUSD.toLocaleString('es-AR', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    USD
                  </>
                )}
                {summary.invARS === 0 && summary.invUSD === 0 && '—'}
              </p>
            </article>
            <article className="portfolio-sum-card">
              <h3>Valor actual</h3>
              <p className="pf-sum-num">
                {summary.curARS > 0 && (
                  <>
                    {summary.curARS.toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    ARS
                    <br />
                  </>
                )}
                {summary.curUSD > 0 && (
                  <>
                    {summary.curUSD.toLocaleString('es-AR', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    USD
                  </>
                )}
                {summary.curARS === 0 && summary.curUSD === 0 && '—'}
              </p>
            </article>
            <article className="portfolio-sum-card">
              <h3>P&L total</h3>
              <p className="pf-sum-num">
                {summary.invARS > 0 && (
                  <span className={summary.plARS >= 0 ? 'gain' : 'loss'}>
                    {summary.plARS >= 0 ? '+' : ''}
                    {summary.plARS.toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    ARS
                    <br />
                  </span>
                )}
                {summary.invUSD > 0 && (
                  <span className={summary.plUSD >= 0 ? 'gain' : 'loss'}>
                    {summary.plUSD >= 0 ? '+' : ''}
                    {summary.plUSD.toLocaleString('es-AR', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    USD
                  </span>
                )}
              </p>
            </article>
            <article className="portfolio-sum-card">
              <h3>P&L total %</h3>
              <p className="pf-sum-num">
                {summary.invARS > 0 && (
                  <span className={summary.pctARS >= 0 ? 'gain' : 'loss'}>
                    ARS: {summary.pctARS >= 0 ? '+' : ''}
                    {summary.pctARS.toFixed(2)}%
                    <br />
                  </span>
                )}
                {summary.invUSD > 0 && (
                  <span className={summary.pctUSD >= 0 ? 'gain' : 'loss'}>
                    USD: {summary.pctUSD >= 0 ? '+' : ''}
                    {summary.pctUSD.toFixed(2)}%
                  </span>
                )}
                {summary.invARS === 0 && summary.invUSD === 0 && '—'}
              </p>
            </article>
          </div>
          {summary.best && (
            <p className="portfolio-best font-prose">
              Mejor posición: <strong>{summary.best.sym}</strong>{' '}
              <span className="gain">+{summary.best.pct.toFixed(2)}%</span>
            </p>
          )}
          {summary.worst && (
            <p className="portfolio-worst font-prose">
              Peor posición: <strong>{summary.worst.sym}</strong>{' '}
              <span className="loss">{summary.worst.pct.toFixed(2)}%</span>
            </p>
          )}
        </section>
      )}

      {positions.length > 0 && (
        <section className="dash-zone" aria-labelledby="pf-ins">
          <h2 id="pf-ins" className="dash-zone-title">
            Insights de cartera
          </h2>
          <div className="insights-grid">
            <div className="chart-container">
              <h3 className="chart-title">Asignación por tipo</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={allocationPie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={88}
                    label
                  >
                    {allocationPie.map((entry, i) => (
                      <Cell
                        key={String(i)}
                        fill={ASSET_COLORS[entry.name as AssetBucket] ?? '#888'}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-container">
              <h3 className="chart-title">Exposición por sector</h3>
              <p className="chart-subtitle font-prose">% del valor de cartera</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  layout="vertical"
                  data={sectorBarData}
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                  <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} />
                  <YAxis type="category" dataKey="name" width={100} />
                  <Tooltip />
                  <Bar dataKey="pct" name="% cartera" fill="#00a87a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-container insights-geo-pie">
              <h3 className="chart-title">Distribución geográfica</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={geoPie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    label
                  >
                    {geoPie.map((_, i) => (
                      <Cell
                        key={String(i)}
                        fill={['#00a87a', '#3b82f6', '#f59e0b', '#94a3b8'][i % 4]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {positions.length > 0 && (
        <section className="dash-zone" aria-labelledby="pf-perf">
          <h2 id="pf-perf" className="dash-zone-title">
            Performance
          </h2>
          <div className="portfolio-perf-row font-prose">
            <p>
              Tu retorno USD:{' '}
              <strong className={summary.pctUSD >= 0 ? 'gain' : 'loss'}>
                {summary.invUSD > 0
                  ? `${summary.pctUSD >= 0 ? '+' : ''}${summary.pctUSD.toFixed(2)}%`
                  : '—'}
              </strong>
            </p>
            <p>
              S&amp;P 500 (6m):{' '}
              <strong>
                {benchmark
                  ? `${benchmark.returnPct >= 0 ? '+' : ''}${benchmark.returnPct.toFixed(2)}%`
                  : '—'}
              </strong>
            </p>
            <p>
              Diferencia vs S&amp;P (USD):{' '}
              <strong
                className={
                  benchDiffUsd != null && benchDiffUsd >= 0 ? 'gain' : 'loss'
                }
              >
                {benchDiffUsd != null
                  ? `${benchDiffUsd >= 0 ? '+' : ''}${benchDiffUsd.toFixed(2)}%`
                  : '—'}{' '}
                {benchDiffUsd != null
                  ? benchDiffUsd >= 0
                    ? '(outperform)'
                    : '(underperform)'
                  : ''}
              </strong>
            </p>
          </div>
          {perfSeries.length > 1 ? (
            <div className="chart-container portfolio-perf-chart">
              <h3 className="chart-title">Cartera vs S&amp;P 500 (normalizado 100)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={perfSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                  <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
                  <YAxis domain={['auto', 'auto']} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="portfolio"
                    name="Tu cartera"
                    stroke="#00a87a"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="sp500"
                    name="S&P 500"
                    stroke="#3b82f6"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </section>
      )}

      {positions.length > 0 && (
        <section className="dash-zone income-section" aria-labelledby="pf-inc">
          <h2 id="pf-inc" className="dash-zone-title">
            Ingresos (dividendos)
          </h2>
          <div className="portfolio-income-summary font-prose">
            <p>
              Yield promedio ponderado (estim.):{' '}
              <strong>{incomeStats.avgYield.toFixed(2)}%</strong>
            </p>
            <p>
              Ingreso anual estimado (según yield):{' '}
              <strong>
                {incomeStats.expectedAnnual.toLocaleString('es-AR', {
                  maximumFractionDigits: 2,
                })}
              </strong>{' '}
              (mixto ARS/USD según posición)
            </p>
          </div>
          <div className="portfolio-income-upcoming font-prose">
            <h3 className="chart-subtitle">Próximos dividendos (ex-date info)</h3>
            <ul className="portfolio-div-list">
              {rows.map((r) => {
                const d = dividendByTicker[r.sym]
                if (!d?.proximo_dividendo) return null
                return (
                  <li key={r.sym}>
                    <strong>{r.sym}</strong>: {d.proximo_dividendo}
                  </li>
                )
              })}
            </ul>
          </div>
          <h3 className="chart-subtitle">Pagos recientes (últimos trimestres)</h3>
          <div className="portfolio-table-wrap">
            <table className="portfolio-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Fecha</th>
                  <th>$/acción</th>
                  <th>Estimado posición</th>
                </tr>
              </thead>
              <tbody>
                {incomeStats.historic.map((h, i) => (
                  <tr key={`${h.sym}-${h.fecha}-${i}`}>
                    <td className="pf-tick">{h.sym}</td>
                    <td>{h.fecha.slice(0, 10)}</td>
                    <td>{h.montoPorAccion.toFixed(4)}</td>
                    <td>{h.estimado.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="dash-zone" aria-labelledby="pf-ai">
        <h2 id="pf-ai" className="dash-zone-title">
          Análisis IA
        </h2>
        <button
          type="button"
          className="portfolio-ai-btn"
          onClick={() => void runAi()}
          disabled={aiLoading || positions.length === 0}
        >
          {aiLoading ? 'Analizando…' : 'Analizar cartera con IA'}
        </button>
        {aiErr && <div className="error-state">{aiErr}</div>}
        {aiText && (
          <div className="portfolio-ai-panel">
            <header className="portfolio-ai-panel-head">
              <span className="portfolio-ai-brand">INGELD</span>
              <span className="portfolio-ai-panel-sub">
                Análisis de cartera — {fechaAnalisisLabel}
              </span>
            </header>
            <div className="portfolio-ai-panel-divider" aria-hidden />
            <div className="portfolio-ai-export-row">
              <button
                type="button"
                className="portfolio-ai-btn"
                onClick={handleExportPdf}
              >
                Exportar PDF
              </button>
              <button
                type="button"
                className="portfolio-refresh-btn"
                onClick={handleExportExcel}
              >
                Exportar Excel
              </button>
            </div>
            <AnalysisMarkdown source={aiText} />
          </div>
        )}
      </section>

      {modal && (
        <div
          className="ingeld-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pf-modal-title"
        >
          <div
            className="ingeld-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="pf-modal-title" className="ingeld-modal-title">
              Nueva posición
            </h2>
            <label className="ingeld-modal-field">
              Ticker
              <input
                type="text"
                className="ingeld-input"
                placeholder="ej: GGAL.BA"
                value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Cantidad
              <input
                type="number"
                className="ingeld-input"
                placeholder="ej: 100"
                value={form.cantidad}
                onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Precio de compra
              <input
                type="number"
                className="ingeld-input"
                placeholder="ej: 6000"
                value={form.precioCompra}
                onChange={e => setForm(f => ({ ...f, precioCompra: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Moneda
              <select
                value={form.moneda}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    moneda: e.target.value as Moneda,
                  }))
                }
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label className="ingeld-modal-field">
              Fecha de compra (opcional)
              <input
                type="date"
                className="ingeld-input"
                value={form.fechaCompra}
                onChange={(e) => setForm((f) => ({ ...f, fechaCompra: e.target.value }))}
              />
            </label>
            {modalFormErr && (
              <p className="ingeld-modal-error" role="alert">
                {modalFormErr}
              </p>
            )}
            <div className="ingeld-modal-actions">
              <button
                type="button"
                onClick={() => {
                  setModalFormErr(null)
                  setModal(false)
                  setForm({
                    ticker: '',
                    cantidad: '',
                    precioCompra: '',
                    moneda: 'ARS',
                    fechaCompra: '',
                  })
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="ingeld-modal-primary"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleGuardarPosicion()
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {csvOpen && (
        <div
          className="ingeld-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pf-csv-title"
        >
          <div
            className="ingeld-modal ingeld-modal--wide"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="pf-csv-title" className="ingeld-modal-title">
              Vista previa — importar CSV
            </h2>
            <p className="page-sub font-prose">
              Formato: ticker, cantidad, precio_compra, moneda, fecha (opcional, YYYY-MM-DD).
            </p>
            {csvErr ? <p className="ingeld-modal-error">{csvErr}</p> : null}
            <div className="portfolio-table-wrap">
              <table className="portfolio-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Cantidad</th>
                    <th>P. compra</th>
                    <th>Moneda</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.map((p) => (
                    <tr key={p.id}>
                      <td className="pf-tick">{p.ticker}</td>
                      <td>{p.cantidad}</td>
                      <td>{p.precioCompra}</td>
                      <td>{p.moneda}</td>
                      <td>{p.fechaCompra ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ingeld-modal-actions">
              <button
                type="button"
                onClick={() => {
                  setCsvOpen(false)
                  setCsvPreview([])
                  setCsvErr(null)
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="ingeld-modal-primary"
                onClick={confirmCsvImport}
                disabled={csvPreview.length === 0}
              >
                Confirmar importación ({csvPreview.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
