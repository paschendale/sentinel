import type { ReactNode } from 'react'

/**
 * A small, safe Markdown subset for incident reports and notes: paragraphs, bullet and
 * numbered lists, links and inline code. Built as React elements, never as HTML, so text
 * cannot inject markup. Links are kept only for http(s), mailto and relative URLs.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    para = []
  }
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    }
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      flushPara()
      const ordered = !!numbered
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? numbered)![1]!)
    } else if (line.trim() === '') {
      flushPara()
      flushList()
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()
  return <>{blocks}</>
}

function safeHref(url: string): string | null {
  const u = url.trim()
  if (/^(https?:|mailto:)/i.test(u) || u.startsWith('/') || u.startsWith('#')) return u
  return null
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      out.push(<code key={out.length}>{m[1]}</code>)
    } else {
      const href = safeHref(m[3]!)
      out.push(
        href ? (
          <a key={out.length} href={href} rel="noopener noreferrer nofollow">
            {m[2]}
          </a>
        ) : (
          m[0]
        ),
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
