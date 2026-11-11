import path from 'path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  // Required for pnpm monorepos: traces files relative to the repo root
  // so standalone output contains apps/web/server.js (not standalone/server.js)
  outputFileTracingRoot: path.join(__dirname, '../../'),
  devIndicators: false,
  // Signed-in pages moved under /admin and the status page lives at /; the old paths keep working.
  async redirects() {
    return [
      { source: '/status', destination: '/', permanent: true },
      { source: '/login', destination: '/admin', permanent: true },
      { source: '/tests', destination: '/admin/tests', permanent: true },
      { source: '/tests/:path*', destination: '/admin/tests/:path*', permanent: true },
      { source: '/notifications', destination: '/admin/notifications', permanent: true },
      { source: '/channels', destination: '/admin/notifications', permanent: true },
      { source: '/secrets', destination: '/admin/secrets', permanent: true },
      { source: '/tokens', destination: '/admin/tokens', permanent: true },
    ]
  },
}

export default config
