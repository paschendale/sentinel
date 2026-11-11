/**
 * Shown on the public status page between the header and the list of checks, on `/` and on
 * every `/status/[tag]` page. Upstream shows nothing here and never changes this file; a fork
 * replaces it (with a map, a banner, a summary) so pulling upstream does not conflict. It is a
 * Server Component: read only from the public API, like the rest of the page. See docs/FORKING.md.
 */
export function StatusLead(_props: { tag?: string }) {
  return null
}
