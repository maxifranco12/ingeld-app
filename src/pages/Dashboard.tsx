import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFavoritos } from '../hooks/useFavoritos'

const API = import.meta.env.VITE_API_URL ?? ''

type PulseItem = {
  label: string
  symbol: string
  price: number
  changePct: number
  currency: string
}

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

type OverviewResponse = {
  items: OverviewItem[]
  errors: string[]
}

type AiSummary = {
  date: string
  text: string
}

type CandidateItem = {
  ticker: string
  signal: string
  price: number
  changePct: number
  rsi: string
  macd: string
  volume: string
  rationale: string
}

type ScanFilter =
  | 'all'
  | 'merval'
  | 'cedear'
  | 'bono_ar'
  | 'usa'
  | 'up'
  | 'rsi35'

const SCAN_FILTERS: { id: ScanFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'merval', label: 'MERVAL' },
  { id: 'cedear', label: 'CEDEARs' },
  { id: 'bono_ar', label: 'Bonos AR' },
  { id: 'usa', label: 'USA·ETFs' },
  { id: 'up', label: 'Solo alzas' },
  { id: 'rsi35', label: 'RSI<35' },
]

function formatPrice(n: number, currency: string) {
  const decimals = n >= 1000 ? 2 : n >= 1 ? 2 : 4
  const formatted = n.toLocaleString('es-AR', {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: decimals,
  })
  return currency ? `${formatted} ${currency}` : formatted
}

function badgeClass(signal: string) {
  if (signal === 'COMPRAR') return 'badge badge-buy'
  if (signal === 'VENDER') return 'badge badge-sell'
  return 'badge badge-neutral'
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso + 'T12:00:00')
    return d.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function Dashboard() {
  const { favoritos } = useFavoritos()
  const [favItems, setFavItems] = useState<OverviewItem[]>([])
  const [pulse, setPulse] = useState<{ items: PulseItem[]; errors: string[] } | null>(
    null,
  )
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [summary, setSummary] = useState<AiSummary | null>(null)
  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanFilter, setScanFilter] = useState<ScanFilter>('all')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [pr, ov, sm, cd] = await Promise.all([
          fetch(`${API}/api/market/pulse`),
          fetch(`${API}/api/market/overview`),
          fetch(`${API}/api/market/ai-summary`),
          fetch(`${API}/api/market/candidates`),
        ])
        if (!pr.ok || !ov.ok || !sm.ok || !cd.ok) {
          throw new Error('Uno o más endpoints fallaron')
        }
        const pj = (await pr.json()) as { items: PulseItem[]; errors: string[] }
        const oj = (await ov.json()) as OverviewResponse
        const sj = (await sm.json()) as AiSummary
        const cj = (await cd.json()) as { items: CandidateItem[] }
        if (!cancelled) {
          setPulse(pj)
          setOverview(oj)
          setSummary(sj)
          setCandidates(cj.items ?? [])
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Error al cargar el panel')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const favKey = favoritos.join(',')

  useEffect(() => {
    if (!favoritos.length) {
      setFavItems([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const q = favoritos.map(encodeURIComponent).join(',')
        const res = await fetch(`${API}/api/market/overview?symbols=${q}`)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as OverviewResponse
        if (!cancelled) setFavItems(j.items ?? [])
      } catch {
        if (!cancelled) setFavItems([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [favKey])

  const filteredRows = useMemo(() => {
    if (!overview?.items.length) return []
    return overview.items.filter((row) => {
      switch (scanFilter) {
        case 'all':
          return true
        case 'merval':
          return row.scannerTag === 'merval'
        case 'cedear':
          return row.scannerTag === 'cedear'
        case 'bono_ar':
          return row.scannerTag === 'bono_ar'
        case 'usa':
          return row.scannerTag === 'usa'
        case 'up':
          return row.changePct > 0
        case 'rsi35':
          return row.rsi != null && row.rsi < 35
        default:
          return true
      }
    })
  }, [overview, scanFilter])

  return (
    <div className="dashboard">
      <h1 className="page-title">Panel</h1>
      <p className="page-sub">
        Pulso del mercado, resumen y scanner. Datos en vivo con yfinance; puede
        haber demoras fuera de horario.
      </p>

      {error && !loading && (
        <div className="error-state dashboard-error">
          {error}. Verificá el backend y el proxy de Vite.
        </div>
      )}

      {favoritos.length > 0 && (
        <section className="dash-zone" aria-labelledby="zfav">
          <h2 id="zfav" className="dash-zone-title">
            Mis favoritos
          </h2>
          <div className="fav-compact-row">
            {favoritos.map((sym) => {
              const row = favItems.find(
                (it) => it.symbol.toUpperCase() === sym.toUpperCase(),
              )
              const pos = row ? row.changePct >= 0 : false
              return (
                <article key={sym} className="fav-compact-card">
                  <div className="fav-compact-tick">{sym}</div>
                  {row ? (
                    <>
                      <div className="fav-compact-price">
                        {formatPrice(row.price, row.currency)}
                      </div>
                      <div className={`fav-compact-chg ${pos ? 'gain' : 'loss'}`}>
                        {pos ? '+' : ''}
                        {row.changePct.toFixed(2)}%
                      </div>
                    </>
                  ) : (
                    <div className="fav-compact-muted font-prose">…</div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      )}

      <section className="dash-zone" aria-labelledby="z1">
        <h2 id="z1" className="dash-zone-title">
          Pulso del mercado
        </h2>
        {loading && (
          <div className="pulse-row pulse-skeleton">
            {[1, 2, 3, 4].map((k) => (
              <div key={k} className="skeleton-card pulse-card-sk" />
            ))}
          </div>
        )}
        {!loading && pulse && (
          <div className="pulse-row">
            {pulse.items.map((p) => {
              const pos = p.changePct >= 0
              return (
                <article key={p.symbol + p.label} className="pulse-card">
                  <div className="pulse-label">{p.label}</div>
                  <div className="pulse-value">
                    {formatPrice(p.price, p.currency)}
                  </div>
                  <div className={`pulse-chg ${pos ? 'gain' : 'loss'}`}>
                    {pos ? '+' : ''}
                    {p.changePct.toFixed(2)}%
                  </div>
                </article>
              )
            })}
          </div>
        )}
        {pulse?.errors?.length ? (
          <p className="dash-footnote font-prose">
            {pulse.errors.join(' · ')}
          </p>
        ) : null}
      </section>

      <section className="dash-zone" aria-labelledby="z2">
        <div className="ai-bar">
          <div className="ai-bar-body">
            <p className="ai-bar-lead font-prose">
              <strong>Resumen IA — {summary ? formatDate(summary.date) : '…'}:</strong>
            </p>
            <p className="ai-bar-text font-prose">
              {loading
                ? 'Cargando…'
                : summary?.text ??
                  'Sin resumen disponible todavía.'}
            </p>
          </div>
          <Link className="ai-bar-btn" to="/analisis">
            Ver análisis completo
          </Link>
        </div>
      </section>

      <section className="dash-zone" aria-labelledby="z3">
        <h2 id="z3" className="dash-zone-title">
          Candidatos del día
        </h2>
        {loading && (
          <div className="cand-row">
            {[1, 2, 3].map((k) => (
              <div key={k} className="skeleton-card cand-sk" />
            ))}
          </div>
        )}
        {!loading && (
          <div className="cand-row">
            {candidates.map((c) => {
              const pos = c.changePct >= 0
              return (
                <article key={c.ticker} className="cand-card">
                  <div className="cand-head">
                    <span className="cand-ticker">{c.ticker}</span>
                    <span className={badgeClass(c.signal)}>{c.signal}</span>
                  </div>
                  <div className="cand-price">
                    {c.price.toLocaleString('es-AR', { maximumFractionDigits: 4 })}
                  </div>
                  <div className={`cand-chg ${pos ? 'gain' : 'loss'}`}>
                    {pos ? '+' : ''}
                    {c.changePct.toFixed(2)}%
                  </div>
                  <div className="cand-pills">
                    <span className="pill">RSI {c.rsi}</span>
                    <span className="pill">MACD {c.macd}</span>
                    <span className="pill">Vol. {c.volume}</span>
                  </div>
                  <p className="cand-rationale font-prose">{c.rationale}</p>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="dash-zone" aria-labelledby="z4">
        <h2 id="z4" className="dash-zone-title">
          Scanner rápido
        </h2>
        <div className="scan-filters" role="tablist" aria-label="Filtros del scanner">
          {SCAN_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={scanFilter === id}
              className={`scan-filter ${scanFilter === id ? 'active' : ''}`}
              onClick={() => setScanFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="scan-table-wrap">
          <table className="scan-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Nombre</th>
                <th>Precio</th>
                <th>% Día</th>
                <th>RSI</th>
                <th>MACD</th>
                <th>Señal IA</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="scan-loading">
                    Cargando…
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="scan-loading">
                    Sin filas para este filtro.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const pos = row.changePct >= 0
                  return (
                    <tr key={row.symbol}>
                      <td className="scan-tick">{row.symbol}</td>
                      <td className="scan-name">{row.name}</td>
                      <td>{formatPrice(row.price, row.currency)}</td>
                      <td className={pos ? 'gain' : 'loss'}>
                        {pos ? '+' : ''}
                        {row.changePct.toFixed(2)}%
                      </td>
                      <td>{row.rsi != null ? row.rsi.toFixed(1) : '—'}</td>
                      <td>{row.macd}</td>
                      <td>
                        <span className={badgeClass(row.signal)}>{row.signal}</span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {overview?.errors?.length ? (
          <p className="dash-footnote font-prose">
            Avisos: {overview.errors.slice(0, 2).join(' · ')}
          </p>
        ) : null}
      </section>
    </div>
  )
}
