import { SLACK_API_URL } from '../../config.js'
import { notifyRequest } from '../http.js'
import { TransportError, type BotCredentials, type IncidentHandles, type IncidentTransport } from './types.js'

interface SlackResponse {
  ok: boolean
  error?: string
  ts?: string
}

/**
 * Slack Web API with a bot token (`xoxb-…`, scope `chat:write`; `reactions:write` optional).
 * Slack answers HTTP 200 with `ok: false` on failure, so the body is always inspected.
 */
async function call(creds: BotCredentials, method: string, body: Record<string, unknown>): Promise<SlackResponse> {
  const res = await notifyRequest(`${SLACK_API_URL}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${creds.token}` },
    body,
  })
  const text = res.text
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new TransportError(`Slack ${method} returned HTTP ${res.statusCode}: ${text.slice(0, 200)}`, res.statusCode)
  }
  let parsed: SlackResponse
  try {
    parsed = JSON.parse(text) as SlackResponse
  } catch {
    throw new TransportError(`Slack ${method} returned a non-JSON body`, res.statusCode)
  }
  if (!parsed.ok) throw new TransportError(`Slack ${method} failed: ${parsed.error ?? 'unknown error'}`, res.statusCode)
  return parsed
}

export const slackBotTransport: IncidentTransport = {
  async open(creds, root) {
    const res = await call(creds, 'chat.postMessage', { channel: creds.channelRef, ...root })
    if (!res.ts) throw new TransportError('Slack chat.postMessage returned no ts')
    // In Slack the root message's ts is the thread identifier.
    return { rootId: res.ts, threadId: res.ts }
  },
  async updateRoot(creds, handles, root) {
    await call(creds, 'chat.update', { channel: creds.channelRef, ts: handles.rootId, ...root })
  },
  async reply(creds, handles, text) {
    await call(creds, 'chat.postMessage', { channel: creds.channelRef, thread_ts: handles.threadId, text })
  },
  async close(creds, handles) {
    // A reaction is a nicety: tolerate a missing scope or a duplicate reaction.
    try {
      await call(creds, 'reactions.add', { channel: creds.channelRef, timestamp: handles.rootId, name: 'white_check_mark' })
    } catch {
      // ignored
    }
  },
  async post(creds, message) {
    await call(creds, 'chat.postMessage', { channel: creds.channelRef, ...message })
  },
}

