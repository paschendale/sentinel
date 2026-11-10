import { NextResponse, type NextRequest } from 'next/server'
import { TOKEN_COOKIE } from '../../../lib/auth-cookie'

/** Sign out: drop the session cookie and return to the sign-in page. Also used when the API answers 401. */
export function GET(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/admin', req.url))
  res.cookies.set(TOKEN_COOKIE, '', { path: '/', expires: new Date(0) })
  return res
}
