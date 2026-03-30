import { useEffect, useState } from 'react'

type TapeItem = {
  symbol: string
  price: number
  changePct: number
  currency: string
}

export function TickerTape() {
  const [items, setItems] = useState<TapeItem[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/market/tape')
        if (!res.ok) return
        const json = (await res.json()) as { items: TapeItem[] }
        if (!cancelled) setItems(json.items ?? [])
      } catch {
        /* ignore */
      }
    }
    load()
    const id = setInterval(load, 120_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!items.length) return null

  const doubled = [...items, ...items]

  return (
    <div className="ticker-tape" aria-hidden>
      <div className="ticker-tape-track">
        {doubled.map((it, i) => {
          const sign = it.changePct >= 0 ? '+' : ''
          const cls = it.changePct >= 0 ? 'tape-up' : 'tape-down'
          const cur = it.currency ? ` ${it.currency}` : ''
          return (
            <span key={`${it.symbol}-${i}`} className="tape-seg">
              <span className="tape-sym">{it.symbol}</span>
              <span className="tape-num">
                {it.price.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                {cur}
              </span>
              <span className={cls}>
                {sign}
                {it.changePct.toFixed(2)}%
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
