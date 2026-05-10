import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import {
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
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'
import { useAuth } from '../context/AuthContext'

const API = import.meta.env.VITE_API_URL ?? ''

type Posicion = {
  ticker: string
  nombre: string
  peso: number
  sector: string
  razon?: string
  precio_actual?: number
}

type PortfolioIA = {
  id: string
  nombre: string
  gestor: string
  plataforma: string
  url: string
  twitter: string
  capital_inicial: number
  capital_actual: number
  inicio: string
  color: string
  posiciones: Posicion[]
}

type IngeldPortfolio = {
  id: 'ingeld'
  nombre: string
  fecha: string
  tesis: string
  posiciones: Posicion[]
  riesgo_principal: string
  retorno_esperado: string
  benchmark: string
}

type OperacionRow = {
  fecha: string
  accion: string
  ticker: string
  razon: string
}

const IA_OVERRIDES_LS = 'ingeld_portfolio_ia_overrides'

/** URLs oficiales en Autopilot por portfolio */
const AUTOPILOT_URL_BY_ID: Record<string, string> = {
  claude: 'https://joinautopilot.com/landing/5/950048',
  grok: 'https://marketplace.joinautopilot.com/landing/5/568906',
  gpt: 'https://www.joinautopilot.com/landing/5/63080',
}

type PortfolioIAOverride = {
  capital_actual?: number
  posiciones?: Posicion[]
  operaciones?: OperacionRow[]
}

type OverridesFile = Record<string, PortfolioIAOverride>

const HARDCODED: { portfolios: PortfolioIA[] } = {
  portfolios: [
    {
      id: 'claude',
      nombre: 'Claude Portfolio',
      gestor: 'Anthropic Claude',
      plataforma: 'Autopilot',
      url: 'https://joinautopilot.com/landing/5/950048',
      twitter: '@theaiportfolios',
      capital_inicial: 50000,
      capital_actual: 50013.79,
      inicio: '2026-04-01',
      color: '#00a87a',
      posiciones: [
        { ticker: 'AVGO', nombre: 'Broadcom', peso: 10, sector: 'Technology' },
        { ticker: 'VST', nombre: 'Vistra', peso: 10, sector: 'Energy' },
        { ticker: 'LLY', nombre: 'Eli Lilly', peso: 8, sector: 'Healthcare' },
        { ticker: 'GLD', nombre: 'Gold ETF', peso: 11, sector: 'Commodities' },
        { ticker: 'MSFT', nombre: 'Microsoft', peso: 8, sector: 'Technology' },
        { ticker: 'HWM', nombre: 'Howmet Aerospace', peso: 4, sector: 'Industrials' },
        { ticker: 'AU', nombre: 'Anglogold Ashanti', peso: 4, sector: 'Mining' },
      ],
    },
    {
      id: 'grok',
      nombre: 'Grok Portfolio',
      gestor: 'xAI Grok',
      plataforma: 'Autopilot',
      url: 'https://marketplace.joinautopilot.com/landing/5/568906',
      twitter: '@grokportfolio',
      capital_inicial: 50000,
      capital_actual: 50000,
      inicio: '2026-04-01',
      color: '#6366f1',
      posiciones: [],
    },
    {
      id: 'gemini',
      nombre: 'Gemini Portfolio',
      gestor: 'Google Gemini',
      plataforma: 'Autopilot',
      url: 'https://joinautopilot.com',
      twitter: '@geminiportfolio',
      capital_inicial: 50000,
      capital_actual: 50000,
      inicio: '2026-04-01',
      color: '#4285f4',
      posiciones: [],
    },
    {
      id: 'gpt',
      nombre: 'GPT Portfolio',
      gestor: 'OpenAI GPT-4',
      plataforma: 'Autopilot',
      url: 'https://www.joinautopilot.com/landing/5/63080',
      twitter: '@gptportfolio',
      capital_inicial: 50000,
      capital_actual: 50000,
      inicio: '2026-04-01',
      color: '#10a37f',
      posiciones: [],
    },
  ],
}

const LAST_OPS: Record<string, OperacionRow[]> = {
  claude: [
    {
      fecha: '2026-04-02',
      accion: 'COMPRÓ',
      ticker: 'GLD',
      razon: 'Refuerzo de cobertura ante volatilidad macro.',
    },
    {
      fecha: '2026-04-01',
      accion: 'COMPRÓ',
      ticker: 'AVGO',
      razon: 'Exposición semiconductores; tesis de IA en infraestructura.',
    },
    {
      fecha: '2026-04-01',
      accion: 'COMPRÓ',
      ticker: 'MSFT',
      razon: 'Core quality + flujos recurrentes en nube.',
    },
  ],
  grok: [
    {
      fecha: '2026-04-01',
      accion: 'COMPRÓ',
      ticker: 'SPY',
      razon: 'Inicialización del book en benchmark.',
    },
  ],
  gemini: [],
  gpt: [],
}

function readIaOverrides(): OverridesFile {
  try {
    const raw = localStorage.getItem(IA_OVERRIDES_LS)
    if (!raw) return {}
    const j = JSON.parse(raw) as OverridesFile
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  } catch {
    return {}
  }
}

function writeIaOverrides(data: OverridesFile) {
  try {
    localStorage.setItem(IA_OVERRIDES_LS, JSON.stringify(data))
  } catch {
    /* noop */
  }
}

function applyIaOverrides(portfolios: PortfolioIA[], ov: OverridesFile): PortfolioIA[] {
  return portfolios.map((p) => {
    const url = AUTOPILOT_URL_BY_ID[p.id] ?? p.url
    const o = ov[p.id]
    if (!o) return { ...p, url }
    return {
      ...p,
      url,
      ...(typeof o.capital_actual === 'number' && Number.isFinite(o.capital_actual)
        ? { capital_actual: o.capital_actual }
        : {}),
      ...(o.posiciones != null ? { posiciones: o.posiciones } : {}),
    }
  })
}

function getOpsForPortfolio(
  id: string,
  ov: OverridesFile,
  remoteOps: Record<string, OperacionRow[]> | null,
): OperacionRow[] {
  if (ov[id]?.operaciones != null) return ov[id]!.operaciones!
  return remoteOps === null ? (LAST_OPS[id] ?? []) : (remoteOps[id] ?? [])
}

type QuoteRow = {
  symbol: string
  name?: string
  price: number
  changePct: number
  currency?: string
}

const TAB_ORDER = ['ingeld', 'claude', 'grok', 'gemini', 'gpt'] as const
type TabId = (typeof TAB_ORDER)[number] | 'comparar'

const TAB_LABEL: Record<Exclude<TabId, 'comparar'>, string> = {
  ingeld: 'INGELD',
  claude: 'Claude',
  grok: 'Grok',
  gemini: 'Gemini',
  gpt: 'GPT',
}

const TAB_STYLE: Record<Exclude<TabId, 'comparar'>, string> = {
  ingeld: 'ai-pf-tab--claude',
  claude: 'ai-pf-tab--claude',
  grok: 'ai-pf-tab--grok',
  gemini: 'ai-pf-tab--gemini',
  gpt: 'ai-pf-tab--gpt',
}

const LINE_STROKE: Record<string, string> = {
  ingeld: '#00a87a',
  claude: '#00a87a',
  grok: '#6366f1',
  gemini: '#4285f4',
  gpt: '#10a37f',
}

const COL_TOP: Record<string, string> = {
  ingeld: 'ai-pf-compare-col--claude',
  claude: 'ai-pf-compare-col--claude',
  grok: 'ai-pf-compare-col--grok',
  gemini: 'ai-pf-compare-col--gemini',
  gpt: 'ai-pf-compare-col--gpt',
}

function quoteSymbolsFromPortfolios(portfolios: PortfolioIA[]): string[] {
  const syms = new Set<string>(['SPY'])
  for (const p of portfolios) {
    for (const x of p.posiciones) syms.add(x.ticker.toUpperCase())
  }
  return [...syms]
}

function totalReturnPct(p: PortfolioIA): number {
  if (!p.capital_inicial) return 0
  return (p.capital_actual / p.capital_inicial - 1) * 100
}

/** Retorno del día ponderado por peso, solo posiciones con cotización. */
function weightedDayReturnPct(
  p: PortfolioIA,
  quotes: Record<string, QuoteRow>,
): number | null {
  if (!p.posiciones.length) return null
  let sum = 0
  let n = 0
  for (const pos of p.posiciones) {
    const q = quotes[pos.ticker.toUpperCase()]
    if (q && typeof q.changePct === 'number') {
      sum += (pos.peso / 100) * q.changePct
      n += 1
    }
  }
  if (n === 0) return null
  return sum
}

function daysActive(inicio: string): number {
  const start = new Date(inicio + 'T12:00:00').getTime()
  return Math.max(1, Math.ceil((Date.now() - start) / 86_400_000))
}

function sectorPie(posiciones: Posicion[]) {
  const m = new Map<string, number>()
  for (const x of posiciones) m.set(x.sector, (m.get(x.sector) ?? 0) + x.peso)
  return [...m.entries()].map(([name, value]) => ({ name, value }))
}

function simulatedSeries(
  inicio: string,
  ids: string[],
  retById: Record<string, number>,
  points = 24,
): Record<string, string | number>[] {
  const start = new Date(inicio + 'T12:00:00')
  const ms = Date.now() - start.getTime()
  const out: Record<string, string | number>[] = []
  for (let i = 0; i <= points; i++) {
    const w = i / points
    const t = start.getTime() + (ms * w) / points
    const d = new Date(t)
    const label = `${d.getMonth() + 1}/${d.getDate()}`
    const noise = Math.sin(i * 1.7) * 0.12
    const row: Record<string, string | number> = { label }
    ids.forEach((id, idx) => {
      const ret = retById[id] ?? 0
      row[id] =
        Math.round(100 * (1 + (ret / 100) * w + noise * (1 - idx * 0.08) * w) * 100) / 100
    })
    out.push(row)
  }
  return out
}

function maxWinIdx(vals: number[]): Set<number> {
  if (!vals.length) return new Set()
  const m = Math.max(...vals)
  const s = new Set<number>()
  vals.forEach((v, i) => {
    if (Math.abs(v - m) < 1e-4) s.add(i)
  })
  return s
}

function minWinIdx(vals: number[]): Set<number> {
  if (!vals.length) return new Set()
  const m = Math.min(...vals)
  const s = new Set<number>()
  vals.forEach((v, i) => {
    if (Math.abs(v - m) < 1e-4) s.add(i)
  })
  return s
}

function estVol(series: number[]): number {
  if (series.length < 2) return 0
  const rets: number[] = []
  for (let i = 1; i < series.length; i++) {
    rets.push((series[i]! - series[i - 1]!) / series[i - 1]!)
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const v = Math.sqrt(
    rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1),
  )
  return Math.round(v * Math.sqrt(252) * 100 * 10) / 10
}

function dateLabelToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function PortfoliosIA() {
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState<TabId>('ingeld')
  const [portfolios, setPortfolios] = useState<PortfolioIA[]>(HARDCODED.portfolios)
  const [ingeldPortfolio, setIngeldPortfolio] = useState<IngeldPortfolio | null>(null)
  const [ingeldLoading, setIngeldLoading] = useState(false)
  const [ingeldError, setIngeldError] = useState(false)
  const [iaOverrides, setIaOverrides] = useState<OverridesFile>(() => readIaOverrides())
  const mergedPortfolios = useMemo(
    () => applyIaOverrides(portfolios, iaOverrides),
    [portfolios, iaOverrides],
  )
  const allPortfolios = useMemo(() => {
    const base = mergedPortfolios.filter((p) => p.id !== 'ingeld')
    if (ingeldPortfolio) {
      base.unshift({
        id: 'ingeld',
        nombre: 'Portfolio INGELD',
        gestor: 'INGELD IA',
        plataforma: 'INGELD',
        url: 'https://joinautopilot.com',
        twitter: '@ingeld',
        capital_inicial: 100,
        capital_actual: 100,
        inicio: ingeldPortfolio.fecha || dateLabelToday(),
        color: '#00a87a',
        posiciones: ingeldPortfolio.posiciones ?? [],
      })
    }
    return base
  }, [mergedPortfolios, ingeldPortfolio])
  const [pfEditId, setPfEditId] = useState<string | null>(null)
  const [editCap, setEditCap] = useState('')
  const [editPosRows, setEditPosRows] = useState<{ ticker: string; peso: string }[]>([])
  const [editOpRows, setEditOpRows] = useState<
    { fecha: string; accion: string; ticker: string; razon: string }[]
  >([])

  const [quotes, setQuotes] = useState<Record<string, QuoteRow>>({})
  const [spyBench, setSpyBench] = useState<number | null>(null)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [compareText, setCompareText] = useState<string | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [remoteOps, setRemoteOps] = useState<Record<string, OperacionRow[]> | null>(null)
  const [opsFetchedAt, setOpsFetchedAt] = useState<number | null>(null)
  const [opsMetaTick, setOpsMetaTick] = useState(0)

  const ordered = useMemo(
    () => TAB_ORDER.map((id) => allPortfolios.find((p) => p.id === id)).filter(Boolean) as PortfolioIA[],
    [allPortfolios],
  )

  const active = allPortfolios.find((p) => p.id === tab)

  useEffect(() => {
    if (!pfEditId) return
    const p = mergedPortfolios.find((x) => x.id === pfEditId)
    if (!p) return
    setEditCap(String(p.capital_actual))
    setEditPosRows(
      p.posiciones.length
        ? p.posiciones.map((x) => ({ ticker: x.ticker, peso: String(x.peso) }))
        : [{ ticker: '', peso: '' }],
    )
    const ops = getOpsForPortfolio(pfEditId, iaOverrides, remoteOps)
    setEditOpRows(
      ops.length
        ? ops.map((o) => ({
            fecha: o.fecha,
            accion: o.accion,
            ticker: o.ticker,
            razon: o.razon,
          }))
        : [{ fecha: '', accion: 'COMPRÓ', ticker: '', razon: '' }],
    )
    // Solo al cambiar modal de portfolio — evita pisar cambios cuando llegan datos remotos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pfEditId])

  useEffect(() => {
    let c = false
    void (async () => {
      try {
        const res = await fetch('/api/market/ai-portfolios')
        if (!res.ok) return
        const j = (await res.json()) as { portfolios?: PortfolioIA[] }
        if (!c && j.portfolios?.length) setPortfolios(j.portfolios)
      } catch {
        /* keep hardcoded */
      }
    })()
    return () => {
      c = true
    }
  }, [])

  const loadIngeldPortfolio = useCallback(async (force = false) => {
    setIngeldLoading(true)
    setIngeldError(false)
    try {
      const res = await fetch(`${API}/api/market/ingeld-portfolio${force ? '?force=true' : ''}`)
      if (!res.ok) throw new Error('ingeld')
      const data = (await res.json()) as Record<string, unknown>
      console.log('INGELD portfolio response:', data)
      const rawPos = Array.isArray(data.posiciones) ? data.posiciones : []
      const posiciones: Posicion[] = rawPos.map((p) => {
        const x = p as Record<string, unknown>
        return {
          ticker: String(x.ticker ?? '').toUpperCase(),
          nombre: String(x.nombre ?? x.ticker ?? ''),
          peso: Number(x.peso ?? 0),
          sector: String(x.sector ?? 'Other'),
          razon: x.razon != null ? String(x.razon) : undefined,
          precio_actual:
            x.precio_actual != null && Number.isFinite(Number(x.precio_actual))
              ? Number(x.precio_actual)
              : undefined,
        }
      }).filter((p) => p.ticker)
      const mapped: IngeldPortfolio = {
        id: 'ingeld',
        nombre: String(data.nombre ?? 'INGELD Portfolio Semana IA'),
        fecha: String(data.fecha ?? dateLabelToday()),
        tesis: String(data.tesis ?? ''),
        posiciones,
        riesgo_principal: String(data.riesgo_principal ?? ''),
        retorno_esperado: String(data.retorno_esperado ?? ''),
        benchmark: String(data.benchmark ?? 'SPY').toUpperCase(),
      }
      setIngeldPortfolio(mapped)
      setIngeldError(false)
    } catch {
      setIngeldError(true)
    } finally {
      setIngeldLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadIngeldPortfolio(false)
  }, [loadIngeldPortfolio])

  const loadQuotes = useCallback(async (syms: string[]) => {
    if (!syms.length) return
    try {
      const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(syms.join(','))}`)
      if (!res.ok) return
      const j = (await res.json()) as { quotes?: QuoteRow[] }
      const map: Record<string, QuoteRow> = {}
      for (const q of j.quotes ?? []) map[q.symbol.toUpperCase()] = q
      setQuotes((prev) => ({ ...prev, ...map }))
    } catch {
      /* noop */
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/market/benchmark?symbols=SPY&period=5d')
        if (!res.ok) return
        const j = (await res.json()) as { returnPct?: number }
        if (typeof j.returnPct === 'number') setSpyBench(j.returnPct)
      } catch {
        /* noop */
      }
    })()
  }, [])

  useEffect(() => {
    const syms = quoteSymbolsFromPortfolios(allPortfolios)
    void loadQuotes(syms)
  }, [allPortfolios, loadQuotes])

  useEffect(() => {
    const syms = quoteSymbolsFromPortfolios(allPortfolios)
    const id = window.setInterval(() => {
      void loadQuotes(syms)
    }, 30_000)
    return () => clearInterval(id)
  }, [allPortfolios, loadQuotes])

  const fetchOperations = useCallback(async () => {
    try {
      const res = await fetch('/api/market/ai-operations')
      if (!res.ok) return
      const j = (await res.json()) as { operations?: Record<string, OperacionRow[]> }
      if (j.operations) {
        setRemoteOps(j.operations)
        setOpsFetchedAt(Date.now())
      }
    } catch {
      /* noop */
    }
  }, [])

  useEffect(() => {
    void fetchOperations()
    const id = window.setInterval(() => void fetchOperations(), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchOperations])

  useEffect(() => {
    const id = window.setInterval(() => setOpsMetaTick((x) => x + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const opsAgeMin = useMemo(() => {
    if (opsFetchedAt == null) return null
    return Math.max(0, Math.floor((Date.now() - opsFetchedAt) / 60_000))
  }, [opsFetchedAt, opsMetaTick])

  const spyQ = quotes['SPY']

  const compareSeries = useMemo(() => {
    const inicio = ordered[0]?.inicio ?? '2026-04-01'
    const ids = ordered.map((p) => p.id)
    const retById: Record<string, number> = {}
    for (const p of ordered) retById[p.id] = totalReturnPct(p)
    return simulatedSeries(inicio, ids, retById)
  }, [ordered])

  const volById = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of ordered) {
      m[p.id] = estVol(compareSeries.map((d) => Number(d[p.id])))
    }
    return m
  }, [ordered, compareSeries])

  const runAnalysis = async (p: PortfolioIA) => {
    setAnalysisLoading(true)
    setAnalysis(null)
    try {
      const body = {
        ticker: 'PORTFOLIO',
        historial: [] as { role: string; content: string }[],
        mensaje: `Portfolio IA "${p.nombre}" (${p.gestor}). Capital ${p.capital_inicial} → ${p.capital_actual}. Inicio ${p.inicio}.
Posiciones: ${JSON.stringify(p.posiciones)}
Respondé en español: diversificación, tesis inferida, mejor posición, riesgos. No inventes tickers fuera de la lista.`,
      }
      const res = await fetch('/api/chat/analizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { respuesta?: string }
      setAnalysis((j.respuesta ?? '').trim())
    } catch (e) {
      setAnalysis(e instanceof Error ? e.message : 'Error')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const runCompare = async () => {
    if (ordered.length < 2) return
    setCompareLoading(true)
    setCompareText(null)
    try {
      const lines = ordered.map(
        (p) =>
          `${p.nombre}: capital ${p.capital_actual}/${p.capital_inicial}, posiciones ${JSON.stringify(p.posiciones)}`,
      )
      const res = await fetch('/api/chat/analizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: 'PORTFOLIO',
          historial: [],
          mensaje: `Compará en español estos 4 portfolios IA:\n${lines.join('\n')}\n¿Quién va ganando y por qué? Breve.`,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { respuesta?: string }
      setCompareText((j.respuesta ?? '').trim())
    } catch (e) {
      setCompareText(e instanceof Error ? e.message : 'Error')
    } finally {
      setCompareLoading(false)
    }
  }

  const saveIaPortfolioOverride = useCallback(() => {
    if (!pfEditId) return
    let cap = Number(String(editCap).replace(/\s/g, '').replace(',', '.'))
    const baseP = mergedPortfolios.find((x) => x.id === pfEditId)
    if (!Number.isFinite(cap) && baseP) cap = baseP.capital_actual
    if (!Number.isFinite(cap)) cap = 0

    const posiciones: Posicion[] = editPosRows
      .filter((r) => r.ticker.trim())
      .map((r) => {
        const ticker = r.ticker.trim().toUpperCase()
        const prev = baseP?.posiciones.find((y) => y.ticker.toUpperCase() === ticker)
        let peso = Number(String(r.peso).replace(/\s/g, '').replace(',', '.'))
        if (!Number.isFinite(peso)) peso = 0
        return {
          ticker,
          nombre: prev?.nombre ?? ticker,
          peso,
          sector: prev?.sector ?? '—',
        }
      })

    const operaciones: OperacionRow[] = editOpRows
      .filter((r) => r.fecha.trim() && r.ticker.trim())
      .map((r) => ({
        fecha: r.fecha.trim().slice(0, 10),
        accion: (r.accion.trim() || 'COMPRÓ').toUpperCase(),
        ticker: r.ticker.trim().toUpperCase(),
        razon: r.razon.trim(),
      }))

    const next: OverridesFile = {
      ...iaOverrides,
      [pfEditId]: { capital_actual: cap, posiciones, operaciones },
    }
    writeIaOverrides(next)
    setIaOverrides(next)
    setPfEditId(null)
  }, [pfEditId, editCap, editPosRows, editOpRows, iaOverrides, mergedPortfolios])

  const renderDetail = (p: PortfolioIA) => {
    const isIngeld = p.id === 'ingeld'
    const ing = isIngeld ? ingeldPortfolio : null
    const ret = totalReturnPct(p)
    const retHoy = weightedDayReturnPct(p, quotes)
    const vsSpy = spyBench != null ? Math.round((ret - spyBench) * 100) / 100 : null
    const dias = daysActive(p.inicio)
    const pie = sectorPie(p.posiciones)
    const ops = getOpsForPortfolio(p.id, iaOverrides, remoteOps)
    const accent = p.color
    const autopilotUrl = p.url

    return (
      <div className="ai-pf-stack">
        <div
          className="ai-pf-banner-weekly font-prose"
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 8,
            background: 'rgba(0, 168, 122, 0.1)',
            border: '1px solid rgba(0, 168, 122, 0.35)',
            fontSize: '0.9rem',
            lineHeight: 1.5,
            color: 'var(--text-heading)',
          }}
        >
          {isIngeld ? (
            <>🧠 Este portfolio fue generado por INGELD IA analizando 30 activos de mercados globales. Se actualiza cada lunes.</>
          ) : (
            <>
              📊 Posiciones y retornos basados en datos públicos de Autopilot · Actualización semanal{' '}
              <a href={autopilotUrl} target="_blank" rel="noopener noreferrer">
                Autopilot
              </a>
            </>
          )}
        </div>

        {isAdmin ? (
          <div style={{ marginTop: '0.65rem' }}>
            <button
              type="button"
              className="portfolio-refresh-btn"
              onClick={() => {
                if (isIngeld) void loadIngeldPortfolio(true)
                else setPfEditId(p.id)
              }}
            >
              {isIngeld
                ? ingeldLoading
                  ? 'Regenerando…'
                  : 'Regenerar portfolio'
                : '🔄 Actualizar datos'}
            </button>
          </div>
        ) : null}

        {!isIngeld ? (
          <>
            <a
              href={autopilotUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '0.95rem 1.25rem',
                marginTop: '0.85rem',
                marginBottom: '1rem',
                fontSize: '1.06rem',
                fontWeight: 700,
                background: '#00a87a',
                color: '#fff',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                boxShadow: '0 4px 14px rgba(0, 168, 122, 0.35)',
              }}
            >
              Invertir con este portfolio en Autopilot →
            </a>
            <p
              className="font-prose"
              style={{
                marginTop: '-0.25rem',
                marginBottom: '1rem',
                fontSize: '0.86rem',
                lineHeight: 1.5,
                color: 'var(--text-muted)',
              }}
            >
              Para copiar las operaciones automáticamente necesitás crear cuenta en Autopilot
              ($29/trimestre). Los datos de posiciones que ves acá se actualizan semanalmente
              desde fuentes públicas.
            </p>
          </>
        ) : null}

        <article className="ai-pf-card" style={{ borderColor: `${accent}44` }}>
          <div className="ai-pf-card-head">
            <span
              className="ai-pf-avatar"
              style={{ backgroundColor: `${accent}28`, boxShadow: `inset 0 0 0 2px ${accent}` }}
              aria-hidden
            />
            <div>
              <h2 className="ai-pf-card-title">{isIngeld ? 'Portfolio INGELD' : p.nombre}</h2>
              <p className="ai-pf-card-sub">
                {isIngeld ? 'Generado por IA · Actualizado semanalmente' : `${p.gestor} · ${p.plataforma}`}
              </p>
            </div>
          </div>
          {isIngeld ? (
            <>
              <div
                className="font-prose"
                style={{
                  marginBottom: '0.85rem',
                  padding: '0.75rem 0.9rem',
                  borderRadius: 8,
                  background: 'rgba(0, 168, 122, 0.08)',
                  border: '1px solid rgba(0, 168, 122, 0.25)',
                }}
              >
                <strong>Tesis:</strong> {ing?.tesis || '—'}
              </div>
              <p className="ai-pf-metric-hint" style={{ marginTop: '-0.2rem', marginBottom: '0.7rem' }}>
                Retorno esperado: <strong>{ing?.retorno_esperado || '—'}</strong>
              </p>
              <div
                className="font-prose"
                style={{
                  marginBottom: '0.7rem',
                  padding: '0.7rem 0.9rem',
                  borderRadius: 8,
                  background: 'rgba(192, 41, 62, 0.08)',
                  border: '1px solid rgba(192, 41, 62, 0.3)',
                }}
              >
                <strong>Riesgo principal:</strong> {ing?.riesgo_principal || '—'}
              </div>
            </>
          ) : null}
          <div className="ai-pf-metrics">
            <div>
              <p className="ai-pf-metric-label">Capital actual</p>
              <p className="ai-pf-metric-big">
                ${p.capital_actual.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
              </p>
              <p className="ai-pf-metric-hint">Inicial ${p.capital_inicial.toLocaleString('es-AR')}</p>
            </div>
            <div>
              <p className="ai-pf-metric-label">Retorno hoy</p>
              {retHoy != null ? (
                <p className={`ai-pf-metric-big ${retHoy >= 0 ? 'ai-pf-gain' : 'ai-pf-loss'}`}>
                  {retHoy >= 0 ? '+' : ''}
                  {retHoy.toFixed(2)}%
                </p>
              ) : (
                <p className="ai-pf-metric-big ai-pf-muted">—</p>
              )}
            </div>
            <div>
              <p className="ai-pf-metric-label">Retorno total (desde inicio)</p>
              <p className={`ai-pf-metric-big ${ret >= 0 ? 'ai-pf-gain' : 'ai-pf-loss'}`}>
                {ret >= 0 ? '+' : ''}
                {ret.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="ai-pf-metric-label">vs S&amp;P 500</p>
              <p className="ai-pf-metric-mid">
                {spyBench != null ? `SPY ~5d: ${spyBench >= 0 ? '+' : ''}${spyBench.toFixed(2)}%` : '—'}
              </p>
              {vsSpy != null ? (
                <p className={`ai-pf-metric-hint ${vsSpy >= 0 ? 'ai-pf-gain' : 'ai-pf-loss'}`}>
                  Δ cartera: {vsSpy >= 0 ? '+' : ''}
                  {vsSpy.toFixed(2)} pp
                </p>
              ) : null}
              {spyQ ? (
                <p className="ai-pf-metric-hint">
                  SPY {spyQ.price.toFixed(2)} ({spyQ.changePct >= 0 ? '+' : ''}
                  {spyQ.changePct.toFixed(2)}%)
                </p>
              ) : null}
            </div>
            <div>
              <p className="ai-pf-metric-label">Días activo</p>
              <p className="ai-pf-metric-big">{dias}</p>
              <p className="ai-pf-metric-hint">desde {p.inicio}</p>
            </div>
          </div>
          <div className="ai-pf-actions">
            {!isIngeld ? (
              <a
                className="ai-pf-btn ai-pf-btn--ghost"
                href={`https://twitter.com/${p.twitter.replace('@', '')}`}
                target="_blank"
                rel="noreferrer"
              >
                Twitter/X
              </a>
            ) : null}
          </div>
        </article>

        <section>
          <h3 className="ai-pf-h3">Posiciones</h3>
          {p.posiciones.length === 0 ? (
            <p className="ai-pf-muted">Sin posiciones por ahora.</p>
          ) : (
            <>
              <div className="ai-pf-pos-grid">
                {p.posiciones.map((row) => {
                  const q = quotes[row.ticker.toUpperCase()]
                  const ch = q?.changePct ?? 0
                  return (
                    <div key={row.ticker} className="ai-pf-pos-card">
                      <p className="ai-pf-ticker" style={{ color: accent }}>
                        {row.ticker}
                      </p>
                      <p className="ai-pf-name">{row.nombre}</p>
                      <span className="ai-pf-sector">{row.sector}</span>
                      <div className="ai-pf-wbar-label">
                        <span>Peso</span>
                        <span>{row.peso}%</span>
                      </div>
                      <div className="ai-pf-wbar-track">
                        <div
                          className="ai-pf-wbar-fill"
                          style={{ width: `${Math.min(100, row.peso)}%`, background: accent }}
                        />
                      </div>
                      <p className="ai-pf-price-row">
                        <span className="ai-pf-muted">Precio</span>
                        <span>
                          {isIngeld
                            ? row.precio_actual != null
                              ? row.precio_actual.toLocaleString('es-AR', { maximumFractionDigits: 4 })
                              : '—'
                            : q
                              ? q.price.toLocaleString('es-AR', { maximumFractionDigits: 4 })
                              : '—'}
                        </span>
                      </p>
                      <p className="ai-pf-price-row">
                        <span className="ai-pf-muted">% día</span>
                        {q ? (
                          <span className={ch >= 0 ? 'ai-pf-gain' : 'ai-pf-loss'}>
                            {ch >= 0 ? '+' : ''}
                            {ch.toFixed(2)}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </p>
                      {isIngeld && row.razon ? (
                        <p className="ai-pf-metric-hint" style={{ marginTop: '0.5rem' }}>
                          {row.razon}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              {pie.length > 0 ? (
                <div className="ai-pf-pie" style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pie}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="40%"
                        outerRadius={90}
                        label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      >
                        {pie.map((_, i) => (
                          <Cell
                            key={i}
                            fill={['#00a87a', '#6366f1', '#4285f4', '#10a37f', '#C9A84C'][i % 5]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend
                        layout="horizontal"
                        verticalAlign="bottom"
                        align="center"
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '0.35rem 0.75rem',
              marginBottom: '0.65rem',
            }}
          >
            <h3 className="ai-pf-h3" style={{ marginBottom: 0 }}>
              Últimas operaciones
            </h3>
            {opsFetchedAt != null ? (
              <span className="ai-pf-muted" style={{ fontSize: '0.72rem' }}>
                Actualizado hace {opsAgeMin ?? 0} min
              </span>
            ) : null}
          </div>
          <div className="ai-pf-timeline">
            {ops.length === 0 ? (
              <p className="ai-pf-muted">Sin operaciones.</p>
            ) : (
              ops.map((o, i) => (
                <div key={i} className="ai-pf-tl-item">
                  <span
                    className={`ai-pf-tl-dot ${
                      o.accion === 'VENDIÓ' ? 'ai-pf-tl-dot--sell' : 'ai-pf-tl-dot--buy'
                    }`}
                  />
                  <p className="ai-pf-tl-date">{o.fecha}</p>
                  <p className={o.accion === 'VENDIÓ' ? 'ai-pf-loss' : 'ai-pf-gain'}>
                    {o.accion} <span className="ai-pf-tl-tick">{o.ticker}</span>
                  </p>
                  <p className="ai-pf-tl-reason">{o.razon}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="ai-pf-analyze">
          <h3 className="ai-pf-h3">Análisis IA</h3>
          <button
            type="button"
            className="ai-pf-btn ai-pf-btn--primary"
            disabled={analysisLoading}
            onClick={() => void runAnalysis(p)}
          >
            {analysisLoading ? 'Analizando…' : 'Analizar este portfolio'}
          </button>
          {analysis ? (
            <div className="ai-pf-md">
              <AnalysisMarkdown source={analysis} />
            </div>
          ) : null}
        </section>
      </div>
    )
  }

  const renderCompare = () => {
    if (ordered.length < 2) return null
    const rets = ordered.map(totalReturnPct)
    const exc = ordered.map((p) => (spyBench != null ? totalReturnPct(p) - spyBench : null))
    const vols = ordered.map((p) => volById[p.id] ?? 0)
    const wR = maxWinIdx(rets)
    const wE =
      exc.every((x) => x != null) && exc.length ? maxWinIdx(exc as number[]) : new Set<number>()
    const wV = minWinIdx(vols)

    return (
      <div className="ai-pf-stack">
        <div className="ai-pf-compare-grid">
          {ordered.map((p, i) => {
            const r = rets[i]!
            const e = exc[i]
            const v = vols[i]!
            return (
              <div key={p.id} className={`ai-pf-compare-col ${COL_TOP[p.id] ?? ''}`}>
                <h3 className="ai-pf-compare-title">{TAB_LABEL[p.id as keyof typeof TAB_LABEL]}</h3>
                <p className="ai-pf-compare-line">
                  <span>Retorno</span>
                  <span className={`${wR.has(i) ? 'ai-pf-win' : ''} ${r >= 0 ? 'ai-pf-gain' : 'ai-pf-loss'}`}>
                    {r >= 0 ? '+' : ''}
                    {r.toFixed(2)}%
                  </span>
                </p>
                <p className="ai-pf-compare-line">
                  <span>vs SPY</span>
                  <span className={wE.has(i) ? 'ai-pf-win' : ''}>
                    {e != null ? `${e >= 0 ? '+' : ''}${e.toFixed(2)} pp` : '—'}
                  </span>
                </p>
                <p className="ai-pf-compare-line">
                  <span>Vol. sim.</span>
                  <span className={wV.has(i) ? 'ai-pf-win' : ''}>{v}%</span>
                </p>
                <p className="ai-pf-compare-line">
                  <span>Posiciones</span>
                  <span>{p.posiciones.length}</span>
                </p>
              </div>
            )
          })}
        </div>
        <div className="ai-pf-chart">
          <p className="ai-pf-chart-cap">Performance simulada (referencia visual)</p>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={compareSeries}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#888' }} />
              <YAxis tick={{ fontSize: 10, fill: '#888' }} domain={['auto', 'auto']} />
              <Tooltip />
              <Legend />
              {ordered.map((p) => (
                <Line
                  key={p.id}
                  type="monotone"
                  dataKey={p.id}
                  name={TAB_LABEL[p.id as keyof typeof TAB_LABEL]}
                  stroke={LINE_STROKE[p.id] ?? p.color}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <section className="ai-pf-analyze">
          <button
            type="button"
            className="ai-pf-btn ai-pf-btn--primary"
            disabled={compareLoading}
            onClick={() => void runCompare()}
          >
            {compareLoading ? 'Generando…' : 'Análisis comparativo IA'}
          </button>
          {compareText ? (
            <div className="ai-pf-md">
              <AnalysisMarkdown source={compareText} />
            </div>
          ) : null}
        </section>
      </div>
    )
  }

  const renderGeminiSoon = () => (
    <div
      className="ai-pf-card"
      style={{
        textAlign: 'center',
        padding: '2.25rem 1.75rem',
        maxWidth: '34rem',
        margin: '0 auto',
        borderColor: 'rgba(66, 133, 244, 0.35)',
      }}
    >
      <div style={{ fontSize: '3.75rem', lineHeight: 1, marginBottom: '1.1rem' }} aria-hidden>
        🤖
      </div>
      <div
        className="font-prose"
        style={{
          padding: '0.75rem 1rem',
          borderRadius: 8,
          marginBottom: '1.25rem',
          background: 'rgba(0, 168, 122, 0.1)',
          border: '1px solid rgba(0, 168, 122, 0.35)',
          fontSize: '0.88rem',
          lineHeight: 1.55,
          textAlign: 'left',
          maxWidth: '34rem',
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        📊 Datos actualizados semanalmente · Para ver un portfolio IA en tiempo real visitá{' '}
        <a href="https://joinautopilot.com" target="_blank" rel="noopener noreferrer">
          Autopilot
        </a>
      </div>
      <h2 className="ai-pf-card-title" style={{ marginBottom: '0.85rem' }}>
        Gemini Portfolio — Próximamente
      </h2>
      <p
        className="ai-pf-muted"
        style={{
          margin: '0 auto 1.75rem',
          maxWidth: '30rem',
          lineHeight: 1.6,
          fontSize: '0.9rem',
          fontFamily: 'var(--font-prose)',
        }}
      >
        Google Gemini no tiene un portfolio público gestionado en Autopilot todavía. Claude, Grok y GPT
        son los únicos modelos con portfolios reales operando en la plataforma.
        <br />
        <br />
        Cuando Gemini lance su portfolio oficial, INGELD lo agregará automáticamente.
      </p>
      <a
        className="ai-pf-btn ai-pf-btn--primary"
        href="https://joinautopilot.com"
        target="_blank"
        rel="noopener noreferrer"
      >
        Seguir en Autopilot
      </a>
    </div>
  )

  return (
    <div className="ai-pf-page">
      <header className="ai-pf-hero">
        <div className="ai-pf-hero-inner">
          <div className="ai-pf-hero-row">
            <Sparkles className="ai-pf-spark" aria-hidden />
            <h1 className="ai-pf-h1">Portfolios IA en vivo</h1>
          </div>
          <p className="ai-pf-hero-sub">
            Seguí en tiempo real los books gestionados por IA en Autopilot.
          </p>
          <span className="ai-pf-badge">● EN VIVO</span>
        </div>
      </header>

      <div className="ai-pf-body">
        <div className="ai-pf-tabs" role="tablist">
          {TAB_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`ai-pf-tab ${TAB_STYLE[id]} ${tab === id ? 'is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'comparar'}
            className={`ai-pf-tab ai-pf-tab--cmp ${tab === 'comparar' ? 'is-active' : ''}`}
            onClick={() => setTab('comparar')}
          >
            Comparar
          </button>
        </div>

        {tab === 'comparar' ? renderCompare() : null}
        {tab === 'ingeld' && ingeldLoading ? (
          <div className="ai-pf-card" style={{ textAlign: 'center', padding: '2rem 1.5rem', maxWidth: '36rem', margin: '1rem auto 0' }}>
            <div style={{ fontSize: '1.35rem', marginBottom: '0.65rem' }}>⏳</div>
            <p className="font-prose">Generando portfolio INGELD...</p>
          </div>
        ) : null}
        {tab === 'ingeld' && !ingeldLoading && ingeldError ? (
          <div className="ai-pf-card" style={{ textAlign: 'center', padding: '2rem 1.5rem', maxWidth: '36rem', margin: '1rem auto 0' }}>
            <p className="font-prose" style={{ marginBottom: '0.9rem' }}>
              No se pudo cargar el portfolio. Intentá de nuevo.
            </p>
            <button type="button" className="ai-pf-btn ai-pf-btn--primary" onClick={() => void loadIngeldPortfolio(true)}>
              Reintentar
            </button>
          </div>
        ) : null}
        {tab === 'gemini'
          ? renderGeminiSoon()
          : tab !== 'comparar' && tab !== 'ingeld' && active
            ? renderDetail(active)
            : null}
        {tab === 'ingeld' && !ingeldLoading && !ingeldError && active ? renderDetail(active) : null}
      </div>

      {pfEditId && isAdmin ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.48)',
            zIndex: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPfEditId(null)
          }}
        >
          <div
            className="panel"
            style={{
              position: 'relative',
              maxWidth: 560,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.25rem',
              boxSizing: 'border-box',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
            }}
            role="dialog"
            aria-labelledby="pf-edit-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="pf-edit-title" className="ai-pf-h3">
              Actualizar datos (admin){' '}
              <span style={{ fontWeight: 400, opacity: 0.85 }}>
                (
                {pfEditId in TAB_LABEL ? TAB_LABEL[pfEditId as keyof typeof TAB_LABEL] : pfEditId})
              </span>
            </h2>
            <p className="page-sub font-prose" style={{ marginTop: '-0.25rem' }}>
              Se guarda en <code>{IA_OVERRIDES_LS}</code>.
            </p>

            <label className="font-prose" style={{ display: 'block', marginTop: '1rem' }}>
              Capital actual
              <input
                type="text"
                value={editCap}
                onChange={(e) => setEditCap(e.target.value)}
                style={{ width: '100%', marginTop: '0.35rem' }}
              />
            </label>

            <h3 className="ai-pf-h3" style={{ marginTop: '1.25rem' }}>
              Posiciones (ticker + peso %)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {editPosRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    placeholder="Ticker"
                    value={row.ticker}
                    onChange={(e) => {
                      const next = [...editPosRows]
                      next[i] = { ...next[i], ticker: e.target.value }
                      setEditPosRows(next)
                    }}
                    style={{ flex: '1 1 100px', minWidth: '6rem' }}
                  />
                  <input
                    placeholder="% peso"
                    value={row.peso}
                    onChange={(e) => {
                      const next = [...editPosRows]
                      next[i] = { ...next[i], peso: e.target.value }
                      setEditPosRows(next)
                    }}
                    style={{ width: '5.5rem' }}
                  />
                  <button
                    type="button"
                    className="favoritos-quitar"
                    onClick={() =>
                      setEditPosRows(editPosRows.filter((_, j) => j !== i))
                    }
                  >
                    −
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="portfolio-ai-btn"
                style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
                onClick={() => setEditPosRows([...editPosRows, { ticker: '', peso: '' }])}
              >
                + Agregar posición
              </button>
            </div>

            <h3 className="ai-pf-h3" style={{ marginTop: '1.25rem' }}>
              Operaciones (fecha · acción · ticker · razón)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {editOpRows.map((row, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.5rem',
                    borderBottom: '1px solid var(--border-subtle)',
                    paddingBottom: '0.5rem',
                  }}
                >
                  <input
                    type="text"
                    placeholder="Fecha YYYY-MM-DD"
                    value={row.fecha}
                    onChange={(e) => {
                      const next = [...editOpRows]
                      next[i] = { ...next[i], fecha: e.target.value }
                      setEditOpRows(next)
                    }}
                  />
                  <input
                    placeholder="Acción ej. COMPRÓ"
                    value={row.accion}
                    onChange={(e) => {
                      const next = [...editOpRows]
                      next[i] = { ...next[i], accion: e.target.value }
                      setEditOpRows(next)
                    }}
                  />
                  <input
                    placeholder="Ticker"
                    value={row.ticker}
                    onChange={(e) => {
                      const next = [...editOpRows]
                      next[i] = { ...next[i], ticker: e.target.value }
                      setEditOpRows(next)
                    }}
                  />
                  <input
                    placeholder="Razón"
                    value={row.razon}
                    onChange={(e) => {
                      const next = [...editOpRows]
                      next[i] = { ...next[i], razon: e.target.value }
                      setEditOpRows(next)
                    }}
                    style={{ gridColumn: '1 / -1' }}
                  />
                  <button
                    type="button"
                    className="favoritos-quitar"
                    style={{ gridColumn: '1 / -1', justifySelf: 'start' }}
                    onClick={() =>
                      setEditOpRows(editOpRows.filter((_, j) => j !== i))
                    }
                  >
                    Quitar operación
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="portfolio-ai-btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={() =>
                  setEditOpRows([
                    ...editOpRows,
                    { fecha: '', accion: 'COMPRÓ', ticker: '', razon: '' },
                  ])
                }
              >
                + Agregar operación
              </button>
            </div>

            <div style={{ marginTop: '1.35rem', display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
              <button type="button" className="portfolio-ai-btn" onClick={() => void saveIaPortfolioOverride()}>
                Guardar
              </button>
              <button type="button" className="portfolio-refresh-btn" onClick={() => setPfEditId(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
