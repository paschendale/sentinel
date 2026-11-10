import { DISCORD_API_URL } from '../../config.js'
import { notifyRequest } from '../http.js'
import { TransportError, type BotCredentials, type IncidentHandles, type IncidentTransport } from './types.js'

/** Public threads auto-archive after a day of silence; Sentinel archives explicitly on recovery. */
const THREAD_AUTO_ARCHIVE_MINUTES = 1440

/**
 * Discord REST API with a bot token. Needs View Channels, Send Messages, Create Public
 * Threads, Send Messages in Threads and Embed Links on the target channel.
 */
async function call(
  creds: BotCredentials,
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await notifyRequest(`${DISCORD_API_URL}${path}`, {
    method,
    headers: { authorization: `Bot ${creds.token}` },
    body,
  })
  const text = res.text
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new TransportError(`Discord ${method} ${path} returned HTTP ${res.statusCode}: ${text.slice(0, 200)}`, res.statusCode)
  }
  if (text === '') return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new TransportError(`Discord ${method} ${path} returned a non-JSON body`, res.statusCode)
  }
}

function idOf(obj: Record<string, unknown>, what: string): string {
  const id = obj['id']
  if (typeof id !== 'string' || id === '') throw new TransportError(`Discord returned no id for the ${what}`)
  return id
}

export const discordBotTransport: IncidentTransport = {
  async open(creds, root, threadName) {
    const message = await call(creds, 'POST', `/channels/${creds.channelRef}/messages`, root)
    const rootId = idOf(message, 'root message')
    const thread = await call(creds, 'POST', `/channels/${creds.channelRef}/messages/${rootId}/threads`, {
      name: threadName,
      auto_archive_duration: THREAD_AUTO_ARCHIVE_MINUTES,
    })
    return { rootId, threadId: idOf(thread, 'thread') }
  },
  async updateRoot(creds, handles, root) {
    await call(creds, 'PATCH', `/channels/${creds.channelRef}/messages/${handles.rootId}`, root)
  },
  async reply(creds, handles, text) {
    await call(creds, 'POST', `/channels/${handles.threadId}/messages`, { content: text })
  },
  async close(creds, handles) {
    try {
      await call(creds, 'PATCH', `/channels/${handles.threadId}`, { archived: true })
    } catch {
      // Archiving is cosmetic; the thread auto-archives after a day anyway.
    }
  },
  async post(creds, message) {
    await call(creds, 'POST', `/channels/${creds.channelRef}/messages`, message)
  },
}
