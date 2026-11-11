import { request } from 'undici'
import { withSentinelHeaders } from '../outbound-headers.js'
import { TransportError } from './transports/types.js'

/** Every notification request (webhooks, email, bot APIs) gives up after this long. */
export const NOTIFY_TIMEOUT_MS = 10_000
/** Response bytes read from a notification endpoint; the rest is discarded. */
const MAX_RESPONSE_BYTES = 64 * 1024

export interface NotifyResponse {
  statusCode: number
  text: string
}

function isAsyncIterable(v: unknown): v is AsyncIterable<Uint8Array> & { destroy?: () => void } {
  return typeof v === 'object' && v !== null && typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
}

/** Reads at most MAX_RESPONSE_BYTES and always consumes or destroys the body, so the socket is released. */
async function readCapped(body: unknown): Promise<string> {
  if (!isAsyncIterable(body)) {
    const text = (body as { text?: unknown } | null | undefined)?.text
    return typeof text === 'function' ? String(await (text as () => Promise<string>).call(body)).slice(0, MAX_RESPONSE_BYTES) : ''
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of body) {
    size += chunk.byteLength
    chunks.push(Buffer.from(chunk))
    if (size >= MAX_RESPONSE_BYTES) {
      body.destroy?.()
      break
    }
  }
  return Buffer.concat(chunks).toString('utf8').slice(0, MAX_RESPONSE_BYTES)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'endpoint'
  }
}

/**
 * Sends one notification request with a timeout and reads (a capped part of) the response,
 * so a hung or chatty endpoint cannot hold a socket or the notifier. Throws TransportError
 * on timeout or network failure; non-2xx statuses are returned, not thrown.
 */
export async function notifyRequest(
  url: string,
  init: { method: 'POST' | 'PATCH'; headers?: Record<string, string>; body: unknown },
): Promise<NotifyResponse> {
  try {
    const res = await request(url, {
      method: init.method,
      headers: withSentinelHeaders({ 'content-type': 'application/json', ...init.headers }),
      body: JSON.stringify(init.body),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      headersTimeout: NOTIFY_TIMEOUT_MS,
      bodyTimeout: NOTIFY_TIMEOUT_MS,
    })
    const text = await readCapped(res.body)
    return { statusCode: res.statusCode, text }
  } catch (err) {
    if (err instanceof TransportError) throw err
    const name = err instanceof Error ? err.name : ''
    const message = err instanceof Error ? err.message : String(err)
    if (name === 'TimeoutError' || name === 'AbortError' || /timeout/i.test(message)) {
      throw new TransportError(`request to ${hostOf(url)} timed out after ${NOTIFY_TIMEOUT_MS} ms`)
    }
    throw new TransportError(`request to ${hostOf(url)} failed: ${message}`)
  }
}
