import type { Metadata } from 'next'
import { PageHeader } from '../../../_components/ui'
import { TokenGenerator } from './token-generator'

export const metadata: Metadata = { title: 'API tokens' }

export default function TokensPage() {
  return (
    <>
      <PageHeader title="API tokens" meta={<span>A token lets an agent or script manage this instance through the MCP server or the REST API.</span>} />
      <section className="sn-narrow sn-stack">
        <div className="sn-prose">
          <p>
            Sentinel is built to be operated by agents. Connect Claude Code or any MCP client and it can create tests, route alerts, run bulk actions, add notes to
            incidents and draft reports. Publishing stays with you: a token cannot publish an incident, a public note or a report.
          </p>
        </div>
        <TokenGenerator />
      </section>
    </>
  )
}
