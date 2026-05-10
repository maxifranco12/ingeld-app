import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL ?? ''

type Cell = {
  ticker: string
  name: string
  sector: string
  changePct: number
  marketCap: number
  price: number
}

export default function Heatmap() {
  const [sectors, setSectors] = useState<Record<string, Cell[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const res = await fetch(`${API}/api/market/heatmap`)
        if (!res.ok) throw new Error('x')
        const j = (await res.json()) as { sectors?: Record<string, Cell[]> }
        setSectors(j.sectors ?? {})
      } catch {
        setSectors({})
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const maxCap = useMemo(() => {
    let m = 1
    for (const list of Object.values(sectors)) {
      for (const c of list) m = Math.max(m, c.marketCap || 0)
    }
    return m
  }, [sectors])

  const intensity = (chg: number) => {
    const a = Math.min(1, Math.abs(chg) / 5)
    return Math.round(a * 100)
  }

  return (
    <div className="page">
      <h1>Sector heatmap</h1>
      <p className="page-sub">{loading ? 'Cargando…' : 'Cambio del día vs market cap relativo (universo 30).'}</p>

      {Object.entries(sectors).map(([sec, cells]) => (
        <section key={sec} style={{ marginBottom: '1.5rem' }}>
          <h2 className="dash-zone-title">{sec}</h2>
          <div className="heatmap-grid">
            {cells.map((c) => {
              const cap = c.marketCap || 0
              const fr = maxCap > 0 ? Math.max(0.08, Math.sqrt(cap / maxCap)) : 0.12
              const inten = intensity(c.changePct)
              const gain = c.changePct >= 0
              return (
                <Link
                  key={c.ticker}
                  to={`/activo/${c.ticker}`}
                  className={`heatmap-cell ${gain ? 'gain' : 'loss'}`}
                  style={{
                    flex: `${fr} 1 ${120 * fr}px`,
                    opacity: 0.45 + inten / 200,
                  }}
                  title={`${c.ticker} · ${c.name}\nPrecio ${c.price}\n${c.changePct >= 0 ? '+' : ''}${c.changePct}%`}
                >
                  <span className="heatmap-ticker">{c.ticker}</span>
                  <span className="heatmap-chg">{c.changePct >= 0 ? '+' : ''}{c.changePct.toFixed(2)}%</span>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
