import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL ?? ''

type Asset = {
  symbol: string
  price: number
  changePct: number
  rsi14: number | null
  macd: { direccion: string }
  fundamentals?: {
    pe_ratio?: number | null
    pb_ratio?: number | null
    eps?: number | null
    revenue_growth?: number | null
    profit_margin?: number | null
    roe?: number | null
    target_price?: number | null
  }
}

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('es-AR', { maximumFractionDigits: d })
}

function fmtPctFromRatio(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(d)}%`
}

function techScore(a: Asset | null): number | null {
  if (!a) return null
  let s = 5
  if (a.rsi14 != null && a.rsi14 < 35) s += 2
  if (a.rsi14 != null && a.rsi14 > 70) s -= 2
  if (a.macd?.direccion === 'alcista') s += 2
  if (a.macd?.direccion === 'bajista') s -= 2
  return Math.max(1, Math.min(10, s))
}

export function Comparador() {
  const nav = useNavigate()
  const [t1, setT1] = useState('GGAL.BA')
  const [t2, setT2] = useState('SPY')
  const [a1, setA1] = useState<Asset | null>(null)
  const [a2, setA2] = useState<Asset | null>(null)
  const [cmp, setCmp] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadBoth = async () => {
    if (!t1.trim() || !t2.trim()) return
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${API}/api/market/asset/${encodeURIComponent(t1.trim().toUpperCase())}`),
        fetch(`${API}/api/market/asset/${encodeURIComponent(t2.trim().toUpperCase())}`),
      ])
      if (!r1.ok || !r2.ok) return
      setA1((await r1.json()) as Asset)
      setA2((await r2.json()) as Asset)
    } finally {
      setLoading(false)
    }
  }

  const runCompareIa = async () => {
    if (!a1 || !a2) return
    const mensaje = `Compará estas dos oportunidades y decí cuál conviene ahora:
${JSON.stringify(a1)}
${JSON.stringify(a2)}
Respondé con: ganador, razones clave, riesgo principal y acción concreta.`
    const res = await fetch(`${API}/api/analysis/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system:
          'Sos un analista financiero senior. Compará dos activos y recomendá uno con argumentos concretos.',
        messages: [{ role: 'user', content: mensaje }],
      }),
    })
    if (!res.ok) return
    const j = (await res.json()) as { reply?: string }
    setCmp(j.reply ?? null)
  }

  const rows = useMemo(
    () => [
      ['Precio', fmt(a1?.price, 4), fmt(a2?.price, 4)],
      ['Variación %', `${fmt(a1?.changePct, 2)}%`, `${fmt(a2?.changePct, 2)}%`],
      ['RSI', fmt(a1?.rsi14, 1), fmt(a2?.rsi14, 1)],
      ['MACD', a1?.macd?.direccion ?? '—', a2?.macd?.direccion ?? '—'],
      ['P/E', fmt(a1?.fundamentals?.pe_ratio), fmt(a2?.fundamentals?.pe_ratio)],
      ['P/B', fmt(a1?.fundamentals?.pb_ratio), fmt(a2?.fundamentals?.pb_ratio)],
      ['EPS', fmt(a1?.fundamentals?.eps), fmt(a2?.fundamentals?.eps)],
      ['Revenue growth', fmtPctFromRatio(a1?.fundamentals?.revenue_growth), fmtPctFromRatio(a2?.fundamentals?.revenue_growth)],
      ['Margen', fmtPctFromRatio(a1?.fundamentals?.profit_margin), fmtPctFromRatio(a2?.fundamentals?.profit_margin)],
      ['ROE', fmtPctFromRatio(a1?.fundamentals?.roe), fmtPctFromRatio(a2?.fundamentals?.roe)],
      ['Target / Upside', `${fmt(a1?.fundamentals?.target_price, 4)} ${a1 && a1.fundamentals?.target_price ? `(${fmt(((a1.fundamentals.target_price - a1.price) / a1.price) * 100, 2)}%)` : ''}`, `${fmt(a2?.fundamentals?.target_price, 4)} ${a2 && a2.fundamentals?.target_price ? `(${fmt(((a2.fundamentals.target_price - a2.price) / a2.price) * 100, 2)}%)` : ''}`],
      ['Score técnico', `${fmt(techScore(a1), 0)}/10`, `${fmt(techScore(a2), 0)}/10`],
    ],
    [a1, a2],
  )

  return (
    <div className="comparador-page">
      <h1 className="page-title">Comparador de activos</h1>
      <div className="comparador-inputs">
        <input className="ingeld-input" value={t1} onChange={(e) => setT1(e.target.value)} />
        <input className="ingeld-input" value={t2} onChange={(e) => setT2(e.target.value)} />
        <button type="button" className="auth-btn" onClick={() => void loadBoth()} disabled={loading}>
          {loading ? 'Cargando…' : 'Comparar'}
        </button>
      </div>

      {(a1 || a2) && (
        <div className="comparador-grid">
          <button type="button" className="comparador-col comparador-col--a" onClick={() => a1 && nav(`/activo/${encodeURIComponent(a1.symbol)}`)}>
            {a1?.symbol || '—'}
          </button>
          <button type="button" className="comparador-col comparador-col--b" onClick={() => a2 && nav(`/activo/${encodeURIComponent(a2.symbol)}`)}>
            {a2?.symbol || '—'}
          </button>
        </div>
      )}

      <div className="comparador-table-wrap">
        <table className="comparador-table">
          <tbody>
            {rows.map(([k, v1, v2]) => (
              <tr key={k} className="comparador-row">
                <th>{k}</th>
                <td>{v1}</td>
                <td>{v2}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="comparador-actions">
        <button type="button" className="activo-fund-ia-btn" onClick={() => void runCompareIa()}>
          Analizar con IA
        </button>
      </div>
      {cmp ? <div className="chat-panel"><div className="chat-msg-body font-prose">{cmp}</div></div> : null}
    </div>
  )
}
