import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const API = import.meta.env.VITE_API_URL ?? ''

type HistItem = {
  id: number
  ticker: string
  tipo: string
  señal: string | null
  resumen: string
  score_total: number | null
  created_at: string | null
}

export function Historial() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [items, setItems] = useState<HistItem[]>([])
  const [tickerFilter, setTickerFilter] = useState('')
  const [signalFilter, setSignalFilter] = useState('')

  useEffect(() => {
    if (!token) return
    void (async () => {
      const res = await fetch(`${API}/api/auth/historial`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const j = (await res.json()) as { items: HistItem[] }
      setItems(j.items || [])
    })()
  }, [token])

  const filtered = useMemo(() => {
    return items.filter((x) => {
      if (tickerFilter && !x.ticker.toUpperCase().includes(tickerFilter.toUpperCase())) return false
      if (signalFilter && (x.señal || '') !== signalFilter) return false
      return true
    })
  }, [items, tickerFilter, signalFilter])

  return (
    <div className="historial-page">
      <h1 className="page-title">Mi historial</h1>
      <div className="historial-filters">
        <input
          className="ingeld-input"
          placeholder="Filtrar ticker"
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value)}
        />
        <select className="ingeld-input" value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)}>
          <option value="">Todas las señales</option>
          <option value="COMPRAR">COMPRAR</option>
          <option value="VENDER">VENDER</option>
          <option value="MANTENER">MANTENER</option>
          <option value="ESPERAR">ESPERAR</option>
        </select>
      </div>

      <div className="historial-list">
        {filtered.map((x) => (
          <button
            key={x.id}
            type="button"
            className="historial-item"
            onClick={() => nav(`/activo/${encodeURIComponent(x.ticker)}`)}
          >
            <div className="historial-item-top">
              <span className="historial-ticker">{x.ticker}</span>
              {x.señal ? <span className={`badge ${x.señal === 'COMPRAR' ? 'badge-buy' : x.señal === 'VENDER' ? 'badge-sell' : 'badge-neutral'}`}>{x.señal}</span> : null}
            </div>
            <p className="font-prose historial-meta">
              {x.tipo} · {x.created_at ? new Date(x.created_at).toLocaleString('es-AR') : '—'} · Score: {x.score_total ?? '—'}
            </p>
            <p className="font-prose historial-resumen">{x.resumen}</p>
          </button>
        ))}
        {filtered.length === 0 ? <p className="page-sub font-prose">Sin análisis guardados.</p> : null}
      </div>
    </div>
  )
}
