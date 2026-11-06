/** Credentials of a bot channel: the bot token and the channel it posts into. */
export interface BotCredentials {
  token: string
  channelRef: string
}

/** The provider's handles for one incident: the root message and the thread under it. */
export interface IncidentHandles {
  rootId: string
  threadId: string
}

export class TransportError extends Error {
  readonly httpStatus: number | null
  constructor(message: string, httpStatus: number | null = null) {
    super(message)
    this.name = 'TransportError'
    this.httpStatus = httpStatus
  }
}

/**
 * What a bot-backed channel can do that a webhook cannot: post a message it can later
 * edit, open a thread under it, reply in that thread, and close the thread.
 */
export interface IncidentTransport {
  /** Posts the root message and opens its thread. */
  open(creds: BotCredentials, root: Record<string, unknown>, threadName: string): Promise<IncidentHandles>
  /** Replaces the root message's content (state change, resolution). */
  updateRoot(creds: BotCredentials, handles: IncidentHandles, root: Record<string, unknown>): Promise<void>
  /** Posts one line inside the thread. */
  reply(creds: BotCredentials, handles: IncidentHandles, text: string): Promise<void>
  /** Marks the incident as over on the provider side (archive, reaction). Best effort. */
  close(creds: BotCredentials, handles: IncidentHandles): Promise<void>
  /** Posts a one-off message with no thread (delivery test). */
  post(creds: BotCredentials, message: Record<string, unknown>): Promise<void>
}
