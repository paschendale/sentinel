import { NextRequest, NextResponse } from 'next/server'

// maplibre-gl's tile-processing worker (RBMC branch, served from public/ — see next.config.ts):
// must be reachable by anonymous visitors of the public /status map, same as /status itself.
const PUBLIC_PATHS = ['/login', '/status', '/maplibre-gl-worker.mjs', '/maplibre-gl-shared.mjs']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  if (isPublicPath(pathname)) return NextResponse.next()

  const token = req.cookies.get('sentinel_token')?.value
  if (!token) {
    // The public map lives on /status — send anonymous visitors of the root there instead of the login form.
    if (pathname === '/') return NextResponse.redirect(new URL('/status', req.url))
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
