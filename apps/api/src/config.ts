import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`${name} is required`)
  return val
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  return raw === 'true' || raw === '1' || raw === 'yes'
}

function parseIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`${name} must be an integer`)
  }
  return parsed
}

function parseIntEnvInRange(name: string, defaultValue: number, min: number, max: number): number {
  const val = parseIntEnv(name, defaultValue)
  if (val < min || val > max) throw new Error(`${name} must be between ${min} and ${max}`)
  return val
}

/** `development` when unset — matches typical local `tsx` runs. */
export const NODE_ENV = optionalEnv('NODE_ENV', 'development')

export const LOG_LEVEL = optionalEnv('LOG_LEVEL', 'info')

/** Pretty one-line logs for humans (default on in non-production). JSON in production. */
export const LOG_PRETTY = parseBoolEnv('LOG_PRETTY', NODE_ENV !== 'production')

export const DATABASE_URL = requireEnv('DATABASE_URL')
export const ADMIN_USERNAME = requireEnv('ADMIN_USERNAME')
export const ADMIN_PASSWORD = requireEnv('ADMIN_PASSWORD')
export const JWT_SECRET = requireEnv('JWT_SECRET')
export const RESEND_API_KEY = optionalEnv('RESEND_API_KEY', '')
export const RESEND_FROM = optionalEnv('RESEND_FROM', '')

export const RAW_RETENTION_DAYS = parseIntEnvInRange('RAW_RETENTION_DAYS', 7, 1, 365)
export const AGG_RETENTION_DAYS = parseIntEnvInRange('AGG_RETENTION_DAYS', 90, 30, 180)
export const PRUNE_BATCH_SIZE = parseIntEnvInRange('PRUNE_BATCH_SIZE', 5000, 100, 50000)

/** Directory `ctx.ftp.get` and `ctx.s3.get` write temp downloads to. Files are deleted immediately after each call. */
export const FTP_TEMP_DIR = optionalEnv('FTP_TEMP_DIR', join(tmpdir(), 'sentinel-ftp'))
/** Shared download size cap for `ctx.ftp.get` and `ctx.s3.get` — both abort once a download exceeds this. */
export const FTP_MAX_DOWNLOAD_BYTES = parseIntEnvInRange(
  'FTP_MAX_DOWNLOAD_BYTES',
  5 * 1024 * 1024,
  1024,
  50 * 1024 * 1024
)
/** Safety-net sweep (also covers ctx.s3.get temp files, same directory): deletes any leftover temp file older than this (covers crashes / orphaned timeouts). */
export const FTP_TEMP_MAX_AGE_MS = parseIntEnvInRange('FTP_TEMP_MAX_AGE_MS', 15 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000)
export const FTP_TEMP_SWEEP_INTERVAL_MS = parseIntEnvInRange('FTP_TEMP_SWEEP_INTERVAL_MS', 10 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000)

/** Optional base64-encoded 32-byte (256-bit) AES-256-GCM key for encrypting secret
 *  values at rest. Generate with: openssl rand -base64 32
 *  If unset, secrets are stored UNENCRYPTED — ctx.secrets still works, but values
 *  aren't protected at rest. The /secrets page shows a warning banner when unset.
 *  No key-rotation/re-encryption tooling exists: secrets created/rotated before this
 *  key is set stay plaintext until individually rotated again after it's configured. */
export const SECRETS_ENCRYPTION_KEY = optionalEnv('SECRETS_ENCRYPTION_KEY', '')

if (SECRETS_ENCRYPTION_KEY && Buffer.from(SECRETS_ENCRYPTION_KEY, 'base64').length !== 32) {
  throw new Error('SECRETS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded)')
}

// ---------------------------------------------------------------------------
// RBMC branch — IBGE GNSS station monitoring (all optional, RULES #28)
// ---------------------------------------------------------------------------

/** Directory holding the IBGE `RBMCPoint.{shp,dbf}` shapefile — the source of truth for stations.
 *  Defaults to `apps/api/data/rbmc` resolved relative to this module, so it works both under `tsx`
 *  (`src/`) and compiled (`dist/`) regardless of the process cwd. Bind-mount a directory over it
 *  (or point this at one) to replace the station list; the sync picks up mtime changes. */
export const RBMC_SHAPEFILE_DIR = optionalEnv(
  'RBMC_SHAPEFILE_DIR',
  join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'rbmc')
)
export const RBMC_SHAPEFILE_BASENAME = 'RBMCPoint'

/** NTRIP caster sourcetable URL (`GET /`). The public RBMC-IP caster by default. */
export const RBMC_NTRIP_URL = optionalEnv('RBMC_NTRIP_URL', 'http://gps-ntrip.ibge.gov.br:2101/')
try {
  new URL(RBMC_NTRIP_URL)
} catch {
  throw new Error('RBMC_NTRIP_URL must be a valid URL')
}

/** How often the shapefile mtime is polled for changes (async `fs.stat`, cheap). */
export const RBMC_SYNC_POLL_MS = parseIntEnvInRange('RBMC_SYNC_POLL_MS', 60 * 1000, 5 * 1000, 60 * 60 * 1000)
