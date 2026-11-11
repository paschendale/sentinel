import { Brand, ButtonLink, EmptyState } from './_components/ui'

export default function NotFound() {
  return (
    <main className="sn-page sn-page--public sn">
      <Brand href="/" />
      <EmptyState title="Nothing is here" actions={<ButtonLink href="/">Back to status</ButtonLink>}>
        This page does not exist.
      </EmptyState>
    </main>
  )
}
