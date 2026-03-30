import { useCallback, useState } from 'react'
import { PageBackButton } from '../components/PageBackButton'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

const LS_KEY = 'ingeld_scanner_tickers'

const DEFAULT_TICKERS = [
  'GGAL.BA',
  'BMA.BA',
  'PAMP.BA',
  'TXAR.BA',
  'YPFD.BA',
  'TECO2.BA',
]

function loadTickers(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return [...DEFAULT_TICKERS]
    const p = JSON.parse(raw) as unknown
    if (!Array.isArray(p) || p.length === 0) return [...DEFAULT_TICKERS]
    const seen = new Set<string>()
    const out: string[] = []
    for (const x of p) {
      const u = String(x).trim().toUpperCase()
      if (!u || seen.has(u)) continue
      seen.add(u)
      out.push(u)
    }
    return out.length ? out : [...DEFAULT_TICKERS]
  } catch {
    return [...DEFAULT_TICKERS]
  }
}

function persistTickers(list: string[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

export function Configuracion() {
  const [tickers, setTickers] = useState<string[]>(() => loadTickers())
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const remove = (t: string) => {
    setTickers((prev) => {
      const next = prev.filter((x) => x !== t)
      persistTickers(next)
      return next
    })
    setMsg(null)
    setErr(null)
  }

  const add = () => {
    const u = input.trim().toUpperCase()
    setErr(null)
    setMsg(null)
    if (!u) {
      setErr('Ingresá un ticker.')
      return
    }
    if (tickers.includes(u)) {
      setErr('Ese ticker ya está en la lista.')
      return
    }
    setTickers((prev) => {
      const next = [...prev, u]
      persistTickers(next)
      return next
    })
    setInput('')
  }

  const guardar = useCallback(async () => {
    setErr(null)
    setMsg(null)
    if (tickers.length === 0) {
      setErr('Debe haber al menos un ticker.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${BASE_URL}/api/scanner/tickers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `HTTP ${res.status}`)
      }
      const j = (await res.json()) as { ok?: boolean; tickers?: string[] }
      const list = j.tickers ?? tickers
      setTickers(list)
      persistTickers(list)
      setMsg('Scanner actualizado en el servidor.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }, [tickers])

  return (
    <div className="config-page">
      <PageBackButton />
      <h1 className="page-title">Configuración del scanner</h1>

      <section className="config-section" aria-labelledby="cfg-universe">
        <h2 id="cfg-universe" className="dash-zone-title">
          Universo de tickers
        </h2>
        <p className="page-sub">
          Los cambios se guardan en este navegador y se envían al backend al
          pulsar &quot;Guardar y actualizar scanner&quot;.
        </p>

        <ul className="config-ticker-list">
          {tickers.map((t) => (
            <li key={t} className="config-ticker-item">
              <span className="config-ticker-code">{t}</span>
              <button
                type="button"
                className="config-ticker-remove"
                onClick={() => remove(t)}
                aria-label={`Quitar ${t}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <div className="config-add-row">
          <input
            className="config-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            placeholder="Ej. SPY"
            aria-label="Nuevo ticker"
          />
          <button type="button" className="config-add-btn" onClick={add}>
            Agregar
          </button>
        </div>

        {err && <div className="error-state config-msg">{err}</div>}
        {msg && <p className="config-success font-prose">{msg}</p>}

        <button
          type="button"
          className="config-save-btn"
          onClick={() => void guardar()}
          disabled={saving || tickers.length === 0}
        >
          {saving ? 'Guardando…' : 'Guardar y actualizar scanner'}
        </button>
      </section>
    </div>
  )
}
