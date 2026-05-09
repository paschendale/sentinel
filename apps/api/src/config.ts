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
export const RAW_RETENTION_DAYS = parseIntEnvInRange('RAW_RETENTION_DAYS', 7, 1, 365)
export const AGG_RETENTION_DAYS = parseIntEnvInRange('AGG_RETENTION_DAYS', 90, 30, 180)
export const PRUNE_BATCH_SIZE = parseIntEnvInRange('PRUNE_BATCH_SIZE', 5000, 100, 50000)
