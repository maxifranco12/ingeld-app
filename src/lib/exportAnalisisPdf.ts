import { jsPDF } from 'jspdf'

import { markdownToPlainText } from './markdownPlain'

const MARGIN_MM = 20
const FOOTER_BLOCK_MM = 18
const BODY_LINE_MM = 5
const BODY_FONT_SIZE = 10

export type PdfChatMessage = { role: 'user' | 'assistant'; content: string }

export type PortfolioPdfRow = {
  sym: string
  cantidad: number
  precioCompra: number
  precioActual: number | null
  pl: number | null
  plPct: number | null
  moneda: string
  hasQuote: boolean
}

export type PortfolioPdfSummary = {
  invARS: number
  invUSD: number
  curARS: number
  curUSD: number
  plARS: number
  plUSD: number
}

function drawPortfolioFooter(doc: jsPDF, pageH: number) {
  const n = doc.getNumberOfPages()
  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  doc.setFont('helvetica', 'normal')
  const line =
    'INGELD Financial Assistant · No constituye asesoramiento financiero'
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.text(line, MARGIN_MM, pageH - 10)
  }
}

export function exportPortfolioPdf(opts: {
  rows: PortfolioPdfRow[]
  summary: PortfolioPdfSummary
  aiMarkdown: string
}) {
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
  const dateSlug = now.toISOString().slice(0, 10)

  let y = MARGIN_MM

  doc.setFont('courier', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(0, 168, 122)
  doc.text('INGELD', MARGIN_MM, y)
  y += 9

  doc.setTextColor(26, 28, 32)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('Análisis de Cartera', MARGIN_MM, y)
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(80, 80, 80)
  doc.text(fechaLarga, MARGIN_MM, y)
  y += 8

  doc.setDrawColor(190, 190, 190)
  doc.line(MARGIN_MM, y, pageW - MARGIN_MM, y)
  y += 10

  doc.setTextColor(26, 28, 32)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Posiciones', MARGIN_MM, y)
  y += 7

  const col = {
    t: MARGIN_MM,
    q: MARGIN_MM + 22,
    pc: MARGIN_MM + 34,
    pa: MARGIN_MM + 58,
    pl: MARGIN_MM + 82,
    pp: MARGIN_MM + 112,
  }
  const fs = 8
  doc.setFontSize(fs)
  doc.text('Ticker', col.t, y)
  doc.text('Cant.', col.q, y)
  doc.text('P. compra', col.pc, y)
  doc.text('P. actual', col.pa, y)
  doc.text('P&L $', col.pl, y)
  doc.text('P&L %', col.pp, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setDrawColor(210, 210, 210)
  doc.line(MARGIN_MM, y, pageW - MARGIN_MM, y)
  y += 5

  const rowH = 5
  for (const r of opts.rows) {
    if (y + rowH > bottomY) {
      doc.addPage()
      y = MARGIN_MM
    }
    const pc = `${r.precioCompra.toLocaleString('es-AR', {
      maximumFractionDigits: 4,
    })} ${r.moneda}`
    const pa = r.hasQuote && r.precioActual !== null
      ? r.precioActual.toLocaleString('es-AR', { maximumFractionDigits: 4 })
      : '—'
    const plStr =
      r.hasQuote && r.pl !== null
        ? `${r.pl >= 0 ? '+' : ''}${r.pl.toLocaleString('es-AR', {
            maximumFractionDigits: 2,
          })} ${r.moneda}`
        : '—'
    const ppStr =
      r.hasQuote && r.plPct !== null
        ? `${r.plPct >= 0 ? '+' : ''}${r.plPct.toFixed(2)}%`
        : '—'

    doc.text(r.sym, col.t, y)
    doc.text(String(r.cantidad), col.q, y)
    doc.text(pc, col.pc, y)
    doc.text(pa, col.pa, y)
    doc.text(plStr, col.pl, y)
    doc.text(ppStr, col.pp, y)
    y += rowH
  }

  y += 6
  if (y + 40 > bottomY) {
    doc.addPage()
    y = MARGIN_MM
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Resumen', MARGIN_MM, y)
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)

  const s = opts.summary
  const linesSum: string[] = []
  if (s.invARS > 0) {
    linesSum.push(
      `Total invertido (ARS): ${s.invARS.toLocaleString('es-AR', {
        maximumFractionDigits: 0,
      })}`,
    )
    linesSum.push(
      `Valor actual (ARS): ${s.curARS.toLocaleString('es-AR', {
        maximumFractionDigits: 0,
      })}`,
    )
    linesSum.push(
      `P&L (ARS): ${s.plARS >= 0 ? '+' : ''}${s.plARS.toLocaleString('es-AR', {
        maximumFractionDigits: 0,
      })}`,
    )
  }
  if (s.invUSD > 0) {
    linesSum.push(
      `Total invertido (USD): ${s.invUSD.toLocaleString('es-AR', {
        maximumFractionDigits: 2,
      })}`,
    )
    linesSum.push(
      `Valor actual (USD): ${s.curUSD.toLocaleString('es-AR', {
        maximumFractionDigits: 2,
      })}`,
    )
    linesSum.push(
      `P&L (USD): ${s.plUSD >= 0 ? '+' : ''}${s.plUSD.toLocaleString('es-AR', {
        maximumFractionDigits: 2,
      })}`,
    )
  }
  for (const line of linesSum) {
    if (y + BODY_LINE_MM > bottomY) {
      doc.addPage()
      y = MARGIN_MM
    }
    doc.text(line, MARGIN_MM, y)
    y += BODY_LINE_MM
  }

  y += 6
  if (y + 20 > bottomY) {
    doc.addPage()
    y = MARGIN_MM
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Análisis IA', MARGIN_MM, y)
  y += 8

  const plain = markdownToPlainText(opts.aiMarkdown)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(BODY_FONT_SIZE)
  const bodyLines = doc.splitTextToSize(plain, contentW)
  for (const line of bodyLines) {
    if (y + BODY_LINE_MM > bottomY) {
      doc.addPage()
      y = MARGIN_MM
    }
    doc.text(line, MARGIN_MM, y)
    y += BODY_LINE_MM
  }

  drawPortfolioFooter(doc, pageH)
  doc.save(`INGELD-portfolio-${dateSlug}.pdf`)
}

function drawFooters(
  doc: jsPDF,
  pageH: number,
  footerLine1: string,
  footerLine2: string,
) {
  const n = doc.getNumberOfPages()
  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  doc.setFont('helvetica', 'normal')
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.text(footerLine1, MARGIN_MM, pageH - 12)
    doc.text(footerLine2, MARGIN_MM, pageH - 8)
  }
}

export function exportAnalisisPdf(ticker: string, messages: PdfChatMessage[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - 2 * MARGIN_MM
  const bottomY = pageH - MARGIN_MM - FOOTER_BLOCK_MM

  const now = new Date()
  const fechaGen = now.toLocaleString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  let y = MARGIN_MM

  doc.setFont('courier', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(0, 168, 122)
  doc.text('INGELD', MARGIN_MM, y)
  y += 8

  doc.setFont('courier', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(130, 130, 130)
  doc.text('Financial Assistant', MARGIN_MM, y)
  y += 5

  doc.setDrawColor(190, 190, 190)
  doc.line(MARGIN_MM, y, pageW - MARGIN_MM, y)
  y += 10

  doc.setTextColor(26, 28, 32)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`Análisis técnico — ${ticker}`, MARGIN_MM, y)
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Fecha y hora de generación: ${fechaGen}`, MARGIN_MM, y)
  y += 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Conversación:', MARGIN_MM, y)
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(BODY_FONT_SIZE)

  for (const m of messages) {
    const prefix = m.role === 'user' ? 'Vos:' : 'INGELD IA:'
    const block = `${prefix} ${m.content}`
    const lines = doc.splitTextToSize(block, contentW)

    for (const line of lines) {
      if (y + BODY_LINE_MM > bottomY) {
        doc.addPage()
        y = MARGIN_MM
      }
      doc.text(line, MARGIN_MM, y)
      y += BODY_LINE_MM
    }
    y += 4
  }

  const footer1 = `INGELD Financial Assistant · Generado el ${fechaGen}`
  const footer2 =
    'Este análisis es informativo y no constituye asesoramiento financiero.'
  drawFooters(doc, pageH, footer1, footer2)

  const safeTicker = ticker.replace(/[^\w.-]/g, '_').replace(/\./g, '-')
  const dateSlug = now.toISOString().slice(0, 10)
  doc.save(`INGELD-analisis-${safeTicker}-${dateSlug}.pdf`)
}
