import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageBackButton } from '../components/PageBackButton'
import { useFavoritos } from '../hooks/useFavoritos'

const API = import.meta.env.VITE_API_URL ?? ''

type OverviewItem = {
  symbol: string
  name: string
  price: number
  changePct: number
  currency: string
  rsi: number | null
  macd: string
  signal: string
  scannerTag: string
}

type WatchSignal = 'COMPRAR' | 'VENDER' | 'NEUTRO'

function watchSignalFrom(row: OverviewItem): WatchSignal {
  const rsi = row.rsi ?? 50
  const m = (row.macd || '').toLowerCase()
  const macdBull = m.includes('alc')
  const macdBear = m.includes('baj')
  if (rsi < 30 && macdBull) return 'COMPRAR'
  if (rsi > 70 && macdBear) return 'VENDER'
  return 'NEUTRO'
}

function badgeClass(signal: WatchSignal) {
  if (signal === 'COMPRAR') return 'scanner-badge-comprar'
  if (signal === 'VENDER') return 'scanner-badge-vender'
  return 'scanner-badge-neutro'
}

function rsiTrafficClass(rsi: number | null): string {
  if (rsi == null) return 'watchlist-rsi watchlist-rsi--na'
  if (rsi < 30) return 'watchlist-rsi watchlist-rsi--low'
  if (rsi > 70) return 'watchlist-rsi watchlist-rsi--high'
  return 'watchlist-rsi watchlist-rsi--mid'
}

function signalRank(s: WatchSignal): number {
  if (s === 'COMPRAR') return 0
  if (s === 'NEUTRO') return 1
  return 2
}

export function Favoritos() {
  const { favoritos, toggleFavorito } = useFavoritos()
  const [items, setItems] = useState<OverviewItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (favoritos.length === 0) {
      setItems([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const q = favoritos.map(encodeURIComponent).join(',')
      const res = await fetch(`${API}/api/market/overview?symbols=${q}`)
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { items: OverviewItem[] }
      setItems(j.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [favoritos])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (favoritos.length === 0) return
    const id = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(id)
  }, [favoritos.length, load])

  const rows = useMemo(() => {
    const bySymbol = new Map(items.map((it) => [it.symbol.toUpperCase(), it]))
    const out = favoritos.map((sym) => {
      const row = bySymbol.get(sym)
      const ws = row ? watchSignalFrom(row) : ('NEUTRO' as WatchSignal)
      return { sym, row, ws }
    })
    out.sort((a, b) => {
      const dr = signalRank(a.ws) - signalRank(b.ws)
      if (dr !== 0) return dr
      return a.sym.localeCompare(b.sym)
    })
    return out
  }, [favoritos, items])

  if (favoritos.length === 0) {
    return (
      <div className="favoritos-page">
        <PageBackButton />
        <h1 className="page-title">Watchlist</h1>
        <p className="page-sub font-prose">
          Agregá símbolos desde el Scanner con la estrella. Monitoreo con RSI, señal y actualización cada 30s.
        </p>
      </div>
    )
  }

  return (
    <div className="favoritos-page">
      <PageBackButton />
      <h1 className="page-title">Watchlist</h1>
      <p className="page-sub">
        {loading ? 'Actualizando cotizaciones…' : `${favoritos.length} activo(s) · auto-refresh 30s`}
      </p>

      {error && <div className="error-state">{error}</div>}

      <div className="watchlist-table-wrap panel">
        <table className="data-table watchlist-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Nombre</th>
              <th>Precio</th>
              <th>% día</th>
              <th>RSI</th>
              <th>Señal</th>
              <th>MACD</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sym, row, ws }) => {
              const rsi = row?.rsi ?? null
              const extreme = rsi != null && (rsi < 30 || rsi > 70)
              const pos = row ? row.changePct >= 0 : false
              return (
                <tr key={sym}>
                  <td>
                    <Link to={`/activo/${sym}`}>
                      <span className="scanner-ticker">{sym}</span>
                      {extreme ? <span title="RSI extremo"> ⚡</span> : null}
                    </Link>
                  </td>
                  <td className="font-prose">{row?.name ?? '—'}</td>
                  <td>
                    {row
                      ? `${row.price.toLocaleString('es-AR', { maximumFractionDigits: 4 })} ${row.currency}`
                      : '—'}
                  </td>
                  <td className={row ? (pos ? 'gain' : 'loss') : ''}>
                    {row ? `${pos ? '+' : ''}${row.changePct.toFixed(2)}%` : '—'}
                  </td>
                  <td>
                    <span className={rsiTrafficClass(rsi)}>{rsi != null ? rsi.toFixed(1) : '—'}</span>
                  </td>
                  <td>
                    {row ? <span className={badgeClass(ws)}>{ws}</span> : <span className="scanner-badge-neutro">—</span>}
                  </td>
                  <td>{row?.macd ?? '—'}</td>
                  <td>
                    <button type="button" className="favoritos-quitar" onClick={() => toggleFavorito(sym)}>
                      Quitar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
