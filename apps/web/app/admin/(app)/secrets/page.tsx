import type { Metadata } from 'next'
import type { Secret, Test } from '@sentinel/shared'
import { apiGet } from '../../../../lib/api-server'
import { ApiErrorCallout, Callout } from '../../../_components/ui'
import { SecretsView } from './secrets-view'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Secrets' }

/** Tests whose code reads ctx.secrets.NAME (or ctx.secrets['NAME']). */
function usage(secrets: Secret[], tests: Test[]): Record<string, number> {
  return Object.fromEntries(
    secrets.map((s) => {
      const re = new RegExp(`secrets(?:\\.${s.name}\\b|\\[\\s*['"\`]${s.name}['"\`]\\s*\\])`)
      return [s.name, tests.filter((t) => re.test(t.code)).length]
    }),
  )
}

export default async function SecretsPage() {
  const [secrets, status, tests] = await Promise.all([
    apiGet<Secret[]>('/secrets', { auth: true }),
    apiGet<{ encryptionEnabled: boolean }>('/secrets/status', { auth: true }),
    apiGet<Test[]>('/tests', { auth: true }),
  ])
  const warning =
    status.ok && !status.data.encryptionEnabled ? (
      <Callout tone="degraded" title="Secrets are not encrypted.">
        Set <code>SECRETS_ENCRYPTION_KEY</code> on the server to encrypt values at rest. Until then they are stored as written.
      </Callout>
    ) : null
  return (
    <SecretsView
      secrets={secrets.ok ? secrets.data : []}
      usedBy={secrets.ok && tests.ok ? usage(secrets.data, tests.data) : null}
      notice={secrets.ok ? warning : <ApiErrorCallout what="secret list" error={secrets.error} />}
      failed={!secrets.ok}
    />
  )
}
