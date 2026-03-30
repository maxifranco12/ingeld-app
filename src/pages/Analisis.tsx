import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { PageBackButton } from '../components/PageBackButton'
import { exportAnalisisPdf } from '../lib/exportAnalisisPdf'

type ChatRole = 'user' | 'assistant'

type ChatMessage = { role: ChatRole; content: string }

const RESUMEN_INICIAL =
  'Hacé un resumen técnico completo de este activo en 3-4 párrafos'

const PREGUNTAS_RAPIDAS = [
  '¿Cuál es la tendencia?',
  '¿Hay señal de entrada?',
  '¿Qué riesgos tiene?',
  '¿Está sobrecomprado?',
]

async function postAnalizar(
  ticker: string,
  mensaje: string,
  historial: { role: string; content: string }[],
) {
  const res = await fetch('/api/chat/analizar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, mensaje, historial }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as { respuesta: string; ticker: string }
}

export function Analisis() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const tickerQ = searchParams.get('ticker')
  const tickerState = (location.state as { ticker?: string } | null)?.ticker
  const [tickerInput, setTickerInput] = useState('GGAL.BA')
  const [activeTicker, setActiveTicker] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  const lastAutoloadKey = useRef<string | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const scrollToBottom = () => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  const cargarTicker = useCallback(async (tRaw: string) => {
    const t = tRaw.trim()
    if (!t) {
      setError('Ingresá un ticker.')
      return
    }
    setActiveTicker(t)
    setTickerInput(t)
    setMessages([])
    messagesRef.current = []
    setError(null)
    setLoading(true)
    try {
      const data = await postAnalizar(t, RESUMEN_INICIAL, [])
      const next: ChatMessage[] = [
        { role: 'user', content: RESUMEN_INICIAL },
        { role: 'assistant', content: data.respuesta },
      ]
      setMessages(next)
      messagesRef.current = next
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
      setActiveTicker(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const sendUserText = useCallback(async (text: string) => {
    const tkr = activeTicker
    if (!tkr || !text.trim()) return
    setLoading(true)
    setError(null)
    const prev = messagesRef.current
    const historial = prev.map(({ role, content }) => ({ role, content }))
    try {
      const data = await postAnalizar(tkr, text.trim(), historial)
      setMessages([
        ...prev,
        { role: 'user', content: text.trim() },
        { role: 'assistant', content: data.respuesta },
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al enviar')
    } finally {
      setLoading(false)
    }
  }, [activeTicker])

  useEffect(() => {
    const t = tickerQ?.trim() || tickerState?.trim()
    if (!t) return
    const key = `${t}|q:${tickerQ ?? ''}|s:${tickerState ?? ''}`
    if (lastAutoloadKey.current === key) return
    lastAutoloadKey.current = key
    void cargarTicker(t)
  }, [tickerQ, tickerState, cargarTicker])

  const handleCargar = () => {
    void cargarTicker(tickerInput)
  }

  const handleEnviar = () => {
    const text = draft.trim()
    if (!text || loading) return
    setDraft('')
    void sendUserText(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleEnviar()
    }
  }

  return (
    <div className="chat-page">
      <PageBackButton />
      <div className="chat-title-row">
        <h1 className="page-title chat-title-inline">
          Chat IA — Análisis de activos
        </h1>
        {messages.length > 0 && activeTicker && (
          <button
            type="button"
            className="chat-export-pdf"
            onClick={() => exportAnalisisPdf(activeTicker, messages)}
          >
            Exportar PDF
          </button>
        )}
      </div>
      <p className="page-sub">
        Elegí un ticker y pedí análisis con contexto técnico (RSI, MACD,
        Bollinger, medias). El historial se mantiene en esta sesión.
      </p>

      <div className="chat-toolbar">
        <label className="chat-ticker-label" htmlFor="chat-ticker">
          Ticker
        </label>
        <input
          id="chat-ticker"
          className="chat-ticker-input"
          value={tickerInput}
          onChange={(e) => setTickerInput(e.target.value)}
          placeholder="ej. GGAL.BA"
          disabled={loading}
        />
        <button
          type="button"
          className="chat-load-btn"
          onClick={handleCargar}
          disabled={loading}
        >
          Cargar
        </button>
      </div>

      {activeTicker && (
        <p className="chat-active-ticker font-prose">
          Activo: <strong>{activeTicker}</strong>
        </p>
      )}

      {error && <div className="error-state chat-error">{error}</div>}

      <div className="chat-panel">
        {loading && !messages.length && (
          <div className="chat-loading-inline">
            <div className="chat-spinner" aria-hidden />
            <span className="font-prose">Generando resumen…</span>
          </div>
        )}

        <div className="chat-log">
          {messages.map((m, i) => (
            <div
              key={`${i}-${m.role}-${m.content.slice(0, 12)}`}
              className={
                m.role === 'user'
                  ? 'chat-msg chat-msg-user'
                  : 'chat-msg chat-msg-assistant'
              }
            >
              <div className="chat-msg-meta">
                {m.role === 'user' ? 'Vos' : 'Claude'}
              </div>
              <div className="chat-msg-body font-prose">{m.content}</div>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {loading && messages.length > 0 && (
          <div className="chat-typing">
            <div className="chat-spinner chat-spinner-sm" aria-hidden />
            <span className="font-prose">Pensando…</span>
          </div>
        )}

        <div className="chat-input-row">
          <textarea
            className="chat-input"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribí tu pregunta…"
            disabled={loading || !activeTicker}
          />
          <button
            type="button"
            className="chat-send-btn"
            onClick={handleEnviar}
            disabled={loading || !activeTicker || !draft.trim()}
          >
            Enviar
          </button>
        </div>

        <div className="chat-quick">
          {PREGUNTAS_RAPIDAS.map((q) => (
            <button
              key={q}
              type="button"
              className="chat-quick-btn"
              disabled={loading || !activeTicker}
              onClick={() => void sendUserText(q)}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
