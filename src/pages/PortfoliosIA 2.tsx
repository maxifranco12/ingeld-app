import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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

const API = import.meta.env.VITE_API_URL ?? ''

type Posicion = {
  ticker: string
  nombre: string
  peso: number
  sector: string
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

type AiPortfoliosResponse = { portfolios: PortfolioIA[] }

type QuoteRow = {
  symbol: string
  name?: string
  price: number
  changePct: number
  currency?: string
}

const FALLBACK_PORTFOLIOS: AiPortfoliosResponse = {
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
      url: 'https://joinautopilot.com',
      twitter: '@grokportfolio',
      capital_inicial: 50000,
      capital_actual: 50000,
      inicio: '2026-04-01',
      color: '#6366f1',
      posiciones: [],
    },
  ],
}

const LAST_OPS: Record<
  string,
  { fecha: string; accion: 'COMPRÓ' | 'VENDIÓ'; ticker: string; razon: string }[]
> = {
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
      razon: 'Inicialización del book en benchmark (placeholder).',
    },
  ],
}

function totalReturnPct(p: PortfolioIA): number {
  if (!p.capital_inicial) return 0
  return ((p.capital_actual / p.capital_inicial - 1) * 100)
}

function sectorChartData(posiciones: Posicion[]) {
  const m = new Map<string, number>()
  for (const x of posiciones) {
    m.set(x.sector, (m.get(x.sector) ?? 0) + x.peso)
  }
  return [...m.entries()].map(([name, value]) => ({ name, value }))
}

function simulatedCompareSeries(
  inicio: string,
  claudeRet: number,
  grokRet: number,
  points = 24,
) {
  const start = new Date(inicio + 'T12:00:00')
  const end = new Date()
  const ms = end.getTime() - start.getTime()
  const out: { label: string; claude: number; grok: number }[] = []
  for (let i = 0; i <= points; i++) {
    const t = start.getTime() + (ms * i) / points
    const d = new Date(t)
    const label = `${d.getMonth() + 1}/${d.getDate()}`
    const w = i / points
    const noise = Math.sin(i * 1.7) * 0.12
    const c = 100 * (1 + (claudeRet / 100) * w + noise * w)
    const g = 100 * (1 + (grokRet / 100) * w + noise * 0.6 * w)
    out.push({ label, claude: Math.round(c * 100) / 100, grok: Math.round(g * 100) / 100 })
  }
  return out
}

function estimateVolFromSeries(series: number[]): number {
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

export function PortfoliosIA() {
  const [tab, setTab] = useState<'claude' | 'grok' | 'comparar'>('claude')
  const [portfolios, setPortfolios] = useState<PortfolioIA[]>(FALLBACK_PORTFOLIOS.portfolios)
  const [apiErr, setApiErr] = useState<string | null>(null)
  const [quotes, setQuotes] = useState<Record<string, QuoteRow>>({})
  const [spyBenchPct, setSpyBenchPct] = useState<number | null>(null)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [compareAnalysis, setCompareAnalysis] = useState<string | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)

  const claude = portfolios.find((p) => p.id === 'claude')
  const grok = portfolios.find((p) => p.id === 'grok')

  useEffect(() => {
    if (!API) {
      setApiErr('Configurá VITE_API_URL para datos en vivo del backend INGELD.')
      return
    }
    let c = false
    void (async () => {
      try {
        const res = await fetch(`${API}/api/market/ai-portfolios`)
        if (!res.ok) throw new Error(await res.text())
        const j = (await res.json()) as AiPortfoliosResponse
        if (!c && j.portfolios?.length) setPortfolios(j.portfolios)
        if (!c) setApiErr(null)
      } catch (e) {
        if (!c) {
          setApiErr(e instanceof Error ? e.message : 'No se pudo cargar /ai-portfolios')
          setPortfolios(FALLBACK_PORTFOLIOS.portfolios)
        }
      }
    })()
    return () => {
      c = true
    }
  }, [])

  const loadQuotes = useCallback(async (syms: string[]) => {
    if (!API || !syms.length) return
    const u = `${API}/api/market/quotes?symbols=${encodeURIComponent(syms.join(','))}`
    try {
      const res = await fetch(u)
      if (!res.ok) return
      const j = (await res.json()) as { quotes?: QuoteRow[] }
      const map: Record<string, QuoteRow> = {}
      for (const q of j.quotes ?? []) {
        map[q.symbol.toUpperCase()] = q
      }
      setQuotes((prev) => ({ ...prev, ...map }))
    } catch {
      /* noop */
    }
  }, [])

  useEffect(() => {
    if (!API) return
    void (async () => {
      try {
        const res = await fetch(`${API}/api/market/benchmark?symbols=SPY&period=5d`)
        if (!res.ok) return
        const j = (await res.json()) as { returnPct?: number }
        if (typeof j.returnPct === 'number') setSpyBenchPct(j.returnPct)
      } catch {
        /* noop */
      }
    })()
  }, [])

  useEffect(() => {
    const syms = new Set<string>(['SPY'])
    for (const p of portfolios) {
      for (const x of p.posiciones) syms.add(x.ticker.toUpperCase())
    }
    void loadQuotes([...syms])
  }, [portfolios, loadQuotes])

  const spyQuote = quotes['SPY']

  const runPortfolioAnalysis = async (p: PortfolioIA) => {
    if (!API) {
      setAnalysis('Configurá VITE_API_URL para usar el análisis con Claude.')
      return
    }
    setAnalysisLoading(true)
    setAnalysis(null)
    try {
      const body = {
        ticker: 'PORTFOLIO',
        historial: [] as { role: string; content: string }[],
        mensaje: `Portfolio IA "${p.nombre}" (${p.gestor}). Capital inicial ${p.capital_inicial}, actual ${p.capital_actual}. Inicio ${p.inicio}.
Posiciones (JSON): ${JSON.stringify(p.posiciones)}
Respondé en español con secciones claras:
1) ¿Está bien diversificado?
2) ¿Cuál es la tesis de inversión que inferís?
3) ¿Qué posición tiene más potencial y por qué?
4) ¿Qué riesgos principales ves?
Sé concreto; no inventes tickers fuera de la lista.`,
      }
      const res = await fetch(`${API}/api/chat/analizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { respuesta?: string }
      setAnalysis((j.respuesta ?? '').trim())
    } catch (e) {
      setAnalysis(e instanceof Error ? e.message : 'Error al analizar')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const runCompareAnalysis = async () => {
    if (!claude || !grok || !API) {
      setCompareAnalysis('Configurá VITE_API_URL para usar el análisis con Claude.')
      return
    }
    setCompareLoading(true)
    setCompareAnalysis(null)
    try {
      const body = {
        ticker: 'PORTFOLIO',
        historial: [],
        mensaje: `Compará en español estos dos portfolios IA (referencia Autopilot):
Claude: capital ${claude.capital_actual} vs inicial ${claude.capital_inicial}, posiciones: ${JSON.stringify(claude.posiciones)}
Grok: capital ${grok.capital_actual} vs inicial ${grok.capital_inicial}, posiciones: ${JSON.stringify(grok.posiciones)}
¿Cuál está ganando y por qué? Mencioná riesgos y similitudes en una sola respuesta breve.`,
      }
      const res = await fetch(`${API}/api/chat/analizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { respuesta?: string }
      setCompareAnalysis((j.respuesta ?? '').trim())
    } catch (e) {
      setCompareAnalysis(e instanceof Error ? e.message : 'Error')
    } finally {
      setCompareLoading(false)
    }
  }

  const compareSeries = useMemo(() => {
    const inicio = claude?.inicio ?? '2026-04-01'
    const c = claude ? totalReturnPct(claude) : 0
    const g = grok ? totalReturnPct(grok) : 0
    return simulatedCompareSeries(inicio, c, g)
  }, [claude, grok])

  const commonTickers = useMemo(() => {
    const a = new Set((claude?.posiciones ?? []).map((x) => x.ticker.toUpperCase()))
    const b = new Set((grok?.posiciones ?? []).map((x) => x.ticker.toUpperCase()))
    return [...a].filter((t) => b.has(t))
  }, [claude, grok])

  const volClaude = useMemo(
    () => estimateVolFromSeries(compareSeries.map((d) => d.claude)),
    [compareSeries],
  )
  const volGrok = useMemo(
    () => estimateVolFromSeries(compareSeries.map((d) => d.grok)),
    [compareSeries],
  )

  const renderPortfolioTab = (p: PortfolioIA) => {
    const ret = totalReturnPct(p)
    const vsSpy =
      spyBenchPct != null ? Math.round((ret - spyBenchPct) * 100) / 100 : null
    const pie = sectorChartData(p.posiciones)
    const ops = LAST_OPS[p.id] ?? []

    return (
      <div className="space-y-5 pb-4">
        <div className={`ai-portfolio-card rounded-card border border-white/10 bg-surface p-4`}>
          <div className="ai-portfolio-header mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <span
                className="h-12 w-12 shrink-0 rounded-full border border-white/10"
                style={{ backgroundColor: `${p.color}33`, boxShadow: `inset 0 0 0 2px ${p.color}` }}
                aria-hidden
              />
              <div>
                <h2 className="text-lg font-semibold text-text">{p.nombre}</h2>
                <p className="text-xs text-muted">
                  {p.gestor} · {p.plataforma}
                </p>
              </div>
            </div>
            <span className="rounded-full bg-win/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-win">
              EN VIVO
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase text-muted">Capital</p>
              <p className="font-mono text-sm text-text">
                ${p.capital_inicial.toLocaleString('es-AR')} → $
                {p.capital_actual.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-muted">Retorno total</p>
              <p className={`font-mono text-sm ${ret >= 0 ? 'text-win' : 'text-loss'}`}>
                {ret >= 0 ? '+' : ''}
                {ret.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-muted">vs S&P 500 (SPY ~5d)</p>
              <p className="font-mono text-sm text-text">
                SPY bench: {spyBenchPct != null ? `${spyBenchPct >= 0 ? '+' : ''}${spyBenchPct.toFixed(2)}%` : '—'}
                {vsSpy != null ? (
                  <span className={vsSpy >= 0 ? 'text-win' : 'text-loss'}>
                    {' '}
                    · Δ portfolio: {vsSpy >= 0 ? '+' : ''}
                    {vsSpy.toFixed(2)} pp
                  </span>
                ) : null}
              </p>
              {spyQuote ? (
                <p className="mt-0.5 text-[11px] text-muted">
                  SPY hoy: {spyQuote.price.toFixed(2)} ({spyQuote.changePct >= 0 ? '+' : ''}
                  {spyQuote.changePct.toFixed(2)}%)
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-[11px] uppercase text-muted">Inicio</p>
              <p className="text-sm text-text">{p.inicio}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue underline-offset-2 hover:underline"
            >
              Abrir en Autopilot
            </a>
            <a
              href={`https://twitter.com/${p.twitter.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue underline-offset-2 hover:underline"
            >
              {p.twitter}
            </a>
          </div>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-gold">Posiciones actuales</h3>
          {p.posiciones.length === 0 ? (
            <p className="text-sm text-muted">Sin posiciones publicadas todavía.</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-card border border-white/10">
                <table className="ai-portfolio-table w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-surface2 text-[11px] uppercase text-muted">
                      <th className="px-3 py-2">Ticker</th>
                      <th className="px-3 py-2">Nombre</th>
                      <th className="px-3 py-2">Sector</th>
                      <th className="px-3 py-2">Peso %</th>
                      <th className="px-3 py-2">Precio</th>
                      <th className="px-3 py-2">% hoy</th>
                      <th className="px-3 py-2">Contrib. día*</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.posiciones.map((row) => {
                      const q = quotes[row.ticker.toUpperCase()]
                      const ch = q?.changePct ?? 0
                      const contrib = (row.peso / 100) * ch
                      return (
                        <tr key={row.ticker} className="border-b border-white/5">
                          <td className="px-3 py-2 font-mono font-medium text-gold">{row.ticker}</td>
                          <td className="px-3 py-2 text-text">{row.nombre}</td>
                          <td className="px-3 py-2 text-muted">{row.sector}</td>
                          <td className="px-3 py-2 font-mono">{row.peso}%</td>
                          <td className="px-3 py-2 font-mono">
                            {q ? q.price.toLocaleString('es-AR', { maximumFractionDigits: 4 }) : '—'}
                          </td>
                          <td className={`px-3 py-2 font-mono ${ch >= 0 ? 'text-win' : 'text-loss'}`}>
                            {q ? (
                              <>
                                {ch >= 0 ? '+' : ''}
                                {ch.toFixed(2)}%
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={`px-3 py-2 font-mono ${contrib >= 0 ? 'text-win' : 'text-loss'}`}>
                            {q ? (
                              <>
                                {contrib >= 0 ? '+' : ''}
                                {contrib.toFixed(3)} pp
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-muted">
                *Contribución aprox.: peso × variación diaria del activo (no reinversión).
              </p>
              {pie.length > 0 ? (
                <div className="mt-4 h-56 rounded-card border border-white/10 bg-surface p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pie}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={78}
                        label={({ name, percent }) =>
                          `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                        }
                      >
                        {pie.map((_, i) => (
                          <Cell key={i} fill={['#00a87a', '#6366f1', '#C9A84C', '#0A84FF', '#FF453A'][i % 5]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-gold">Últimas operaciones</h3>
          <ul className="space-y-2 rounded-card border border-white/10 bg-surface p-3 text-sm">
            {ops.length === 0 ? (
              <li className="text-muted">Sin operaciones de ejemplo aún.</li>
            ) : (
              ops.map((o, i) => (
                <li key={i} className="border-b border-white/5 pb-2 last:border-0 last:pb-0">
                  <span className="text-muted">{o.fecha}</span>{' '}
                  <span className={o.accion === 'COMPRÓ' ? 'text-win' : 'text-loss'}>{o.accion}</span>{' '}
                  <span className="font-mono text-gold">{o.ticker}</span> —{' '}
                  <span className="text-muted">{o.razon}</span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="comparar-grid rounded-card border border-white/10 bg-surface p-4">
          <h3 className="mb-2 text-sm font-semibold text-gold">Análisis IA de INGELD</h3>
          <p className="mb-3 text-xs text-muted">
            Claude revisa las posiciones actuales y responde diversificación, tesis, potencial y riesgos.
          </p>
          <button
            type="button"
            className="rounded-input bg-gold px-4 py-2 text-sm font-semibold text-bg"
            disabled={analysisLoading}
            onClick={() => void runPortfolioAnalysis(p)}
          >
            {analysisLoading ? 'Analizando…' : 'Analizar este portfolio'}
          </button>
          {analysis ? (
            <div className="ai-portfolio-analysis mt-3 whitespace-pre-wrap text-sm leading-relaxed text-text">
              {analysis}
            </div>
          ) : null}
        </section>
      </div>
    )
  }

  const renderComparar = () => {
    if (!claude || !grok) return null
    const rc = totalReturnPct(claude)
    const rg = totalReturnPct(grok)
    return (
      <div className="comparar-grid space-y-5 pb-4">
        <div className="overflow-x-auto rounded-card border border-white/10">
          <table className="ai-portfolio-table w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-surface2 text-[11px] uppercase text-muted">
                <th className="px-3 py-2" />
                <th className="px-3 py-2 portfolio-tab-claude text-win">Claude</th>
                <th className="px-3 py-2 portfolio-tab-grok text-blue">Grok</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/5">
                <td className="px-3 py-2 text-muted">Retorno total</td>
                <td className={`px-3 py-2 font-mono ${rc >= 0 ? 'text-win' : 'text-loss'}`}>
                  {rc >= 0 ? '+' : ''}
                  {rc.toFixed(2)}%
                </td>
                <td className={`px-3 py-2 font-mono ${rg >= 0 ? 'text-win' : 'text-loss'}`}>
                  {rg >= 0 ? '+' : ''}
                  {rg.toFixed(2)}%
                </td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="px-3 py-2 text-muted">Retorno vs SPY (5d)</td>
                <td className="px-3 py-2 font-mono text-text">
                  {spyBenchPct != null ? `${(rc - spyBenchPct).toFixed(2)} pp` : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-text">
                  {spyBenchPct != null ? `${(rg - spyBenchPct).toFixed(2)} pp` : '—'}
                </td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="px-3 py-2 text-muted">Volatilidad est. (serie sim.)</td>
                <td className="px-3 py-2 font-mono">{volClaude}% ann. apr.</td>
                <td className="px-3 py-2 font-mono">{volGrok}% ann. apr.</td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-muted">Posiciones en común</td>
                <td colSpan={2} className="px-3 py-2 font-mono text-text">
                  {commonTickers.length ? commonTickers.join(', ') : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="h-64 rounded-card border border-white/10 bg-surface p-2">
          <p className="mb-1 px-1 text-[11px] text-muted">Performance simulada desde el inicio (referencia visual)</p>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={compareSeries}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8E8E93' }} />
              <YAxis tick={{ fontSize: 10, fill: '#8E8E93' }} domain={['auto', 'auto']} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="claude" name="Claude" stroke="#00a87a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="grok" name="Grok" stroke="#6366f1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-card border border-white/10 bg-surface p-4">
          <h3 className="mb-2 text-sm font-semibold text-gold">Análisis IA — ¿cuál va ganando?</h3>
          <button
            type="button"
            className="rounded-input bg-gold px-4 py-2 text-sm font-semibold text-bg"
            disabled={compareLoading}
            onClick={() => void runCompareAnalysis()}
          >
            {compareLoading ? 'Generando…' : 'Pedir comparación a Claude'}
          </button>
          {compareAnalysis ? (
            <p className="ai-portfolio-analysis mt-3 whitespace-pre-wrap text-sm leading-relaxed text-text">
              {compareAnalysis}
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="ai-portfolio-page mx-auto max-w-3xl">
      <div className="ai-portfolio-header mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-gold" aria-hidden />
            <h1 className="text-xl font-bold text-text">Portfolios IA en vivo</h1>
            <span className="rounded-full bg-win/15 px-2 py-0.5 text-[10px] font-bold uppercase text-win">
              EN VIVO
            </span>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            Seguí en tiempo real cómo invierten Claude y Grok. Compará performance y copiá las mejores ideas.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Link
            to="/analisis"
            className="briefing-more-btn inline-flex rounded-input bg-gold px-3 py-1.5 text-xs font-semibold text-bg no-underline hover:opacity-90"
          >
            Ver análisis completo
          </Link>
          <Link to="/ranking" className="text-xs text-blue underline-offset-2 hover:underline">
            ← Ranking
          </Link>
        </div>
      </div>

      {apiErr ? (
        <p className="mb-3 rounded-input border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-muted">{apiErr}</p>
      ) : null}

      <div className="mb-4 flex gap-1 rounded-input border border-white/10 bg-surface2 p-1">
        <button
          type="button"
          className={`flex-1 rounded-input py-2 text-xs font-semibold ${
            tab === 'claude' ? 'portfolio-tab-claude bg-win/20 text-win' : 'text-muted'
          }`}
          onClick={() => setTab('claude')}
        >
          Claude
        </button>
        <button
          type="button"
          className={`flex-1 rounded-input py-2 text-xs font-semibold ${
            tab === 'grok' ? 'portfolio-tab-grok bg-blue/20 text-blue' : 'text-muted'
          }`}
          onClick={() => setTab('grok')}
        >
          Grok
        </button>
        <button
          type="button"
          className={`flex-1 rounded-input py-2 text-xs font-semibold ${
            tab === 'comparar' ? 'bg-gold/20 text-gold' : 'text-muted'
          }`}
          onClick={() => setTab('comparar')}
        >
          Comparar
        </button>
      </div>

      {tab === 'claude' && claude ? renderPortfolioTab(claude) : null}
      {tab === 'grok' && grok ? renderPortfolioTab(grok) : null}
      {tab === 'comparar' ? renderComparar() : null}
    </div>
  )
}
