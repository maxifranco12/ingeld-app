import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageBackButton } from '../components/PageBackButton'
import { useFavoritos } from '../hooks/useFavoritos'

const API = import.meta.env.VITE_API_URL ?? ''

type SearchHit = {
  symbol: string
  name: string
  exchange: string
  type: string
  currency: string
}

type OverviewRow = {
  symbol: string
  name: string
  price: number
  changePct: number
  currency: string
}

const MERVAL = [
  'GGAL.BA',
  'YPF.BA',
  'BMA.BA',
  'PAMP.BA',
  'TXAR.BA',
  'TECO2.BA',
  'SUPV.BA',
  'BBAR.BA',
]
const BONOS_AR = ['AL30.BA', 'GD30.BA', 'GD35.BA', 'AE38.BA']
const USA_ETFS = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'EWZ', 'GLD']
const CRYPTO = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'ADA-USD']

type MercadoTab = 'merval' | 'bonos' | 'usa' | 'crypto'

const TABS: { id: MercadoTab; label: string; syms: string[] }[] = [
  { id: 'merval', label: 'MERVAL', syms: MERVAL },
  { id: 'bonos', label: 'Bonos AR', syms: BONOS_AR },
  { id: 'usa', label: 'USA & ETFs', syms: USA_ETFS },
  { id: 'crypto', label: 'Crypto', syms: CRYPTO },
]

const DEBOUNCE_MS = 400

export function Buscador() {
  const navigate = useNavigate()
  const { toggleFavorito, esFavorito } = useFavoritos()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [mercadoTab, setMercadoTab] = useState<MercadoTab>('merval')
  const [tabRows, setTabRows] = useState<Partial<Record<MercadoTab, OverviewRow[]>>>(
    {},
  )
  const [tabLoading, setTabLoading] = useState<MercadoTab | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const goActivo = (symbol: string) => {
    const s = symbol.trim()
    if (!s) return
    navigate(`/activo/${encodeURIComponent(s)}`)
    setSearchOpen(false)
  }

  useEffect(() => {
    let cancelled = false
    const v = q.trim()
    if (!v) {
      setHits([])
      setSearchLoading(false)
      return () => {
        cancelled = true
      }
    }
    const t = window.setTimeout(() => {
      setSearchLoading(true)
      ;(async () => {
        try {
          const res = await fetch(
            `${API}/api/market/search?q=${encodeURIComponent(v)}`,
          )
          if (cancelled || !res.ok) return
          const data = (await res.json()) as SearchHit[]
          if (!cancelled) setHits(Array.isArray(data) ? data : [])
        } catch {
          if (!cancelled) setHits([])
        } finally {
          if (!cancelled) setSearchLoading(false)
        }
      })()
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [q])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const loadTab = useCallback(async (id: MercadoTab) => {
    const spec = TABS.find((t) => t.id === id)
    if (!spec) return
    setTabLoading(id)
    try {
      const qs = spec.syms.map(encodeURIComponent).join(',')
      const res = await fetch(`${API}/api/market/overview?symbols=${qs}`)
      if (!res.ok) return
      const j = (await res.json()) as { items: OverviewRow[] }
      setTabRows((prev) => ({ ...prev, [id]: j.items ?? [] }))
    } finally {
      setTabLoading(null)
    }
  }, [])

  useEffect(() => {
    if (tabRows[mercadoTab]) return
    void loadTab(mercadoTab)
  }, [mercadoTab, tabRows, loadTab])

  const rows = tabRows[mercadoTab] ?? []
  const bySym = new Map(rows.map((r) => [r.symbol.toUpperCase(), r]))

  return (
    <div className="buscador-page">
      <PageBackButton />
      <h1 className="page-title">Buscador global</h1>
      <p className="page-sub">
        Encontrá activos en BYMA, USA y crypto. Elegí un resultado o un ticker
        de los mercados abajo.
      </p>

      <div className="buscador-search-wrap" ref={wrapRef}>
        <input
          className="buscador-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSearchOpen(true)
          }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Buscá ticker, empresa o crypto — ej: GGAL.BA, AAPL, BTC-USD"
          aria-label="Búsqueda de activos"
          autoComplete="off"
        />
        {searchOpen && (q.trim() || searchLoading) && (
          <div className="buscador-dropdown" role="listbox">
            {searchLoading && (
              <div className="buscador-dd-muted font-prose">Buscando…</div>
            )}
            {!searchLoading &&
              hits.map((h) => (
                <button
                  key={h.symbol}
                  type="button"
                  role="option"
                  className="buscador-dd-item"
                  onClick={() => goActivo(h.symbol)}
                >
                  <span className="buscador-dd-name font-prose">{h.name}</span>
                  <span className="buscador-dd-meta">
                    <strong>{h.symbol}</strong>
                    {h.exchange ? ` · ${h.exchange}` : ''}
                    {h.type ? ` · ${h.type}` : ''}
                  </span>
                </button>
              ))}
            {!searchLoading && q.trim() && hits.length === 0 && (
              <div className="buscador-dd-muted font-prose">Sin resultados.</div>
            )}
          </div>
        )}
      </div>

      <section className="mercados-section" aria-labelledby="mercados-h">
        <h2 id="mercados-h" className="dash-zone-title">
          Mercados
        </h2>
        <div className="mercados-tabs" role="tablist">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mercadoTab === id}
              className={`mercados-tab ${mercadoTab === id ? 'active' : ''}`}
              onClick={() => setMercadoTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <ul className="mercados-lista">
          {tabLoading === mercadoTab && (
            <li className="mercados-loading font-prose">Cargando cotizaciones…</li>
          )}
          {TABS.find((t) => t.id === mercadoTab)?.syms.map((sym) => {
            const row = bySym.get(sym.toUpperCase())
            const pos = row ? row.changePct >= 0 : false
            return (
              <li key={sym}>
                <div className="mercados-row">
                  <button
                    type="button"
                    className="mercados-row-hit"
                    onClick={() => goActivo(sym)}
                  >
                    <span className="mercados-sym">{sym}</span>
                    {row ? (
                      <>
                        <span className="mercados-price">
                          {row.price.toLocaleString('es-AR', {
                            maximumFractionDigits: 4,
                          })}{' '}
                          {row.currency}
                        </span>
                        <span className={`mercados-pct ${pos ? 'gain' : 'loss'}`}>
                          {pos ? '+' : ''}
                          {row.changePct.toFixed(2)}%
                        </span>
                      </>
                    ) : (
                      <span className="mercados-pending font-prose">—</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`fav-star ${esFavorito(sym) ? 'active' : 'inactive'}`}
                    aria-label={
                      esFavorito(sym)
                        ? `Quitar ${sym} de favoritos`
                        : `Favorito ${sym}`
                    }
                    onClick={() => toggleFavorito(sym)}
                  >
                    {esFavorito(sym) ? '★' : '☆'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
