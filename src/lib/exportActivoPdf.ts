import { jsPDF } from 'jspdf'

import { markdownToPlainText } from './markdownPlain'

const MARGIN_MM = 20
const FOOTER_BLOCK_MM = 18
const LINE_MM = 5

type FundamentalIa = {
  valuacion: string
  confianza: string
  score_salud: number
  score_tecnico?: number
  score_fundamental?: number
  score_noticias?: number
  score_total?: number
  señal?: string
  accion_concreta?: string
  horizonte?: string
  fortalezas: string[]
  riesgos: string[]
  catalizadores?: string[]
  resumen: string
}

type ExportActivoPdfInput = {
  symbol: string
  companyName: string
  exchange: string
  currency: string
  price: number
  changePct: number
  volume: number
  rsi14: number | null
  macd: { linea: number; senal: number; histograma: number; direccion: string }
  bollinger: { superior: number; media: number; inferior: number; precio_vs_bandas: string }
  ma20: number | null
  ma50: number | null
  precioVsMa20: string
  precioVsMa50: string | null
  fundamentals?: {
    pe_ratio?: number | null
    pb_ratio?: number | null
    eps?: number | null
    market_cap?: number | null
    revenue?: number | null
    revenue_growth?: number | null
    profit_margin?: number | null
    roe?: number | null
    debt_to_equity?: number | null
    target_price?: number | null
    analyst_recommendation?: string | null
    sector?: string | null
    industry?: string | null
    description?: string | null
  } | null
  fundamentalIa?: FundamentalIa | null
}

function fmtNum(n: number | null | undefined, max = 4): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('es-AR', { maximumFractionDigits: max })
}

function fmtPct(n: number | null | undefined, max = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(max)}%`
}

function fmtCap(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)} B`
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} mil M`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)} M`
  return fmtNum(n, 0)
}

export function exportActivoPdf(data: ExportActivoPdfInput) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - 2 * MARGIN_MM
  const bottomY = pageH - MARGIN_MM - FOOTER_BLOCK_MM
  const now = new Date()
  const fechaLarga = now.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const fechaFull = now.toLocaleString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const safeTicker = data.symbol.replace(/[^\w.-]/g, '_').replace(/\./g, '-')
  const dateSlug = now.toISOString().slice(0, 10)
  let y = MARGIN_MM

  const ensure = (needed: number) => {
    if (y + needed > bottomY) {
      doc.addPage()
      y = MARGIN_MM
    }
  }
  const section = (title: string) => {
    ensure(12)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(0, 168, 122)
    doc.text(title, MARGIN_MM, y)
    y += 4.8
    doc.setDrawColor(205, 205, 205)
    doc.line(MARGIN_MM, y, pageW - MARGIN_MM, y)
    y += 6
    doc.setTextColor(26, 28, 32)
    doc.setFont('courier', 'normal')
    doc.setFontSize(10)
  }
  const line = (text: string) => {
    ensure(LINE_MM)
    doc.text(text, MARGIN_MM, y)
    y += LINE_MM
  }
  const paragraph = (text: string) => {
    const lines = doc.splitTextToSize(text, contentW)
    for (const ln of lines) line(String(ln))
  }

  doc.setFont('courier', 'bold')
  doc.setTextColor(0, 168, 122)
  doc.setFontSize(24)
  doc.text('INGELD', MARGIN_MM, y)
  y += 8
  doc.setFont('courier', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.setFontSize(10)
  doc.text('Financial Assistant', MARGIN_MM, y)
  y += 5
  doc.setDrawColor(190, 190, 190)
  doc.line(MARGIN_MM, y, pageW - MARGIN_MM, y)
  y += 9

  doc.setTextColor(26, 28, 32)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  const ttl = `${data.symbol} — ${data.companyName || data.symbol}`
  paragraph(ttl)
  y += 1
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  line(`Fecha de generación: ${fechaFull}`)
  y += 1
  doc.setFont('courier', 'bold')
  doc.setFontSize(11)
  line(`Precio actual: ${fmtNum(data.price, 6)} ${data.currency}`)
  line(`Variación %: ${fmtPct(data.changePct, 2)}`)
  line(`Volumen: ${fmtNum(data.volume, 0)}`)
  line(`Exchange/Moneda: ${data.exchange || '—'} · ${data.currency || '—'}`)
  y += 2

  section('Análisis Técnico')
  const rsiTxt =
    data.rsi14 == null
      ? 'N/D'
      : data.rsi14 < 30
        ? `${data.rsi14.toFixed(1)} (sobrevendido)`
        : data.rsi14 > 70
          ? `${data.rsi14.toFixed(1)} (sobrecomprado)`
          : `${data.rsi14.toFixed(1)} (neutro)`
  line(`RSI (14): ${rsiTxt}`)
  line(
    `MACD: línea ${fmtNum(data.macd.linea, 4)} · señal ${fmtNum(data.macd.senal, 4)} · histograma ${fmtNum(data.macd.histograma, 4)} · dirección ${data.macd.direccion}`,
  )
  line(
    `Bollinger: sup ${fmtNum(data.bollinger.superior, 4)} · media ${fmtNum(data.bollinger.media, 4)} · inf ${fmtNum(data.bollinger.inferior, 4)} · precio ${data.bollinger.precio_vs_bandas.replace(/_/g, ' ')}`,
  )
  line(
    `MA20: ${fmtNum(data.ma20, 4)} (${data.precioVsMa20}) · MA50: ${fmtNum(data.ma50, 4)}${data.precioVsMa50 ? ` (${data.precioVsMa50})` : ''}`,
  )
  y += 3

  const f = data.fundamentals
  if (f) {
    section('Análisis Fundamental')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(70, 70, 70)
    line('Valuación')
    doc.setFont('courier', 'normal')
    doc.setTextColor(26, 28, 32)
    line(`P/E: ${fmtNum(f.pe_ratio, 2)} · P/B: ${fmtNum(f.pb_ratio, 2)} · EPS: ${fmtNum(f.eps, 4)} · Market Cap: ${fmtCap(f.market_cap)}`)
    y += 1
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(70, 70, 70)
    line('Salud financiera')
    doc.setFont('courier', 'normal')
    doc.setTextColor(26, 28, 32)
    line(`Revenue: ${fmtCap(f.revenue)} · Crecimiento: ${f.revenue_growth != null ? fmtPct(f.revenue_growth * 100) : '—'}`)
    line(`Margen: ${f.profit_margin != null ? fmtPct(f.profit_margin * 100) : '—'} · ROE: ${f.roe != null ? fmtPct(f.roe * 100) : '—'} · Deuda/Patrimonio: ${fmtNum(f.debt_to_equity, 2)}`)
    y += 1
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(70, 70, 70)
    line('Precio objetivo')
    doc.setFont('courier', 'normal')
    doc.setTextColor(26, 28, 32)
    const upside =
      f.target_price != null && data.price > 0
        ? ((f.target_price - data.price) / data.price) * 100
        : null
    line(
      `Actual: ${fmtNum(data.price, 4)} · Objetivo analistas: ${fmtNum(f.target_price, 4)} · Potencial: ${upside != null ? fmtPct(upside, 2) : '—'}`,
    )
    line(`Recomendación: ${f.analyst_recommendation || '—'}`)
    y += 1
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(70, 70, 70)
    line('Empresa')
    doc.setFont('courier', 'normal')
    doc.setTextColor(26, 28, 32)
    line(`Sector: ${f.sector || '—'} · Industria: ${f.industry || '—'}`)
    if (f.description) {
      const cleanDesc = markdownToPlainText(f.description)
      paragraph(cleanDesc)
    }
  }

  if (data.fundamentalIa) {
    ensure(18)
    doc.addPage()
    y = MARGIN_MM
    section('Análisis IA Fundamental')
    line(`Valuación: ${data.fundamentalIa.valuacion}`)
    line(`Confianza: ${data.fundamentalIa.confianza} · Score salud: ${data.fundamentalIa.score_salud}/10`)
    y += 1
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(70, 70, 70)
    line('Fortalezas')
    doc.setFont('courier', 'normal')
    doc.setTextColor(26, 28, 32)
    for (const x of data.fundamentalIa.fortalezas || []) line(`• ${x}`)
    y += 1
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(70, 70, 70)
    line('Riesgos')
    doc.setFont('courier', 'normal')
    doc.setTextColor(26, 28, 32)
    for (const x of data.fundamentalIa.riesgos || []) line(`• ${x}`)
    y += 1
    if (data.fundamentalIa.catalizadores?.length) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(70, 70, 70)
      line('Catalizadores')
      doc.setFont('courier', 'normal')
      doc.setTextColor(26, 28, 32)
      for (const x of data.fundamentalIa.catalizadores) line(`• ${x}`)
      y += 1
    }
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(70, 70, 70)
    line('Resumen')
    doc.setFont('courier', 'normal')
    doc.setTextColor(26, 28, 32)
    paragraph(markdownToPlainText(data.fundamentalIa.resumen || ''))
  }

  const footer1 = `INGELD Financial Assistant · ${fechaLarga}`
  const footer2 =
    'Este análisis es informativo y no constituye asesoramiento financiero.'
  const pages = doc.getNumberOfPages()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.text(footer1, MARGIN_MM, pageH - 12)
    doc.text(footer2, MARGIN_MM, pageH - 8)
  }

  doc.save(`INGELD-${safeTicker}-${dateSlug}.pdf`)
}
