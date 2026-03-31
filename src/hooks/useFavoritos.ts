import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

const KEY = 'ingeld_favoritos'
const API = import.meta.env.VITE_API_URL ?? ''

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

async function putFavoritos(token: string, list: string[]) {
  await fetch(`${API}/api/auth/profile`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ favoritos: list }),
  })
}

export function useFavoritos() {
  const { token, isAuthenticated } = useAuth()
  const [favoritos, setFavoritos] = useState<string[]>(read)

  useEffect(() => {
    const sub = () => setFavoritos(read())
    subs.add(sub)
    return () => {
      subs.delete(sub)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setFavoritos(read())
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${API}/api/auth/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('profile')
        const j = (await res.json()) as { favoritos?: unknown }
        const server = parseStored(JSON.stringify(j.favoritos ?? []))
        const local = read()
        const merged = [...new Set([...server, ...local])]
        if (cancelled) return
        write(merged)
        setFavoritos(merged)
        if (
          merged.length !== server.length ||
          (server.length === 0 && local.length > 0)
        ) {
          await putFavoritos(token, merged)
        }
      } catch {
        if (!cancelled) setFavoritos(read())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, token])

  const toggleFavorito = useCallback(
    (ticker: string) => {
      const u = ticker.trim().toUpperCase()
      if (!u) return
      const cur = read()
      const next = cur.includes(u) ? cur.filter((x) => x !== u) : [...cur, u]
      write(next)
      notify()
      setFavoritos(next)
      const t = token
      if (t) {
        void putFavoritos(t, next)
      }
    },
    [token],
  )

  const esFavorito = useCallback(
    (ticker: string) => favoritos.includes(ticker.trim().toUpperCase()),
    [favoritos],
  )

  return { favoritos, toggleFavorito, esFavorito }
}
