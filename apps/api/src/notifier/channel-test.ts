import { request } from 'undici'
import { isBotChannelType } from '@sentinel/shared'
import { RESEND_API_KEY, RESEND_FROM } from '../config.js'
import type { DeliverableChannel } from '../db/queries/channels.js'
import { withSentinelHeaders } from '../outbound-headers.js'
import { postStandalone } from './incidents.js'
import { escapeHtml, testMessage } from './payloads.js'
import { TransportError } from './transports/types.js'

/**
 * Sends a one-off "channel test" message through a channel, outside any incident, so a
 * new channel can be verified without a throwaway test. Throws TransportError on failure.
 */
export async function sendChannelTest(channel: DeliverableChannel): Promise<{ http_status: number | null }> {
  if (isBotChannelType(channel.type)) {
    await postStandalone(channel, testMessage(channel.type))
    return { http_status: 200 }
  }

  if (channel.type === 'email') {
    if (!RESEND_API_KEY) throw new TransportError('RESEND_API_KEY not configured')
    const subject = '🔔 Sentinel · channel test'
    const response = await request('https://api.resend.com/emails', {
      method: 'POST',
      headers: withSentinelHeaders({ 'content-type': 'application/json', authorization: `Bearer ${RESEND_API_KEY}` }),
      body: JSON.stringify({
        from: RESEND_FROM,
        to: channel.email_to ?? [],
        subject,
        html: `<p>${escapeHtml(subject)}</p><p>This channel is wired correctly. Alerts for assigned tests will arrive here.</p>`,
      }),
    })
    return checked(response.statusCode)
  }

  if (channel.webhook_url === null) throw new TransportError('channel has no webhook_url')
  const response = await request(channel.webhook_url, {
    method: 'POST',
    headers: withSentinelHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(testMessage(channel.type)),
  })
  return checked(response.statusCode)
}

function checked(statusCode: number): { http_status: number } {
  if (statusCode < 200 || statusCode >= 300) throw new TransportError(`non-2xx status: ${statusCode}`, statusCode)
  return { http_status: statusCode }
}
