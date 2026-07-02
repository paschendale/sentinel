import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('secret-cipher (SECRETS_ENCRYPTION_KEY unset)', () => {
  it('reports encryption as not configured', async () => {
    const { isEncryptionConfigured } = await import('./secret-cipher.js')
    expect(isEncryptionConfigured()).toBe(false)
  })

  it('round-trips plaintext when no key is configured', async () => {
    const { encryptSecret, decryptSecret } = await import('./secret-cipher.js')
    const blob = encryptSecret('sk-hunter2')
    expect(decryptSecret(blob)).toBe('sk-hunter2')
  })

  it('writes an unencrypted (mode 0x00) blob when no key is configured', async () => {
    const { encryptSecret } = await import('./secret-cipher.js')
    const blob = encryptSecret('sk-hunter2')
    expect(blob[0]).toBe(0x00)
    // The plaintext bytes are recoverable directly from the blob — this is the point:
    // no key means no protection at rest, by design.
    expect(blob.subarray(1).toString('utf8')).toBe('sk-hunter2')
  })
})

describe('secret-cipher (SECRETS_ENCRYPTION_KEY configured)', () => {
  const validKey = Buffer.alloc(32, 7).toString('base64')

  beforeEach(() => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', validKey)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('reports encryption as configured', async () => {
    const { isEncryptionConfigured } = await import('./secret-cipher.js')
    expect(isEncryptionConfigured()).toBe(true)
  })

  it('round-trips a value through AES-256-GCM', async () => {
    const { encryptSecret, decryptSecret } = await import('./secret-cipher.js')
    const blob = encryptSecret('sk-hunter2')
    expect(decryptSecret(blob)).toBe('sk-hunter2')
  })

  it('writes an encrypted (mode 0x01) blob that does not contain the plaintext', async () => {
    const { encryptSecret } = await import('./secret-cipher.js')
    const blob = encryptSecret('sk-hunter2')
    expect(blob[0]).toBe(0x01)
    expect(blob.toString('latin1')).not.toContain('sk-hunter2')
  })

  it('uses a fresh IV per call, so identical plaintexts produce different ciphertexts', async () => {
    const { encryptSecret } = await import('./secret-cipher.js')
    const a = encryptSecret('sk-hunter2')
    const b = encryptSecret('sk-hunter2')
    expect(a.equals(b)).toBe(false)
  })

  it('throws on tampered ciphertext instead of returning garbage', async () => {
    const { encryptSecret, decryptSecret } = await import('./secret-cipher.js')
    const blob = encryptSecret('sk-hunter2')
    const tampered = Buffer.from(blob)
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) % 256
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('still decrypts a plaintext (mode 0x00) blob written before a key was configured', async () => {
    // Simulates upgrading a deployment: secrets created while the key was unset
    // must keep working once it's set, until individually rotated.
    const { decryptSecret } = await import('./secret-cipher.js')
    const legacyPlaintextBlob = Buffer.concat([Buffer.from([0x00]), Buffer.from('sk-legacy', 'utf8')])
    expect(decryptSecret(legacyPlaintextBlob)).toBe('sk-legacy')
  })
})

describe('secret-cipher (key removed after being used to encrypt)', () => {
  it('throws a clear error instead of silently failing', async () => {
    const validKey = Buffer.alloc(32, 7).toString('base64')
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', validKey)
    vi.resetModules()
    const { encryptSecret } = await import('./secret-cipher.js')
    const blob = encryptSecret('sk-hunter2')

    vi.unstubAllEnvs()
    vi.resetModules()
    const { decryptSecret } = await import('./secret-cipher.js')
    expect(() => decryptSecret(blob)).toThrow(/SECRETS_ENCRYPTION_KEY/)
  })
})
