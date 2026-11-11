import Link from 'next/link'
import { splitTag } from '../../../lib/format'

function Parts({ tag }: { tag: string }) {
  const { key, value } = splitTag(tag)
  return key ? (
    <>
      <i>{key}</i>
      {value}
    </>
  ) : (
    <>{value}</>
  )
}

/**
 * A free-form label; `key:value` tags show the key in `fg-subtle`. With `href` it is a link
 * (filters the page); `current` marks the selected filter.
 */
export function Tag({ tag, href, current, external }: { tag: string; href?: string; current?: boolean; external?: boolean }) {
  if (href === undefined) {
    return (
      <span className="sn-tag">
        <Parts tag={tag} />
      </span>
    )
  }
  const props = { className: 'sn-tag', 'aria-current': current ? ('true' as const) : undefined }
  return external ? (
    <a href={href} {...props}>
      <Parts tag={tag} />
    </a>
  ) : (
    <Link href={href} scroll={false} {...props}>
      <Parts tag={tag} />
    </Link>
  )
}

/** A row of filter tags with "all" first. */
export function TagFilters({ tags, current, hrefFor, allHref, external }: { tags: string[]; current: string | null; hrefFor: (t: string) => string; allHref: string; external?: boolean }) {
  if (tags.length === 0) return null
  return (
    <div className="sn-tags">
      <Tag tag="all" href={allHref} current={current === null} external={external} />
      {tags.map((t) => (
        <Tag key={t} tag={t} href={hrefFor(t)} current={current === t} external={external} />
      ))}
    </div>
  )
}
