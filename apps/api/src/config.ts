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

/** `development` when unset — matches typical local `tsx` runs. */
export const NODE_ENV = optionalEnv('NODE_ENV', 'development')

export const LOG_LEVEL = optionalEnv('LOG_LEVEL', 'info')

/** Pretty one-line logs for humans (default on in non-production). JSON in production. */
export const LOG_PRETTY = parseBoolEnv('LOG_PRETTY', NODE_ENV !== 'production')

export const DATABASE_URL = requireEnv('DATABASE_URL')
export const ADMIN_USERNAME = requireEnv('ADMIN_USERNAME')
export const ADMIN_PASSWORD = requireEnv('ADMIN_PASSWORD')
export const JWT_SECRET = requireEnv('JWT_SECRET')
