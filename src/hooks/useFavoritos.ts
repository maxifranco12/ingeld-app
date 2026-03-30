import { useCallback, useEffect, useState } from 'react'

const KEY = 'ingeld_favoritos'

function parseStored(raw: string | null): string[] {
  if (!raw) return []
  try {
    const p = JSON.parse(raw) as unknown
    if (!Array.isArray(p)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const x of p) {
      const u = String(x).trim().toUpperCase()
      if (!u || seen.has(u)) continue
      seen.add(u)
      out.push(u)
    }
    return out
  } catch {
    return []
  }
}

function read(): string[] {
  return parseStored(localStorage.getItem(KEY))
}

function write(next: string[]) {
  localStorage.setItem(KEY, JSON.stringify(next))
}

const subs = new Set<() => void>()

function notify() {
  subs.forEach((fn) => fn())
}

export function useFavoritos() {
  const [favoritos, setFavoritos] = useState<string[]>(read)

  useEffect(() => {
    const sub = () => setFavoritos(read())
    subs.add(sub)
    return () => {
      subs.delete(sub)
    }
  }, [])

  const toggleFavorito = useCallback((ticker: string) => {
    const u = ticker.trim().toUpperCase()
    if (!u) return
    const cur = read()
    const next = cur.includes(u) ? cur.filter((x) => x !== u) : [...cur, u]
    write(next)
    notify()
  }, [])

  const esFavorito = useCallback(
    (ticker: string) => favoritos.includes(ticker.trim().toUpperCase()),
    [favoritos],
  )

  return { favoritos, toggleFavorito, esFavorito }
}
