import { REPORT_SECTIONS, REPORT_SECTION_LABELS } from '@sentinel/shared'
import type { ReportSection } from '@sentinel/shared'
import { Markdown } from '../../../lib/markdown'

/**
 * The written account of an incident, set as a document (Prose styles, `prose-max`). Sections
 * without text are left out.
 */
export function IncidentReport({ sections }: { sections: Partial<Record<ReportSection, string>> }) {
  const filled = REPORT_SECTIONS.filter((s) => (sections[s] ?? '').trim() !== '')
  return (
    <article className="sn-prose">
      {filled.map((s) => (
        <div key={s}>
          <h3>{REPORT_SECTION_LABELS[s]}</h3>
          <Markdown text={sections[s]!} />
        </div>
      ))}
    </article>
  )
}
