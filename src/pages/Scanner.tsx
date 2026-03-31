import { useCallback, useEffect, useState } from 'react'
import { PageBackButton } from '../components/PageBackButton'
import { useFavoritos } from '../hooks/useFavoritos'

const API = import.meta.env.VITE_API_URL ?? ''

type Candidato = {
  ticker: string
  nombre: string
  precio: number
  variacion_pct: number
  rsi: number | null
  macd: number
  macd_signal: number
  macd_hist: number
  macd_direccion: string
  cruce_histograma: boolean
  vs_ma20: string
  vs_ma50: string | null
  volumen_relativo: number
  score: number
  señal: string
  confianza: string
  razón: string
}

type ScannerResponse = {
  updatedAt: string
  candidatos: Candidato[]
}

const SCORE_TOOLTIP =
  'Puntos de analista (máx. 3): RSI <35 o >70, cruce de histograma MACD en últimos 5 cierres, volumen >1,3× media 20 sesiones.'

function badgeClass(signal: string) {
  if (signal === 'COMPRAR') return 'scanner-badge-comprar'
  if (signal === 'VENDER') return 'scanner-badge-vender'
  return 'scanner-badge-neutro'
}

function formatUpdated(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export function Scanner() {
  const { toggleFavorito, esFavorito } = useFavoritos()
  const [data, setData] = useState<ScannerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/scanner/candidatos`)
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `HTTP ${res.status}`)
      }
      const json = (await res.json()) as ScannerResponse
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar el scanner')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="scanner-page">
      <PageBackButton />
      <h1 className="page-title">Candidatos del día</h1>
      <div className="scanner-sub-row">
        <p className="page-sub scanner-sub">
          {data?.updatedAt
            ? formatUpdated(data.updatedAt)
            : loading && !data
              ? 'Obteniendo datos…'
              : '—'}
        </p>
        <button
          type="button"
          className="scanner-refresh"
          onClick={() => load()}
          disabled={loading}
        >
          Actualizar
        </button>
      </div>

      {loading && !data && (
        <div className="scanner-loading-wrap" aria-busy="true">
          <div className="scanner-spinner" />
          <p className="scanner-loading-text font-prose">Analizando mercado…</p>
        </div>
      )}

      {error && !loading && (
        <div className="error-state">{error}</div>
      )}

      {data && (
        <div className="scanner-grid-wrap">
          {loading && (
            <div className="scanner-refresh-overlay" aria-hidden>
              <div className="scanner-spinner" />
            </div>
          )}
          <div className="scanner-grid">
            {data.candidatos.map((c) => {
              const pos = c.variacion_pct >= 0
              return (
                <article key={c.ticker} className="scanner-card">
                  <div className="scanner-card-top">
                    <div>
                      <div className="scanner-ticker-row">
                        <button
                          type="button"
                          className={`fav-star ${esFavorito(c.ticker) ? 'active' : 'inactive'}`}
                          onClick={() => toggleFavorito(c.ticker)}
                          aria-label={
                            esFavorito(c.ticker)
                              ? `Quitar ${c.ticker} de favoritos`
                              : `Agregar ${c.ticker} a favoritos`
                          }
                        >
                          {esFavorito(c.ticker) ? '★' : '☆'}
                        </button>
                        <span className="scanner-ticker">{c.ticker}</span>
                      </div>
                      <p className="scanner-name font-prose">{c.nombre}</p>
                    </div>
                    <div className="scanner-badges">
                      <span className={badgeClass(c.señal)}>{c.señal}</span>
                      <span className="scanner-confianza">{c.confianza}</span>
                    </div>
                  </div>

                  <div className="scanner-score-row">
                    <span
                      className="scanner-score"
                      title={SCORE_TOOLTIP}
                    >
                      Score técnico: {c.score}/3
                    </span>
                  </div>

                  <div className="scanner-price-row">
                    <span className="scanner-price">
                      {c.precio.toLocaleString('es-AR', {
                        maximumFractionDigits: 4,
                      })}
                    </span>
                    <span className={`scanner-chg ${pos ? 'gain' : 'loss'}`}>
                      {pos ? '+' : ''}
                      {c.variacion_pct.toFixed(2)}%
                    </span>
                  </div>

                  <div className="scanner-pills">
                    <span className="scanner-pill">
                      RSI {c.rsi != null ? c.rsi.toFixed(1) : '—'}
                    </span>
                    <span className="scanner-pill">
                      MACD {c.macd_direccion}
                    </span>
                    <span className="scanner-pill">
                      Cruce {c.cruce_histograma ? 'sí' : 'no'}
                    </span>
                    <span className="scanner-pill">MA20 {c.vs_ma20}</span>
                    <span className="scanner-pill">
                      MA50 {c.vs_ma50 ?? '—'}
                    </span>
                    <span className="scanner-pill">
                      Vol. {c.volumen_relativo.toFixed(2)}×
                    </span>
                  </div>

                  <div className="scanner-meta-line font-prose">
                    MACD hist. {c.macd_hist.toFixed(4)} · señal{' '}
                    {c.macd_signal.toFixed(4)}
                  </div>

                  <hr className="scanner-divider" />

                  <p className="scanner-reason font-prose">{c.razón}</p>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {data && !loading && data.candidatos.length === 0 && (
        <p className="page-sub">No hay candidatos para mostrar.</p>
      )}
    </div>
  )
}
