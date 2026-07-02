import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { SECRETS_ENCRYPTION_KEY } from '../config.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

const MODE_PLAINTEXT = 0x00
const MODE_AES_256_GCM = 0x01

const key = SECRETS_ENCRYPTION_KEY ? Buffer.from(SECRETS_ENCRYPTION_KEY, 'base64') : null

export function isEncryptionConfigured(): boolean {
  return key !== null
}

/**
 * Encrypts (or, if SECRETS_ENCRYPTION_KEY is unset, plaintext-wraps) a secret value.
 * Returns a version-tagged blob: mode byte + payload, so plaintext and encrypted
 * secrets can coexist in the same table across a key being added/removed over time.
 */
export function encryptSecret(plaintext: string): Buffer {
  if (!key) {
    return Buffer.concat([Buffer.from([MODE_PLAINTEXT]), Buffer.from(plaintext, 'utf8')])
  }
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([MODE_AES_256_GCM]), iv, authTag, ciphertext])
}

/** Decrypts a blob produced by `encryptSecret`, transparently handling either mode. */
export function decryptSecret(blob: Buffer): string {
  const mode = blob[0]
  const payload = blob.subarray(1)

  if (mode === MODE_PLAINTEXT) {
    return payload.toString('utf8')
  }

  if (mode === MODE_AES_256_GCM) {
    if (!key) {
      throw new Error('secret is encrypted but SECRETS_ENCRYPTION_KEY is not set — cannot decrypt')
    }
    const iv = payload.subarray(0, IV_LENGTH)
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }

  throw new Error(`unknown secret blob mode: ${mode}`)
}
