import { redirect } from 'next/navigation'

// middleware.ts already redirects anonymous requests to /login before this ever renders,
// so '/' just forwards authenticated visitors to the test dashboard. The RBMC station map
// lives at /status.
export default function HomePage() {
  redirect('/tests')
}
