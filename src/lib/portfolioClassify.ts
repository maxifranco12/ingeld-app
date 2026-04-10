/** Clasificación de tickers para insights de cartera (estilo Wealthfolio). */

const BONO_PREFIXES = ['AL30', 'GD30', 'AL29', 'GD29', 'AE38', 'GD38', 'AL35', 'GD35']

const ETF_SET = new Set([
  'SPY',
  'QQQ',
  'QQQM',
  'IWM',
  'IVV',
  'VOO',
  'DIA',
  'XLF',
  'XLK',
  'XLE',
  'XLV',
  'XLI',
  'XLP',
  'XLY',
  'XLRE',
  'XLU',
  'XLB',
  'XLRE',
  'ARKK',
  'TLT',
  'HYG',
  'LQD',
  'VTI',
  'SCHD',
  'VYM',
  'IEFA',
  'VWO',
  'VEA',
  'EEM',
  'EWZ',
  'GLD',
  'SLV',
  'SMH',
  'SOXX',
])

const GLOBAL_TICKERS = new Set(['EWZ', 'EEM', 'VWO', 'VEA', 'IEFA', 'FXI', 'EWJ'])

export type AssetBucket =
  | 'Acciones AR'
  | 'Acciones USA'
  | 'Crypto'
  | 'ETFs'
  | 'Bonos'

export type GeoBucket = 'Argentina' | 'USA' | 'Global' | 'Otro'

function stripBa(t: string): string {
  return t.toUpperCase().replace(/\.BA$/i, '')
}

export function isBonoTicker(ticker: string): boolean {
  const base = stripBa(ticker)
  return BONO_PREFIXES.some((p) => base === p || base.startsWith(p))
}

export function isCryptoTicker(ticker: string): boolean {
  const u = ticker.toUpperCase()
  if (u.endsWith('.BA')) return false
  return /^(BTC|ETH|SOL|ADA|XRP|DOT|AVAX|MATIC|LINK|DOGE|SHIB|LTC|BNB|UNI|ATOM|NEAR|APT|ARB|OP|SEI|CRO|TRX)-USD$/.test(
    u,
  )
}

export function isEtfTicker(ticker: string): boolean {
  return ETF_SET.has(stripBa(ticker))
}

export function classifyAssetType(ticker: string): AssetBucket {
  const t = ticker.trim()
  if (isBonoTicker(t)) return 'Bonos'
  if (t.toUpperCase().endsWith('.BA')) return 'Acciones AR'
  if (isCryptoTicker(t)) return 'Crypto'
  if (isEtfTicker(t)) return 'ETFs'
  return 'Acciones USA'
}

export function classifyGeo(ticker: string): GeoBucket {
  const u = ticker.trim().toUpperCase()
  if (u.endsWith('.BA')) return 'Argentina'
  if (isCryptoTicker(ticker)) return 'Global'
  if (GLOBAL_TICKERS.has(stripBa(u))) return 'Global'
  return 'USA'
}

export const ASSET_COLORS: Record<AssetBucket, string> = {
  'Acciones AR': '#00a87a',
  'Acciones USA': '#3b82f6',
  Crypto: '#f59e0b',
  ETFs: '#8b5cf6',
  Bonos: '#ef4444',
}
