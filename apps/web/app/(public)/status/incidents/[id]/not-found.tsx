import { ButtonLink, EmptyState, PublicHeader } from '../../../../_components/ui'

export default function IncidentNotFound() {
  return (
    <>
      <PublicHeader title="Incident not found" />
      <EmptyState title="Nothing is published here" actions={<ButtonLink href="/">Back to status</ButtonLink>}>
        This incident does not exist or has not been published.
      </EmptyState>
    </>
  )
}
