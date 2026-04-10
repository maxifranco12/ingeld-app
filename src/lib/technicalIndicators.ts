import type { UTCTimestamp } from 'lightweight-charts'

export type OhlcBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null)
  if (period <= 0 || values.length < period) return out
  for (let i = period - 1; i < values.length; i++) {
    let s = 0
    for (let j = 0; j < period; j++) s += values[i - j]
    out[i] = s / period
  }
  return out
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null)
  if (period <= 0 || values.length === 0) return out
  const k = 2 / (period + 1)
  let prev: number | null = null
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue
    if (i === period - 1) {
      let s = 0
      for (let j = 0; j < period; j++) s += values[i - j]
      prev = s / period
      out[i] = prev
      continue
    }
    prev = (values[i] - (prev as number)) * k + (prev as number)
    out[i] = prev
  }
  return out
}

export function bollinger(
  closes: number[],
  period: number,
  mult: number,
): { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(closes, period)
  const upper = closes.map(() => null as number | null)
  const lower = closes.map(() => null as number | null)
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i]
    if (m == null) continue
    let v = 0
    for (let j = 0; j < period; j++) {
      const d = closes[i - j] - m
      v += d * d
    }
    const sd = Math.sqrt(v / period)
    upper[i] = m + mult * sd
    lower[i] = m - mult * sd
  }
  return { upper, mid, lower }
}

export function rsi(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null)
  if (closes.length < period + 1) return out
  const changes: number[] = []
  for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1])
  let avgG = 0
  let avgL = 0
  for (let i = 0; i < period; i++) {
    const ch = changes[i]
    if (ch > 0) avgG += ch
    else avgL -= ch
  }
  avgG /= period
  avgL /= period
  const idx = period
  const rs0 = avgL === 0 ? 100 : avgG / avgL
  out[idx] = 100 - 100 / (1 + rs0)
  for (let i = period; i < changes.length; i++) {
    const ch = changes[i]
    const g = ch > 0 ? ch : 0
    const l = ch < 0 ? -ch : 0
    avgG = (avgG * (period - 1) + g) / period
    avgL = (avgL * (period - 1) + l) / period
    const rs = avgL === 0 ? 100 : avgG / avgL
    out[i + 1] = 100 - 100 / (1 + rs)
  }
  return out
}

export function macdSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): {
  line: (number | null)[]
  signal: (number | null)[]
  hist: (number | null)[]
} {
  const ef = ema(closes, fast)
  const es = ema(closes, slow)
  const line: (number | null)[] = closes.map(() => null)
  for (let i = 0; i < closes.length; i++) {
    if (ef[i] != null && es[i] != null) line[i] = (ef[i] as number) - (es[i] as number)
  }
  const macdVals: number[] = []
  const idxMap: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (line[i] != null) {
      macdVals.push(line[i] as number)
      idxMap.push(i)
    }
  }
  const sigOn = ema(macdVals, signalPeriod)
  const signal: (number | null)[] = closes.map(() => null)
  for (let k = 0; k < idxMap.length; k++) {
    signal[idxMap[k]] = sigOn[k]
  }
  const hist: (number | null)[] = closes.map(() => null)
  for (let i = 0; i < closes.length; i++) {
    if (line[i] != null && signal[i] != null) hist[i] = (line[i] as number) - (signal[i] as number)
  }
  return { line, signal, hist }
}

export function toLineData(
  times: UTCTimestamp[],
  values: (number | null)[],
): { time: UTCTimestamp; value: number }[] {
  const out: { time: UTCTimestamp; value: number }[] = []
  for (let i = 0; i < times.length; i++) {
    const v = values[i]
    if (v != null && Number.isFinite(v)) out.push({ time: times[i], value: v })
  }
  return out
}

export function computeIndicatorData(bars: OhlcBar[]) {
  const closes = bars.map((b) => b.close)
  const times = bars.map((b) => b.time as UTCTimestamp)
  const ma20 = sma(closes, 20)
  const ma50 = sma(closes, 50)
  const ma200 = sma(closes, 200)
  const bb = bollinger(closes, 20, 2)
  const rsi14 = rsi(closes, 14)
  const macd = macdSeries(closes, 12, 26, 9)
  return {
    times,
    ma20: toLineData(times, ma20),
    ma50: toLineData(times, ma50),
    ma200: toLineData(times, ma200),
    bbUpper: toLineData(times, bb.upper),
    bbMid: toLineData(times, bb.mid),
    bbLower: toLineData(times, bb.lower),
    rsi: toLineData(times, rsi14),
    macdLine: toLineData(times, macd.line),
    macdSignal: toLineData(times, macd.signal),
    macdHist: times
      .map((t, i) => {
        const v = macd.hist[i]
        if (v == null || !Number.isFinite(v)) return null
        return {
          time: t,
          value: v,
          color: v >= 0 ? 'rgba(10, 124, 82, 0.65)' : 'rgba(192, 41, 62, 0.65)',
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null),
  }
}
