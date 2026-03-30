import { useCallback, useEffect, useMemo, useState } from 'react'

import { exportPortfolioPdf } from '../lib/exportAnalisisPdf'
import { exportPortfolioExcel } from '../lib/exportPortfolioExcel'
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'

const API = import.meta.env.VITE_API_URL ?? ''
const LS_KEY = 'ingeld_portfolio'

type Moneda = 'USD' | 'ARS'

type Position = {
  id: string
  ticker: string
  cantidad: number
  precioCompra: number
  moneda: Moneda
}

type QuoteRow = {
  symbol: string
  name: string
  price: number
  changePct: number
  currency: string
}

/** Campos del modal "Nueva posición" (strings en inputs controlados). */
type PortfolioFormState = {
  ticker: string
  cantidad: string
  precioCompra: string
  moneda: Moneda
}

function loadPositions(): Position[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const p = JSON.parse(raw) as unknown
    if (!Array.isArray(p)) return []
    return p
      .map((x) => x as Position)
      .filter(
        (x) =>
          x &&
          typeof x.ticker === 'string' &&
          typeof x.cantidad === 'number' &&
          typeof x.precioCompra === 'number' &&
          (x.moneda === 'USD' || x.moneda === 'ARS'),
      )
  } catch {
    return []
  }
}

function savePositions(list: Position[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function Portfolio() {
  const [positions, setPositions] = useState<Position[]>(() => loadPositions())
  const [quotes, setQuotes] = useState<Record<string, QuoteRow>>({})
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<PortfolioFormState>({
    ticker: '',
    cantidad: '',
    precioCompra: '',
    moneda: 'ARS',
  })
  const [aiLoading, setAiLoading] = useState(false)
  const [aiText, setAiText] = useState<string | null>(null)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const [modalFormErr, setModalFormErr] = useState<string | null>(null)

  const tickers = useMemo(
    () => [...new Set(positions.map((p) => p.ticker.trim().toUpperCase()))],
    [positions],
  )

  const refreshQuotes = useCallback(async () => {
    if (tickers.length === 0) {
      setQuotes({})
      return
    }
    setLoading(true)
    try {
      const qs = tickers.map(encodeURIComponent).join(',')
      const res = await fetch(`${API}/api/market/quotes?symbols=${qs}`)
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { quotes: QuoteRow[] }
      const map: Record<string, QuoteRow> = {}
      for (const q of j.quotes ?? []) {
        map[q.symbol.toUpperCase()] = q
      }
      setQuotes(map)
    } catch {
      setQuotes({})
    } finally {
      setLoading(false)
    }
  }, [tickers])

  useEffect(() => {
    void refreshQuotes()
  }, [refreshQuotes])

  useEffect(() => {
    savePositions(positions)
  }, [positions])

  const rows = useMemo(() => {
    return positions.map((p) => {
      const sym = p.ticker.trim().toUpperCase()
      const q = quotes[sym]
      const price = q?.price ?? 0
      const inv = p.cantidad * p.precioCompra
      const cur = p.cantidad * price
      const pl = cur - inv
      const plPct = inv !== 0 ? (pl / inv) * 100 : 0
      return {
        pos: p,
        sym,
        name: q?.name ?? sym,
        price,
        hasQuote: Boolean(q),
        inv,
        cur,
        pl,
        plPct,
        currency: p.moneda,
      }
    })
  }, [positions, quotes])

  const fechaAnalisisLabel = useMemo(
    () =>
      new Date().toLocaleDateString('es-AR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [],
  )

  const fileDateSlug = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [],
  )

  const summary = useMemo(() => {
    let invUSD = 0
    let invARS = 0
    let curUSD = 0
    let curARS = 0
    for (const r of rows) {
      if (r.pos.moneda === 'USD') {
        invUSD += r.inv
        curUSD += r.cur
      } else {
        invARS += r.inv
        curARS += r.cur
      }
    }
    const plUSD = curUSD - invUSD
    const plARS = curARS - invARS
    const pctUSD = invUSD !== 0 ? (plUSD / invUSD) * 100 : 0
    const pctARS = invARS !== 0 ? (plARS / invARS) * 100 : 0
    const withPct = rows.filter((r) => r.hasQuote && r.inv !== 0)
    let best: { sym: string; pct: number } | null = null
    let worst: { sym: string; pct: number } | null = null
    for (const r of withPct) {
      if (best === null || r.plPct > best.pct) best = { sym: r.sym, pct: r.plPct }
      if (worst === null || r.plPct < worst.pct) worst = { sym: r.sym, pct: r.plPct }
    }
    return {
      invUSD,
      invARS,
      curUSD,
      curARS,
      plUSD,
      plARS,
      pctUSD,
      pctARS,
      best,
      worst,
    }
  }, [rows])

  const handleGuardarPosicion = () => {
    console.log('form state:', form)
    setModalFormErr(null)
    const { ticker, cantidad, precioCompra, moneda } = form
    const cantidadNum = parseFloat(cantidad)
    const precioNum = parseFloat(precioCompra)

    if (
      !ticker.trim() ||
      isNaN(cantidadNum) ||
      cantidadNum <= 0 ||
      isNaN(precioNum) ||
      precioNum <= 0
    ) {
      setModalFormErr('Completá ticker, cantidad y precio (números > 0)')
      return
    }
    const t = ticker.trim().toUpperCase()
    const nuevaPosicion: Position = {
      id: uid(),
      ticker: t,
      cantidad: cantidadNum,
      precioCompra: precioNum,
      moneda,
    }
    console.log('guardando posicion', nuevaPosicion)
    setPositions((prev) => {
      const next = [...prev, nuevaPosicion]
      savePositions(next)
      return next
    })
    setForm({ ticker: '', cantidad: '', precioCompra: '', moneda })
    setModalFormErr(null)
    setModal(false)
  }

  const remove = (id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id))
  }

  const runAi = async () => {
    if (rows.length === 0) return
    setAiLoading(true)
    setAiErr(null)
    setAiText(null)
    const lines = rows.map((r) => {
      const q = quotes[r.sym]
      const nombre = q?.name ?? r.sym
      return (
        `- ${r.sym} (${nombre}): cantidad ${r.pos.cantidad}, compra ${r.pos.precioCompra} ${r.pos.moneda}, ` +
        `actual ${r.hasQuote ? r.price.toFixed(4) : 'N/D'}, P&L ${r.plPct.toFixed(2)}% (${r.pl.toFixed(2)} ${r.pos.moneda})`
      )
    })
    const mensaje = `Cartera del usuario:\n${lines.join('\n')}\n\nResumí riesgos, diversificación y próximos pasos.`
    try {
      const res = await fetch(`${API}/api/chat/analizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: 'PORTFOLIO',
          mensaje,
          historial: [],
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { respuesta: string }
      setAiText(j.respuesta ?? '')
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setAiLoading(false)
    }
  }

  const handleExportPdf = () => {
    if (!aiText) return
    exportPortfolioPdf({
      rows: rows.map((r) => ({
        sym: r.sym,
        cantidad: r.pos.cantidad,
        precioCompra: r.pos.precioCompra,
        precioActual: r.hasQuote ? r.price : null,
        pl: r.hasQuote ? r.pl : null,
        plPct: r.hasQuote ? r.plPct : null,
        moneda: r.pos.moneda,
        hasQuote: r.hasQuote,
      })),
      summary: {
        invARS: summary.invARS,
        invUSD: summary.invUSD,
        curARS: summary.curARS,
        curUSD: summary.curUSD,
        plARS: summary.plARS,
        plUSD: summary.plUSD,
      },
      aiMarkdown: aiText,
    })
  }

  const handleExportExcel = () => {
    if (!aiText) return
    exportPortfolioExcel({
      fileDateSlug,
      rows: rows.map((r) => ({
        ticker: r.sym,
        nombre: r.hasQuote ? r.name : '—',
        cantidad: r.pos.cantidad,
        precioCompra: r.pos.precioCompra,
        precioActual: r.hasQuote
          ? r.price.toLocaleString('es-AR', { maximumFractionDigits: 4 })
          : '—',
        pl: r.hasQuote
          ? `${r.pl >= 0 ? '+' : ''}${r.pl.toLocaleString('es-AR', {
              maximumFractionDigits: 2,
            })} ${r.pos.moneda}`
          : '—',
        plPct: r.hasQuote
          ? `${r.plPct >= 0 ? '+' : ''}${r.plPct.toFixed(2)}%`
          : '—',
        valorTotal: r.hasQuote
          ? r.cur.toLocaleString('es-AR', { maximumFractionDigits: 2 })
          : '—',
        moneda: r.pos.moneda,
      })),
      summary: {
        totalInvertidoARS:
          summary.invARS > 0
            ? `${summary.invARS.toLocaleString('es-AR', {
                maximumFractionDigits: 0,
              })} ARS`
            : '—',
        totalInvertidoUSD:
          summary.invUSD > 0
            ? `${summary.invUSD.toLocaleString('es-AR', {
                maximumFractionDigits: 2,
              })} USD`
            : '—',
        valorActualARS:
          summary.curARS > 0
            ? `${summary.curARS.toLocaleString('es-AR', {
                maximumFractionDigits: 0,
              })} ARS`
            : '—',
        valorActualUSD:
          summary.curUSD > 0
            ? `${summary.curUSD.toLocaleString('es-AR', {
                maximumFractionDigits: 2,
              })} USD`
            : '—',
        plARS:
          summary.invARS > 0
            ? `${summary.plARS >= 0 ? '+' : ''}${summary.plARS.toLocaleString(
                'es-AR',
                { maximumFractionDigits: 0 },
              )} ARS`
            : '—',
        plUSD:
          summary.invUSD > 0
            ? `${summary.plUSD >= 0 ? '+' : ''}${summary.plUSD.toLocaleString(
                'es-AR',
                { maximumFractionDigits: 2 },
              )} USD`
            : '—',
        mejorPosicion: summary.best
          ? `${summary.best.sym} (${summary.best.pct >= 0 ? '+' : ''}${summary.best.pct.toFixed(2)}%)`
          : '—',
        peorPosicion: summary.worst
          ? `${summary.worst.sym} (${summary.worst.pct.toFixed(2)}%)`
          : '—',
      },
    })
  }

  return (
    <div className="portfolio-page">
      <h1 className="page-title">Portfolio</h1>
      <p className="page-sub">
        Cargá posiciones manualmente. El valor actual se actualiza con
        cotizaciones en vivo.
      </p>

      <section className="dash-zone" aria-labelledby="pf-pos">
        <div className="portfolio-toolbar">
          <h2 id="pf-pos" className="dash-zone-title">
            Mis posiciones
          </h2>
          <button
            type="button"
            className="portfolio-add-btn"
            onClick={() => setModal(true)}
          >
            Agregar posición
          </button>
          <button
            type="button"
            className="portfolio-refresh-btn"
            onClick={() => void refreshQuotes()}
            disabled={loading || tickers.length === 0}
          >
            {loading ? 'Actualizando…' : 'Actualizar cotizaciones'}
          </button>
        </div>

        {positions.length === 0 ? (
          <p className="page-sub font-prose">No hay posiciones aún.</p>
        ) : (
          <div className="portfolio-table-wrap">
            <table className="portfolio-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Nombre</th>
                  <th>Cantidad</th>
                  <th>P. Compra</th>
                  <th>P. Actual</th>
                  <th>P&L $</th>
                  <th>P&L %</th>
                  <th>Valor total</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const plPos = r.pl >= 0
                  return (
                    <tr key={r.pos.id}>
                      <td className="pf-tick">{r.sym}</td>
                      <td className="font-prose">{r.hasQuote ? r.name : '—'}</td>
                      <td>{r.pos.cantidad}</td>
                      <td>
                        {r.pos.precioCompra.toLocaleString('es-AR', {
                          maximumFractionDigits: 4,
                        })}{' '}
                        {r.pos.moneda}
                      </td>
                      <td>
                        {r.hasQuote
                          ? `${r.price.toLocaleString('es-AR', { maximumFractionDigits: 4 })}`
                          : '—'}
                      </td>
                      <td className={plPos ? 'gain' : 'loss'}>
                        {r.hasQuote
                          ? `${r.pl >= 0 ? '+' : ''}${r.pl.toLocaleString('es-AR', {
                              maximumFractionDigits: 2,
                            })} ${r.pos.moneda}`
                          : '—'}
                      </td>
                      <td className={plPos ? 'gain' : 'loss'}>
                        {r.hasQuote
                          ? `${r.plPct >= 0 ? '+' : ''}${r.plPct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td>
                        {r.hasQuote
                          ? `${r.cur.toLocaleString('es-AR', {
                              maximumFractionDigits: 2,
                            })} ${r.pos.moneda}`
                          : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="portfolio-remove"
                          onClick={() => remove(r.pos.id)}
                          aria-label="Quitar"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {positions.length > 0 && (
        <section className="dash-zone" aria-labelledby="pf-sum">
          <h2 id="pf-sum" className="dash-zone-title">
            Resumen de cartera
          </h2>
          <div className="portfolio-summary">
            <article className="portfolio-sum-card">
              <h3>Total invertido</h3>
              <p className="pf-sum-num">
                {summary.invARS > 0 && (
                  <>
                    {summary.invARS.toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    ARS
                    <br />
                  </>
                )}
                {summary.invUSD > 0 && (
                  <>
                    {summary.invUSD.toLocaleString('es-AR', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    USD
                  </>
                )}
                {summary.invARS === 0 && summary.invUSD === 0 && '—'}
              </p>
            </article>
            <article className="portfolio-sum-card">
              <h3>Valor actual</h3>
              <p className="pf-sum-num">
                {summary.curARS > 0 && (
                  <>
                    {summary.curARS.toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    ARS
                    <br />
                  </>
                )}
                {summary.curUSD > 0 && (
                  <>
                    {summary.curUSD.toLocaleString('es-AR', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    USD
                  </>
                )}
                {summary.curARS === 0 && summary.curUSD === 0 && '—'}
              </p>
            </article>
            <article className="portfolio-sum-card">
              <h3>P&L total</h3>
              <p className="pf-sum-num">
                {summary.invARS > 0 && (
                  <span className={summary.plARS >= 0 ? 'gain' : 'loss'}>
                    {summary.plARS >= 0 ? '+' : ''}
                    {summary.plARS.toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    ARS
                    <br />
                  </span>
                )}
                {summary.invUSD > 0 && (
                  <span className={summary.plUSD >= 0 ? 'gain' : 'loss'}>
                    {summary.plUSD >= 0 ? '+' : ''}
                    {summary.plUSD.toLocaleString('es-AR', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    USD
                  </span>
                )}
              </p>
            </article>
            <article className="portfolio-sum-card">
              <h3>P&L total %</h3>
              <p className="pf-sum-num">
                {summary.invARS > 0 && (
                  <span className={summary.pctARS >= 0 ? 'gain' : 'loss'}>
                    ARS: {summary.pctARS >= 0 ? '+' : ''}
                    {summary.pctARS.toFixed(2)}%
                    <br />
                  </span>
                )}
                {summary.invUSD > 0 && (
                  <span className={summary.pctUSD >= 0 ? 'gain' : 'loss'}>
                    USD: {summary.pctUSD >= 0 ? '+' : ''}
                    {summary.pctUSD.toFixed(2)}%
                  </span>
                )}
                {summary.invARS === 0 && summary.invUSD === 0 && '—'}
              </p>
            </article>
          </div>
          {summary.best && (
            <p className="portfolio-best font-prose">
              Mejor posición: <strong>{summary.best.sym}</strong>{' '}
              <span className="gain">+{summary.best.pct.toFixed(2)}%</span>
            </p>
          )}
          {summary.worst && (
            <p className="portfolio-worst font-prose">
              Peor posición: <strong>{summary.worst.sym}</strong>{' '}
              <span className="loss">{summary.worst.pct.toFixed(2)}%</span>
            </p>
          )}
        </section>
      )}

      <section className="dash-zone" aria-labelledby="pf-ai">
        <h2 id="pf-ai" className="dash-zone-title">
          Análisis IA
        </h2>
        <button
          type="button"
          className="portfolio-ai-btn"
          onClick={() => void runAi()}
          disabled={aiLoading || positions.length === 0}
        >
          {aiLoading ? 'Analizando…' : 'Analizar cartera con IA'}
        </button>
        {aiErr && <div className="error-state">{aiErr}</div>}
        {aiText && (
          <div className="portfolio-ai-panel">
            <header className="portfolio-ai-panel-head">
              <span className="portfolio-ai-brand">INGELD</span>
              <span className="portfolio-ai-panel-sub">
                Análisis de cartera — {fechaAnalisisLabel}
              </span>
            </header>
            <div className="portfolio-ai-panel-divider" aria-hidden />
            <div className="portfolio-ai-export-row">
              <button
                type="button"
                className="portfolio-ai-btn"
                onClick={handleExportPdf}
              >
                Exportar PDF
              </button>
              <button
                type="button"
                className="portfolio-refresh-btn"
                onClick={handleExportExcel}
              >
                Exportar Excel
              </button>
            </div>
            <AnalysisMarkdown source={aiText} />
          </div>
        )}
      </section>

      {modal && (
        <div
          className="ingeld-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pf-modal-title"
        >
          <div
            className="ingeld-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="pf-modal-title" className="ingeld-modal-title">
              Nueva posición
            </h2>
            <label className="ingeld-modal-field">
              Ticker
              <input
                type="text"
                className="ingeld-input"
                placeholder="ej: GGAL.BA"
                value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Cantidad
              <input
                type="number"
                className="ingeld-input"
                placeholder="ej: 100"
                value={form.cantidad}
                onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Precio de compra
              <input
                type="number"
                className="ingeld-input"
                placeholder="ej: 6000"
                value={form.precioCompra}
                onChange={e => setForm(f => ({ ...f, precioCompra: e.target.value }))}
              />
            </label>
            <label className="ingeld-modal-field">
              Moneda
              <select
                value={form.moneda}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    moneda: e.target.value as Moneda,
                  }))
                }
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </label>
            {modalFormErr && (
              <p className="ingeld-modal-error" role="alert">
                {modalFormErr}
              </p>
            )}
            <div className="ingeld-modal-actions">
              <button
                type="button"
                onClick={() => {
                  setModalFormErr(null)
                  setModal(false)
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="ingeld-modal-primary"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleGuardarPosicion()
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
