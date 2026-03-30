import * as XLSX from 'xlsx'

export type ExcelRow = {
  ticker: string
  nombre: string
  cantidad: number
  precioCompra: number
  precioActual: string
  pl: string
  plPct: string
  valorTotal: string
  moneda: string
}

export type ExcelSummary = {
  totalInvertidoARS: string
  totalInvertidoUSD: string
  valorActualARS: string
  valorActualUSD: string
  plARS: string
  plUSD: string
  mejorPosicion: string
  peorPosicion: string
}

export function exportPortfolioExcel(opts: {
  rows: ExcelRow[]
  summary: ExcelSummary
  fileDateSlug: string
}) {
  const wb = XLSX.utils.book_new()

  const posHeader = [
    'Ticker',
    'Nombre',
    'Cantidad',
    'P. Compra',
    'P. Actual',
    'P&L $',
    'P&L %',
    'Valor total',
    'Moneda',
  ]
  const posAoA = [
    posHeader,
    ...opts.rows.map((r) => [
      r.ticker,
      r.nombre,
      r.cantidad,
      r.precioCompra,
      r.precioActual,
      r.pl,
      r.plPct,
      r.valorTotal,
      r.moneda,
    ]),
  ]
  const wsPos = XLSX.utils.aoa_to_sheet(posAoA)
  XLSX.utils.book_append_sheet(wb, wsPos, 'Posiciones')

  const resAoA = [
    ['Concepto', 'Valor'],
    ['Total invertido (ARS)', opts.summary.totalInvertidoARS],
    ['Total invertido (USD)', opts.summary.totalInvertidoUSD],
    ['Valor actual (ARS)', opts.summary.valorActualARS],
    ['Valor actual (USD)', opts.summary.valorActualUSD],
    ['P&L total (ARS)', opts.summary.plARS],
    ['P&L total (USD)', opts.summary.plUSD],
    ['Mejor posición', opts.summary.mejorPosicion],
    ['Peor posición', opts.summary.peorPosicion],
  ]
  const wsRes = XLSX.utils.aoa_to_sheet(resAoA)
  XLSX.utils.book_append_sheet(wb, wsRes, 'Resumen')

  const name = `INGELD-portfolio-${opts.fileDateSlug}.xlsx`
  XLSX.writeFile(wb, name)
}
