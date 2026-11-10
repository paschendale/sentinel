import type { Metadata } from 'next'
import { SignInForm } from './sign-in-form'

export const metadata: Metadata = { title: 'Sign in' }

/** Sign-in. A signed-in operator is sent on to /admin/tests by the middleware. */
export default function SignInPage() {
  return <SignInForm />
}
