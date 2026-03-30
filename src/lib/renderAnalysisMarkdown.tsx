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

export function AnalysisMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let key = 0
  const nextKey = () => key++

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const t = raw.trimEnd()

    if (/^---+$/u.test(t.trim())) {
      blocks.push(<hr key={nextKey()} className="portfolio-ai-hr" />)
      continue
    }

    if (t.startsWith('### ')) {
      blocks.push(
        <h3 key={nextKey()} className="portfolio-ai-h3">
          {parseInline(t.slice(4))}
        </h3>,
      )
      continue
    }

    if (t.startsWith('## ')) {
      blocks.push(
        <h2 key={nextKey()} className="portfolio-ai-h2">
          {parseInline(t.slice(3))}
        </h2>,
      )
      continue
    }

    if (t.startsWith('# ')) {
      blocks.push(
        <h2 key={nextKey()} className="portfolio-ai-h2">
          {parseInline(t.slice(2))}
        </h2>,
      )
      continue
    }

    const listMatch = t.match(/^\s*-\s+(.*)$/)
    if (listMatch) {
      blocks.push(
        <div key={nextKey()} className="portfolio-ai-li">
          <span className="portfolio-ai-bullet" aria-hidden>
            ·
          </span>
          <span className="portfolio-ai-li-text">{parseInline(listMatch[1])}</span>
        </div>,
      )
      continue
    }

    if (t.trim() === '') {
      blocks.push(<div key={nextKey()} className="portfolio-ai-spacer" />)
      continue
    }

    blocks.push(
      <p key={nextKey()} className="portfolio-ai-p">
        {parseInline(t)}
      </p>,
    )
  }

  return <div className="portfolio-ai-md">{blocks}</div>
}
