import { NextRequest, NextResponse } from 'next/server'
import { TOKEN_COOKIE, isLiveToken } from './lib/auth-cookie'

/**
 * Everything under /admin needs a session, except /admin itself (the sign-in page), which
 * sends a signed-in operator on to /admin/tests. Public pages are never gated.
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  const signedIn = isLiveToken(req.cookies.get(TOKEN_COOKIE)?.value)
  if (pathname === '/admin' || pathname === '/admin/') {
    return signedIn ? NextResponse.redirect(new URL('/admin/tests', req.url)) : NextResponse.next()
  }
  if (pathname === '/admin/signout') return NextResponse.next()
  if (!signedIn) return NextResponse.redirect(new URL('/admin', req.url))
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
