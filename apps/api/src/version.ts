import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The release version, read once at startup. semantic-release bumps the root package.json;
 * the Docker images write it to a VERSION file next to dist/ (they ship no root package.json),
 * and a checkout finds the root package.json by walking up. Never throws.
 */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const file = join(here, '..', 'VERSION')
    if (existsSync(file)) {
      const v = readFileSync(file, 'utf8').trim()
      if (v !== '') return v
    }
    let dir = here
    for (let i = 0; i < 6; i++) {
      const pkg = join(dir, 'package.json')
      if (existsSync(pkg)) {
        const parsed: unknown = JSON.parse(readFileSync(pkg, 'utf8'))
        if (typeof parsed === 'object' && parsed !== null) {
          const { name, version } = parsed as { name?: unknown; version?: unknown }
          if (name === 'sentinel' && typeof version === 'string') return version
        }
      }
      dir = dirname(dir)
    }
  } catch {
    // fall through
  }
  return '0.0.0-dev'
}

export const SENTINEL_VERSION = readVersion()
