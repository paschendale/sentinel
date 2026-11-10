import { ButtonLink, EmptyState, PublicHeader } from '../_components/ui'

export default function PublicNotFound() {
  return (
    <>
      <PublicHeader title="Not found" />
      <EmptyState title="Nothing is here" actions={<ButtonLink href="/">Back to status</ButtonLink>}>
        This page does not exist, or the check is not published on the status page.
      </EmptyState>
    </>
  )
}
