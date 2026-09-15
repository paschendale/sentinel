import { copyFileSync, mkdirSync } from 'fs'
import path from 'path'
import type { NextConfig } from 'next'

// maplibre-gl v6 ships as ESM and locates its tile-processing worker via `import.meta.url`
// relative to its own module — which resolves to a real CDN/static URL when loaded directly,
// but to a webpack chunk URL (not a servable path) once bundled by Next. The result is a worker
// created from an empty/invalid URL that silently never processes any tiles (RBMC branch: no
// basemap, no station markers, no error surfaced). The fix is `maplibregl.setWorkerUrl(...)`
// (apps/web/app/status/_components/rbmc-map.tsx) pointed at these two files served statically —
// the worker's own `./maplibre-gl-shared.mjs` import needs them side by side.
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  const dest = path.join(__dirname, 'public', file)
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(path.join(__dirname, 'node_modules/maplibre-gl/dist', file), dest)
}

const config: NextConfig = {
  output: 'standalone',
  // Required for pnpm monorepos: traces files relative to the repo root
  // so standalone output contains apps/web/server.js (not standalone/server.js)
  outputFileTracingRoot: path.join(__dirname, '../../'),
}

export default config
