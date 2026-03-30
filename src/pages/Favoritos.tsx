import { useCallback, useEffect, useState } from 'react'
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

function badgeClass(signal: string) {
  if (signal === 'COMPRAR') return 'scanner-badge-comprar'
  if (signal === 'VENDER') return 'scanner-badge-vender'
  return 'scanner-badge-neutro'
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

  const bySymbol = new Map(items.map((it) => [it.symbol.toUpperCase(), it]))

  if (favoritos.length === 0) {
    return (
      <div className="favoritos-page">
        <PageBackButton />
        <h1 className="page-title">Favoritos</h1>
        <p className="page-sub font-prose">
          Agregá favoritos desde el Scanner con la estrella en cada card.
        </p>
      </div>
    )
  }

  return (
    <div className="favoritos-page">
      <PageBackButton />
      <h1 className="page-title">Favoritos</h1>
      <p className="page-sub">
        {loading ? 'Cargando cotizaciones…' : `${favoritos.length} activo(s)`}
      </p>

      {error && <div className="error-state">{error}</div>}

      <div className="favoritos-grid">
        {favoritos.map((sym) => {
          const row = bySymbol.get(sym)
          const pos = row ? row.changePct >= 0 : false
          return (
            <article key={sym} className="favoritos-card">
              <div className="favoritos-card-head">
                <div>
                  <span className="scanner-ticker">{sym}</span>
                  {row && (
                    <p className="scanner-name font-prose favoritos-name">
                      {row.name}
                    </p>
                  )}
                </div>
                {row && (
                  <span className={badgeClass(row.signal)}>{row.signal}</span>
                )}
              </div>
              {row ? (
                <>
                  <div className="scanner-price-row">
                    <span className="scanner-price">
                      {row.price.toLocaleString('es-AR', {
                        maximumFractionDigits: 4,
                      })}{' '}
                      {row.currency}
                    </span>
                    <span className={`scanner-chg ${pos ? 'gain' : 'loss'}`}>
                      {pos ? '+' : ''}
                      {row.changePct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="scanner-pills favoritos-pills">
                    <span className="scanner-pill">
                      RSI {row.rsi != null ? row.rsi.toFixed(1) : '—'}
                    </span>
                    <span className="scanner-pill">MACD {row.macd}</span>
                  </div>
                </>
              ) : (
                <p className="page-sub font-prose">
                  {loading ? '…' : 'Sin datos de cotización.'}
                </p>
              )}
              <button
                type="button"
                className="favoritos-quitar"
                onClick={() => toggleFavorito(sym)}
              >
                Quitar favorito
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}
