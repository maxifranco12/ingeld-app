/** Convierte markdown ligero a texto plano (p. ej. para PDF). */
export function markdownToPlainText(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (/^---+$/u.test(t)) {
      out.push('')
      continue
    }
    let s = line
    if (s.startsWith('### ')) s = s.slice(4)
    else if (s.startsWith('## ')) s = s.slice(3)
    else if (s.startsWith('# ')) s = s.slice(2)
    s = s.replace(/\*\*(.+?)\*\*/g, '$1')
    if (/^\s*-\s/.test(s)) s = s.replace(/^\s*-\s/, '• ')
    out.push(s.trimEnd())
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
