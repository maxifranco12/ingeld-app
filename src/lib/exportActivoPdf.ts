import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import type { RefObject } from 'react'

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
  precio_entrada_sugerido?: number | null
  precio_objetivo?: number | null
  stop_loss_sugerido?: number | null
  fortalezas: string[]
  riesgos: string[]
  catalizadores?: string[]
  resumen: string
  modelos_valuacion?: {
    dcf?: { valor_intrinseco?: number | null } | null
    relative_multiples?: {
      valor_modelo_pe?: number | null
      valor_modelo_pb?: number | null
      valor_modelo_ps?: number | null
    } | null
  } | null
}

type FinancialsData = {
  años: number[]
  income: {
    revenue: Array<number | null>
    operating_income: Array<number | null>
    net_income: Array<number | null>
  }
  cashflow: {
    operating_cashflow: Array<number | null>
    free_cashflow: Array<number | null>
    net_income: Array<number | null>
  }
}

type NewsItem = {
  titulo: string
  fecha: string
  fuente?: string
  impacto?: string
  analisis?: string
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
  financialsData?: FinancialsData | null
  newsData?: { noticias: NewsItem[] } | null
  chartRefs?: {
    income: RefObject<HTMLDivElement | null> | null
    cashflow: RefObject<HTMLDivElement | null> | null
    valuation: RefObject<HTMLDivElement | null> | null
  }
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

function fmtBig(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return fmtNum(n, 0)
}

function upsidePct(target: number | null | undefined, price: number): number | null {
  if (target == null || !Number.isFinite(target) || !Number.isFinite(price) || price <= 0)
    return null
  return ((target - price) / price) * 100
}

function valSemaforo(target: number | null | undefined, price: number): 'BARATA' | 'JUSTA' | 'CARA' {
  if (target == null || !Number.isFinite(target) || !Number.isFinite(price) || price <= 0) {
    return 'JUSTA'
  }
  if (target > price * 1.3) return 'BARATA'
  if (target < price * 0.9) return 'CARA'
  return 'JUSTA'
}

export async function exportActivoPdf(data: ExportActivoPdfInput) {
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
    if (y > pageH - MARGIN_MM) {
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
  const subtitle = (text: string) => {
    ensure(LINE_MM + 1)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(68, 68, 68)
    doc.text(text, MARGIN_MM, y)
    y += LINE_MM
    doc.setFont('courier', 'normal')
    doc.setTextColor(26, 28, 32)
  }
  const captureChartImage = async (
    refObj: RefObject<HTMLDivElement | null> | null | undefined,
  ): Promise<{ img: string; widthPx: number; heightPx: number } | null> => {
    try {
      if (!refObj?.current) return null
      const canvas = await html2canvas(refObj.current, {
        scale: 1.5,
        backgroundColor: '#ffffff',
      })
      return {
        img: canvas.toDataURL('image/png'),
        widthPx: canvas.width,
        heightPx: canvas.height,
      }
    } catch {
      return null
    }
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

  if (data.financialsData?.años?.length) {
    const incomeImg = await captureChartImage(data.chartRefs?.income)
    const cashImg = await captureChartImage(data.chartRefs?.cashflow)
    const valImg = await captureChartImage(data.chartRefs?.valuation)
    if (incomeImg && cashImg && valImg) {
      const wSmall = 80
      const wWide = 170
      const hIncome = (incomeImg.heightPx * wSmall) / incomeImg.widthPx
      const hCash = (cashImg.heightPx * wSmall) / cashImg.widthPx
      const hVal = (valImg.heightPx * wWide) / valImg.widthPx
      const topRowH = Math.max(hIncome, hCash)
      const neededChartsH = topRowH + 6 + hVal + 4
      if (y + 12 + neededChartsH > bottomY) {
        doc.addPage()
        y = MARGIN_MM
      }
      section('Tendencias Financieras')
      const rowY = y
      doc.addImage(incomeImg.img, 'PNG', 15, rowY, wSmall, hIncome)
      doc.addImage(cashImg.img, 'PNG', 110, rowY, wSmall, hCash)
      y = rowY + topRowH + 6
      doc.addImage(valImg.img, 'PNG', 15, y, wWide, hVal)
      y += hVal + 4
    } else {
      section('Tendencias Financieras')
      const years = data.financialsData.años
      const row = (label: string, vals: Array<number | null | undefined>) => {
        const cells = vals.map((v) => fmtBig(v)).join(' | ')
        line(`${label}: ${cells}`)
      }
      subtitle(`Income Statement (${years.join(' | ')})`)
      row('Revenue', data.financialsData.income.revenue)
      row('Operating Income', data.financialsData.income.operating_income)
      row('Net Income', data.financialsData.income.net_income)
      y += 1
      subtitle(`Cash Flow (${years.join(' | ')})`)
      row('Operating CF', data.financialsData.cashflow.operating_cashflow)
      row('FCF', data.financialsData.cashflow.free_cashflow)
      y += 2
    }
  }

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
    line(`Señal: ${data.fundamentalIa.señal || '—'}`)
    line(`Valuación: ${data.fundamentalIa.valuacion}`)
    line(
      `Confianza: ${data.fundamentalIa.confianza} · Score salud: ${data.fundamentalIa.score_salud}/10`,
    )
    line(
      `Scores: Técnico ${fmtNum(data.fundamentalIa.score_tecnico, 0)}/10 · Fundamental ${fmtNum(data.fundamentalIa.score_fundamental, 0)}/10 · Noticias ${fmtNum(data.fundamentalIa.score_noticias, 0)}/10 · Total ${fmtNum(data.fundamentalIa.score_total, 0)}/10`,
    )
    line(
      `Niveles: Entrada ${fmtNum(data.fundamentalIa.precio_entrada_sugerido, 4)} · Objetivo ${fmtNum(data.fundamentalIa.precio_objetivo, 4)} · Stop ${fmtNum(data.fundamentalIa.stop_loss_sugerido, 4)}`,
    )
    line(`Horizonte: ${data.fundamentalIa.horizonte || '—'}`)
    if (data.fundamentalIa.accion_concreta) {
      y += 1
      subtitle('Acción concreta')
      paragraph(markdownToPlainText(data.fundamentalIa.accion_concreta))
    }
    const mv = data.fundamentalIa.modelos_valuacion
    if (mv) {
      y += 1
      section('Modelos de Valuación')
      const precio = data.price
      const dcfVal = mv.dcf?.valor_intrinseco ?? null
      const peVal = mv.relative_multiples?.valor_modelo_pe ?? null
      const pbVal = mv.relative_multiples?.valor_modelo_pb ?? null
      const psVal = mv.relative_multiples?.valor_modelo_ps ?? null
      const modelRow = (name: string, val: number | null | undefined) => {
        line(
          `${name}: ${fmtNum(val, 4)} vs ${fmtNum(precio, 4)} · Upside ${fmtPct(upsidePct(val, precio), 2)} · ${valSemaforo(val, precio)}`,
        )
      }
      modelRow('DCF Terminal', dcfVal)
      modelRow('Mean P/E', peVal)
      modelRow('Mean P/B', pbVal)
      modelRow('Mean P/S', psVal)
    }
    y += 1
    subtitle('Fortalezas')
    for (const x of data.fundamentalIa.fortalezas || []) line(`• ${x}`)
    y += 1
    subtitle('Riesgos')
    for (const x of data.fundamentalIa.riesgos || []) line(`• ${x}`)
    y += 1
    if (data.fundamentalIa.catalizadores?.length) {
      subtitle('Catalizadores')
      for (const x of data.fundamentalIa.catalizadores) line(`• ${x}`)
      y += 1
    }
    subtitle('Resumen')
    paragraph(markdownToPlainText(data.fundamentalIa.resumen || ''))
  }

  if (data.newsData?.noticias?.length) {
    ensure(12)
    doc.addPage()
    y = MARGIN_MM
    section('Noticias recientes')
    for (const n of data.newsData.noticias) {
      subtitle(n.titulo || 'Sin título')
      const meta = `${n.fuente || 'Fuente N/D'} · ${n.fecha || 'Fecha N/D'} · Impacto: ${(n.impacto || 'NEUTRO').toUpperCase()}`
      line(meta)
      if (n.analisis) {
        const oneLine = markdownToPlainText(n.analisis).split('\n')[0]
        paragraph(`IA: ${oneLine}`)
      }
      y += 1
    }
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
