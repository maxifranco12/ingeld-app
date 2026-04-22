import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnalysisMarkdown } from '../lib/renderAnalysisMarkdown'

const API = import.meta.env.VITE_API_URL ?? ''

type Idea = {
  ticker: string
  nombre: string
  señal: string
  precio_entrada: number
  precio_objetivo: number
  stop_loss: number
  horizonte: string
  racional: string
  riesgo_principal: string
  confianza: 'Alta' | 'Media' | 'Baja'
  fecha_generada?: string
}

const FALLBACK: Idea = {
  ticker: 'MSFT',
  nombre: 'Microsoft Corp.',
  señal: 'COMPRAR',
  precio_entrada: 420,
  precio_objetivo: 460,
  stop_loss: 395,
  horizonte: '1-4 semanas',
  racional:
    'La tesis combina momentum de IA corporativa, fortaleza de márgenes y resiliencia de caja en un entorno de tasas todavía elevadas.\n\nMicrosoft mantiene tracción en nube y productividad, con capacidad de monetización incremental.\n\nEl perfil riesgo/retorno es asimétrico mientras el precio se mantenga sobre soporte clave.',
  riesgo_principal: 'Compresión de múltiplos si el crecimiento de nube se desacelera más de lo esperado.',
  confianza: 'Media',
}

function confClass(c: Idea['confianza']): string {
  if (c === 'Alta') return 'lab-pill lab-pill--ok'
  if (c === 'Media') return 'lab-pill lab-pill--warn'
  return 'lab-pill lab-pill--bad'
}

function normConf(c: string): Idea['confianza'] {
  const x = c.trim().toLowerCase()
  if (x.startsWith('alta')) return 'Alta'
  if (x.startsWith('baja')) return 'Baja'
  return 'Media'
}

export default function IdeaSemana() {
  const [idea, setIdea] = useState<Idea>(FALLBACK)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(`${API}/api/market/idea-semanal`)
        if (!res.ok) throw new Error('fetch')
        const j = (await res.json()) as Record<string, unknown>
        setIdea({
          ticker: String(j.ticker ?? FALLBACK.ticker).toUpperCase(),
          nombre: String(j.nombre ?? FALLBACK.nombre),
          señal: String(j.señal ?? j['senal'] ?? FALLBACK.señal),
          precio_entrada: Number(j.precio_entrada ?? FALLBACK.precio_entrada),
          precio_objetivo: Number(j.precio_objetivo ?? FALLBACK.precio_objetivo),
          stop_loss: Number(j.stop_loss ?? FALLBACK.stop_loss),
          horizonte: String(j.horizonte ?? FALLBACK.horizonte),
          racional: String(j.racional ?? FALLBACK.racional),
          riesgo_principal: String(j.riesgo_principal ?? FALLBACK.riesgo_principal),
          confianza: normConf(String(j.confianza ?? 'Media')),
          fecha_generada: j.fecha_generada != null ? String(j.fecha_generada) : undefined,
        })
      } catch {
        setIdea(FALLBACK)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const gauge = useMemo(() => {
    const min = Math.min(idea.stop_loss, idea.precio_entrada, idea.precio_objetivo)
    const max = Math.max(idea.stop_loss, idea.precio_entrada, idea.precio_objetivo)
    const span = Math.max(1, max - min)
    return {
      stop: ((idea.stop_loss - min) / span) * 100,
      entry: ((idea.precio_entrada - min) / span) * 100,
      target: ((idea.precio_objetivo - min) / span) * 100,
    }
  }, [idea])

  return (
    <div className="page">
      <h1>💡 Idea de la semana</h1>
      <p className="page-sub">
        {idea.fecha_generada ? `Actualizado: ${idea.fecha_generada}` : `Actualizado: ${new Date().toLocaleDateString('es-AR')}`}
      </p>

      {loading ? <p className="page-sub">Generando idea de esta semana…</p> : null}

      <article className="idea-card">
        <div className="idea-top">
          <div>
            <p className="idea-ticker">{idea.ticker}</p>
            <h2>{idea.nombre}</h2>
          </div>
          <span className="señal-badge señal-badge--comprar">{idea.señal || 'COMPRAR'}</span>
        </div>

        <div className="lab-grid-3">
          <div><p className="small-muted">Entrada</p><p className="big-mono">{idea.precio_entrada}</p></div>
          <div><p className="small-muted">Objetivo</p><p className="big-mono">{idea.precio_objetivo}</p></div>
          <div><p className="small-muted">Stop loss</p><p className="big-mono">{idea.stop_loss}</p></div>
        </div>

        <div className="idea-gauge">
          <div className="idea-gauge-line" />
          <span className="idea-dot idea-dot--stop" style={{ left: `${gauge.stop}%` }} />
          <span className="idea-dot idea-dot--entry" style={{ left: `${gauge.entry}%` }} />
          <span className="idea-dot idea-dot--target" style={{ left: `${gauge.target}%` }} />
        </div>

        <div className="lab-grid-2">
          <p>Horizonte: <b>{idea.horizonte}</b></p>
          <p>Confianza: <span className={confClass(idea.confianza)}>{idea.confianza}</span></p>
        </div>

        <section className="idea-racional">
          <h3>Racional</h3>
          <AnalysisMarkdown source={idea.racional} />
        </section>

        <section className="idea-riesgo">
          <h3>Riesgo principal</h3>
          <p>{idea.riesgo_principal}</p>
        </section>

        <div className="idea-actions">
          <Link className="portfolio-ai-btn" to={`/activo/${idea.ticker}`}>
            Ver análisis completo
          </Link>
          <Link className="portfolio-refresh-btn" to={`/stock-lab?ticker=${encodeURIComponent(idea.ticker)}`}>
            Analizar en Stock Lab
          </Link>
        </div>

        <p className="small-muted" style={{ marginTop: '1rem' }}>
          Esta idea es generada por IA y no constituye asesoramiento financiero.
        </p>
      </article>
    </div>
  )
}
