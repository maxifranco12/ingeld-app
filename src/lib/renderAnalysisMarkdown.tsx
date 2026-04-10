import type { ReactNode } from 'react'

function parseInline(s: string): ReactNode {
  const parts = s.split(/(\*\*.+?\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return <span key={i}>{part}</span>
  })
}

const LIST_RE = /^\s*[-*]\s+(.+)$/

export function AnalysisMarkdown({
  source,
  rootClassName = 'portfolio-ai-md',
}: {
  source: string
  rootClassName?: string
}) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let key = 0
  const nextKey = () => key++

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const t = raw.trimEnd()
    const trim = t.trim()

    const listMatch = trim.match(LIST_RE)
    if (listMatch) {
      const items: string[] = []
      let j = i
      while (j < lines.length) {
        const lineRaw = lines[j]
        if (lineRaw.trim() === '') break
        const m = lineRaw.trimEnd().trim().match(LIST_RE)
        if (!m) break
        items.push(m[1])
        j++
      }
      if (items.length) {
        blocks.push(
          <ul key={nextKey()} className="portfolio-ai-ul">
            {items.map((text, idx) => (
              <li key={idx}>{parseInline(text)}</li>
            ))}
          </ul>,
        )
        i = j
        continue
      }
    }

    if (/^---+$/u.test(trim)) {
      blocks.push(<hr key={nextKey()} className="portfolio-ai-hr" />)
      i++
      continue
    }

    if (t.startsWith('### ')) {
      blocks.push(
        <h3 key={nextKey()} className="portfolio-ai-h3">
          {parseInline(t.slice(4))}
        </h3>,
      )
      i++
      continue
    }

    if (t.startsWith('## ')) {
      blocks.push(
        <h2 key={nextKey()} className="portfolio-ai-h2">
          {parseInline(t.slice(3))}
        </h2>,
      )
      i++
      continue
    }

    if (t.startsWith('# ')) {
      blocks.push(
        <h2 key={nextKey()} className="portfolio-ai-h2">
          {parseInline(t.slice(2))}
        </h2>,
      )
      i++
      continue
    }

    if (trim === '') {
      blocks.push(<div key={nextKey()} className="portfolio-ai-spacer" />)
      i++
      continue
    }

    blocks.push(
      <p key={nextKey()} className="portfolio-ai-p">
        {parseInline(t)}
      </p>,
    )
    i++
  }

  return <div className={rootClassName}>{blocks}</div>
}
