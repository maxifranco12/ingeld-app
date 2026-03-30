import { jsPDF } from 'jspdf'

export type PdfChatMessage = { role: 'user' | 'assistant'; content: string }

const MARGIN_MM = 20
const FOOTER_BLOCK_MM = 18
const BODY_LINE_MM = 5
const BODY_FONT_SIZE = 10

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
